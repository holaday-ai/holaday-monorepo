import type { BrowseAction, BrowseRunResult, BrowseVerdict } from './explorer-browse.js';
import type { ExploreSiteOutcome } from './explorer.js';

/**
 * Playbook ④ explorer — BROWSE-试用 runtime wiring (clean-context + exploration_runs).
 *
 * Two injected-dep factories so the heavy runtime (a connected PlaywrightExecutor,
 * runSupercarTask, the DB) stays in the CLI while the logic here is unit-testable:
 *   - makeRunBrowseTask  → the `runBrowseTask` makeBrowseExploreSite needs: connect a
 *     FRESH clean context → fail-closed zero-cookie assert → runSupercar(veto hook) →
 *     dispose the context (always). The clean context is the hermetic guard (§9.6).
 *   - withExplorationRun → persist one exploration_runs row per browse.
 */

/** Minimal executor view the runner needs (PlaywrightExecutor satisfies it). */
export interface CleanBrowseExecutor {
  connect(
    cdpEndpoint: string,
    opts: { cleanContext: true; storageState?: string },
  ): Promise<{ ok: boolean; error?: string }>;
  assertCleanContext(): Promise<void>;
  disposeCleanContext(): Promise<void>;
}

export interface RunBrowseTaskDeps {
  cdpEndpoint: string;
  /** Fresh executor per browse so each site gets its own isolated clean context. */
  makeExecutor: () => CleanBrowseExecutor;
  /**
   * Dispatch the live browse through runSupercarTask with the clean executor + veto hook.
   * Returns the in-process accumulated cost (cost-source A) so the breaker reads a
   * fail-closed number — NOT a DB read-back (a DB path fails OPEN = over-burn).
   */
  runSupercar: (args: {
    taskId: string;
    intent: string;
    executor: CleanBrowseExecutor;
    onBeforeAction: (action: BrowseAction) => BrowseVerdict;
  }) => Promise<{ status: string; reason?: string; costUsd: number; summary?: string }>;
  newTaskExternalId: () => string;
  /** Per-site connect/assert hard timeout (ms). Default DEFAULT_CONNECT_MS. */
  connectTimeoutMs?: number;
  /**
   * A2 login-self-learning: a test-account Playwright storageState FILE PATH. When set, the
   * connect seeds the isolated context with it (a LOGIN context) AND the clean-context assert is
   * SKIPPED (cookies are EXPECTED — the免登录 zero-credential guarantee does not apply to a
   * deliberately-authenticated test-account browse). Undefined → 免登录 lane unchanged (assert runs).
   */
  storageState?: string;
  logger?: { warn: (o: unknown, m: string) => void };
}

/**
 * FAIL-CLOSED env gate for the browse lane — the cost-source-A safety hinge.
 *
 * The breaker reads an in-memory cost total, but the accumulator only receives turns when
 * runSupercarTask fires `recorder.record()`, which it gates on `recorder && userExternalId`.
 * So a MISSING `EXPLORER_USER_EXTERNAL_ID` silently yields $0 accumulated cost = fail-OPEN
 * (the breaker can't see the burn → over-spend). And the browse MUST hit the live browser
 * (`HEADED_CDP_ENDPOINT` = 9223); `CDP_ENDPOINT` (9222) is dead. THROW rather than browse
 * blind — the CLI turns this into an abort BEFORE any connect / spend.
 */
export function requireBrowseEnv(env: {
  EXPLORER_USER_EXTERNAL_ID?: string;
  HEADED_CDP_ENDPOINT?: string;
}): { userExternalId: string; cdpEndpoint: string } {
  const userExternalId = (env.EXPLORER_USER_EXTERNAL_ID ?? '').trim();
  const cdpEndpoint = (env.HEADED_CDP_ENDPOINT ?? '').trim();
  if (!userExternalId) {
    throw new Error(
      '--browse requires EXPLORER_USER_EXTERNAL_ID — runSupercarTask fires the cost recorder ' +
        'only when userExternalId is set; without it the in-memory breaker reads $0 (fail-OPEN). ' +
        'Refusing to browse blind.',
    );
  }
  if (!cdpEndpoint) {
    throw new Error(
      '--browse requires HEADED_CDP_ENDPOINT (the live browser; CDP_ENDPOINT 9222 is dead). ' +
        'Refusing to browse.',
    );
  }
  return { userExternalId, cdpEndpoint };
}

/** (c) Per-browse iteration cap — the real single-run spend bound (the per-site $5 breaker
 *  is post-hoc; it can't kill a task mid-run). env-overridable so BOSS can tune batch-1
 *  without a redeploy. The DEFAULT is the calibrated ~$0.5–0.6 budget. */
