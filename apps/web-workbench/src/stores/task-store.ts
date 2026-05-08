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
  /**
   * Composer mode flag. `'new'` is the default: cold start of `/`
   * lands the user in an empty composer (no auto-selection of the
   * newest task). `'task'` means a task is selected, either through
   * a deep link, sidebar/search/history click, or a successful
   * `createTask`. The two URL effects in WorkbenchApp also key off
   * this flag — inbound bails while `'new'`, outbound forces the
   * `?task=` param to drop while `'new'`.
   */
  composerMode: 'new' | 'task';
  /**
   * `true` when the user explicitly clicked the sidebar 浏览器 entry
   * (or other "show me the browser" surfaces) while no task is
   * active. The BrowserPanel idle gate (`hasActiveTask`) blocks the
   * URL build / token fetch by default, but this flag opts the panel
   * back into the user-scoped pool stream — `/vnc-ws/<userId>` /
   * `/screencast-ws/<userId>` — so the requester sees their Brave.
   *
   * Cleared on any path that re-binds the browser context to a task
   * (selectTask, enterNewTaskMode, createTask via the same set), so
   * the next selection / new-task / submit cycles the stream cleanly
   * back to task-scoped or off.
   */
  browserLiveRequested: boolean;
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
   * Tasks that hit a terminal state during the current session
   * (i.e. a `server.task.terminal` arrived live, not loaded from
   * history). TerminalSummary's typewriter reveal only fires for
   * task ids in this set — switching to a historical task whose
   * terminal frame arrived before mount renders the summary
   * statically, no replay on every navigation.
   *
   * Set is in-memory only — page refresh resets it, so any task
   * loaded fresh from `tasks.list` reads as historical.
   */
  animatedTaskIds: ReadonlySet<string>;
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

  /**
   * Unified state-machine entry for task selection. Replaces the
   * earlier mix of `selectAndHydrateTask`, an outbound URL-sync
   * effect, an inbound URL effect, and refreshTasks's auto-select.
   * Three actions only:
   *
   *   - `selectTask(id, source)` — pick an existing task. Idempotent.
   *     Triggers detail hydrate. Writes the URL via replaceState
   *     unless `source === 'url'` (in which case the URL already
   *     reflects the choice). 'ui' is the default.
   *   - `enterNewTaskMode()` — clear selection. Drops the follow-up
   *     chip (which is derived from selectedTaskId). Writes `/`.
   *   - `refreshTaskList()` — fetch the list. Never auto-selects
   *     EXCEPT when there's no current selection AND no `?task=`
   *     hint AND the list is non-empty — in that case auto-picks
   *     the newest task as a UI default.
   */
  selectTask(taskId: string, source?: 'url' | 'ui'): void;
  enterNewTaskMode(): void;
  /**
   * Opt the BrowserPanel out of its idle gate so the panel connects
   * to the user-scoped pool stream even with no active task.
   * Triggered from the sidebar 浏览器 entry. Cleared by selectTask /
   * enterNewTaskMode below.
   */
  requestBrowserLive(): void;
  refreshTaskList(): Promise<void>;
  /** Legacy alias — routes through selectTask / enterNewTaskMode. */
  selectAndHydrateTask(taskId: string | null): void;
  /** Legacy alias — calls refreshTaskList. */
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

// URL-write callback registered by WorkbenchApp at mount. Earlier the
// store→URL sync lived in a useEffect that watched selectedTaskId and
// called `navigate()`; that created an infinite loop on every sidebar
// click (effect → navigate → URL change → inbound effect → selectTask
// → set → effect …). Letting selectTask/enterNewTaskMode/createTask
// write the URL directly closes the loop because the inbound effect
// can short-circuit when `taskParam === selectedTaskId` (no work).
// `source='url'` selectTask calls (originating from the inbound effect)
// SKIP this writer to break the cycle even tighter.
let storeNavigate: ((taskId: string | null) => void) | null = null;
export function setStoreNavigate(
  fn: ((taskId: string | null) => void) | null,
): void {
  storeNavigate = fn;
}

