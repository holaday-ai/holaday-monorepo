import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { PlaybookBrowserTools } from '../replay/browser-tools.js';
import type { PathMatcher } from '../replay/model-assist.js';
import {
  type ReplayResult,
  type StepRepairer,
  estimateModelCallsSaved,
  executePathTemplate,
} from '../replay/replay-executor.js';
import type { EvolutionStore, StoredPath } from './evolution-store.js';
import { generalizeGroup } from './generalize.js';
import type { ParamValues } from './path-template.js';
import { groupTrajectories } from './trajectory.js';

/**
 * Batch 06 — the self-evolution loop.
 *
 *   capture  ─▶ sediment ─▶ canary ×N ─▶ verified ─▶ reuse (deterministic)
 *                                                    └─ step fails → model repair → new version
 *
 * Each stage is a plain async function over `EvolutionStore` so it can be
 * driven by BullMQ jobs (sediment / canary), by the executor hook (reuse), or
 * by tests with the in-memory store.
 */

interface LoopLogger {
  info: (o: unknown, m: string) => void;
  warn: (o: unknown, m: string) => void;
}

const silent: LoopLogger = { info: () => {}, warn: () => {} };

// ---------------------------------------------------------------------------
// 2. 沉淀 — sediment
// ---------------------------------------------------------------------------

export interface SedimentReport {
  trajectories: number;
  groups: number;
  created: Array<{ pathId: number; capabilityKey: string; generalizer: string; version: number }>;
  skippedNoNewEvidence: number;
  rejected: Array<{ capabilityKey: string; errors: string[] }>;
  modelCalls: number;
}

export async function runSedimentSweep(deps: {
  store: EvolutionStore;
  adapter?: MessagesAdapter | null;
  minSupport?: number;
  trajectoryLimit?: number;
  logger?: LoopLogger;
}): Promise<SedimentReport> {
  const logger = deps.logger ?? silent;
  const trajectories = await deps.store.loadTrajectories({ limit: deps.trajectoryLimit ?? 2_000 });
  const groups = groupTrajectories(trajectories, deps.minSupport ?? 2);
  const report: SedimentReport = {
    trajectories: trajectories.length,
    groups: groups.length,
    created: [],
    skippedNoNewEvidence: 0,
    rejected: [],
    modelCalls: 0,
  };
  for (const group of groups) {
    const existing = await deps.store.findTemplatePaths(group.siteDomain, group.capabilityKey);
    const covered = new Set(existing.flatMap((p) => p.sourceTaskIds));
    if (existing.length > 0 && group.trajectories.every((t) => covered.has(t.taskId))) {
      report.skippedNoNewEvidence += 1;
      continue;
    }
    // A verified path already serving this capability is left alone; new
    // evidence only matters when it would produce a different template.
    const outcome = await generalizeGroup(group, { adapter: deps.adapter ?? null });
    report.modelCalls += outcome.modelCalls;
    if (!outcome.ok || !outcome.template || !outcome.generalizer) {
      report.rejected.push({ capabilityKey: group.capabilityKey, errors: outcome.errors ?? [] });
      continue;
    }
    const latest = existing[0];
    if (latest && JSON.stringify(latest.template) === JSON.stringify(outcome.template)) {
      report.skippedNoNewEvidence += 1;
      continue;
    }
    const path = await deps.store.createTemplatePath({
      siteDomain: group.siteDomain,
      capabilityKey: group.capabilityKey,
      template: outcome.template,
      generalizer: outcome.generalizer,
      sourceTaskIds: group.trajectories.map((t) => t.taskId),
      status: 'draft',
      parentPathId: latest?.id ?? null,
    });
    report.created.push({
      pathId: path.id,
      capabilityKey: group.capabilityKey,
      generalizer: outcome.generalizer,
      version: path.version,
    });
    logger.info(
      { pathId: path.id, capabilityKey: group.capabilityKey, generalizer: outcome.generalizer },
      'playbook sediment: template path created (draft, awaiting canary)',
    );
  }
  return report;
}

