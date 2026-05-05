import type { ServerMessage } from '@holaday/shared-types';
import { create } from 'zustand';
import { humaniseTaskError } from '@/lib/error-copy';
import { hdDebug } from '@/lib/hd-debug';
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
  /**
   * Follow-up user messages for a task. The initial intent renders as
   * the first user bubble; every `tasks.reply` succeeds pushes the
   * typed text here so the conversation stays visible after send.
   */
  userRepliesByTask: Record<string, Array<{ at: number; text: string }>>;
  /** Supercar: most recent web_search event per task. */
  webSearchByTask: Record<string, UiWebSearchEvent>;
  /** Supercar: latest extended-thinking summary per task. */
  thinkingByTask: Record<string, UiThinkingEvent>;
  /**
   * Phase 24 RC follow-up — running streaming buffer for generate
   * and scrape mode tasks. Each `server.task.stream` delta gets
   * appended. PERSISTS past terminal — the render gate prefers
   * `task.resultText` when set, falls back to this buffer when
   * resultText hasn't loaded yet (covers the ~200ms gap between
   * terminal arrival and tasks.detail merging the canonical
   * summary). Without this, the streaming view disappeared on
   * terminal then reappeared as TerminalSummary, perceived as
   * "two playbacks".
   */
  streamingByTask: Record<string, string>;
  /**
   * Phase 24 RC follow-up — coarse progress message for runners with
   * a non-streaming pre-phase (today: scrape's Firecrawl-fetch
   * window). Latest-wins per task. PERSISTS past terminal — same
   * rationale as streamingByTask.
   */
  progressByTask: Record<string, string>;
  /**
   * Phase 24 RC follow-up — set of taskIds that have reached a
   * terminal state (server.task.terminal received). The
   * stale-delta guard for stream / progress handlers checks THIS
   * set instead of `prev.tasks.find(...).status` because the
   * tasks array is populated asynchronously (initial list query)
   * and a delta arriving before the task row is in the array
   * would otherwise see status='unknown' and skip the guard.
   * Set membership is the authoritative "this task is done"
   * signal for the SPA's runtime.
   */
  terminalTaskIds: ReadonlySet<string>;
  /**
   * O5 — backend-generated follow-up suggestions per task. Populated
   * when the orchestrator's `generateSuggestions` call resolves
   * after a task's terminal frame. TaskStream prefers this over the
   * markdown-parsed in-summary block.
   */
  suggestionsByTask: Record<string, string[]>;
  /** BrowserPanel interactive-mode toggle, shared app-wide so the
   *  terminal summary's "Continue in browser" button can flip it on. */
  browserInteractive: boolean;
  setBrowserInteractive(v: boolean): void;

  /** Task ids the user has pinned to the top of the sidebar.
   *  Persisted in localStorage — no backend column yet. */
  pinnedTaskIds: ReadonlySet<string>;
  togglePin(taskId: string): void;

  selectAndHydrateTask(taskId: string | null): void;
  refreshTasks(): Promise<void>;
  /**
   * Phase 24 RC follow-up — older tasks beyond the first page. Cursor
   * comes from the previous page's `nextCursor`; null means no more
   * pages. The store appends to `tasks` and stops setting
   * `tasksHasMore` once the server returns null.
   */
  loadMoreTasks(): Promise<void>;
  /** Cursor for the NEXT page (server returns this as nextCursor). */
  tasksCursor: number | null;
  /** False once the server reports no more pages. */
  tasksHasMore: boolean;
  /** Loading flag specific to the load-more action (so the button can spin without re-blanking the list). */
  loadingMore: boolean;
  /** Phase 16 — toggle the starred flag on a task. Optimistic. */
  toggleStarred(taskId: string): Promise<void>;
  /**
   * Phase 16b — move a task into a project (or out of one when
   * projectId === null). Optimistic; reverts the row on server error.
   */
  moveTaskToProject(taskId: string, projectId: string | null): Promise<void>;
  createTask(
    intent: string,
    fileIds?: string[],
    /**
     * Phase 14 audit follow-up — when set, server treats this as
     * a 追问 of the parent task: skips quota and prepends the
     * parent's intent + summary so the agent has full context.
     * The parent must be in a terminal state (completed/failed/cancelled).
     */
    replyToTaskId?: string,
    /** O4 — 'plan' makes agent emit + wait-for-approval before executing. */
    mode?: 'auto' | 'plan',
  ): Promise<{ taskId: string } | { error: string }>;
  deleteTask(taskId: string): Promise<{ ok: true } | { error: string }>;
  renameTask(taskId: string, title: string): Promise<{ ok: true } | { error: string }>;
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
  // Phase 24 RC follow-up — pagination state.
  tasksCursor: null,
  tasksHasMore: false,
  loadingMore: false,
  stepsByTask: {},
  screencastByTask: {},
  captchaWaitByTask: {},
  executorFallbackByTask: {},
  degradeByTask: {},
  awaitingUserByTask: {},
  userRepliesByTask: {},
  webSearchByTask: {},
  thinkingByTask: {},
  suggestionsByTask: {},
  streamingByTask: {},
  progressByTask: {},
  terminalTaskIds: new Set<string>(),
  // Default OFF: the product story is "watch the agent" — the user
  // observes by default and only takes over when they explicitly
  // click the takeover button or the agent enters awaiting_user /
  // captcha. Defaulting ON contradicted the framing and surfaced
  // confusing "你正在直接操作浏览器" copy on completed tasks.
  browserInteractive: false,
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

  selectAndHydrateTask(taskId) {
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
            const rawResultText = extractSummary(detail.result);
            // Failed-task path stores the same technical English in
            // `result.reason` as in `error_message`; humanise both so
            // the SPA never renders raw "exhausted maxIterations" /
            // "Anthropic API error 4xx" / etc. Only failed/cancelled
            // tasks go through the transformer — completed tasks'
            // summary is the agent's own reply text and shouldn't be
            // touched.
            const isFailed =
              detail.status === 'failed' || detail.status === 'cancelled';
            const resultText = rawResultText
              ? isFailed
                ? humaniseTaskError(rawResultText)
                : rawResultText
              : undefined;
            // Phase 13 Dim 1 — hydrate plan body + status from the
            // persisted columns (server.task.plan was a one-shot
            // broadcast at task start; this picks up the plan when
            // the user re-opens a tab later).
            const detailWithPlan = detail as typeof detail & {
              planText?: string | null;
              planStatus?: UiTask['planStatus'] | null;
            };
            const planText = detailWithPlan.planText ?? undefined;
            const planStatus = (detailWithPlan.planStatus as UiTask['planStatus']) ?? undefined;
            // R7 — pull the final-state evidence out of result JSON.
            // tasks.detail is the only path that ships finalScreenshot;
            // tasks.list strips it. So this hydration is the SOLE way
            // the SPA learns about the captured screenshot.
            const resultObj = (detail.result ?? {}) as {
              finalScreenshot?: string;
              finalUrl?: string;
            };
            const finalScreenshot =
              typeof resultObj.finalScreenshot === 'string' && resultObj.finalScreenshot.length > 0
                ? resultObj.finalScreenshot
                : undefined;
            const finalUrl =
              typeof resultObj.finalUrl === 'string' && resultObj.finalUrl.length > 0
                ? resultObj.finalUrl
                : undefined;
            // R6 — rebuild webSearchByTask from persisted step.output.
            // The WS-live state stores the LAST web_search per task
            // (latest-wins). Hydration mirrors that: walk steps in
            // ascending seq, take the last entry of the last step
            // that carried `webSearches`. End state matches what a
            // user-without-refresh would have seen.
            let hydratedWebSearch: UiWebSearchEvent | null = null;
            for (const s of detail.steps ?? []) {
              const out = (s.output ?? {}) as {
                webSearches?: ReadonlyArray<{
                  query: string;
                  sources?: ReadonlyArray<{ title: string; url: string; snippet?: string }>;
                }>;
              };
              const arr = out.webSearches;
              if (!arr || arr.length === 0) continue;
              const last = arr[arr.length - 1];
              if (!last) continue;
              hydratedWebSearch = {
                iteration: typeof s.seq === 'number' ? s.seq : 0,
                query: last.query,
                at: Date.now(),
                ...(last.sources && last.sources.length > 0
                  ? { sources: last.sources }
                  : {}),
              };
            }
            // F11 → P1.1 — rehydrate the awaiting_user prompt from
            // the persisted column so a refresh during the pause
            // re-renders the input box. Only meaningful while the
            // task is actually awaiting; otherwise we drop the
            // prompt to avoid stale render after resume.
            const awaitingQuestion =
              detail.status === 'awaiting_user' &&
              typeof (detail as { awaitingQuestion?: string | null }).awaitingQuestion === 'string'
                ? ((detail as { awaitingQuestion?: string | null }).awaitingQuestion ?? null)
                : null;
            return {
              stepsByTask: { ...prev.stepsByTask, [taskId]: steps },
              ...(hydratedWebSearch
                ? {
                    webSearchByTask: {
                      ...prev.webSearchByTask,
                      [taskId]: hydratedWebSearch,
                    },
                  }
                : {}),
              awaitingUserByTask: awaitingQuestion
                ? {
                    ...prev.awaitingUserByTask,
                    [taskId]: { question: awaitingQuestion, at: Date.now() },
                  }
                : (() => {
                    // Strip any stale entry — the live WS path also
                    // clears once the task moves out of awaiting_user.
                    if (!prev.awaitingUserByTask[taskId]) return prev.awaitingUserByTask;
                    const next = { ...prev.awaitingUserByTask };
                    delete next[taskId];
                    return next;
                  })(),
              tasks: (() => {
                const exists = prev.tasks.some((t) => t.taskId === taskId);
                if (exists) {
                  return prev.tasks.map((t) =>
                    t.taskId === taskId
                      ? {
                          ...t,
                          status: detail.status as UiTaskStatus,
                          tickCount: Math.max(t.tickCount, steps.length),
                          ...(resultText ? { resultText } : {}),
                          ...(planText ? { planText } : {}),
                          ...(planStatus ? { planStatus } : {}),
                          ...(finalScreenshot ? { finalScreenshot } : {}),
                          ...(finalUrl ? { finalUrl } : {}),
                        }
                      : t,
                  );
                }
                // P1-C — deep link to a task older than the first
                // page. List didn't ship this row, so synthesise a
                // UiTask from the detail and prepend. Without this
                // the panel renders blank because activeTask is
                // null and finalScreenshot can't surface.
                const detailExtras = detail as typeof detail & {
                  opusUsed?: boolean;
                  starred?: boolean;
                  starredAt?: Date | string | null;
                  projectId?: string | null;
                };
                const synth: UiTask = {
                  taskId,
                  intent: detail.intent,
                  title:
                    typeof detail.title === 'string' ? detail.title : null,
                  status: detail.status as UiTaskStatus,
                  tickCount: steps.length,
                  ...(resultText ? { resultText } : {}),
                  createdAt: new Date(
                    detail.createdAt as unknown as string | number | Date,
                  ),
                  modelLabel: detailExtras.opusUsed === true ? 'opus' : 'sonnet',
                  starred: detailExtras.starred === true,
                  starredAt: detailExtras.starredAt
                    ? new Date(
                        detailExtras.starredAt as unknown as string | number | Date,
                      )
                    : null,
                  projectId:
                    typeof detailExtras.projectId === 'string'
                      ? detailExtras.projectId
                      : null,
                  ...(planText ? { planText } : {}),
                  ...(planStatus ? { planStatus } : {}),
                  ...(finalScreenshot ? { finalScreenshot } : {}),
                  ...(finalUrl ? { finalUrl } : {}),
                };
                return [synth, ...prev.tasks];
              })(),
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
      const freshList: UiTask[] = res.tasks.map(toUiTask);
      // P1-C race fix — preserve the active selection's UiTask even
      // when it isn't on the loaded page. Deep-link flow goes:
      //   1. URL effect → selectAndHydrateTask(deepLinkId) prepends
      //      a synth UiTask for an old task not in the first 50.
      //   2. Some later refreshTasks() (e.g. an in-flight one
      //      finishing after the deep-link fired) used to wipe the
      //      synth and fall to first-task because keepSelection
      //      checked only the FRESH list.
      // Now we look at the LIVE store: if the current selection has
      // a UiTask there but isn't in the fresh list, prepend that
      // UiTask onto the new list and treat the selection as kept.
      // Genuinely deleted-by-the-user tasks fall off normally —
      // the sidebar's deleteTask path clears selectedTaskId first.
      const prevSelected = get().selectedTaskId;
      const freshIds = new Set(freshList.map((t) => t.taskId));
      const preservedSelected: UiTask | null =
        prevSelected && !freshIds.has(prevSelected)
          ? get().tasks.find((t) => t.taskId === prevSelected) ?? null
          : null;
      const tasks: UiTask[] = preservedSelected
        ? [preservedSelected, ...freshList]
        : freshList;
      const keepSelection = Boolean(
        prevSelected && (freshIds.has(prevSelected) || preservedSelected),
      );
      const nextSelected = keepSelection ? prevSelected : (tasks[0]?.taskId ?? null);
      set({
        tasks,
        loading: false,
        // Phase 24 RC follow-up — track cursor so 'load more' picks
        // up from where the first page ended.
        tasksCursor: res.nextCursor ?? null,
        tasksHasMore: res.nextCursor != null,
        selectedTaskId: nextSelected,
      });
      // P1.1 — re-hydrate detail (finalScreenshot, webSearches,
      // awaiting_question) for the active selection. tasks.list
      // doesn't ship those, so without this a refresh after a task
      // completed would render a sidebar entry but no evidence in
      // the panel.
      if (nextSelected) {
        get().selectAndHydrateTask(nextSelected);
      }
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  async loadMoreTasks() {
    const { tasksCursor, tasksHasMore, loadingMore } = get();
    if (loadingMore) return;
    if (!tasksHasMore || tasksCursor == null) return;
    set({ loadingMore: true });
    try {
      const res = await trpc.tasks.list.query({ limit: 50, cursor: tasksCursor });
      const moreTasks: UiTask[] = res.tasks.map(toUiTask);
      set((prev) => {
        // De-dupe defensively in case a row landed on both pages
        // (e.g. a task whose id equals the cursor boundary). Last
        // write wins so the freshly-fetched row replaces the stale.
        const seen = new Set<string>();
        const merged: UiTask[] = [];
        for (const t of [...prev.tasks, ...moreTasks]) {
          if (seen.has(t.taskId)) continue;
          seen.add(t.taskId);
          merged.push(t);
        }
        return {
          tasks: merged,
          loadingMore: false,
          tasksCursor: res.nextCursor ?? null,
          tasksHasMore: res.nextCursor != null,
        };
      });
    } catch (err) {
      set({ loadingMore: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  async toggleStarred(taskId) {
    // Optimistic local flip first so the star icon swaps instantly.
    // On server failure we re-flip and surface the error via toast
    // (caller usually doesn't show one — the row reverting is the
    // visible signal that something went wrong).
    const before = get().tasks.find((t) => t.taskId === taskId);
    if (!before) return;
    const next = !before.starred;
    set((prev) => ({
      tasks: prev.tasks.map((t) =>
        t.taskId === taskId ? { ...t, starred: next, starredAt: next ? new Date() : null } : t,
      ),
    }));
    try {
      await trpc.tasks.star.mutate({ taskId, starred: next });
    } catch {
      // revert
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.taskId === taskId
            ? { ...t, starred: before.starred ?? false, starredAt: before.starredAt ?? null }
            : t,
        ),
      }));
    }
  },

  async moveTaskToProject(taskId, projectId) {
    const before = get().tasks.find((t) => t.taskId === taskId);
    if (!before) return;
    set((prev) => ({
      tasks: prev.tasks.map((t) => (t.taskId === taskId ? { ...t, projectId } : t)),
    }));
    try {
      await trpc.tasks.moveToProject.mutate({ taskId, projectId });
    } catch {
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.taskId === taskId ? { ...t, projectId: before.projectId ?? null } : t,
        ),
      }));
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
        const userRepliesByTask = { ...prev.userRepliesByTask };
        delete userRepliesByTask[taskId];
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
          userRepliesByTask,
        };
      });
      return { ok: true as const };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      return { error: msg };
    }
  },

  async renameTask(taskId, title) {
    const trimmed = title.trim();
    const nextTitle = trimmed.length === 0 ? null : trimmed;
    // Optimistic update — snap the new title immediately so the inline
    // edit UI doesn't lag a round-trip behind user input.
    set((prev) => ({
      tasks: prev.tasks.map((t) =>
        t.taskId === taskId ? { ...t, title: nextTitle } : t,
      ),
    }));
    try {
      await trpc.tasks.rename.mutate({ taskId, title: trimmed });
      return { ok: true as const };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      // Roll back optimistic change by pulling the server's truth.
      void get().refreshTasks();
      return { error: msg };
    }
  },

  async replyToTask(taskId, message) {
    // Pin the user's text into the conversation stream before the
    // round-trip returns — the old behaviour wiped the composer and
    // left no trace of what the user said, which read like the reply
    // had vanished. If the mutation fails the message stays visible
    // (the toast explains) so the user can retry without retyping.
    const trimmed = message.trim();
    const entry = { at: Date.now(), text: trimmed };
    set((prev) => ({
      userRepliesByTask: {
        ...prev.userRepliesByTask,
        [taskId]: [...(prev.userRepliesByTask[taskId] ?? []), entry],
      },
    }));
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

  async createTask(intent, fileIds, replyToTaskId, mode) {
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
      const res = await trpc.tasks.create.mutate({
        intent,
        ...(fileIds && fileIds.length > 0 ? { fileIds } : {}),
        ...(replyToTaskId ? { replyToTaskId } : {}),
        ...(mode === 'plan' ? { mode } : {}),
      });
      // Optimistic insert at the top so the UI feels instant; the next
      // refreshTasks() will pick up the canonical server row.
      const now = new Date();
      const optimistic: UiTask = {
        taskId: res.taskId,
        intent,
        title: null,
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
      set((prev) => {
        // Phase 24 RC follow-up (Bug 1 fix): DO NOT clear streaming
        // + progress buffers here. There's a ~200ms window between
        // terminal arrival and tasks.detail merging the canonical
        // summary; clearing buffers in that window leaves the
        // streaming view rendering NOTHING, perceived as
        // "content disappeared then reappeared". The render gate in
        // TaskStream prefers `task.resultText` over the buffer when
        // both are present, so retaining the buffer is harmless and
        // bridges the gap.
        //
        // Bug 2 fix: also add to terminalTaskIds so stale-delta
        // guards in stream/progress handlers can check Set
        // membership directly (instead of looking at the tasks
        // array's status, which races with tasks.list).
        hdDebug('terminal', {
          taskId: msg.taskId,
          status: msg.status,
          prevBufferLen: (prev.streamingByTask[msg.taskId] ?? '').length,
          hadProgress: Boolean(prev.progressByTask[msg.taskId]),
          hasSummary: Boolean((msg as { summary?: string }).summary),
        });
        const nextTerminalIds = new Set(prev.terminalTaskIds);
        nextTerminalIds.add(msg.taskId);
        return {
          tasks: prev.tasks.map((t) =>
            t.taskId === msg.taskId
              ? {
                  ...t,
                  status: msg.status,
                  ...(msg.summary ? { resultText: msg.summary } : {}),
                  ...(msg.reason ? { resultText: humaniseTaskError(msg.reason) } : {}),
                }
              : t,
          ),
          terminalTaskIds: nextTerminalIds,
          // streamingByTask + progressByTask unchanged; buffers
          // persist until resultText is rendered in their place.
        };
      });
      return;
    }
    if (msg.type === 'server.task.stream') {
      // Phase 24 RC follow-up — append the delta to this task's
      // streaming buffer. The render gate prefers task.resultText
      // when set, otherwise renders the buffer.
      //
      // Bug 2 fix: stale-delta guard reads `terminalTaskIds`
      // (Set membership) instead of `prev.tasks.find().status`.
      // The previous version saw status='unknown' whenever the
      // delta arrived before tasks.list had loaded the task into
      // the array — guard never fired, stale post-terminal
      // deltas resurrected cleared buffers.
      set((prev) => {
        const isTerminal = prev.terminalTaskIds.has(msg.taskId);
        const bufferLen = (prev.streamingByTask[msg.taskId] ?? '').length;
        hdDebug('stream delta', {
          taskId: msg.taskId,
          isTerminal,
          bufferLen,
          delta: msg.delta.slice(0, 20),
          gated: isTerminal,
        });
        if (isTerminal) return prev;
        return {
          streamingByTask: {
            ...prev.streamingByTask,
            [msg.taskId]: (prev.streamingByTask[msg.taskId] ?? '') + msg.delta,
          },
        };
      });
      return;
    }
    if (msg.type === 'server.task.progress') {
      // Phase 24 RC follow-up — coarse progress note (latest wins).
      // Same stale-message guard as server.task.stream — Set
      // membership, not tasks-array status.
      set((prev) => {
        const isTerminal = prev.terminalTaskIds.has(msg.taskId);
        hdDebug('progress', {
          taskId: msg.taskId,
          isTerminal,
          message: msg.message,
          gated: isTerminal,
        });
        if (isTerminal) return prev;
        return {
          progressByTask: {
            ...prev.progressByTask,
            [msg.taskId]: msg.message,
          },
        };
      });
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
    if (msg.type === 'server.task.plan') {
      // Phase 13 Dim 1 — first-frame plan arrival. Stash on the
      // matching task; the TaskStream renders <PlanCard> when this
      // is set. Idempotent: a reconnected WS replay just overwrites
      // with the same body.
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.taskId === msg.taskId
            ? { ...t, planText: msg.planText, planStatus: msg.planStatus }
            : t,
        ),
      }));
      return;
    }
    if (msg.type === 'server.task.plan_step') {
      // Phase 13 Dim 1 follow-up — incremental status update.
      // Replace the planStatus array wholesale; the orchestrator
      // sends the whole snapshot so the SPA doesn't merge diffs.
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.taskId === msg.taskId ? { ...t, planStatus: msg.planStatus } : t,
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
          [msg.taskId]: {
            iteration: msg.iteration,
            query: msg.query,
            at: Date.now(),
            ...(msg.sources && msg.sources.length > 0 ? { sources: msg.sources } : {}),
          },
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
    if (msg.type === 'server.supercar.suggestions') {
      set((prev) => ({
        suggestionsByTask: {
          ...prev.suggestionsByTask,
          [msg.taskId]: msg.suggestions,
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
      tasksCursor: null,
      tasksHasMore: false,
      loadingMore: false,
      stepsByTask: {},
      screencastByTask: {},
      captchaWaitByTask: {},
      executorFallbackByTask: {},
      degradeByTask: {},
      awaitingUserByTask: {},
      userRepliesByTask: {},
      webSearchByTask: {},
      thinkingByTask: {},
      suggestionsByTask: {},
      streamingByTask: {},
      progressByTask: {},
      terminalTaskIds: new Set<string>(),
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
  const opusUsed = (row as { opusUsed?: unknown }).opusUsed === true;
  const r = row as { starred?: unknown; starredAt?: unknown; projectId?: unknown };
  // Root-cause fix for the "result text disappears on refresh" / brief
  // post-terminal flash: tasks.list already ships `result` for every
  // row, but toUiTask used to drop it and only map errorMessage. The
  // detail-hydration that filled in resultText only fired on opening
  // a task, so a completed task in the sidebar rendered with
  // resultText=null until something else triggered a hydrate. The
  // earlier streaming-buffer-persistence + terminalTaskIds Set patch
  // bridged the gap; mapping result.summary here removes the gap
  // entirely, so those guards mostly become belt-and-suspenders.
  const summaryFromResult = extractSummary((row as { result?: unknown }).result);
  const errorText =
    typeof row.errorMessage === 'string'
      ? humaniseTaskError(row.errorMessage)
      : null;
  const resultText = summaryFromResult ?? errorText ?? null;
  return {
    taskId: row.taskId,
    intent: row.intent,
    title: typeof (row as { title?: unknown }).title === 'string' ? ((row as { title: string }).title) : null,
    status: normaliseStatus(row.status),
    // The list endpoint doesn't expose tickCount directly; we leave 0
    // for now and let G4's ws events fill it in as ticks stream.
    tickCount: 0,
    ...(resultText ? { resultText } : {}),
    // tRPC serializes Date to string over the wire; coerce back.
    createdAt: new Date(row.createdAt as unknown as string | number | Date),
    modelLabel: opusUsed ? 'opus' : 'sonnet',
    starred: r.starred === true,
    starredAt: r.starredAt ? new Date(r.starredAt as string | number | Date) : null,
    projectId: typeof r.projectId === 'string' ? r.projectId : null,
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
    // Phase 24 RC follow-up — `queued` is the new pre-executing state
    // emitted by tasks.create when the BrowserPool is at capacity.
    case 'queued':
      return raw;
    case 'awaiting_user':
      return 'paused';
    default:
      return 'executing';
  }
}
