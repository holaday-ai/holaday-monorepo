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
    opts: { cleanContext: true },
  ): Promise<{ ok: boolean; error?: string }>;
  assertCleanContext(): Promise<void>;
  disposeCleanContext(): Promise<void>;
}

export interface RunBrowseTaskDeps {
  cdpEndpoint: string;
  /** Fresh executor per browse so each site gets its own isolated clean context. */
  makeExecutor: () => CleanBrowseExecutor;
  /** Dispatch the live browse through runSupercarTask with the clean executor + veto hook. */
  runSupercar: (args: {
    taskId: string;
    intent: string;
    executor: CleanBrowseExecutor;
    onBeforeAction: (action: BrowseAction) => BrowseVerdict;
  }) => Promise<{ status: string; reason?: string }>;
  newTaskExternalId: () => string;
  resolveTaskInternalId: (taskExternalId: string) => Promise<number | null>;
  logger?: { warn: (o: unknown, m: string) => void };
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
    const executor = deps.makeExecutor();
    const taskId = deps.newTaskExternalId();
    try {
      const c = await executor.connect(deps.cdpEndpoint, { cleanContext: true });
      if (!c.ok)
        return { status: 'failed', reason: `clean-context connect failed: ${c.error ?? '?'}` };
      // 🔒 fail-closed zero-credential guarantee — throws if ANY cookie present.
      await executor.assertCleanContext();
      const outcome = await deps.runSupercar({ taskId, intent, executor, onBeforeAction });
      const taskInternalId = await deps.resolveTaskInternalId(taskId).catch(() => null);
      return { status: outcome.status, taskInternalId, reason: outcome.reason };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      deps.logger?.warn(
        { domain, reason },
        'browse runner: failed (clean-context assert or run error)',
      );
      return { status: 'failed', reason };
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