export const DEFAULT_MAX_ITERATIONS = 25;
/** Fat-finger guard: a mistyped EXPLORER_MAX_ITERATIONS=2500 must NOT let one browse run
 *  away far past the $5 site breaker. A requested value above this is clamped down. */
export const MAX_ITERATIONS_CEILING = 50;

/**
 * FAIL-SAFE parse of EXPLORER_MAX_ITERATIONS. Missing / non-integer / ≤0 → DEFAULT;
 * a valid value is clamped to [1, MAX_ITERATIONS_CEILING]. Pure → unit-tested.
 */
export function resolveMaxIterations(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_MAX_ITERATIONS;
  return Math.min(n, MAX_ITERATIONS_CEILING);
}

/** Per-browse HARD wall (env-overridable). The supercar loop's `timeoutMs` is SOFT (checked
 *  between turns) → a single hung page/CDP op (hostile / anti-bot site) can block past it.
 *  This wall-clock deadline fires regardless. Default 420s > the 300s soft timeout, so the
 *  soft one gets first (clean) crack and this is the catch-all backstop. */
export const DEFAULT_BROWSE_HARD_MS = 420_000;
export function resolveBrowseHardMs(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_BROWSE_HARD_MS;
  return n;
}

/** Per-site CONNECT/ASSERT hard timeout (env-overridable). The per-browse hard wall wraps
 *  runSupercarTask but NOT the connectOverCDP + assertCleanContext phase before it — a hung
 *  connect (busy/flaky browser) pinned the whole batch. Default 60s. */
export const DEFAULT_CONNECT_MS = 60_000;
export function resolveConnectMs(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_CONNECT_MS;
  return n;
}

/**
 * Deterministic breakpoint summary — ALWAYS produced (done / maxIter / soft-timeout / hard-abort
 * / veto-halt / connect-fail), built from the captured step sequence + the stop reason, NOT the
 * model's final summary (a force-abort skips that, leaving it empty = the batch-2 "白烧"). This is
 * the "免登录够不够" evidence: where the task got to + why it stopped. The caller persists it into
 * exploration_runs.metadata.summary (a COMPLETED browse prefers the richer model summary).
 */
export function buildBreakpointSummary(args: {
  status: string;
  reason?: string;
  steps: ReadonlyArray<{ stepType: string; visibleText?: string | null }>;
}): string {
  const { status, reason, steps } = args;
  const r = reason ?? '';
  let stop: string;
  if (status === 'completed') stop = '完成（done）';
  else if (/hard deadline/i.test(r)) stop = '硬超时 force-abort（未走完）';
  else if (/maxIteration|exhausted/i.test(r)) stop = 'maxIter 耗尽（未收敛）';
  else if (/veto|sensitive|refus|blocked|登录|支付|下单|提交/i.test(r))
    stop = `veto 边界拦停（${r.slice(0, 80)}）`;
  else if (/timeout|timed out/i.test(r)) stop = '软超时';
  else if (/connect/i.test(r)) stop = `connect 失败（${r.slice(0, 80)}）`;
  else stop = `失败（${r.slice(0, 80) || status}）`;
  const stepLine = steps.length
    ? steps
        .map((s, i) => `${i + 1}.${s.stepType}${s.visibleText ? `(${s.visibleText.slice(0, 30)})` : ''}`)
        .join(' → ')
    : '(无捕获动作)';
  return `停止原因：${stop}。已走 ${steps.length} 步：${stepLine}`;
}

/**
 * Race `work` against a HARD wall-clock deadline. On timeout: run `onTimeout` (best-effort —
 * e.g. force-dispose the clean context to reject any in-flight op and unblock a hung loop) and
 * REJECT, so the caller reaches its terminal handling (status update, no stuck 'running' row).
 * The timer is always cleared. Pure-ish → unit-tested.
 */
export async function withHardDeadline<T>(
  work: Promise<T>,
  hardMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            onTimeout();
          } catch {
            /* best-effort — a cleanup failure must not mask the timeout */
          }
          reject(new Error(`browse hard deadline ${hardMs}ms exceeded — force-aborted`));
        }, hardMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Build the `runBrowseTask`: connect a fresh clean context → ASSERT zero cookies
 * (fail-closed; a dirty context throws → caught → failed, browse refused) →
 * runSupercar with the veto hook → dispose the context in `finally` (always).
 */
