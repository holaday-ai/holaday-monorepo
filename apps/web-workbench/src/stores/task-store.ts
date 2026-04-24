import type { ServerMessage } from '@holaday/shared-types';
import { create } from 'zustand';
import { trpc } from '@/lib/trpc';
import type {
  UiAwaitingUser,
  UiCaptchaWait,
  UiDegradeEvent,
  UiExecutorFallback,
  UiScreencast,
  UiStep,
  UiTask,
  UiTaskStatus,
  UiThinkingEvent,
  UiWebSearchEvent,
} from '@/types/task';

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
  /** Active captcha-wait state per task (Layer 4). */
  captchaWaitByTask: Record<string, UiCaptchaWait>;
  /** Sticky executor-fallback notice per task (Layer 5). */
  executorFallbackByTask: Record<string, UiExecutorFallback>;
  /** Latest degradation-chain attempt per task — most recent wins. */
  degradeByTask: Record<string, UiDegradeEvent>;
  /** Supercar: current "agent asked a question" state per task. Cleared on reply. */
  awaitingUserByTask: Record<string, UiAwaitingUser>;
  /** Supercar: most recent web_search event per task. */
  webSearchByTask: Record<string, UiWebSearchEvent>;
  /** Supercar: latest extended-thinking summary per task. */
  thinkingByTask: Record<string, UiThinkingEvent>;
  /** BrowserPanel interactive-mode toggle, shared app-wide so the
   *  terminal summary's "Continue in browser" button can flip it on. */
  browserInteractive: boolean;
  setBrowserInteractive(v: boolean): void;

  /** Task ids the user has pinned to the top of the sidebar.
   *  Persisted in localStorage — no backend column yet. */
  pinnedTaskIds: ReadonlySet<string>;
  togglePin(taskId: string): void;

  setSelectedTask(taskId: string | null): void;
  refreshTasks(): Promise<void>;
  createTask(intent: string): Promise<{ taskId: string } | { error: string }>;
  deleteTask(taskId: string): Promise<{ ok: true } | { error: string }>;
  replyToTask(taskId: string, message: string): Promise<{ ok: boolean } | { error: string }>;
  abortTask(taskId: string): Promise<{ ok: boolean } | { error: string }>;
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
  captchaWaitByTask: {},
  executorFallbackByTask: {},
  degradeByTask: {},
  awaitingUserByTask: {},
  webSearchByTask: {},
  thinkingByTask: {},
  // Default ON: with the VNC lane live, view-only is the defensive
  // crouch. Users that never toggle this flag still get interactive
  // clicks, which matches the product promise ("watch the agent,
  // take over when you want to"). The toggle in the Panel header
  // still flips it off for "don't let me accidentally click the
  // captcha solution the agent is staring at".
  browserInteractive: true,
  setBrowserInteractive(v) {
    set({ browserInteractive: v });
  },

  pinnedTaskIds: readPinnedFromStorage(),
  togglePin(taskId) {
    set((prev) => {
      const next = new Set(prev.pinnedTaskIds);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      writePinnedToStorage(next);
      return { pinnedTaskIds: next };
    });
  },

  setSelectedTask(taskId) {
    set({ selectedTaskId: taskId });
    // Bug 4 — hydrate persisted steps + result when the user picks a
    // task from the side nav. Without this, a closed-and-reopened tab
    // shows an empty task because all the WS-driven step-state was
    // in-memory only.
    if (taskId) {
      void (async () => {
        try {
          const detail = await trpc.tasks.detail.query({ taskId });
          const steps: UiStep[] = (detail.steps ?? []).map((s, idx) => {
            const out = (s.output ?? {}) as {
              message?: string;
              mode?: string;
              durationMs?: number;
              antiBot?: UiStep['antiBot'];
            };
            const summary =
              ((s.input ?? {}) as { summary?: string }).summary ?? s.kind;
            const startedAt = s.startedAt
              ? new Date(s.startedAt as unknown as string | number | Date).getTime()
              : Date.now();
            return {
              tickIndex: typeof s.seq === 'number' ? s.seq : idx,
              status: s.status === 'done' ? 'done' : 'failed',
              actionKind: s.kind,
              actionSummary: summary,
              durationMs: out.durationMs ?? 0,
              ...(out.message ? { message: out.message } : {}),
              ...(out.antiBot ? { antiBot: out.antiBot } : {}),
              startedAt,
            };
          });
          set((prev) => {
            const resultText = extractSummary(detail.result) ?? undefined;
            return {
              stepsByTask: { ...prev.stepsByTask, [taskId]: steps },
              tasks: prev.tasks.map((t) =>
                t.taskId === taskId
                  ? {
                      ...t,
                      status: detail.status as UiTaskStatus,
                      tickCount: Math.max(t.tickCount, steps.length),
                      ...(resultText ? { resultText } : {}),
                    }
                  : t,
              ),
            };
          });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      })();
    }
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

  async deleteTask(taskId) {
    try {
      await trpc.tasks.delete.mutate({ taskId });
      set((prev) => {
        const stepsByTask = { ...prev.stepsByTask };
        delete stepsByTask[taskId];
        const screencastByTask = { ...prev.screencastByTask };
        delete screencastByTask[taskId];
        const captchaWaitByTask = { ...prev.captchaWaitByTask };
        delete captchaWaitByTask[taskId];
        const executorFallbackByTask = { ...prev.executorFallbackByTask };
        delete executorFallbackByTask[taskId];
        const degradeByTask = { ...prev.degradeByTask };
        delete degradeByTask[taskId];
        const nextTasks = prev.tasks.filter((t) => t.taskId !== taskId);
        const nextSelected =
          prev.selectedTaskId === taskId ? (nextTasks[0]?.taskId ?? null) : prev.selectedTaskId;
        return {
          tasks: nextTasks,
          selectedTaskId: nextSelected,
          stepsByTask,
          screencastByTask,
          captchaWaitByTask,
          executorFallbackByTask,
          degradeByTask,
        };
      });
      return { ok: true as const };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      return { error: msg };
    }
  },

  async replyToTask(taskId, message) {
    try {
      const res = await trpc.tasks.reply.mutate({ taskId, message });
      if (res.ok) {
        // Optimistically clear the awaiting-user state so the composer
        // flips back to the default mode. The agent's actual response
        // will flow in through subsequent tick frames.
        set((prev) => {
          const next = { ...prev.awaitingUserByTask };
          delete next[taskId];
          return { awaitingUserByTask: next };
        });
      }
      return { ok: res.ok };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      return { error: msg };
    }
  },

  async abortTask(taskId) {
    try {
      const res = await trpc.tasks.abort.mutate({ taskId });
      // Optimistic status flip so the UI doesn't keep showing the
      // task as executing until the terminal frame arrives. The
      // server's own terminal broadcast (status='cancelled') will
      // overwrite this in applyServerMessage on the same tick.
      if (res.ok) {
        set((prev) => ({
          tasks: prev.tasks.map((t) =>
            t.taskId === taskId ? { ...t, status: 'cancelled' as const } : t,
          ),
        }));
      }
      return { ok: res.ok };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      return { error: msg };
    }
  },

  async createTask(intent) {
    // Reject intents that are obviously control commands typed into
    // the wrong box (e.g. user typing "停止" into the composer
    // because they didn't see the Stop button). Fails client-side
    // with a clear error — no server round-trip, no orphan row.
    const trimmed = intent.trim();
    if (CONTROL_WORDS.has(trimmed.toLowerCase())) {
      const msg = `"${trimmed}" 是控制词，不是任务指令。要停止任务请用 Panel 右上角的"停止"按钮。`;
      set({ error: msg });
      return { error: msg };
    }
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
    if (msg.type === 'server.vision.captcha_detected') {
      const startedAt = Date.now();
      set((prev) => ({
        captchaWaitByTask: {
          ...prev.captchaWaitByTask,
          [msg.taskId]: {
            antiBotType: msg.antiBotType,
            message: msg.message,
            startedAt,
            deadlineMs: startedAt + msg.waitTimeoutMs,
          },
        },
      }));
      return;
    }
    if (msg.type === 'server.vision.captcha_resolved') {
      set((prev) => {
        const next = { ...prev.captchaWaitByTask };
        delete next[msg.taskId];
        return { captchaWaitByTask: next };
      });
      return;
    }
    if (msg.type === 'server.vision.degrade') {
      set((prev) => ({
        degradeByTask: {
          ...prev.degradeByTask,
          [msg.taskId]: {
            level: msg.level,
            strategy: msg.strategy,
            ok: msg.ok,
            message: msg.message,
            ...(msg.handoffToExtension ? { handoffToExtension: true } : {}),
            ...(msg.nextUrl ? { nextUrl: msg.nextUrl } : {}),
            at: Date.now(),
          },
        },
      }));
      return;
    }
    if (msg.type === 'server.vision.executor_fallback') {
      set((prev) => ({
        executorFallbackByTask: {
          ...prev.executorFallbackByTask,
          [msg.taskId]: { available: msg.available, at: Date.now() },
        },
      }));
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
    if (msg.type === 'server.supercar.awaiting_user') {
      set((prev) => ({
        awaitingUserByTask: {
          ...prev.awaitingUserByTask,
          [msg.taskId]: { question: msg.question, at: Date.now() },
        },
      }));
      return;
    }
    if (msg.type === 'server.supercar.web_search') {
      set((prev) => ({
        webSearchByTask: {
          ...prev.webSearchByTask,
          [msg.taskId]: { iteration: msg.iteration, query: msg.query, at: Date.now() },
        },
      }));
      return;
    }
    if (msg.type === 'server.supercar.thinking') {
      set((prev) => ({
        thinkingByTask: {
          ...prev.thinkingByTask,
          [msg.taskId]: { summary: msg.summary, at: Date.now() },
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
      captchaWaitByTask: {},
      executorFallbackByTask: {},
      degradeByTask: {},
      awaitingUserByTask: {},
      webSearchByTask: {},
      thinkingByTask: {},
    });
  },
}));

// Pinned-task persistence. Trivial JSON array of taskIds in
// localStorage — no sync across devices, no backend column. Good
// enough until we have user preferences as a first-class backend
// feature.
const PINNED_KEY = 'holaday.pinnedTasks';
function readPinnedFromStorage(): ReadonlySet<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(PINNED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x) => typeof x === 'string'));
  } catch {
    return new Set();
  }
}
function writePinnedToStorage(ids: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PINNED_KEY, JSON.stringify([...ids]));
  } catch {
    // Quota / private-mode failure — losing the pin list is
    // acceptable vs crashing the set-state call.
  }
}