export const useTaskStore = create<TaskStore>((set, get) => {
  // Hydrate dedup token. Every selectTask bumps the token; the
  // tail of an older detail-fetch checks its own token against
  // the current one and bails if superseded. Cheaper + more
  // portable than threading AbortControllers through tRPC.
  let hydrateToken = 0;

  function abortInFlightHydrate(): void {
    hydrateToken += 1;
  }

  async function hydrateDetail(taskId: string): Promise<void> {
    const myToken = ++hydrateToken;
    try {
      const detail = await trpc.tasks.detail.query({ taskId });
      if (myToken !== hydrateToken) return;
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
        const isFailed =
          detail.status === 'failed' || detail.status === 'cancelled';
        const resultText = rawResultText
          ? isFailed
            ? humaniseTaskError(rawResultText)
            : rawResultText
          : undefined;
        const detailWithPlan = detail as typeof detail & {
          planText?: string | null;
          planStatus?: UiTask['planStatus'] | null;
        };
        const planText = detailWithPlan.planText ?? undefined;
        const planStatus =
          (detailWithPlan.planStatus as UiTask['planStatus']) ?? undefined;
        const resultObj = (detail.result ?? {}) as {
          finalScreenshot?: string;
          finalUrl?: string;
        };
        const finalScreenshot =
          typeof resultObj.finalScreenshot === 'string' &&
          resultObj.finalScreenshot.length > 0
            ? resultObj.finalScreenshot
            : undefined;
        const finalUrl =
          typeof resultObj.finalUrl === 'string' && resultObj.finalUrl.length > 0
            ? resultObj.finalUrl
            : undefined;
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
        const awaitingQuestion =
          detail.status === 'awaiting_user' &&
          typeof (detail as { awaitingQuestion?: string | null }).awaitingQuestion ===
            'string'
            ? (detail as { awaitingQuestion?: string | null }).awaitingQuestion ??
              null
            : null;
        const awaitingKindRaw = (detail as { awaitingKind?: string | null })
          .awaitingKind;
        const awaitingKind: UiAwaitingUser['awaitingKind'] =
          awaitingKindRaw === 'login' ||
          awaitingKindRaw === 'captcha' ||
          awaitingKindRaw === 'browser_action' ||
          awaitingKindRaw === 'clarification'
            ? awaitingKindRaw
            : undefined;
        const executionMode = extractExecutionMode(detail.result);
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
                [taskId]: {
                  question: awaitingQuestion,
                  at: Date.now(),
                  ...(awaitingKind ? { awaitingKind } : {}),
                },
              }
            : (() => {
                if (!prev.awaitingUserByTask[taskId])
                  return prev.awaitingUserByTask;
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
                      ...(awaitingKind ? { awaitingKind } : {}),
                      ...(executionMode ? { executionMode } : {}),
                    }
                  : t,
              );
            }
            // P1-C — deep link to a task older than the first page.
            // synthesise UiTask from detail, prepend.
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
              ...(awaitingKind ? { awaitingKind } : {}),
              ...(executionMode ? { executionMode } : {}),
            };
            return [synth, ...prev.tasks];
          })(),
        };
      });
    } catch (err) {
      if (myToken !== hydrateToken) return;
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
  tasks: [],
  selectedTaskId: null,
  composerMode: 'new',
  browserLiveRequested: false,
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
  animatedTaskIds: new Set<string>(),
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

  selectTask(taskId, source = 'ui') {
    if (!taskId) return;
    if (get().selectedTaskId === taskId) {
      // Idempotent: already selected. Still re-hydrate detail —
      // a re-click on the same task is the user asking for fresh
      // data (post-completion summary, refreshed plan status, etc).
      void hydrateDetail(taskId);
      return;
    }
    // F2 — switching tasks is UNCONDITIONAL. No guard on the previous
    // task's status, no in-flight check. The user clicked a row —
    // they want that view, the executing/awaiting_user task in the
    // background keeps running on its own. Aborting the old hydrate
    // prevents its tail (the post-fetch `set()` that stamps tasks[]
    // entries) from running against the now-different selectedTaskId
    // and re-pulling the previous task's payload into the new view.
    // composerMode flips back to 'task' on any selection.
    // Selecting a task re-binds the browser context to that task —
    // browserLiveRequested clears so the panel switches off the
    // user-scoped pool stream and onto the task-scoped path.
    abortInFlightHydrate();
    set({
      selectedTaskId: taskId,
      composerMode: 'task',
      browserLiveRequested: false,
    });
    void hydrateDetail(taskId);
    // URL write — only when the call ORIGINATES from a UI action
    // (sidebar click, suggestion chip, etc.). When source==='url'
    // the inbound effect already saw the URL change and called us —
    // re-navigating would re-emit the same URL change and the
    // inbound effect would re-fire selectTask(... 'url') in a loop.
    // The asymmetry is what closes the loop: store→URL writes only
    // happen when the store update originated outside RR, and
    // URL→store reads never trigger a re-write.
    if (source !== 'url') {
      storeNavigate?.(taskId);
    }
  },

  enterNewTaskMode() {
    // composerMode='new' is the lock. refreshTaskList's auto-pick
    // checks it and bails — without that lock, a refresh that
    // fires shortly after enterNewTaskMode would silently re-
    // select the newest task and pull the user back into a 追问
    // of a stale task.
    set({
      selectedTaskId: null,
      composerMode: 'new',
      browserLiveRequested: false,
    });
    // Cancel any in-flight hydrate so its post-set callback doesn't
    // re-stamp the just-cleared selection's tasks[] entry.
    abortInFlightHydrate();
    // Drop ?task= via the same direct-navigate path as selectTask;
    // the deleted outbound effect used to do this. Inbound effect
    // bails on composerMode==='new' so no loop.
    storeNavigate?.(null);
  },

  requestBrowserLive() {
    set({ browserLiveRequested: true });
  },

  // Legacy alias retained for code that hasn't migrated yet.
  selectAndHydrateTask(taskId) {
    if (taskId) {
      get().selectTask(taskId, 'ui');
    } else {
      get().enterNewTaskMode();
    }
  },

  async refreshTaskList() {
    set({ loading: true, error: null });
    try {
      const res = await trpc.tasks.list.query({ limit: 50 });
      const freshList: UiTask[] = res.tasks.map(toUiTask);
      // P1-C: preserve the active selection's UiTask object across
      // a list refresh. Deep-linked oldies (not in the first 50) get
      // upserted by the hydrate path, and that synth must survive a
      // subsequent refreshTaskList() that overwrites tasks[].
      const prevSelected = get().selectedTaskId;
      const freshIds = new Set(freshList.map((t) => t.taskId));
      const preservedSelected: UiTask | null =
        prevSelected && !freshIds.has(prevSelected)
          ? get().tasks.find((t) => t.taskId === prevSelected) ?? null
          : null;
      const tasks: UiTask[] = preservedSelected
        ? [preservedSelected, ...freshList]
        : freshList;
      // refreshTaskList NEVER decides selectedTaskId. Cold start of
      // `/` lands in new-task mode (composerMode='new' default)
      // with the sidebar populated but nothing selected. Selection
      // happens only through explicit signals: URL deep link via
      // bootstrap, a sidebar / search / history click, or a
      // successful createTask. This call just delivers fresh task
      // data and re-hydrates the active selection if there is one.
      set({
        tasks,
        loading: false,
        tasksCursor: res.nextCursor ?? null,
        tasksHasMore: res.nextCursor != null,
      });
      if (prevSelected) {
        // Selection unchanged but the underlying detail might have
        // moved on (task completed, awaiting_user prompt added,
        // etc.). Re-hydrate so the panel reflects the fresh state.
        // hydrateDetail's token guard collapses bursts so this is
        // cheap when refreshTaskList fires alongside a deep-link.
        void hydrateDetail(prevSelected);
      }
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  // Legacy alias retained for code paths that haven't migrated.
  async refreshTasks() {
    await get().refreshTaskList();
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
        // If the user is deleting the currently selected task, drop
        // them into new-task mode rather than auto-jumping to the
        // next sibling. The previous "promote tasks[0]" behaviour
        // pulled the user into a stale task they'd just chosen NOT
        // to be looking at — surprising, especially for batch deletes
        // that include the active selection. composerMode flips to
        // 'new' so the inbound URL effect bails and outbound clears
        // ?task=. Other selections are untouched.
        const wasActive = prev.selectedTaskId === taskId;
        const nextSelected = wasActive ? null : prev.selectedTaskId;
        const nextComposerMode = wasActive ? ('new' as const) : prev.composerMode;
        return {
          tasks: nextTasks,
          selectedTaskId: nextSelected,
          composerMode: nextComposerMode,
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
      // Fix 2 — backend tags reply outcome as `state: 'resumed' | 'stillAwaiting'`.
      // Only `resumed` means the supercar accepted the message and
      // started executing again; `stillAwaiting` is the user saying
      // "等一下 / wait" and we should preserve the takeover UI so the
      // BrowserPanel banner stays up. Older orchestrator builds omit
      // `state` — treat that as the legacy "always clear" behaviour.
      const state =
        (res as { state?: 'resumed' | 'stillAwaiting' }).state ??
        (res.ok ? 'resumed' : null);
      if (state === 'resumed') {
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
      //
      // F2 — stamp `executionMode` with a coarse front-end inference so
      // the BrowserPanel's `isBrowserTask` gate doesn't fall through
      // to the "could be browser, treat optimistic" fallback for the
      // initial render window. Generate is the safe default (no Brave
      // = no chrome shown for non-browser tasks); the inference flips
      // to 'browser' when the intent obviously needs the live browser
      // (URL or 打开 / 访问 / 浏览器 / 登录 / 扫码 keywords). The
      // server's authoritative executionMode arrives via
      // tasks.detail's `result.executionMode` (parked-from-generate)
      // or via `result.metadata.executionMode` (terminal persist),
      // and overwrites this hint downstream.
      const now = new Date();
      const optimistic: UiTask = {
        taskId: res.taskId,
        intent,
        title: null,
        status: (res.status as UiTaskStatus) ?? 'executing',
        tickCount: 0,
        createdAt: now,
        executionMode: inferExecutionModeFromIntent(intent),
      };
      // composerMode flips back to 'task' here. Without this, a user
      // who clicked 发新任务 (composerMode='new') and submitted ends
      // up with selectedTaskId=res.taskId but composerMode still
      // pinned to 'new' — leaving the store in an inconsistent state
      // that any subsequent enterNewTaskMode() would clear.
      // browserLiveRequested clears so the BrowserPanel switches from
      // the user-scoped fallback (if it was on) onto the new task's
      // CDP / VNC stream.
      set((prev) => ({
        tasks: [optimistic, ...prev.tasks.filter((t) => t.taskId !== res.taskId)],
        selectedTaskId: res.taskId,
        composerMode: 'task' as const,
        browserLiveRequested: false,
      }));
      // Pin URL to the new task — same direct-navigate path as
      // selectTask. The deleted outbound effect used to do this off
      // the selectedTaskId dep change.
      storeNavigate?.(res.taskId);
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
        // Mark this taskId as freshly-completed so TerminalSummary's
        // typewriter reveal plays once. Tasks loaded from history
        // (`tasks.list` / `tasks.detail`) never enter this set, so
        // navigating to a historical task renders the summary in full
        // immediately — no replay on every sidebar click.
        const nextAnimatedIds = new Set(prev.animatedTaskIds);
        nextAnimatedIds.add(msg.taskId);
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
          animatedTaskIds: nextAnimatedIds,
          // streamingByTask + progressByTask unchanged; buffers
          // persist until resultText is rendered in their place.
        };
      });
      // F1 — auto-handoff. The reply browser-handoff branch on the
      // backend marks this task `completed` AND attaches `autoHandoff
      // = { intent, mode }` so the SPA fires a fresh createTask with
      // the combined intent. Without this the user saw a "click the
      // button" message but no button (the executionMode-aware CTA
      // gate hides the button on the now-completed parent task).
      // setTimeout(0) defers the dispatch until after the current
      // set() commit so any state listeners on terminal complete
      // first; createTask updates selectedTaskId to the new row and
      // navigates the URL via storeNavigate.
      const ah = (msg as { autoHandoff?: { intent: string; mode: 'browser' | 'generate' } })
        .autoHandoff;
      if (ah && typeof ah.intent === 'string' && ah.intent.trim().length > 0) {
        const intent = ah.intent;
        setTimeout(() => {
          void get()
            .createTask(intent, undefined, undefined, undefined)
            .catch((err) => {
              // Best-effort. If quota / network blips, the user can
              // retry manually — they have the full intent in the
              // completed task's chat history.
              hdDebug('autoHandoff createTask failed', {
                err: err instanceof Error ? err.message : String(err),
              });
            });
        }, 0);
      }
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
          // Stream deltas only come from the generate / scrape runners
          // (browser path uses screencast, not text streaming). Stamp
          // executionMode='generate' on first delta so the BrowserPanel
          // closes its chrome before tasks.detail's persisted result
          // catches up. Idempotent: only writes when the field is
          // currently undefined / 'browser', so a real browser→generate
          // fallback that already persisted 'generate' isn't overridden.
          tasks: prev.tasks.map((t) =>
            t.taskId === msg.taskId && t.executionMode !== 'generate'
              ? { ...t, executionMode: 'generate' as const }
              : t,
          ),
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
          // Same rationale as the stream branch above — progress
          // notes only come from generate / scrape, never browser.
          tasks: prev.tasks.map((t) =>
            t.taskId === msg.taskId && t.executionMode !== 'generate'
              ? { ...t, executionMode: 'generate' as const }
              : t,
          ),
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
      const awaitingKind = msg.awaitingKind;
      set((prev) => ({
        awaitingUserByTask: {
          ...prev.awaitingUserByTask,
          [msg.taskId]: {
            question: msg.question,
            at: Date.now(),
            ...(awaitingKind ? { awaitingKind } : {}),
          },
        },
        // P2-A — also mirror onto the task row so a refresh that
        // re-loads via tasks.detail still has the right kind even if
        // the WS event arrived first and tasks.detail's hydrate has
        // not yet fired.
        tasks: prev.tasks.map((t) =>
          t.taskId === msg.taskId && awaitingKind
            ? { ...t, awaitingKind }
            : t,
        ),
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
      browserLiveRequested: false,
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
      animatedTaskIds: new Set<string>(),
    });
  },
  };
});

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

