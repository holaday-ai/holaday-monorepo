import type { ServerMessage } from '@holaday/shared-types';
import { create } from 'zustand';
import { trpc } from '@/lib/trpc';
import type { UiScreencast, UiStep, UiTask, UiTaskStatus } from '@/types/task';

/**
 * Single source of truth for the task list + selection. Data flows in
 * from two places:
 *   1. `refreshTasks()` — tRPC `tasks.list`, called on login and after
 *      a new task is created (optimistic append + server truth).
 *   2. `applyServerMessage()` — WS server frames. task.terminal flips
 *      the status / stores the result; G4 wires the per-tick ticks.
 *
 * Kept as a plain zustand store (no slices, no middleware) — the UI
 * surface is small and the hot path is a single selector.
 */
export interface TaskStore {
  tasks: UiTask[];
  selectedTaskId: string | null;
  loading: boolean;
  error: string | null;
  /** Per-task step streams, keyed by taskId. */
  stepsByTask: Record<string, UiStep[]>;
  /** Latest screencast frame per task (G5). */
  screencastByTask: Record<string, UiScreencast>;

  setSelectedTask(taskId: string | null): void;
  refreshTasks(): Promise<void>;
  createTask(intent: string): Promise<{ taskId: string } | { error: string }>;
  applyServerMessage(msg: ServerMessage): void;
  reset(): void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  loading: false,
  error: null,
  stepsByTask: {},
  screencastByTask: {},

  setSelectedTask(taskId) {
    set({ selectedTaskId: taskId });
  },

