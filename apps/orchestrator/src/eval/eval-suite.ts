/**
 * Phase 0 — Evaluation suite type definitions.
 *
 * The eval runner drives the orchestrator over its real tRPC HTTP
 * surface, the same path the SPA uses. Cases live in
 * `eval-cases/<suite>.json` so the suite can be edited without
 * recompiling. This file is the contract.
 *
 * Tier guidance:
 *   P0 — smoke. Runs every deploy. ≤10 cases, ≤5 min total.
 *   P1 — regression. Runs nightly / pre-RC. Covers per-feature paths.
 *   P2 — benchmark. Slow, expensive, model-quality oriented.
 */
export type EvalTier = 'P0' | 'P1' | 'P2';

/**
 * Free-form category — `douyin_review`, `browser_nav`, `login_park`,
 * `edge`, etc. Used only for grouping in the report; the runner
 * never branches on it.
 */
export type EvalCategory = string;

export type ExpectedExecutionMode = 'browser' | 'generate' | 'scrape';

export type ExpectedAwaitingKind =
  | 'clarification'
  | 'login'
  | 'captcha'
  | 'browser_action';

export type ExpectedTerminalStatus =
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'cancelled'
  | 'awaiting_user';

/**
 * What "passing" means for one case. Every assertion is independent;
 * failing one assertion records a single failure string and keeps
 * checking the rest, so the report shows everything that's wrong
 * (not just the first thing).
 */
export interface EvalExpectations {
  /**
   * Hard requirement: terminal status must be 'completed'. Combined
   * with `terminalStatus` lets you pin to a non-terminal state too
   * (e.g. P0_002 expects 'awaiting_user').
   */
  mustComplete: boolean;
  /**
   * Pin the terminal status. When set, this overrides `mustComplete`
   * — a case that expects 'awaiting_user' shouldn't also need
   * mustComplete=true. Use one or the other.
   */
  terminalStatus?: ExpectedTerminalStatus;
  /**
   * Cap on `tasks.create → terminal-status` wall-clock. Defaults to
   * 180_000 (3 min) when unset. P0_007 (search) caps at 60_000 to
   * surface latency regressions.
   */
  maxDurationMs?: number;
  /**
   * All of these substrings must appear in the search haystack
   * (result.summary + intent + errorMessage). Plain substring; case
   * matters.
   */
  mustContain?: string[];
  /**
   * At least ONE of these substrings must appear. Useful for
   * synonyms — P0_009 passes if either "矛盾" OR "不一致" surfaces.
   */
  mustContainAny?: string[];
  /**
   * None of these substrings may appear in the search haystack.
   */
  mustNotContain?: string[];
  /**
   * Pin the executor lane the orchestrator picked. Read from
   * `result.executionMode` (or the synchronous `tasks.create` return
   * for tasks that finish in the create call).
   */
  executionMode?: ExpectedExecutionMode;
  /**
   * Pin the awaiting-kind classifier output. Only meaningful when
   * `terminalStatus='awaiting_user'`.
   */
  awaitingKind?: ExpectedAwaitingKind;
  /**
   * `result.finalUrl` must include this substring. e.g. "iana.org"
   * for the example.com → IANA navigation case.
   */
  urlMustMatch?: string;
  /**
   * Named hook into a custom validator. Currently understood values:
   *   - 'detailRehydrate' — fetches tasks.list, picks the newest
   *     'completed' row, calls tasks.detail, asserts the response
   *     would let the SPA render without white-screening (has
   *     either result or steps).
   * Unknown values record a failure rather than silently passing.
   */
  customValidator?: string;
  /**
   * Phase 1 follow-up — when true, the case PASSES if `tasks.create`
   * returns a 4xx error. The error message is checked against
   * `mustContainAny` if provided; everything else (terminalStatus,
   * executionMode, etc.) is skipped because no task was created.
   *
   * Use this to validate refusal paths like the looksLikeCodeIntent
   * guard, where the create endpoint itself is the gate.
   */
  expectsCreateRejection?: boolean;
}

/**
 * Optional follow-up turn. The runner first validates the initial
 * post-create state against `case.expectations`, then for each
 * reply turn:
 *   1. issues `tasks.reply` with the message,
 *   2. polls until terminal again (unless `pollAfter:false`),
 *   3. validates the post-reply detail against `turn.expectations`.
 *
 * `pollAfter` defaults to `true` — the natural use case is "user
 * sends data, agent resumes and finishes; assert the resumed task
 * eventually completes". Set `pollAfter:false` only when probing
 * an immediate-return reply path (e.g. still_awaiting short-circuit).
 */
export interface EvalReplyTurn {
  message: string;
  fileIds?: string[];
  pollAfter?: boolean;
  /**
   * How to deliver the message:
   *   - 'reply' (default) — `tasks.reply` against the SAME taskId.
   *     Used to resume an awaiting_user task with the missing data.
   *   - 'follow-up' — `tasks.create` with `replyToTaskId` pointing
   *     at the parent. Used for the SPA's followup-action chips
   *     (parent already completed; user clicks "生成 SOP" → new
   *     task with parent context inherited). The runner switches
   *     subsequent polls to the NEW taskId.
   */
  kind?: 'reply' | 'follow-up';
  /**
   * Optional validation against the post-reply state. Same shape
   * as `case.expectations`. When omitted the turn just advances
   * the conversation without asserting on the outcome.
   */
  expectations?: EvalExpectations;
}

export interface EvalCase {
  /** Stable id, e.g. "P0_001". Appears in the report and CLI log. */
  id: string;
  tier: EvalTier;
  category: EvalCategory;
  /** The intent passed to `tasks.create.intent`. */
  prompt: string;
  /**
   * Multi-turn follow-up — issued via `tasks.reply` against the
   * same task after the parent parks / completes.
   */
  replySequence?: EvalReplyTurn[];
  /**
   * External file ids (upload via POST /files/upload first, then
   * pass them here). The runner does NOT upload files itself —
   * tests that need attachments must seed the ids beforehand. For
   * P0 this is unused.
   */
  attachments?: string[];
  expectations: EvalExpectations;
  /**
   * Free-form note shown in the report — useful for "this case
   * needs Brave running" kind of caveats.
   */
  notes?: string;
}

/**
 * Per-case outcome.
 */
export interface EvalCaseResult {
  id: string;
  tier: EvalTier;
  category: EvalCategory;
  ok: boolean;
  /** Human-readable failure reasons. Empty when `ok=true`. */
  failures: string[];
  taskId?: string;
  durationMs: number;
  terminalStatus?: string;
  awaitingKind?: string | null;
  executionMode?: string | null;
  finalUrl?: string | null;
  /** First 200 chars of `result.summary` — for eyeballing. */
  summarySnippet?: string | null;
  errorMessage?: string | null;
}

/**
 * Full suite report — written to `apps/orchestrator/eval-results/`.
 * Read by future tooling that diffs runs across deploys.
 */
export interface EvalReport {
  /** Suite name (matches the JSON filename minus `.json`). */
  suite: string;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  passed: number;
  failed: number;
  total: number;
  baseUrl: string;
  evalUserExternalId: string;
  cases: EvalCaseResult[];
}