/**
 * Read `executionMode` out of the `result` JSON. Two locations:
 *   - `result.executionMode` (parked-from-generate write path)
 *   - `result.metadata.executionMode` (terminal persistVisionOutcome
 *     stamps it under `metadata`)
 * Returns undefined for executing tasks that haven't persisted yet —
 * BrowserPanel falls back to streamingByTask presence in that window.
 */
/**
 * F2 — coarse front-end inference for the optimistic task row created
 * inside `createTask`. We don't have access to the orchestrator's
 * `classifyExecutionMode` (Anthropic round-trip) on the SPA, so we
 * apply a conservative keyword pass: anything that obviously implies
 * driving the browser flips to 'browser'; everything else defaults
 * to 'generate' (the safe default — BrowserPanel's `isBrowserTask`
 * gate stays closed, no idle WS connect attempt). The server's
 * authoritative classification overwrites this hint via
 * `result.executionMode` / `result.metadata.executionMode` when
 * tasks.detail / WS terminal lands.
 *
 * Rule order:
 *   1. Bare URL → 'browser' (almost always navigation).
 *   2. Action verb (打开 / 登录 / 访问 / open / sign in …) — required
 *      for `browser` regardless of site mention. Earlier draft fired
 *      `browser` on any site keyword (抖音/淘宝/...), which mis-flagged
 *      "复盘抖音直播数据" because pure analysis tasks aren't browser
 *      sessions. The action+site combo dodges that: "复盘抖音" only
 *      matches the site half → falls through to 'generate'; "打开抖音
 *      罗盘" matches both halves → 'browser'.
 *   3. Pure action verb without a site (e.g. "打开浏览器") → 'browser'.
 *      The verb itself is a strong tell.
 *   4. Otherwise → 'generate' (safe default).
 */