export function makeRunBrowseTask(deps: RunBrowseTaskDeps): (args: {
  domain: string;
  intent: string;
  onBeforeAction: (a: BrowseAction) => BrowseVerdict;
}) => Promise<BrowseRunResult> {
  return async ({ domain, intent, onBeforeAction }) => {
    const taskId = deps.newTaskExternalId();
    const connectMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_MS;
    // ① + ② CONNECT/ASSERT phase: HARD-timeout (the per-browse wall wraps runSupercar but NOT
    // this phase — a hung connectOverCDP pinned the whole batch) + ONE retry with a FRESH
    // executor (a transient hung/failed connect on a busy browser recovers on retry). On final
    // failure the SITE fails and the BATCH CONTINUES — it never pins the batch.
    let executor: CleanBrowseExecutor | null = null;
    for (let attempt = 1; attempt <= 2 && !executor; attempt++) {
      const ex = deps.makeExecutor();
      try {
        const connectOpts = deps.storageState
          ? ({ cleanContext: true, storageState: deps.storageState } as const)
          : ({ cleanContext: true } as const);
        const c = await withHardDeadline(ex.connect(deps.cdpEndpoint, connectOpts), connectMs, () => {
          void ex.disposeCleanContext().catch(() => {}); // unblock a hung connect
        });
        if (!c.ok) throw new Error(`connect failed: ${c.error ?? '?'}`);
        // 🔒 fail-closed zero-credential guarantee — throws if ANY cookie present. SKIPPED in
        // login mode (deps.storageState set): a test-account browse is deliberately authenticated,
        // so cookies are EXPECTED; safety there is the thicker veto (EXTRA_RE) + submit/password
        // decisive rules + the test-account isolation, not the empty-jar assert.
        if (!deps.storageState) {
          await withHardDeadline(ex.assertCleanContext(), connectMs, () => {
            void ex.disposeCleanContext().catch(() => {});
          });
        }
        executor = ex; // connected + (免登录: verified clean / login: authenticated test-account)
      } catch (e) {
        await ex.disposeCleanContext().catch(() => {});
        const reason = e instanceof Error ? e.message : String(e);
        deps.logger?.warn({ domain, attempt, reason }, 'browse runner: connect/assert failed');
        if (attempt === 2) {
          return { status: 'failed', costUsd: 0, reason: `connect/assert failed (${attempt} attempts): ${reason}` };
        }
      }
    }
    if (!executor) return { status: 'failed', costUsd: 0, reason: 'connect: no executor (unexpected)' };
    try {
      const outcome = await deps.runSupercar({ taskId, intent, executor, onBeforeAction });
      return {
        status: outcome.status,
        costUsd: outcome.costUsd,
        reason: outcome.reason,
        ...(outcome.summary ? { summary: outcome.summary } : {}),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      deps.logger?.warn({ domain, reason }, 'browse runner: run error');
      return { status: 'failed', costUsd: 0, reason };
    } finally {
      await executor.disposeCleanContext().catch(() => {});
    }
  };
}

// ---- exploration_runs persistence ------------------------------------------

const EXPLORE_STATUS_TO_RUN: Record<string, string> = {
  completed: 'completed',
  halted_sensitive: 'halted_sensitive',
  failed: 'failed',
};

export interface ExplorationRunWriter {
  /** Upsert/find the global site for the domain → its id (FK for the run row). */
  resolveSiteId: (domain: string) => Promise<number>;
  createExplorationRun: (input: {
    siteId: number;
    triggerType: string;
    runnerType: string;
    status: string;
    metadataJson: unknown;
  }) => Promise<unknown>;
  logger?: { warn: (o: unknown, m: string) => void };
}

/**
 * Wrap an exploreSite so each browse persists ONE exploration_runs row (site /
 * status / cost / halt reason) — closes v1's "doesn't write exploration_runs" gap.
 * Best-effort: a write failure logs + does NOT change the outcome.
 */
export function withExplorationRun(
  exploreSite: (domain: string) => Promise<ExploreSiteOutcome>,
  writer: ExplorationRunWriter,
  triggerType = 'manual_batch',
): (domain: string) => Promise<ExploreSiteOutcome> {
  return async (domain) => {
    const outcome = await exploreSite(domain);
    try {
      const siteId = await writer.resolveSiteId(domain);
      await writer.createExplorationRun({
        siteId,
        triggerType,
        runnerType: 'explorer.browse',
        status: EXPLORE_STATUS_TO_RUN[outcome.status] ?? 'failed',
        metadataJson: {
          domain,
          costUsd: outcome.costUsd,
          note: outcome.note,
          // v2 — the model's 任务流程 / 能力清单 / 断点报告 (truncated). The "免登录够不够"
          // evidence lives here, queryable per exploration_run.
          ...(outcome.summary ? { summary: outcome.summary.slice(0, 8000) } : {}),
          ...(outcome.capabilityExternalId
            ? { capabilityExternalId: outcome.capabilityExternalId }
            : {}),
        },
      });
    } catch (err) {
      writer.logger?.warn(
        { domain, err: err instanceof Error ? err.message : String(err) },
        'exploration_runs write failed (non-blocking)',
      );
    }
    return outcome;
  };
}
