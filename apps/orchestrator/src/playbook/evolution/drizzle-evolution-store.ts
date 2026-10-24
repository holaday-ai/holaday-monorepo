import { newExternalId } from '@holaday/shared-types';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { readInsertId } from '../../db/mysql-result.js';
import { canaryResults } from '../../db/schema/canary-results.js';
import { operationPathReplays } from '../../db/schema/operation-path-replays.js';
import { operationPathSteps } from '../../db/schema/operation-path-steps.js';
import { operationPaths } from '../../db/schema/operation-paths.js';
import { siteCapabilities } from '../../db/schema/site-capabilities.js';
import { sites } from '../../db/schema/sites.js';
import { taskActionCaptures } from '../../db/schema/task-action-captures.js';
import { tasks } from '../../db/schema/tasks.js';
import { SUCCESS_STATUSES } from '../crystallizer.js';
import { PlaybookRepository } from '../playbook-repository.js';
import { SiteRepository } from '../site-repository.js';
import type {
  CanaryRecord,
  CreateTemplatePathInput,
  EvolutionStore,
  PathGeneralizer,
  PathStatePatch,
  PathStatus,
  ReplayRecord,
  StoredPath,
} from './evolution-store.js';
import { describeStep, pathTemplateSchema } from './path-template.js';
import { type CaptureRowForTrajectory, type Trajectory, buildTrajectory } from './trajectory.js';

/**
 * Batch 06 — MySQL binding of `EvolutionStore`.
 *
 * Template paths live in the existing playbook graph: a GLOBAL site
 * (`owner_user_id IS NULL`) → a capability keyed by the trajectory skeleton
 * (`auto_<hash>`) → versioned `operation_paths` rows whose `template_json`
 * holds the executable template. Steps are mirrored into
 * `operation_path_steps` so existing readers (hint injection, admin views)
 * keep working. `source_task_id` = newest contributing task so account
 * closure removes a path derived from a closing user's task.
 */

const pathColumns = {
  id: operationPaths.id,
  version: operationPaths.version,
  status: operationPaths.status,
  templateJson: operationPaths.templateJson,
  generalizer: operationPaths.generalizer,
  canaryPassStreak: operationPaths.canaryPassStreak,
  parentPathId: operationPaths.parentPathId,
  metadataJson: operationPaths.metadataJson,
  lastVerifiedAt: operationPaths.lastVerifiedAt,
  staleReason: operationPaths.staleReason,
  siteDomain: sites.canonicalDomain,
  capabilityKey: siteCapabilities.capabilityKey,
};

type PathRow = {
  id: number;
  version: number;
  status: string;
  templateJson: unknown;
  generalizer: string | null;
  canaryPassStreak: number;
  parentPathId: number | null;
  metadataJson: unknown;
  lastVerifiedAt: Date | null;
  staleReason: string | null;
  siteDomain: string;
  capabilityKey: string;
};

const PATH_STATUSES: ReadonlySet<string> = new Set(['draft', 'verified', 'stale']);

function toStoredPath(row: PathRow): StoredPath | null {
  const template = pathTemplateSchema.safeParse(row.templateJson);
  if (!template.success || !PATH_STATUSES.has(row.status)) return null;
  const meta = (row.metadataJson ?? {}) as { sourceTaskIds?: unknown };
  const sourceTaskIds = Array.isArray(meta.sourceTaskIds)
    ? meta.sourceTaskIds.filter((v): v is number => typeof v === 'number')
    : [];
  return {
    id: row.id,
    siteDomain: row.siteDomain,
    capabilityKey: row.capabilityKey,
    version: row.version,
    status: row.status as PathStatus,
    template: template.data,
    generalizer: (row.generalizer as PathGeneralizer | null) ?? null,
    canaryPassStreak: row.canaryPassStreak,
    sourceTaskIds,
    parentPathId: row.parentPathId,
    lastVerifiedAt: row.lastVerifiedAt,
    staleReason: row.staleReason,
  };
}

function compact(rows: PathRow[]): StoredPath[] {
  return rows.map(toStoredPath).filter((p): p is StoredPath => p !== null);
}