  async refreshTasks() {
    set({ loading: true, error: null });
    try {
      const res = await trpc.tasks.list.query({ limit: 50 });
      const tasks: UiTask[] = res.tasks.map(toUiTask);
      set((prev) => ({
        tasks,
        loading: false,
        // keep the current selection if it still exists; otherwise pick the newest.
        selectedTaskId:
          prev.selectedTaskId && tasks.some((t) => t.taskId === prev.selectedTaskId)
            ? prev.selectedTaskId
            : (tasks[0]?.taskId ?? null),
      }));
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  async createTask(intent) {
    try {
      const res = await trpc.tasks.create.mutate({ intent });
      // Optimistic insert at the top so the UI feels instant; the next
      // refreshTasks() will pick up the canonical server row.
      const now = new Date();
      const optimistic: UiTask = {
        taskId: res.taskId,
        intent,
        status: (res.status as UiTaskStatus) ?? 'executing',
        tickCount: 0,
        createdAt: now,
      };
      set((prev) => ({
        tasks: [optimistic, ...prev.tasks.filter((t) => t.taskId !== res.taskId)],
        selectedTaskId: res.taskId,
      }));
      // Fire-and-forget refresh so the row's server-authored fields
      // (createdAt, status) replace the optimistic stub once available.
      void get().refreshTasks();
      return { taskId: res.taskId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      return { error: msg };
    }
  },

  applyServerMessage(msg) {
    if (msg.type === 'server.task.terminal') {
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.taskId === msg.taskId
            ? {
                ...t,
                status: msg.status,
                ...(msg.summary ? { resultText: msg.summary } : {}),
                ...(msg.reason ? { resultText: msg.reason } : {}),
              }
            : t,
        ),
      }));
      return;
    }
    if (msg.type === 'server.task.queued') {
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.taskId === msg.taskId ? { ...t, queuePosition: msg.position } : t,
        ),
      }));
      return;
    }
    if (msg.type === 'server.vision.tick.start') {
      set((prev) => {
        const existing = prev.stepsByTask[msg.taskId] ?? [];
        // Idempotent: a reconnected WS may replay a recent tick. If
        // we already have the step, leave it alone.
        if (existing.some((s) => s.tickIndex === msg.tickIndex)) return prev;
        const next: UiStep = {
          tickIndex: msg.tickIndex,
          status: 'running',
          startedAt: Date.now(),
        };
        return {
          stepsByTask: { ...prev.stepsByTask, [msg.taskId]: [...existing, next] },
          tasks: prev.tasks.map((t) => {
            if (t.taskId !== msg.taskId) return t;
            const { queuePosition: _queuePosition, ...rest } = t;
            void _queuePosition;
            return { ...rest, tickCount: Math.max(t.tickCount, msg.tickIndex + 1) };
          }),
        };
      });
      return;
    }
    if (msg.type === 'server.vision.tick.end') {
      // Layer 3: forward the anti-bot tag into the UI step. When the
      // orchestrator flagged this tick as captcha / verify / block /
      // cloudflare, StepCard renders an orange warning badge instead
      // of plain green/red.
      const antiBotTag = msg.antiBot
        ? {
            type: msg.antiBot.type,
            confidence: msg.antiBot.confidence,
            message: msg.antiBot.message,
          }
        : undefined;
      set((prev) => {
        const existing = prev.stepsByTask[msg.taskId] ?? [];
        let matched = false;
        const updated = existing.map((s) => {
          if (s.tickIndex !== msg.tickIndex) return s;
          matched = true;
          return {
            ...s,
            status: msg.ok ? ('done' as const) : ('failed' as const),
            actionKind: msg.actionKind,
            actionSummary: msg.actionSummary,
            durationMs: msg.durationMs,
            ...(msg.message ? { message: msg.message } : {}),
            ...(antiBotTag ? { antiBot: antiBotTag } : {}),
          };
        });
        // Missed tick.start (e.g. reconnected mid-task): synthesise
        // the step from the end frame so nothing's dropped.
        const finalList = matched
          ? updated
          : [
              ...existing,
              {
                tickIndex: msg.tickIndex,
                status: msg.ok ? ('done' as const) : ('failed' as const),
                actionKind: msg.actionKind,
                actionSummary: msg.actionSummary,
                durationMs: msg.durationMs,
                ...(msg.message ? { message: msg.message } : {}),
                ...(antiBotTag ? { antiBot: antiBotTag } : {}),
                startedAt: Date.now() - msg.durationMs,
              } satisfies UiStep,
            ];
        finalList.sort((a, b) => a.tickIndex - b.tickIndex);
        return {
          stepsByTask: { ...prev.stepsByTask, [msg.taskId]: finalList },
          tasks: prev.tasks.map((t) =>
            t.taskId === msg.taskId ? { ...t, tickCount: Math.max(t.tickCount, msg.tickIndex + 1) } : t,
          ),
        };
      });
      return;
    }
    if (msg.type === 'server.vision.screencast') {
      set((prev) => ({
        screencastByTask: {
          ...prev.screencastByTask,
          [msg.taskId]: {
            tickIndex: msg.tickIndex,
            imageBase64: msg.imageBase64,
            url: msg.url,
            viewport: msg.viewport,
            timestamp: msg.timestamp,
          },
        },
      }));
      return;
    }
    // Other frames (vision.observe / vision.act / user.confirm / ...)
    // aren't UI-relevant yet; silently ignore.
  },

  reset() {
    set({
      tasks: [],
      selectedTaskId: null,
      loading: false,
      error: null,
      stepsByTask: {},
      screencastByTask: {},
    });
  },
}));

// Dev helper — pins the store on `window.__taskStore` so browser-based
// smoke tests can inject fake server frames without spinning up the
// orchestrator. Stripped out of production builds by vite's DEV flag.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __taskStore?: typeof useTaskStore }).__taskStore = useTaskStore;
}

type ListRow = Awaited<ReturnType<typeof trpc.tasks.list.query>>['tasks'][number];

function toUiTask(row: ListRow): UiTask {
  return {
    taskId: row.taskId,
    intent: row.intent,
    status: normaliseStatus(row.status),
    // The list endpoint doesn't expose tickCount directly; we leave 0
    // for now and let G4's ws events fill it in as ticks stream.
    tickCount: 0,
    ...(typeof row.errorMessage === 'string' ? { resultText: row.errorMessage } : {}),
    // tRPC serializes Date to string over the wire; coerce back.
    createdAt: new Date(row.createdAt as unknown as string | number | Date),
  };
}

function normaliseStatus(raw: string): UiTaskStatus {
  // The orchestrator has a richer status set (planning, pending,
  // awaiting_user, ...). Map everything we don't display onto an
  // active/paused bucket so the sidebar stays readable.
  switch (raw) {
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'paused':
    case 'executing':
      return raw;
    case 'awaiting_user':
      return 'paused';
    default:
      return 'executing';
  }
}