// Short-list of control-shaped strings that should NEVER become a new
// task intent. Matched case-insensitive + whole-string; a task legitimately
// asking the agent to "停止" some external action would be phrased as a
// full sentence and wouldn't match.
const CONTROL_WORDS: ReadonlySet<string> = new Set([
  '停止',
  '取消',
  '暂停',
  '结束',
  '关闭',
  'stop',
  'cancel',
  'pause',
  'abort',
  'kill',
  'quit',
]);

// Dev helper — pins the store on `window.__taskStore` so browser-based
// smoke tests can inject fake server frames without spinning up the
// orchestrator. Stripped out of production builds by vite's DEV flag.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __taskStore?: typeof useTaskStore }).__taskStore = useTaskStore;
}

type ListRow = Awaited<ReturnType<typeof trpc.tasks.list.query>>['tasks'][number];

/**
 * Pull a human-readable summary string out of the task.detail.result
 * JSON blob. The orchestrator shoves different shapes in here:
 *   { summary: "..." }  — on status=completed
 *   { reason:  "..." }  — on status=failed / paused
 * Returns null when result is absent or doesn't match either shape.
 */
function extractSummary(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (typeof r.summary === 'string' && r.summary.length > 0) return r.summary;
  if (typeof r.reason === 'string' && r.reason.length > 0) return r.reason;
  return null;
}

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