export class DrizzleEvolutionStore implements EvolutionStore {
  constructor(private readonly db: DB) {}

  private selectPaths() {
    return this.db
      .select(pathColumns)
      .from(operationPaths)
      .innerJoin(sites, eq(operationPaths.siteId, sites.id))
      .innerJoin(siteCapabilities, eq(operationPaths.capabilityId, siteCapabilities.id));
  }

  async loadTrajectories(opts: { limit: number }): Promise<Trajectory[]> {
    const candidates = await this.db
      .selectDistinct({ id: tasks.id, intent: tasks.intent })
      .from(taskActionCaptures)
      .innerJoin(tasks, eq(taskActionCaptures.taskId, tasks.id))
      .where(
        and(isNotNull(taskActionCaptures.replayJson), inArray(tasks.status, [...SUCCESS_STATUSES])),
      )
      .orderBy(desc(tasks.id))
      .limit(opts.limit);
    if (candidates.length === 0) return [];
    const rows = await this.db
      .select({
        taskId: taskActionCaptures.taskId,
        actionIndex: taskActionCaptures.actionIndex,
        stepType: taskActionCaptures.stepType,
        siteDomain: taskActionCaptures.siteDomain,
        entryUrl: taskActionCaptures.entryUrl,
        inputValue: taskActionCaptures.inputValue,
        replayJson: taskActionCaptures.replayJson,
        outcomeJson: taskActionCaptures.outcomeJson,
      })
      .from(taskActionCaptures)
      .where(
        inArray(
          taskActionCaptures.taskId,
          candidates.map((c) => c.id),
        ),
      )
      .orderBy(asc(taskActionCaptures.taskId), asc(taskActionCaptures.actionIndex));
    const byTask = new Map<number, CaptureRowForTrajectory[]>();
    for (const r of rows) {
      const list = byTask.get(r.taskId) ?? [];
      list.push(r);
      byTask.set(r.taskId, list);
    }
    const out: Trajectory[] = [];
    for (const task of candidates) {
      const built = buildTrajectory(task, byTask.get(task.id) ?? []);
      if (built.ok) out.push(built.trajectory);
    }
    return out;
  }

  async findTemplatePaths(siteDomain: string, capabilityKey: string): Promise<StoredPath[]> {
    const rows = await this.selectPaths()
      .where(
        and(
          eq(sites.canonicalDomain, siteDomain),
          isNull(sites.ownerUserId),
          eq(siteCapabilities.capabilityKey, capabilityKey),
          isNotNull(operationPaths.templateJson),
        ),
      )
      .orderBy(desc(operationPaths.version));
    return compact(rows);
  }