// Naked weak verbs (访问 / 下单 / 购买 / 抢票 / visit) bled into metric
// phrases — "下单率"、"购买转化"、"访问量"、"visit count" — and pushed
// pure-analysis intents into the browser lane. Real browser sessions
// always carry stronger phrasing (打开 / 登录 / 扫码 / 进入后台 / open
// browser / log in). Keep `提交(?:表单|申请)` and `进入(?:后台|页面|网站)`
// because they're already qualified — only fire when followed by a
// matching object word.
const BROWSER_ACTION_RE =
  /打开|登录|登陆|扫码|扫一扫|进入(?:后台|页面|网站)|读取(?:页面|后台)|提交(?:表单|申请)|帮我点|帮我操作|\bopen\s+(?:the\s+)?(?:browser|page|site|url|tab)|\b(?:log|sign)\s*in\b|\bnavigate\s+to\b|\bgo\s+to\s+https?:/iu;
const BROWSER_SITE_RE =
  /抖店|罗盘|公众号|小红书|淘宝|京东|拼多多|抖音|微信|支付宝|美团|大众点评|jinritemai|taobao|jd\.com|tmall|pinduoduo|xiaohongshu|douyin|weixin|alipay|meituan/iu;
function inferExecutionModeFromIntent(
  intent: string,
): UiTask['executionMode'] {
  const t = intent.toLowerCase();
  if (/https?:\/\/\S+/i.test(t)) return 'browser';
  const hasAction = BROWSER_ACTION_RE.test(intent);
  const hasSite = BROWSER_SITE_RE.test(intent);
  if (hasAction && hasSite) return 'browser';
  if (hasAction) return 'browser';
  return 'generate';
}