// ---------------------------------------------------------------------------
// 3. 验证 — canary
// ---------------------------------------------------------------------------

export interface BrowserSession {
  tools: PlaybookBrowserTools;
  close(): Promise<void>;
}

/** Opens a fresh ISOLATED browser (no cookies, no user profile) per replay. */
export type IsolatedBrowserFactory = () => Promise<BrowserSession>;

export function canaryParams(path: StoredPath): ParamValues {
  return Object.fromEntries(path.template.params.map((p) => [p.name, p.example]));
}

export interface CanaryPathReport {
  pathId: number;
  passed: boolean;
  streak: number;
  status: StoredPath['status'];
  failureReason?: string;
}

/** Replay one path once, deterministically (no model), and advance its state machine. */
export async function runCanaryForPath(deps: {
  store: EvolutionStore;
  path: StoredPath;
  openBrowser: IsolatedBrowserFactory;
  passThreshold: number;
  locatorWaitMs?: number;
  now?: () => Date;
}): Promise<CanaryPathReport> {
  const now = deps.now ?? (() => new Date());
  const { path } = deps;
  const startedAt = now();
  let result: ReplayResult | null = null;
  let failure: string | undefined;
  let session: BrowserSession | null = null;
  try {
    session = await deps.openBrowser();
    result = await executePathTemplate({
      tools: session.tools,
      template: path.template,
      params: canaryParams(path),
      repairer: null, // canary is strict: a drifted page must fail, not be papered over
      ...(deps.locatorWaitMs ? { locatorWaitMs: deps.locatorWaitMs } : {}),
    });
    if (result.outcome !== 'success') failure = result.failureReason ?? 'replay_failed';
  } catch (err) {
    failure = `canary_error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 255);
  } finally {
    await session?.close().catch(() => {});
  }
  const passed = failure === undefined;
  await deps.store.recordCanaryResult(path.id, {
    passed,
    failureType: passed ? null : (failure ?? 'unknown').split(':')[0] ?? 'unknown',
    evidence: {
      stepsTotal: result?.stepsTotal ?? path.template.steps.length,
      stepsDeterministic: result?.stepsDeterministic ?? 0,
      finalUrl: result?.evidence.finalUrl ?? null,
      matchedSuccessTexts: result?.evidence.matchedSuccessTexts ?? [],
      ...(failure ? { failureReason: failure.slice(0, 255) } : {}),
    },
    startedAt,
    completedAt: now(),
  });
  if (passed) {
    const streak = path.canaryPassStreak + 1;
    const promote = path.status === 'draft' && streak >= deps.passThreshold;
    await deps.store.updatePathState(path.id, {
      canaryPassStreak: streak,
      ...(promote || path.status === 'verified' ? { lastVerifiedAt: now() } : {}),
      ...(promote ? { status: 'verified', staleReason: null } : {}),
    });
    return { pathId: path.id, passed, streak, status: promote ? 'verified' : path.status };
  }
  const demote = path.status === 'verified';
  await deps.store.updatePathState(path.id, {
    canaryPassStreak: 0,
    ...(demote ? { status: 'stale', staleReason: `canary_failed: ${failure}`.slice(0, 255) } : {}),
  });
  return {
    pathId: path.id,
    passed,
    streak: 0,
    status: demote ? 'stale' : path.status,
    ...(failure ? { failureReason: failure } : {}),
  };
}

export async function runCanaryRound(deps: {
  store: EvolutionStore;
  openBrowser: IsolatedBrowserFactory;
  passThreshold: number;
  batchSize?: number;
  locatorWaitMs?: number;
  logger?: LoopLogger;
}): Promise<CanaryPathReport[]> {
  const paths = await deps.store.listCanaryPaths(deps.batchSize ?? 20);
  const reports: CanaryPathReport[] = [];
  for (const path of paths) {
    const report = await runCanaryForPath({ ...deps, path });
    reports.push(report);
    (deps.logger ?? silent).info(report, 'playbook canary: path replayed');
  }
  return reports;
}

// ---------------------------------------------------------------------------
// 4. 复用 — reuse (hook in front of the batch-04 executor)
// ---------------------------------------------------------------------------

export type ReuseStatus = 'no_verified_path' | 'no_match' | 'replayed';

export interface ReuseResult {
  status: ReuseStatus;
  /** True only when the task's browser goal was met by the replay. */
  handled: boolean;
  pathId?: number;
  newVersionPathId?: number;
  replay?: ReplayResult;
  /** Model calls spent by matching + repair (0 when no verified path exists). */
  modelCalls: number;
}

export interface ReuseInput {
  store: EvolutionStore;
  tools: PlaybookBrowserTools;
  intent: string;
  siteDomain: string;
  taskId: number | null;
  matcher: PathMatcher;
  repairer?: StepRepairer | null;
  /** Per-step locator/wait budget (executor default when omitted). */
  locatorWaitMs?: number;
  logger?: LoopLogger;
}

/**
 * Try to satisfy a browser task from a `verified` path BEFORE the agent loop
 * runs. Returns `handled:false` whenever the normal executor must take over
 * (no path, no match, replay failed) — the page may have moved, so the caller
 * should start its agent loop from a fresh snapshot.
 */
export async function tryReuseVerifiedPath(input: ReuseInput): Promise<ReuseResult> {
  const logger = input.logger ?? silent;
  const verified = await input.store.listVerifiedPaths(input.siteDomain);
  if (verified.length === 0) return { status: 'no_verified_path', handled: false, modelCalls: 0 };

  const { match, modelCalls: matchCalls } = await input.matcher.match(
    input.intent,
    verified.map((p) => ({ pathId: p.id, description: p.template.description, params: p.template.params })),
  );
  const path = match ? verified.find((p) => p.id === match.pathId) : undefined;
  if (!match || !path) return { status: 'no_match', handled: false, modelCalls: matchCalls };

  const replay = await executePathTemplate({
    tools: input.tools,
    template: path.template,
    params: match.params,
    repairer: input.repairer ?? null,
    ...(input.locatorWaitMs ? { locatorWaitMs: input.locatorWaitMs } : {}),
  });
  const modelCalls = matchCalls + replay.modelCalls;

  let newVersionPathId: number | undefined;
  if (replay.outcome === 'repaired' && replay.repairedTemplate) {
    // 修复成功记为新版本: the repaired template is now the live path; the old
    // version is retired. The canary keeps re-checking the new version and
    // demotes it if the repair does not hold.
    const next = await input.store.createTemplatePath({
      siteDomain: path.siteDomain,
      capabilityKey: path.capabilityKey,
      template: replay.repairedTemplate,
      generalizer: 'repair',
      sourceTaskIds: path.sourceTaskIds,
      status: 'verified',
      parentPathId: path.id,
      canaryPassStreak: 0,
    });
    newVersionPathId = next.id;
    await input.store.updatePathState(path.id, {
      status: 'stale',
      staleReason: `superseded_by_repair:${next.id}`,
    });
    logger.info({ pathId: path.id, newVersionPathId }, 'playbook reuse: repaired path saved as new version');
  }

  await input.store.recordReplay({
    pathId: path.id,
    taskId: input.taskId,
    outcome: replay.outcome,
    stepsTotal: replay.stepsTotal,
    stepsDeterministic: replay.stepsDeterministic,
    stepsRepaired: replay.stepsRepaired,
    modelCalls,
    modelCallsSaved:
      replay.outcome === 'failed' ? 0 : estimateModelCallsSaved(replay.stepsTotal, modelCalls),
    repairedPathId: newVersionPathId ?? null,
    failedStepIndex: replay.failedStepIndex ?? null,
    failureReason: replay.failureReason ?? null,
    durationMs: replay.durationMs,
  });

  return {
    status: 'replayed',
    handled: replay.outcome !== 'failed',
    pathId: path.id,
    ...(newVersionPathId ? { newVersionPathId } : {}),
    replay,
    modelCalls,
  };
}
