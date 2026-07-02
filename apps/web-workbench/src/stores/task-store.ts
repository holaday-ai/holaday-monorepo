import type { BrowserViewportProfile, ServerMessage } from '@holaday/shared-types';
import { create } from 'zustand';
import { pickDefaultBrowserViewportProfile } from '@/lib/browser-viewport-profile';
import { humaniseTaskError } from '@/lib/error-copy';
import { pageErrorMessage } from '@/lib/page-error-copy';
import { hdDebug } from '@/lib/hd-debug';
import { trpc } from '@/lib/trpc';
import type {
  UiAwaitingUser,
  UiCaptchaWait,
  UiDegradeEvent,
  UiExecutorFallback,
  UiScreencast,
  UiSkillSelection,
  UiStep,
  UiTask,
  UiTaskStatus,
  UiThinkingEvent,
  UiWebSearchEvent,
} from '@/types/task';
import { isTerminalStatus } from '@/types/task';
import type { VideoCreationOptions } from '@/types/video';

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
   * Codex Pack B1 — coarse phase marker for the live progress chip.
   * Backend broadcasts `server.task.progress` with a `subStatus`
   * field when entering one of five logical phases (planning →
   * browsing/extracting/generating → verifying). Cleared on terminal
   * arrival so the chip never lingers after a task completes. `since`
   * is a client-side timestamp captured the FIRST time a sub_status
   * arrives, used to drive the 30s+ elapsed-time timer in TaskStream.
   */
  subStatusByTask: Record<
    string,
    {
      subStatus:
        | 'planning'
        | 'browsing'
        | 'extracting'
        | 'verifying'
        | 'generating'
        | 'generating_image';
      since: number;
    }
  >;
  /**
   * Phase 24 RC follow-up — set of taskIds whose stale live frames
   * must be blocked. Completed/failed/cancelled terminal frames stay
   * here permanently; paused tasks are added while paused and removed
   * on resume. Stream/progress/tick guards check THIS set instead of
   * `prev.tasks.find(...).status` because the tasks array is populated
   * asynchronously and a late frame can otherwise revive old UI.
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
  /**
   * Current workbench browser surface. WorkbenchApp updates this from
   * the live panel/sheet/fullscreen layout so retry buttons outside
   * WorkbenchApp's submit wrapper still create the right browser
   * geometry instead of falling back to desktop.
   */
  defaultViewportProfile: BrowserViewportProfile | null;
  setDefaultViewportProfile(profile: BrowserViewportProfile | null): void;

  /**
   * Toggle the pin state on a task. Pin is now server-persisted —
   * the legacy localStorage `pinnedTaskIds` Set is gone and the
   * Sidebar reads `t.starred` directly off each row. Hits
   * `tasks.star/unstar` over the wire; "pin" is the single product-
   * side name (no more "收藏 / 星标"), but the RPC surface stays
   * unchanged so the backend doesn't need to be touched.
   *
   * `desiredPinned` lets callers force the target state when the
   * row isn't in the local `tasks` slice — used by the /starred page
   * to unpin a pre-paginated task that the recent-50 store never saw.
   * When omitted, falls back to flipping the local row's `starred`
   * (or pinning a missing row by default).
   */
  togglePin(taskId: string, desiredPinned?: boolean): Promise<void>;

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
  /**
   * Phase 16b — move a task into a project (or out of one when
   * projectId === null). Optimistic; reverts the row on server error.
   */
  moveTaskToProject(
    taskId: string,
    projectId: string | null,
  ): Promise<{ ok: true } | { error: string }>;
  createTask(
    intent: string,
    fileIds?: string[],
    /**
   * Phase 14 audit follow-up — when set, server treats this as
   * a 追问 of the parent task: skips quota and prepends the
   * parent's intent + summary so the agent has full context.
   * The parent must be in a terminal state.
     */
    replyToTaskId?: string,
    /** O4 — 'plan' makes agent emit + wait-for-approval before executing. */
    mode?: 'auto' | 'plan',
    /**
     * Codex Pack C1 — task-level expert mode toggle. `auto` (default)
     * lets the orchestrator's intent matcher decide; `expert` forces
     * the typed-workflow path; `normal` forces the general-purpose
     * lane regardless of intent. Sent as `expertMode` on tasks.create.
     */
    expertMode?: 'normal' | 'expert' | 'auto',
    /**
     * Optimization #3 R1 — picked from the SPA's current panel
     * layout (sidepanel / fullscreen / mobile sheet). Plumbed to
     * the pool so Brave + Xvfb + CDP frame caps match the user's
     * surface. Optional; the server defaults to 'desktop' when
     * absent.
     */
    viewportProfile?: BrowserViewportProfile,
    /**
     * Phase 2 第一期 — 视频独立界面带上来的模型档/风格/画幅/画质/时长。
     * 仅当 video fork 命中(VIDEO_CREATION_ENABLED + 灰度内)被后端读取;
     * 其余任务忽略。透传给 `tasks.create` 的 `videoOptions`。
     */
    videoOptions?: VideoCreationOptions,
    skillSelection?: UiSkillSelection,
  ): Promise<{ taskId: string } | { error: string }>;
  deleteTask(taskId: string): Promise<{ ok: true } | { error: string }>;
  renameTask(taskId: string, title: string): Promise<{ ok: true } | { error: string }>;
  replyToTask(
    taskId: string,
    message: string,
    /**
     * F2 — file attachments uploaded with the reply, in the same
     * fileId shape `createTask` accepts. Backend `tasks.reply` parses
     * + plumbs them through `supercarReply`'s attachmentBlocks (or
     * the generate-resume path's `attachments`).
     */
    fileIds?: string[],
  ): Promise<{ ok: boolean } | { error: string }>;
  abortTask(taskId: string): Promise<{ ok: boolean } | { error: string }>;
  applyServerMessage(msg: ServerMessage): void;
  reset(): void;
}

type RuntimeStateKey =
  | 'captchaWaitByTask'
  | 'executorFallbackByTask'
  | 'degradeByTask'
  | 'awaitingUserByTask'
  | 'streamingByTask'
  | 'progressByTask'
  | 'subStatusByTask';

type RuntimeStatePatch = Pick<TaskStore, RuntimeStateKey | 'terminalTaskIds'>;