function extractExecutionMode(
  result: unknown,
): UiTask['executionMode'] | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as Record<string, unknown>;
  const direct = r.executionMode;
  if (direct === 'browser' || direct === 'generate' || direct === 'scrape') {
    return direct;
  }
  const meta = r.metadata;
  if (meta && typeof meta === 'object') {
    const m = (meta as Record<string, unknown>).executionMode;
    if (m === 'browser' || m === 'generate' || m === 'scrape') return m;
  }
  return undefined;
}

export function toUiTask(row: ListRow): UiTask {
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
  const executionMode = extractExecutionMode(
    (row as { result?: unknown }).result,
  );
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
    ...(executionMode ? { executionMode } : {}),
    // tRPC serializes Date to string over the wire; coerce back.
    createdAt: new Date(row.createdAt as unknown as string | number | Date),
    modelLabel: opusUsed ? 'opus' : 'sonnet',
    starred: r.starred === true,
    starredAt: r.starredAt ? new Date(r.starredAt as string | number | Date) : null,
    projectId: typeof r.projectId === 'string' ? r.projectId : null,
  };
}

function normaliseStatus(raw: string): UiTaskStatus {
  // The orchestrator has a richer status set (planning, pending, ...).
  // Map everything we don't display onto an active/paused bucket so
  // the sidebar stays readable. `awaiting_user` is now a first-class
  // SPA status — composer flips to reply mode and the sidebar dot
  // turns amber so the user sees "this task is waiting on me".
  switch (raw) {
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'paused':
    case 'executing':
    case 'awaiting_user':
    // Phase 24 RC follow-up — `queued` is the new pre-executing state
    // emitted by tasks.create when the BrowserPool is at capacity.
    case 'queued':
      return raw;
    default:
      return 'executing';
  }
}