  async createTemplatePath(input: CreateTemplatePathInput): Promise<StoredPath> {
    const siteRepo = new SiteRepository(this.db);
    const playbook = new PlaybookRepository(this.db);
    let site = await siteRepo.findGlobalByDomain(input.siteDomain);
    if (!site) {
      site = await siteRepo.create({
        ownerUserId: null,
        canonicalDomain: input.siteDomain,
        displayName: input.siteDomain,
        homepageUrl: `https://${input.siteDomain}/`,
      });
    }
    const caps = await playbook.listCapabilitiesForSite(site.id);
    let cap = caps.find((c) => c.capabilityKey === input.capabilityKey);
    if (!cap) {
      cap = await playbook.createCapability({
        siteId: site.id,
        capabilityKey: input.capabilityKey,
        displayName: input.template.description.slice(0, 255),
        description: input.template.description,
        inputSchemaJson: {
          params: input.template.params.map((p) => ({ name: p.name, description: p.description })),
        },
      });
    }
    const version = (await playbook.maxPathVersion(cap.id)) + 1;
    const sourceTaskId = input.sourceTaskIds.length ? Math.max(...input.sourceTaskIds) : null;
    const siteId = site.id;
    const capabilityId = cap.id;
    const externalId = newExternalId('operationPath');
    const pathId = await this.db.transaction(async (tx) => {
      const insert = await tx.insert(operationPaths).values({
        externalId,
        siteId,
        capabilityId,
        version,
        status: input.status,
        parentPathId: input.parentPathId ?? null,
        sourceTaskId,
        entryUrlTemplate:
          input.template.steps[0]?.op === 'navigate'
            ? input.template.steps[0].url.slice(0, 1024)
            : null,
        inputBindingJson: input.template.params,
        laneHint: 'browser',
        metadataJson: { sourceTaskIds: input.sourceTaskIds, evolution: 'batch-06' },
        templateJson: input.template,
        generalizer: input.generalizer,
        canaryPassStreak: input.canaryPassStreak ?? 0,
      });
      const id = readInsertId(insert);
      await tx.insert(operationPathSteps).values(
        input.template.steps.map((step, stepIndex) => ({
          pathId: id,
          stepIndex,
          stepType: step.op,
          intent: describeStep(step).slice(0, 255),
          ...('target' in step
            ? {
                targetSelectorJson: step.target,
                targetTextJson: { candidates: [step.target.name] },
              }
            : {}),
          ...(step.wait ? { expectedObservationJson: step.wait } : {}),
          inputKey:
            step.op === 'type'
              ? (/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/.exec(step.text)?.[1] ?? null)
              : null,
        })),
      );
      return id;
    });
    return {
      id: pathId,
      siteDomain: input.siteDomain,
      capabilityKey: input.capabilityKey,
      version,
      status: input.status,
      template: input.template,
      generalizer: input.generalizer,
      canaryPassStreak: input.canaryPassStreak ?? 0,
      sourceTaskIds: [...input.sourceTaskIds],
      parentPathId: input.parentPathId ?? null,
      lastVerifiedAt: null,
      staleReason: null,
    };
  }

  async listCanaryPaths(limit: number): Promise<StoredPath[]> {
    const rows = await this.selectPaths()
      .where(
        and(
          isNotNull(operationPaths.templateJson),
          inArray(operationPaths.status, ['draft', 'verified']),
        ),
      )
      // Least recently verified first; never-verified (NULL) drafts lead.
      .orderBy(
        sql`${operationPaths.lastVerifiedAt} IS NOT NULL`,
        asc(operationPaths.lastVerifiedAt),
        asc(operationPaths.id),
      )
      .limit(limit);
    return compact(rows);
  }

  async recordCanaryResult(pathId: number, record: CanaryRecord): Promise<void> {
    await this.db.insert(canaryResults).values({
      externalId: newExternalId('canaryResult'),
      pathId,
      status: record.passed ? 'passed' : 'failed',
      failureType: record.failureType ? record.failureType.slice(0, 64) : null,
      evidenceSummaryJson: record.evidence,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
    });
  }

  async updatePathState(pathId: number, patch: PathStatePatch): Promise<void> {
    const set: Partial<typeof operationPaths.$inferInsert> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.canaryPassStreak !== undefined) set.canaryPassStreak = patch.canaryPassStreak;
    if (patch.lastVerifiedAt !== undefined) set.lastVerifiedAt = patch.lastVerifiedAt;
    if (patch.staleReason !== undefined) set.staleReason = patch.staleReason;
    if (Object.keys(set).length === 0) return;
    await this.db.update(operationPaths).set(set).where(eq(operationPaths.id, pathId));
  }

  async listVerifiedPaths(siteDomain: string): Promise<StoredPath[]> {
    const rows = await this.selectPaths()
      .where(
        and(
          eq(sites.canonicalDomain, siteDomain),
          isNull(sites.ownerUserId),
          eq(operationPaths.status, 'verified'),
          isNotNull(operationPaths.templateJson),
        ),
      )
      .orderBy(desc(operationPaths.lastVerifiedAt))
      .limit(20);
    return compact(rows);
  }

  async recordReplay(record: ReplayRecord): Promise<void> {
    await this.db.insert(operationPathReplays).values({
      externalId: newExternalId('operationPathReplay'),
      pathId: record.pathId,
      taskId: record.taskId,
      outcome: record.outcome,
      stepsTotal: record.stepsTotal,
      stepsDeterministic: record.stepsDeterministic,
      stepsRepaired: record.stepsRepaired,
      modelCalls: record.modelCalls,
      modelCallsSaved: record.modelCallsSaved,
      repairedPathId: record.repairedPathId,
      failedStepIndex: record.failedStepIndex,
      failureReason: record.failureReason ? record.failureReason.slice(0, 255) : null,
      durationMs:
        record.durationMs === null
          ? null
          : Math.min(Math.max(0, Math.round(record.durationMs)), 4_294_967_295),
    });
  }
}