export function pruneRuntimeStateForTerminalTasks(
  prev: Pick<TaskStore, RuntimeStateKey | 'terminalTaskIds'>,
  tasks: readonly UiTask[],
): Partial<RuntimeStatePatch> {
  const terminalTasks = tasks.filter((task) => isTerminalStatus(task.status));
  if (terminalTasks.length === 0) return {};

  const terminalIds = new Set(terminalTasks.map((task) => task.taskId));
  const terminalIdsWithResult = new Set(
    terminalTasks
      .filter((task) => typeof task.resultText === 'string' && task.resultText.length > 0)
      .map((task) => task.taskId),
  );

  const patch: Partial<RuntimeStatePatch> = {};
  const nextTerminalTaskIds = new Set(prev.terminalTaskIds);
  let terminalChanged = false;
  for (const taskId of terminalIds) {
    if (nextTerminalTaskIds.has(taskId)) continue;
    nextTerminalTaskIds.add(taskId);
    terminalChanged = true;
  }
  if (terminalChanged) patch.terminalTaskIds = nextTerminalTaskIds;

  const nextCaptchaWaitByTask = omitRuntimeKeys(
    prev.captchaWaitByTask,
    terminalIds,
  );
  if (nextCaptchaWaitByTask !== prev.captchaWaitByTask) {
    patch.captchaWaitByTask = nextCaptchaWaitByTask;
  }

  const nextExecutorFallbackByTask = omitRuntimeKeys(
    prev.executorFallbackByTask,
    terminalIds,
  );
  if (nextExecutorFallbackByTask !== prev.executorFallbackByTask) {
    patch.executorFallbackByTask = nextExecutorFallbackByTask;
  }

  const nextDegradeByTask = omitRuntimeKeys(prev.degradeByTask, terminalIds);
  if (nextDegradeByTask !== prev.degradeByTask) {
    patch.degradeByTask = nextDegradeByTask;
  }

  const nextAwaitingUserByTask = omitRuntimeKeys(
    prev.awaitingUserByTask,
    terminalIds,
  );
  if (nextAwaitingUserByTask !== prev.awaitingUserByTask) {
    patch.awaitingUserByTask = nextAwaitingUserByTask;
  }

  const nextSubStatusByTask = omitRuntimeKeys(prev.subStatusByTask, terminalIds);
  if (nextSubStatusByTask !== prev.subStatusByTask) {
    patch.subStatusByTask = nextSubStatusByTask;
  }

  // Keep streaming/progress as a bridge until canonical resultText is
  // present. Once the API refresh confirms a terminal result, those
  // live buffers are stale and can no longer improve the handoff.
  const nextStreamingByTask = omitRuntimeKeys(
    prev.streamingByTask,
    terminalIdsWithResult,
  );
  if (nextStreamingByTask !== prev.streamingByTask) {
    patch.streamingByTask = nextStreamingByTask;
  }

  const nextProgressByTask = omitRuntimeKeys(
    prev.progressByTask,
    terminalIdsWithResult,
  );
  if (nextProgressByTask !== prev.progressByTask) {
    patch.progressByTask = nextProgressByTask;
  }

  return patch;
}

function omitRuntimeKeys<T extends Record<string, unknown>>(
  record: T,
  keys: ReadonlySet<string>,
): T {
  let next: T | null = null;
  for (const key of keys) {
    if (!(key in record)) continue;
    next ??= { ...record };
    delete next[key];
  }
  return next ?? record;
}