/** Metrics for the 学习引擎 dashboard (admin-only). */
export interface EvolutionMetrics {
  paths: { total: number; draft: number; verified: number; stale: number };
  canary: { runs: number; passed: number; passRate: number | null };
  reuse: { attempts: number; hits: number; repaired: number; hitRate: number | null };
  modelCallsSaved: number;
  windowDays: number;
}

export async function readEvolutionMetrics(db: DB, windowDays = 30): Promise<EvolutionMetrics> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const statusRows = await db
    .select({ status: operationPaths.status, count: sql<number>`COUNT(*)` })
    .from(operationPaths)
    .where(isNotNull(operationPaths.templateJson))
    .groupBy(operationPaths.status);
  const byStatus = new Map(statusRows.map((r) => [r.status, Number(r.count)]));
  const [canary] = await db
    .select({
      runs: sql<number>`COUNT(*)`,
      passed: sql<number>`COALESCE(SUM(CASE WHEN ${canaryResults.status} = 'passed' THEN 1 ELSE 0 END), 0)`,
    })
    .from(canaryResults)
    .innerJoin(operationPaths, eq(canaryResults.pathId, operationPaths.id))
    .where(
      and(isNotNull(operationPaths.templateJson), sql`${canaryResults.createdAt} >= ${since}`),
    );
  const [reuse] = await db
    .select({
      attempts: sql<number>`COUNT(*)`,
      hits: sql<number>`COALESCE(SUM(CASE WHEN ${operationPathReplays.outcome} IN ('success', 'repaired') THEN 1 ELSE 0 END), 0)`,
      repaired: sql<number>`COALESCE(SUM(CASE WHEN ${operationPathReplays.outcome} = 'repaired' THEN 1 ELSE 0 END), 0)`,
      saved: sql<number>`COALESCE(SUM(${operationPathReplays.modelCallsSaved}), 0)`,
    })
    .from(operationPathReplays)
    .where(sql`${operationPathReplays.createdAt} >= ${since}`);
  return summariseEvolutionMetrics({
    byStatus,
    canaryRuns: Number(canary?.runs ?? 0),
    canaryPassed: Number(canary?.passed ?? 0),
    reuseAttempts: Number(reuse?.attempts ?? 0),
    reuseHits: Number(reuse?.hits ?? 0),
    reuseRepaired: Number(reuse?.repaired ?? 0),
    modelCallsSaved: Number(reuse?.saved ?? 0),
    windowDays,
  });
}

export function summariseEvolutionMetrics(input: {
  byStatus: ReadonlyMap<string, number>;
  canaryRuns: number;
  canaryPassed: number;
  reuseAttempts: number;
  reuseHits: number;
  reuseRepaired: number;
  modelCallsSaved: number;
  windowDays: number;
}): EvolutionMetrics {
  const draft = input.byStatus.get('draft') ?? 0;
  const verified = input.byStatus.get('verified') ?? 0;
  const stale = input.byStatus.get('stale') ?? 0;
  const total = [...input.byStatus.values()].reduce((a, b) => a + b, 0);
  const ratio = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
  return {
    paths: { total, draft, verified, stale },
    canary: {
      runs: input.canaryRuns,
      passed: input.canaryPassed,
      passRate: ratio(input.canaryPassed, input.canaryRuns),
    },
    reuse: {
      attempts: input.reuseAttempts,
      hits: input.reuseHits,
      repaired: input.reuseRepaired,
      hitRate: ratio(input.reuseHits, input.reuseAttempts),
    },
    modelCallsSaved: input.modelCallsSaved,
    windowDays: input.windowDays,
  };
}