function omitRuntimeKey<T extends Record<string, unknown>>(record: T, key: string): T {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function omitTaskIdFromSet(values: ReadonlySet<string>, taskId: string): ReadonlySet<string> {
  if (!values.has(taskId)) return values;
  const next = new Set(values);
  next.delete(taskId);
  return next;
}

export function mergeTaskPagesReplacingDuplicates(
  current: readonly UiTask[],
  incoming: readonly UiTask[],
): UiTask[] {
  const merged = [...current];
  const indexByTaskId = new Map<string, number>();
  merged.forEach((task, index) => indexByTaskId.set(task.taskId, index));

  for (const task of incoming) {
    const existingIndex = indexByTaskId.get(task.taskId);
    if (existingIndex === undefined) {
      indexByTaskId.set(task.taskId, merged.length);
      merged.push(task);
      continue;
    }
    merged[existingIndex] = task;
  }

  return merged;
}

export function mergeFirstPageWithPreservedSelection(
  firstPage: readonly UiTask[],
  preservedSelected: UiTask | null,
): UiTask[] {
  const merged = preservedSelected
    ? [preservedSelected, ...firstPage]
    : [...firstPage];
  const seen = new Set<string>();
  const tasks: UiTask[] = [];
  for (const task of merged) {
    if (seen.has(task.taskId)) continue;
    seen.add(task.taskId);
    tasks.push(task);
  }
  return tasks;
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
      const rawDetail = await trpc.tasks.detail.query({ taskId });
      if (myToken !== hydrateToken) return;
      const detail: Record<string, unknown> = isTaskListRecord(rawDetail)
        ? rawDetail
        : {};
      const steps = normalizeTaskDetailSteps(detail.steps);
      set((prev) => {
        const existingTask = prev.tasks.find((t) => t.taskId === taskId);
        const rawDetailStatus = safeTaskListText(detail.status);
        const detailStatus = rawDetailStatus
          ? normaliseStatus(rawDetailStatus)
          : existingTask?.status ?? 'unknown';
        const rawResultText = extractSummary(detail.result);
        const rawErrorText = safeTaskListText(detail.errorMessage);
        const resultText =
          displayResultTextForStatus(detailStatus, rawResultText, rawErrorText) ??
          undefined;
        const planText = safeTaskListText(detail.planText) || undefined;
        const planStatus = normalizeTaskPlanStatus(detail.planStatus);
        const resultObj = isTaskListRecord(detail.result) ? detail.result : {};
        const metadata = isTaskListRecord(resultObj.metadata) ? resultObj.metadata : {};
        const finalScreenshot =
          safeTaskListText(resultObj.finalScreenshot).length > 0
            ? safeTaskListText(resultObj.finalScreenshot)
            : undefined;
        const finalUrl =
          safeTaskListText(resultObj.finalUrl).length > 0
            ? safeTaskListText(resultObj.finalUrl)
            : undefined;
        const finalViewport = normalizeFinalViewport(
          resultObj.finalViewport ?? metadata.finalViewport,
        );
        // Phase 4 R1 — hydrate metadata.attachments[] +
        // metadata.expertWorkflowId from the terminal-state JSON.
        // Both fields are nullable; we only pass them through when
        // the shape validates so a malformed metadata block can't
        // crash the renderer.
        const attachments: UiTask['attachments'] | undefined = parseUiAttachments(
          metadata.attachments,
        );
        const expertWorkflowId =
          safeTaskListText(metadata.expertWorkflowId).length > 0
            ? safeTaskListText(metadata.expertWorkflowId)
            : undefined;
        // Codex Round 2 P1-7 — surface the user's composer pick on
        // the task so the SPA can show "expert mode requested but no
        // workflow matched" (and so future analytics can compare
        // normal vs expert runs without re-querying the DB).
        const expertMode =
          metadata.expertMode === 'normal' ||
          metadata.expertMode === 'expert' ||
          metadata.expertMode === 'auto'
            ? metadata.expertMode
            : undefined;
        let hydratedWebSearch: UiWebSearchEvent | null = null;
        const rawSteps = Array.isArray(detail.steps) ? detail.steps : [];
        for (const [idx, s] of rawSteps.entries()) {
          if (!isTaskListRecord(s)) continue;
          const out = isTaskListRecord(s.output) ? s.output : {};
          const arr = out.webSearches;
          if (!Array.isArray(arr) || arr.length === 0) continue;
          const last = arr[arr.length - 1];
          if (!isTaskListRecord(last)) continue;
          const query = safeTaskListText(last.query);
          if (!query) continue;
          const sources = normalizeWebSearchSources(last.sources);
          hydratedWebSearch = {
            iteration: typeof s.seq === 'number' && Number.isFinite(s.seq) ? s.seq : idx,
            query,
            at: Date.now(),
            ...(sources.length > 0
              ? { sources }
              : {}),
          };
        }
        const awaitingQuestion =
          detailStatus === 'awaiting_user'
            ? safeTaskListText(detail.awaitingQuestion) || null
            : null;
        const awaitingKindRaw = detail.awaitingKind;
        const awaitingKind: UiAwaitingUser['awaitingKind'] =
          awaitingKindRaw === 'login' ||
          awaitingKindRaw === 'captcha' ||
          awaitingKindRaw === 'permission' ||
          awaitingKindRaw === 'browser_action' ||
          awaitingKindRaw === 'clarification' ||
          awaitingKindRaw === 'video_quote'
            ? awaitingKindRaw
            : undefined;
        const executionMode = extractExecutionMode(detail.result);
        const failedChecks = extractFailedChecks(detail.result);
        // Codex Pack A4 — verifier verdict columns from tasks.detail.
        const detailVerification = detail as typeof detail & {
          verificationPassed?: boolean | null;
          failureLevel?: string | null;
        };
        const verificationPassed =
          typeof detailVerification.verificationPassed === 'boolean'
            ? detailVerification.verificationPassed
            : null;
        const failureLevelRaw = detailVerification.failureLevel;
        const failureLevel: UiTask['failureLevel'] =
          failureLevelRaw === 'fixable' ||
          failureLevelRaw === 'needs_clarification' ||
          failureLevelRaw === 'hard_fail'
            ? failureLevelRaw
            : null;
        const nextAwaitingUserByTask = awaitingQuestion
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
            })();
        const nextTasks: UiTask[] = (() => {
          const exists = Boolean(existingTask);
          if (exists) {
            return prev.tasks.map((t) =>
              t.taskId === taskId
                ? {
                    ...t,
                    status: detailStatus,
                    tickCount: Math.max(t.tickCount, steps.length),
                    ...(resultText ? { resultText } : {}),
                    ...(planText ? { planText } : {}),
                    ...(planStatus ? { planStatus } : {}),
                    ...(finalScreenshot ? { finalScreenshot } : {}),
                    ...(finalUrl ? { finalUrl } : {}),
                    ...(finalViewport ? { finalViewport } : {}),
                    ...(awaitingKind ? { awaitingKind } : {}),
                    ...(executionMode ? { executionMode } : {}),
                    ...(attachments ? { attachments } : {}),
                    ...(expertWorkflowId ? { expertWorkflowId } : {}),
                    ...(expertMode ? { expertMode } : {}),
                    failedChecks,
                    verificationPassed,
                    failureLevel,
                  }
                : t,
            );
          }
          // P1-C — deep link to a task older than the first page.
          // synthesise UiTask from detail, prepend.
          const synth: UiTask = {
            taskId,
            intent: safeTaskListText(detail.intent) || '未命名任务',
            title: safeNullableTaskListText(detail.title),
            status: detailStatus,
            tickCount: steps.length,
            ...(resultText ? { resultText } : {}),
            createdAt: new Date(safeTaskListDate(detail.createdAt) ?? 0),
            modelLabel: detail.opusUsed === true ? 'opus' : 'sonnet',
            starred: detail.starred === true,
            starredAt: safeNullableTaskListDate(detail.starredAt),
            projectId: safeNullableTaskListText(detail.projectId),
            ...(planText ? { planText } : {}),
            ...(planStatus ? { planStatus } : {}),
            ...(finalScreenshot ? { finalScreenshot } : {}),
            ...(finalUrl ? { finalUrl } : {}),
            ...(finalViewport ? { finalViewport } : {}),
            ...(awaitingKind ? { awaitingKind } : {}),
            ...(executionMode ? { executionMode } : {}),
            ...(attachments ? { attachments } : {}),
            ...(expertWorkflowId ? { expertWorkflowId } : {}),
            ...(expertMode ? { expertMode } : {}),
            failedChecks,
            verificationPassed,
            failureLevel,
          };
          return [synth, ...prev.tasks];
        })();
        const hydratedTask = nextTasks.find((task) => task.taskId === taskId);
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
          awaitingUserByTask: nextAwaitingUserByTask,
          tasks: nextTasks,
          ...(hydratedTask
            ? pruneRuntimeStateForTerminalTasks(
                { ...prev, awaitingUserByTask: nextAwaitingUserByTask },
                [hydratedTask],
              )
            : {}),
        };
      });
    } catch (err) {
      if (myToken !== hydrateToken) return;
      set({ error: taskStoreError(err) });
    }
  }

  return {
  tasks: [],
  selectedTaskId: null,
  composerMode: 'new',
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
  subStatusByTask: {},
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
  defaultViewportProfile: null,
  setDefaultViewportProfile(profile) {
    set({ defaultViewportProfile: profile });
  },


  selectTask(taskId, source = 'ui') {
    if (!taskId) return;
    if (isLocalPendingTaskId(taskId)) return;
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
    // Selecting a task also drops takeover mode so the browser
    // context starts view-only for the newly selected task.
    abortInFlightHydrate();
    set({
      selectedTaskId: taskId,
      composerMode: 'task',
      browserInteractive: false,
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
      browserInteractive: false,
    });
    // Cancel any in-flight hydrate so its post-set callback doesn't
    // re-stamp the just-cleared selection's tasks[] entry.
    abortInFlightHydrate();
    // Drop ?task= via the same direct-navigate path as selectTask;
    // the deleted outbound effect used to do this. Inbound effect
    // bails on composerMode==='new' so no loop.
    storeNavigate?.(null);
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
      const freshList = normalizeTaskListRows(res?.tasks);
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
      const tasks = mergeFirstPageWithPreservedSelection(
        freshList,
        preservedSelected,
      );
      // refreshTaskList NEVER decides selectedTaskId. Cold start of
      // `/` lands in new-task mode (composerMode='new' default)
      // with the sidebar populated but nothing selected. Selection
      // happens only through explicit signals: URL deep link via
      // bootstrap, a sidebar / search / history click, or a
      // successful createTask. This call just delivers fresh task
      // data and re-hydrates the active selection if there is one.
      set((prev) => ({
        tasks,
        loading: false,
        tasksCursor: normalizeTaskListCursor(res?.nextCursor),
        tasksHasMore: normalizeTaskListCursor(res?.nextCursor) != null,
        ...pruneRuntimeStateForTerminalTasks(prev, tasks),
      }));
      if (prevSelected) {
        // Selection unchanged but the underlying detail might have
        // moved on (task completed, awaiting_user prompt added,
        // etc.). Re-hydrate so the panel reflects the fresh state.
        // hydrateDetail's token guard collapses bursts so this is
        // cheap when refreshTaskList fires alongside a deep-link.
        void hydrateDetail(prevSelected);
      }
    } catch (err) {
      set({ loading: false, error: taskStoreError(err) });
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
      const moreTasks = normalizeTaskListRows(res?.tasks);
      set((prev) => {
        // De-dupe defensively in case a row landed on both pages
        // (e.g. a task whose id equals the cursor boundary). The
        // freshly-fetched row replaces the stale copy in place so
        // status/result updates land without the sidebar jumping.
        const merged = mergeTaskPagesReplacingDuplicates(prev.tasks, moreTasks);
        return {
          tasks: merged,
          loadingMore: false,
          tasksCursor: normalizeTaskListCursor(res?.nextCursor),
          tasksHasMore: normalizeTaskListCursor(res?.nextCursor) != null,
          ...pruneRuntimeStateForTerminalTasks(prev, moreTasks),
        };
      });
    } catch (err) {
      set({ loadingMore: false, error: taskStoreError(err) });
    }
  },

  async togglePin(taskId, desiredPinned) {
    // Pin is server-persisted. The optimistic local flip only applies
    // when the task is in the store's `tasks` array — /starred can
    // call this for older pins that aren't in the recent-50 slice, in
    // which case there's no local row to flip but the RPC must still
    // fire. Caller can pass `desiredPinned` to force the target state
    // (the toggle-off path on /starred can't infer it from a local
    // row that doesn't exist).
    const before = get().tasks.find((t) => t.taskId === taskId);
    const next = desiredPinned ?? !(before?.starred ?? false);
    if (before) {
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.taskId === taskId
            ? { ...t, starred: next, starredAt: next ? new Date() : null }
            : t,
        ),
      }));
    }
    try {
      await trpc.tasks.star.mutate({ taskId, starred: next });
    } catch (err) {
      if (before) {
        // Local row existed and the RPC failed — revert the optimistic
        // flip so the UI matches the server.
        set((prev) => ({
          tasks: prev.tasks.map((t) =>
            t.taskId === taskId
              ? {
                  ...t,
                  starred: before.starred ?? false,
                  starredAt: before.starredAt ?? null,
                }
              : t,
          ),
        }));
      }
      // Nothing to revert when the task wasn't in the local slice;
      // the caller (StarredPage) handles its own optimistic remove.
      throw err;
    }
  },

  async moveTaskToProject(taskId, projectId) {
    const before = get().tasks.find((t) => t.taskId === taskId);
    if (!before) return { ok: true };
    set((prev) => ({
      tasks: prev.tasks.map((t) => (t.taskId === taskId ? { ...t, projectId } : t)),
    }));
    try {
      await trpc.tasks.moveToProject.mutate({ taskId, projectId });
      return { ok: true };
    } catch (err) {
      const msg = taskStoreError(err);
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.taskId === taskId ? { ...t, projectId: before.projectId ?? null } : t,
        ),
        error: msg,
      }));
      return { error: msg };
    }
  },

  async deleteTask(taskId) {
    try {
      await trpc.tasks.delete.mutate({ taskId });
      const deletedActiveTask = get().selectedTaskId === taskId;
      if (deletedActiveTask) {
        abortInFlightHydrate();
        storeNavigate?.(null);
      }
      set((prev) => {
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
          browserInteractive: wasActive ? false : prev.browserInteractive,
          stepsByTask: omitRuntimeKey(prev.stepsByTask, taskId),
          screencastByTask: omitRuntimeKey(prev.screencastByTask, taskId),
          captchaWaitByTask: omitRuntimeKey(prev.captchaWaitByTask, taskId),
          executorFallbackByTask: omitRuntimeKey(prev.executorFallbackByTask, taskId),
          degradeByTask: omitRuntimeKey(prev.degradeByTask, taskId),
          awaitingUserByTask: omitRuntimeKey(prev.awaitingUserByTask, taskId),
          userRepliesByTask: omitRuntimeKey(prev.userRepliesByTask, taskId),
          webSearchByTask: omitRuntimeKey(prev.webSearchByTask, taskId),
          thinkingByTask: omitRuntimeKey(prev.thinkingByTask, taskId),
          suggestionsByTask: omitRuntimeKey(prev.suggestionsByTask, taskId),
          streamingByTask: omitRuntimeKey(prev.streamingByTask, taskId),
          progressByTask: omitRuntimeKey(prev.progressByTask, taskId),
          subStatusByTask: omitRuntimeKey(prev.subStatusByTask, taskId),
          terminalTaskIds: omitTaskIdFromSet(prev.terminalTaskIds, taskId),
          animatedTaskIds: omitTaskIdFromSet(prev.animatedTaskIds, taskId),
        };
      });
      return { ok: true as const };
    } catch (err) {
      const msg = taskStoreError(err);
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
      const msg = taskStoreError(err);
      set({ error: msg });
      // Roll back optimistic change by pulling the server's truth.
      void get().refreshTasks();
      return { error: msg };
    }
  },

  async replyToTask(taskId, message, fileIds) {
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
      const res = await trpc.tasks.reply.mutate({
        taskId,
        message,
        ...(fileIds && fileIds.length > 0 ? { fileIds } : {}),
      });
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
        // flips back to the default mode. Also clear the mirrored
        // task-row awaitingKind/status immediately; otherwise the
        // selected-task derivations can keep showing browser handoff
        // UI until the next WS frame lands.
        set((prev) => {
          const nextAwaiting = { ...prev.awaitingUserByTask };
          delete nextAwaiting[taskId];
          const nextCaptcha = prev.captchaWaitByTask[taskId]
            ? { ...prev.captchaWaitByTask }
            : prev.captchaWaitByTask;
          if (nextCaptcha !== prev.captchaWaitByTask) delete nextCaptcha[taskId];
          return {
            awaitingUserByTask: nextAwaiting,
            captchaWaitByTask: nextCaptcha,
            tasks: prev.tasks.map((t) => {
              if (t.taskId !== taskId) return t;
              const { awaitingKind: _awaitingKind, ...rest } = t;
              return {
                ...rest,
                status: t.status === 'awaiting_user' ? 'executing' : t.status,
              };
            }),
          };
        });
      }
      return { ok: res.ok };
    } catch (err) {
      const msg = taskStoreError(err);
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
      const msg = taskStoreError(err);
      set({ error: msg });
      return { error: msg };
    }
  },

  async createTask(
    intent,
    fileIds,
    replyToTaskId,
    mode,
    expertMode,
    viewportProfile,
    videoOptions,
    skillSelection,
  ) {
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
    const pickedViewportProfile =
      viewportProfile ??
      get().defaultViewportProfile ??
      pickDefaultBrowserViewportProfile();
    const localTaskId = `${LOCAL_PENDING_TASK_PREFIX}${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const createdAt = new Date();
    const pendingTask: UiTask = {
      taskId: localTaskId,
      intent,
      title: '正在创建任务',
      status: 'executing',
      tickCount: 0,
      createdAt,
      executionMode: inferExecutionModeFromIntent(intent),
    };
    set((prev) => ({
      tasks: [pendingTask, ...prev.tasks],
      browserInteractive: false,
    }));
    try {
      const res = await trpc.tasks.create.mutate({
        intent,
        ...(fileIds && fileIds.length > 0 ? { fileIds } : {}),
        ...(replyToTaskId ? { replyToTaskId } : {}),
        ...(mode === 'plan' ? { mode } : {}),
        ...(expertMode && expertMode !== 'auto' ? { expertMode } : {}),
        ...(skillSelection?.skillId
          ? {
              skillId: skillSelection.skillId,
              skillSource: skillSelection.skillSource,
            }
          : {}),
        ...(videoOptions ? { videoOptions } : {}),
        viewportProfile: pickedViewportProfile,
      });
      // Optimistic insert at the top so the UI feels instant; the next
      // refreshTasks() will pick up the canonical server row.
      //
      // F3 — `executionMode` source-of-truth order:
      //   1. `res.executionMode` (server-authoritative, available on
      //      builds that include the F3 patch)
      //   2. `inferExecutionModeFromIntent(intent)` — front-end coarse
      //      inference, kept as a fallback for older orchestrator
      //      builds that don't yet ship the field
      // The server value is always correct because it was decided by
      // `classifyExecutionMode` + `matchExpertWorkflow` BEFORE the
      // task row was inserted. Falling back to inference covers the
      // version-skew window after a deploy.
      const serverExecutionMode = (res as { executionMode?: UiTask['executionMode'] })
        .executionMode;
      const optimistic: UiTask = {
        taskId: res.taskId,
        intent,
        title: null,
        status: (res.status as UiTaskStatus) ?? 'executing',
        tickCount: 0,
        createdAt,
        executionMode: serverExecutionMode ?? inferExecutionModeFromIntent(intent),
      };
      // composerMode flips back to 'task' here. Without this, a user
      // who clicked 发新任务 (composerMode='new') and submitted ends
      // up with selectedTaskId=res.taskId but composerMode still
      // pinned to 'new' — leaving the store in an inconsistent state
      // that any subsequent enterNewTaskMode() would clear.
      // browserInteractive clears so the new task starts view-only
      // unless it explicitly needs user action.
      set((prev) => ({
        tasks: [
          optimistic,
          ...prev.tasks.filter(
            (t) => t.taskId !== res.taskId && t.taskId !== localTaskId,
          ),
        ],
        selectedTaskId: res.taskId,
        composerMode: 'task' as const,
        browserInteractive: false,
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
      const msg = taskStoreError(err);
      set((prev) => ({
        error: msg,
        tasks: prev.tasks.filter((t) => t.taskId !== localTaskId),
      }));
      return { error: msg };
    }
  },

  applyServerMessage(msg) {
    if (msg.type === 'server.task.control') {
      set((prev) => {
        const existingTask = prev.tasks.find((task) => task.taskId === msg.taskId);
        const isPausedResume = msg.command === 'resume' && existingTask?.status === 'paused';
        if (isTaskRuntimeTerminal(prev, msg.taskId) && !isPausedResume) return prev;
        const nextSubStatus = { ...prev.subStatusByTask };
        delete nextSubStatus[msg.taskId];
        const nextAwaiting = { ...prev.awaitingUserByTask };
        delete nextAwaiting[msg.taskId];
        const nextTerminalIds = new Set(prev.terminalTaskIds);
        if (msg.command === 'cancel' || msg.command === 'pause') nextTerminalIds.add(msg.taskId);
        else nextTerminalIds.delete(msg.taskId);
        const status =
          msg.command === 'pause'
            ? 'paused'
            : msg.command === 'cancel'
              ? 'cancelled'
              : 'executing';
        return {
          tasks: prev.tasks.map((t) =>
            t.taskId === msg.taskId
              ? {
                  ...t,
                  status,
                  ...(msg.command === 'resume'
                    ? { awaitingKind: undefined, resultText: undefined }
                    : {}),
                }
              : t,
          ),
          awaitingUserByTask: nextAwaiting,
          subStatusByTask: nextSubStatus,
          terminalTaskIds: nextTerminalIds,
        };
      });
      return;
    }
    if (msg.type === 'server.task.terminal') {
      set((prev) => {
        const existingTask = prev.tasks.find((task) => task.taskId === msg.taskId);
        if (
          existingTask &&
          isTerminalStatus(existingTask.status) &&
          existingTask.status !== msg.status
        ) {
          return prev;
        }
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
        if (isTerminalStatus(msg.status)) {
          nextAnimatedIds.add(msg.taskId);
        } else {
          nextAnimatedIds.delete(msg.taskId);
        }
        // Codex Pack B1 — clear sub-status on terminal so the chip
        // disappears the moment a task finishes. Unlike
        // streamingByTask / progressByTask (which we keep around to
        // bridge the terminal → TerminalSummary handoff), the chip is
        // a pure live-state surface — keeping it would leave "正在
        // 操作浏览器…" hanging next to a completed result.
        const nextSubStatus = { ...prev.subStatusByTask };
        delete nextSubStatus[msg.taskId];
        const nextAwaiting = { ...prev.awaitingUserByTask };
        delete nextAwaiting[msg.taskId];
        const nextCaptchaWait = omitRuntimeKey(prev.captchaWaitByTask, msg.taskId);
        const nextExecutorFallback = omitRuntimeKey(
          prev.executorFallbackByTask,
          msg.taskId,
        );
        const nextDegrade = omitRuntimeKey(prev.degradeByTask, msg.taskId);
        // Codex Round 2 P1-6 — terminal frame may carry the verifier
        // verdict's failed-check list so the SPA banner can render
        // specific bullets. Stamp onto the task; null clears prior
        // values if a re-broadcast comes back clean.
        const incomingFailedChecks =
          (msg as { failedChecks?: Array<{ type: string; detail: string }> })
            .failedChecks ?? null;
        // P1 timing fix — the image lane now ships attachments[] ON the
        // terminal frame (see orchestrator tasks.ts + ws.ts). Stamp them
        // onto the task immediately so the image card renders WITH the
        // "已生成1张图片" summary, instead of arriving one tasks.detail
        // round-trip later (the gap the user reported as 文字先出图后到).
        const incomingAttachments = parseUiAttachments(
          (msg as { attachments?: unknown }).attachments,
        );
        return {
          tasks: prev.tasks.map((t) =>
            t.taskId === msg.taskId
              ? {
                  ...t,
                  status: msg.status,
                  ...(msg.summary ? { resultText: msg.summary } : {}),
                  ...(msg.reason ? { resultText: humaniseTaskError(msg.reason) } : {}),
                  ...(incomingFailedChecks !== null
                    ? { failedChecks: incomingFailedChecks }
                    : {}),
                  ...(incomingAttachments ? { attachments: incomingAttachments } : {}),
                }
              : t,
          ),
          terminalTaskIds: nextTerminalIds,
          animatedTaskIds: nextAnimatedIds,
          awaitingUserByTask: nextAwaiting,
          subStatusByTask: nextSubStatus,
          captchaWaitByTask: nextCaptchaWait,
          executorFallbackByTask: nextExecutorFallback,
          degradeByTask: nextDegrade,
          // streamingByTask + progressByTask unchanged; buffers
          // persist until resultText is rendered in their place.
        };
      });
      // F4 — backend-orchestrated handoff. When the reply handler on
      // the orchestrator spawns a follow-up task (intake clarification
      // revealed a need for the browser lane), it ships the new task's
      // id on the terminal frame. The SPA's only job: navigate the
      // selection to that task — the new row + its supercar dispatch
      // are already running server-side. Earlier flow had the SPA
      // fire createTask off the terminal which double-created on WS
      // replay; this version is idempotent because the backend uses
      // `result.handoffTaskId` as its dedup key.
      const handoffTaskId = (msg as { handoffTaskId?: string }).handoffTaskId;
      if (typeof handoffTaskId === 'string' && handoffTaskId.length > 0) {
        setTimeout(() => {
          try {
            get().selectTask(handoffTaskId, 'ui');
          } catch (err) {
            hdDebug('handoff selectTask failed', {
              err: err instanceof Error ? err.message : String(err),
            });
          }
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
            t.taskId === msg.taskId
              ? {
                  ...markTaskRunningFromLiveSignal(t),
                  executionMode: 'generate' as const,
                }
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
      // Codex Pack B1 — optional `subStatus` field drives the
      // live-phase chip in TaskStream. Recorded with a client-side
      // timestamp so the 30s+ elapsed timer can run without needing
      // server clock alignment.
      const subStatus = (msg as { subStatus?: string }).subStatus;
      const typedSubStatus =
        subStatus === 'planning' ||
        subStatus === 'browsing' ||
        subStatus === 'extracting' ||
        subStatus === 'verifying' ||
        subStatus === 'generating' ||
        subStatus === 'generating_image'
          ? subStatus
          : null;
      set((prev) => {
        const isTerminal = prev.terminalTaskIds.has(msg.taskId);
        hdDebug('progress', {
          taskId: msg.taskId,
          isTerminal,
          message: msg.message,
          subStatus: typedSubStatus,
          gated: isTerminal,
        });
        if (isTerminal) return prev;
        // Explicit type annotation: the two branches of the inner
        // ternary produce slightly different object literal types,
        // and without this hint TS widens `nextSubStatus` to a union
        // that no longer matches `TaskStore['subStatusByTask']` —
        // causing the zustand `set` callback to reject the return
        // shape (C2 TS regression repro on Pack B1 land).
        const nextSubStatus: TaskStore['subStatusByTask'] = typedSubStatus
          ? {
              ...prev.subStatusByTask,
              [msg.taskId]:
                // Reuse `since` if the chip was already up — gives a
                // continuous timer across phase transitions instead of
                // resetting to 0 every time the runner advances.
                prev.subStatusByTask[msg.taskId]
                  ? { subStatus: typedSubStatus, since: prev.subStatusByTask[msg.taskId]!.since }
                  : { subStatus: typedSubStatus, since: Date.now() },
            }
          : prev.subStatusByTask;
        return {
          progressByTask: {
            ...prev.progressByTask,
            [msg.taskId]: msg.message,
          },
          subStatusByTask: nextSubStatus,
          // Pre-B1: progress notes only came from generate / scrape, so
          // we eagerly flipped executionMode='generate' to keep the
          // BrowserPanel from rendering for non-browser tasks. Pack B1
          // adds supercar/browser progress events; skip the flip when
          // the new subStatus is `browsing` (real browser session) so
          // the panel stays mounted.
          tasks: prev.tasks.map((t) => {
            if (t.taskId !== msg.taskId) return t;
            const liveTask = markTaskRunningFromLiveSignal(t);
            if (liveTask.executionMode !== 'generate' && typedSubStatus !== 'browsing') {
              return { ...liveTask, executionMode: 'generate' as const };
            }
            return liveTask;
          }),
        };
      });
      return;
    }
    if (msg.type === 'server.task.queued') {
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.taskId === msg.taskId && !isTaskRuntimeTerminal(prev, msg.taskId)
            ? { ...t, status: 'queued' as const, queuePosition: msg.position }
            : t,
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
        if (isTaskRuntimeTerminal(prev, msg.taskId)) return prev;
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
            return {
              ...rest,
              status: 'executing' as const,
              tickCount: Math.max(t.tickCount, msg.tickIndex + 1),
            };
          }),
        };
      });
      return;
    }
    if (msg.type === 'server.vision.tick.end') {
      // Layer 3: forward the anti-bot tag into the UI step. When the
      // orchestrator flagged this tick as captcha / verify / block /
      // cloudflare, StepCard renders an orange warning badge instead
      // of plain success/failure colors.
      const antiBotTag = msg.antiBot
        ? {
            type: msg.antiBot.type,
            confidence: msg.antiBot.confidence,
            message: msg.antiBot.message,
          }
        : undefined;
      set((prev) => {
        if (isTaskRuntimeTerminal(prev, msg.taskId)) return prev;
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
      set((prev) => {
        if (isTaskRuntimeTerminal(prev, msg.taskId)) return prev;
        const nextSubStatus = { ...prev.subStatusByTask };
        delete nextSubStatus[msg.taskId];
        return {
          awaitingUserByTask: {
            ...prev.awaitingUserByTask,
            [msg.taskId]: {
              question: msg.question,
              at: Date.now(),
              ...(awaitingKind ? { awaitingKind } : {}),
            },
          },
          subStatusByTask: nextSubStatus,
          // P2-A — also mirror onto the task row so a refresh that
          // re-loads via tasks.detail still has the right kind even if
          // the WS event arrived first and tasks.detail's hydrate has
          // not yet fired. Also flip the row status immediately: the
          // awaiting card is now the authoritative lifecycle surface and
          // must suppress stale "executing / browsing" UI until the next
          // list refresh catches up.
          tasks: prev.tasks.map((t) =>
            t.taskId === msg.taskId
              ? {
                  ...t,
                  status: 'awaiting_user' as const,
                  ...(awaitingKind ? { awaitingKind } : {}),
                }
              : t,
          ),
        };
      });
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
      subStatusByTask: {},
      terminalTaskIds: new Set<string>(),
      animatedTaskIds: new Set<string>(),
      defaultViewportProfile: null,
    });
  },
  };
});

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
const LOCAL_PENDING_TASK_PREFIX = 'local_pending_';

function isLocalPendingTaskId(taskId: string): boolean {
  return taskId.startsWith(LOCAL_PENDING_TASK_PREFIX);
}

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
  const summary = safeTaskListText(r.summary);
  if (summary) return stripInternalResultMetadata(summary);
  const reason = safeTaskListText(r.reason);
  if (reason) return stripInternalResultMetadata(reason);
  return null;
}

const INTERNAL_RESULT_METADATA_KEYS = [
  '"model"',
  '"finalUrl"',
  '"elapsedMs"',
  '"toolsUsed"',
  '"expertMode"',
  '"iterations"',
  '"attachments"',
  '"selectedRole"',
  '"executionMode"',
  '"fallbackChain"',
  '"modelFinalText"',
  '"expertWorkflowId"',
  '"awaitingUserCount"',
  '"finalExecutionMode"',
  '"hasFinalScreenshot"',
] as const;

function looksLikeInternalResultMetadata(block: string): boolean {
  let hits = 0;
  for (const key of INTERNAL_RESULT_METADATA_KEYS) {
    if (block.includes(key)) hits += 1;
  }
  return hits >= 4 && /"(?:finalUrl|modelFinalText|fallbackChain|toolsUsed)"/.test(block);
}

function stripInternalResultMetadata(input: string): string {
  let out = '';
  let i = 0;
  while (i < input.length) {
    if (input[i] !== '{') {
      out += input[i];
      i += 1;
      continue;
    }

    const start = i;
    let depth = 1;
    let j = i + 1;
    while (j < input.length && depth > 0 && j - start < 50_000) {
      const ch = input[j];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      j += 1;
    }
    if (depth !== 0) {
      out += input.slice(start);
      break;
    }

    const block = input.slice(start, j);
    if (!looksLikeInternalResultMetadata(block)) out += block;
    i = j;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function extractFailedChecks(
  result: unknown,
): Array<{ type: string; detail: string }> | null {
  if (!result || typeof result !== 'object') return null;
  const raw = (result as Record<string, unknown>).failedChecks;
  if (!Array.isArray(raw)) return null;
  const checks = raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const rec = item as Record<string, unknown>;
      if (typeof rec.type !== 'string' || typeof rec.detail !== 'string') {
        return null;
      }
      const type = rec.type.trim();
      const detail = rec.detail.trim();
      return type && detail ? { type, detail } : null;
    })
    .filter((item): item is { type: string; detail: string } => item !== null);
  return checks.length > 0 ? checks : null;
}

function displayResultTextForStatus(
  status: UiTask['status'],
  resultText: string | null,
  fallbackErrorText: string | null,
): string | null {
  const raw = resultText || fallbackErrorText;
  if (!raw) return null;
  return status === 'failed' || status === 'cancelled'
    ? humaniseTaskError(raw)
    : raw;
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
  if (/生成一张图片|生成.*图片|图片生成|图生图|图片编辑/u.test(intent)) {
    return 'image';
  }
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
  if (direct === 'browser' || direct === 'generate' || direct === 'scrape' || direct === 'image') {
    return direct;
  }
  const meta = r.metadata;
  if (meta && typeof meta === 'object') {
    const m = (meta as Record<string, unknown>).executionMode;
    if (m === 'browser' || m === 'generate' || m === 'scrape' || m === 'image') return m;
  }
  return undefined;
}

function taskStoreError(err: unknown): string {
  return pageErrorMessage(err);
}

export function normalizeTaskListRows(value: unknown): UiTask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = normalizeTaskListRow(entry);
    return row ? [toUiTask(row as ListRow)] : [];
  });
}

export function normalizeTaskListCursor(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export function normalizeTaskDetailSteps(value: unknown, now = Date.now()): UiStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, idx) => {
    if (!isTaskListRecord(entry)) return [];
    const output = isTaskListRecord(entry.output) ? entry.output : {};
    const input = isTaskListRecord(entry.input) ? entry.input : {};
    const kind = safeTaskListText(entry.kind) || 'step';
    const summary = safeTaskListText(input.summary) || kind;
    const startedAtValue = safeTaskListDate(entry.startedAt);
    const startedAt =
      startedAtValue == null ? now : new Date(startedAtValue).getTime();
    const durationMs =
      typeof output.durationMs === 'number' && Number.isFinite(output.durationMs)
        ? Math.max(0, output.durationMs)
        : 0;
    const message = safeTaskListText(output.message);
    const antiBot = normalizeStepAntiBot(output.antiBot);
    return [
      {
        tickIndex:
          typeof entry.seq === 'number' && Number.isSafeInteger(entry.seq)
            ? entry.seq
            : idx,
        status: normaliseDetailStepStatus(safeTaskListText(entry.status)),
        actionKind: kind,
        actionSummary: summary,
        durationMs,
        ...(message ? { message } : {}),
        ...(antiBot ? { antiBot } : {}),
        startedAt: Number.isFinite(startedAt) ? startedAt : now,
      },
    ];
  });
}

function normalizeTaskPlanStatus(value: unknown): UiTask['planStatus'] | undefined {
  if (!Array.isArray(value)) return undefined;
  type PlanStatusEntry = NonNullable<UiTask['planStatus']>[number];
  const cleaned: PlanStatusEntry[] = value.flatMap((entry) => {
    if (!isTaskListRecord(entry)) return [];
    const idx = typeof entry.idx === 'number' && Number.isSafeInteger(entry.idx)
      ? entry.idx
      : null;
    const status: PlanStatusEntry['status'] | null =
      entry.status === 'pending' ||
      entry.status === 'running' ||
      entry.status === 'done' ||
      entry.status === 'failed'
        ? entry.status
        : null;
    if (idx == null || status == null) return [];
    const note = safeTaskListText(entry.note);
    return [{ idx, status, ...(note ? { note } : {}) }];
  });
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeTaskListRow(value: unknown): Record<string, unknown> | null {
  if (!isTaskListRecord(value)) return null;
  const taskId = safeTaskListText(value.taskId);
  if (!taskId) return null;
  return {
    ...value,
    taskId,
    intent: safeTaskListText(value.intent) || '未命名任务',
    title: safeNullableTaskListText(value.title),
    status: safeTaskListText(value.status) || 'unknown',
    createdAt: safeTaskListDate(value.createdAt) ?? 0,
    starredAt: safeNullableTaskListDate(value.starredAt),
    projectId: safeNullableTaskListText(value.projectId),
    errorMessage: safeNullableTaskListText(value.errorMessage),
  };
}

function normalizeWebSearchSources(
  value: unknown,
): ReadonlyArray<{ title: string; url: string; snippet?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isTaskListRecord(entry)) return [];
    const title = safeTaskListText(entry.title);
    const url = safeTaskListText(entry.url);
    if (!title || !url) return [];
    const snippet = safeTaskListText(entry.snippet);
    return [{ title, url, ...(snippet ? { snippet } : {}) }];
  });
}

function normalizeStepAntiBot(value: unknown): UiStep['antiBot'] | undefined {
  if (!isTaskListRecord(value)) return undefined;
  const type =
    value.type === 'captcha' ||
    value.type === 'verify' ||
    value.type === 'block' ||
    value.type === 'cloudflare'
      ? value.type
      : null;
  const confidence =
    value.confidence === 'high' || value.confidence === 'medium'
      ? value.confidence
      : null;
  const message = safeTaskListText(value.message);
  return type && confidence && message
    ? { type, confidence, message }
    : undefined;
}

export function toUiTask(row: ListRow): UiTask {
  const opusUsed = (row as { opusUsed?: unknown }).opusUsed === true;
  const r = row as { starred?: unknown; starredAt?: unknown; projectId?: unknown };
  const status = normaliseStatus(safeTaskListText((row as { status?: unknown }).status) || 'unknown');
  // Root-cause fix for the "result text disappears on refresh" / brief
  // post-terminal flash: tasks.list already ships `result` for every
  // row, but toUiTask used to drop it and only map errorMessage. The
  // detail-hydration that filled in resultText only fired on opening
  // a task, so a completed task in the sidebar rendered with
  // resultText=null until something else triggered a hydrate. The
  // earlier streaming-buffer-persistence + terminalTaskIds Set patch
  // bridged the gap; mapping result.summary here removes the gap
  // entirely, so those guards mostly become belt-and-suspenders.
  const rowResult = (row as { result?: unknown }).result;
  const resultObj = isTaskListRecord(rowResult) ? rowResult : {};
  const metadata = isTaskListRecord(resultObj.metadata) ? resultObj.metadata : {};
  const summaryFromResult = extractSummary(rowResult);
  const failedChecks = extractFailedChecks(rowResult);
  const executionMode = extractExecutionMode(rowResult);
  // Generation (success) tasks carry metadata.videoType; the quote task
  // (awaiting video_quote) carries metadata.videoOptions.tab instead — fall
  // back to it so the quote card can hide 图片版 for ip_person (B2).
  const videoMeta = metadata as { videoType?: unknown; videoOptions?: { tab?: unknown } };
  const videoTypeRaw = videoMeta.videoType ?? videoMeta.videoOptions?.tab;
  const videoType =
    videoTypeRaw === 'normal' || videoTypeRaw === 'pet' || videoTypeRaw === 'ip_person'
      ? videoTypeRaw
      : undefined;
  const finalScreenshot =
    safeTaskListText(resultObj.finalScreenshot).length > 0
      ? safeTaskListText(resultObj.finalScreenshot)
      : undefined;
  const finalUrl =
    safeTaskListText(resultObj.finalUrl).length > 0
      ? safeTaskListText(resultObj.finalUrl)
      : undefined;
  const finalViewport = normalizeFinalViewport(
    resultObj.finalViewport ?? metadata.finalViewport,
  );
  const errorText =
    typeof row.errorMessage === 'string'
      ? humaniseTaskError(row.errorMessage)
      : null;
  const resultText = displayResultTextForStatus(
    status,
    summaryFromResult,
    errorText,
  ) ?? null;
  // Codex Pack A4 — verifier verdict columns (null on legacy rows).
  const verificationPassedRaw = (row as { verificationPassed?: unknown })
    .verificationPassed;
  const failureLevelRaw = (row as { failureLevel?: unknown }).failureLevel;
  const failureLevel =
    failureLevelRaw === 'fixable' ||
    failureLevelRaw === 'needs_clarification' ||
    failureLevelRaw === 'hard_fail'
      ? failureLevelRaw
      : null;
  return {
    taskId: safeTaskListText((row as { taskId?: unknown }).taskId),
    intent: safeTaskListText((row as { intent?: unknown }).intent) || '未命名任务',
    title: safeNullableTaskListText((row as { title?: unknown }).title),
    status,
    // The list endpoint doesn't expose tickCount directly; we leave 0
    // for now and let G4's ws events fill it in as ticks stream.
    tickCount: 0,
    ...(resultText ? { resultText } : {}),
    ...(executionMode ? { executionMode } : {}),
    ...(videoType ? { videoType } : {}),
    ...(finalScreenshot ? { finalScreenshot } : {}),
    ...(finalUrl ? { finalUrl } : {}),
    ...(finalViewport ? { finalViewport } : {}),
    // tRPC serializes Date to string over the wire; coerce back.
    createdAt: new Date(safeTaskListDate((row as { createdAt?: unknown }).createdAt) ?? 0),
    modelLabel: opusUsed ? 'opus' : 'sonnet',
    starred: r.starred === true,
    starredAt: safeNullableTaskListDate(r.starredAt),
    projectId: safeNullableTaskListText(r.projectId),
    verificationPassed:
      typeof verificationPassedRaw === 'boolean' ? verificationPassedRaw : null,
    failureLevel,
    failedChecks,
  };
}

function safeNullableTaskListText(value: unknown): string | null {
  const text = safeTaskListText(value);
  return text || null;
}

function safeTaskListText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFinalViewport(
  value: unknown,
): UiTask['finalViewport'] | undefined {
  if (!isTaskListRecord(value)) return undefined;
  const width = value.width;
  const height = value.height;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return {
    width: Math.floor(width),
    height: Math.floor(height),
  };
}

/**
 * Validate a raw attachments[] array (from metadata.attachments on a
 * tasks.detail payload, OR from the attachments field now carried on
 * the server.task.terminal WS frame) into the UiTask attachment shape.
 * Only well-formed entries pass; a malformed block yields undefined so
 * the renderer can never crash. Shared by hydrateDetail and the
 * terminal handler so the image card lands WITH the summary text
 * instead of one detail round-trip later (P1 timing fix).
 */
function parseUiAttachments(arr: unknown): UiTask['attachments'] | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const cleaned = arr
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as Record<string, unknown>;
      if (
        typeof e.fileId !== 'string' ||
        typeof e.downloadUrl !== 'string' ||
        typeof e.filename !== 'string' ||
        typeof e.mimetype !== 'string' ||
        typeof e.sizeBytes !== 'number' ||
        typeof e.expiresAt !== 'string' ||
        typeof e.kind !== 'string'
      ) {
        return null;
      }
      const downloadUrl = normaliseAttachmentDownloadUrl(e.downloadUrl);
      if (!downloadUrl) return null;
      return {
        fileId: e.fileId,
        downloadUrl,
        filename: e.filename,
        mimetype: e.mimetype,
        sizeBytes: e.sizeBytes,
        expiresAt: e.expiresAt,
        kind: e.kind,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
  return cleaned.length > 0 ? cleaned : undefined;
}

function normaliseAttachmentDownloadUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\/api\/files\/[^/]+\/download(?:[?#].*)?$/.test(trimmed)) return trimmed;
  if (/^\/files\/[^/]+\/download(?:[?#].*)?$/.test(trimmed)) return `/api${trimmed}`;
  return null;
}

function safeNullableTaskListDate(value: unknown): Date | null {
  const normalized = safeTaskListDate(value);
  return normalized == null ? null : new Date(normalized);
}

function safeTaskListDate(value: unknown): string | number | Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && !Number.isNaN(Date.parse(trimmed)) ? trimmed : null;
}

function isTaskListRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
    case 'pending':
    case 'planning':
    case 'executing':
    case 'awaiting_user':
    // Codex Pack A4 — verifier verdict downgraded a completed run.
    case 'partial_success':
    // Phase 24 RC follow-up — `queued` is the new pre-executing state
    // emitted by tasks.create when the BrowserPool is at capacity.
    case 'queued':
      return raw;
    default:
      return 'unknown';
  }
}

function markTaskRunningFromLiveSignal(task: UiTask): UiTask {
  const shouldFlip =
    task.status === 'pending' || task.status === 'planning' || task.status === 'queued';
  if (!shouldFlip && task.queuePosition === undefined) return task;
  const { queuePosition: _queuePosition, ...rest } = task;
  void _queuePosition;
  return {
    ...rest,
    ...(shouldFlip ? { status: 'executing' as const } : {}),
  };
}

function hasFinalTaskRow(
  state: Pick<TaskStore, 'tasks'>,
  taskId: string,
): boolean {
  const task = state.tasks.find((candidate) => candidate.taskId === taskId);
  return Boolean(task && isTerminalStatus(task.status));
}

function isTaskRuntimeTerminal(
  state: Pick<TaskStore, 'tasks' | 'terminalTaskIds'>,
  taskId: string,
): boolean {
  return state.terminalTaskIds.has(taskId) || hasFinalTaskRow(state, taskId);
}

export function normaliseDetailStepStatus(raw: string): UiStep['status'] {
  switch (raw) {
    case 'done':
    case 'ok':
    case 'completed':
      return 'done';
    case 'failed':
    case 'error':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'running';
  }
}
