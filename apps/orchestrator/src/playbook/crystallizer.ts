import { newExternalId } from '@holaday/shared-types';
import { asc, eq, inArray } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readInsertId } from '../db/mysql-result.js';
import { operationPathSteps } from '../db/schema/operation-path-steps.js';
import { operationPaths } from '../db/schema/operation-paths.js';
import { taskActionCaptures } from '../db/schema/task-action-captures.js';
import { tasks } from '../db/schema/tasks.js';
import { PlaybookRepository } from './playbook-repository.js';
import { SiteRepository } from './site-repository.js';

/**
 * Phase 1 Playbook ① 被动结晶 v1 — passive crystallization.
 *
 * Turns ONE successful task's captured action trajectory
 * (`task_action_captures`) into ONE `draft` `operation_path` + its
 * `operation_path_steps`, hung off a site + a placeholder capability.
 * v1 is FAITHFUL SINGLE-TRAJECTORY capture, NOT clustering — clustering
 * "same-site same-type many trajectories → robust path" is deferred to
 * v2 (needs real organic ≥3-same-type trajectories per site; the current
 * corpus is ~8 test tasks). Each crystallized trajectory becomes a new
 * DRAFT VERSION under the site's placeholder capability; v2 reads all
 * versions of a capability and merges them.
 *
 * Idempotent by `operation_paths.source_task_id` (0037): a re-run skips a
 * task that already has a path. Site / placeholder-capability are reused
 * when present. DEFAULT DRY-RUN — `crystallizeTasks` writes NOTHING unless
 * `dryRun:false`. Offline batch only: NOT wired into any hot path.
 *
 * The correctness-critical logic (dedup, primary-domain pick, version
 * sequence, capture→step mapping incl. the NON-CONTIGUOUS action_index
 * re-index, intent templating) lives in the PURE `planCrystallization`,
 * unit-tested without a DB. `crystallizeTasks` is thin glue: read → plan →
 * (dry-run: return; commit: write from the plan).
 */

export const CRYSTALLIZER_VERSION = 'v1';
/** v1 = one placeholder capability per site; NO intent-based classification (corpus too small → would bake in bias). */
export const PLACEHOLDER_CAPABILITY_KEY = 'general_browse';
export const PLACEHOLDER_CAPABILITY_DISPLAY = '通用浏览（① 结晶占位）';
export const PLACEHOLDER_CAPABILITY_DESCRIPTION =
  '① 被动结晶 v1 站级占位 capability（未做意图分类，待 v2 聚类细化）';
/** Only successful trajectories are crystallized. */
export const SUCCESS_STATUSES = ['completed', 'partial_success'] as const;
const INTENT_MAX = 255;
const VISIBLE_TEXT_IN_INTENT_MAX = 180;

/** code-point-safe truncate (varchar length is characters, not UTF-16 units). */
function truncateChars(s: string, max: number): string {
  const cp = Array.from(s);
  return cp.length <= max ? s : cp.slice(0, max).join('');
}

// ---- shapes ---------------------------------------------------------------

export interface CaptureRow {
  actionIndex: number;
  stepType: string;
  siteDomain: string | null;
  visibleText: string | null;
  targetSelectorJson: unknown;
  coordinateJson: unknown;
  framePath: string | null;
  screenshotAnchorId: number | null;
}

export interface SourceTaskRow {
  id: number;
  externalId: string;
  intent: string;
  status: string;
}

export interface PlannedStep {
  stepIndex: number;
  stepType: string;
  intent: string;
  targetTextJson: { candidates: string[] } | null;
  targetSelectorJson: unknown;
  coordinateFallbackJson: unknown;
  framePath: string | null;
  screenshotAnchorId: number | null;
}

export interface PathMetadata {
  sourceTaskId: number;
  sourceTaskExternalId: string;
  /** FULL original task instruction — never truncated; this is the v2 clustering material. */
  sourceTaskIntent: string;
  crystallizedAt: string;
  crystallizerVersion: string;
}

export type SiteAction = 'create' | 'reuse';

export interface PlannedPath {
  sourceTaskId: number;
  sourceTaskExternalId: string;
  siteDomain: string;
  siteAction: SiteAction;
  capabilityKey: string;
  capabilityAction: SiteAction;
  version: number;
  status: 'draft';
  /** true when the trajectory touched a domain other than the entry domain (steps still kept). */
  crossDomain: boolean;
  metadata: PathMetadata;
  steps: PlannedStep[];
  /** filled only on a committed write. */
  committedPathExternalId?: string;
}

export type SkipReason = 'already_crystallized' | 'no_captures' | 'no_site_domain';

export interface SkippedTask {
  sourceTaskId: number;
  sourceTaskExternalId: string;
  reason: SkipReason;
}

export interface CrystallizeResult {
  scannedTasks: number;
  planned: PlannedPath[];
  skipped: SkippedTask[];
  committed: boolean;
}

export interface PlanInput {
  /** candidate successful tasks that have ≥1 capture (caller pre-filters). */
  tasks: SourceTaskRow[];
  capturesByTaskId: Map<number, CaptureRow[]>;
  /** task ids that already have an operation_paths.source_task_id row. */
  alreadyCrystallizedTaskIds: Set<number>;
  /** global site id already in DB, keyed by canonical domain. */
  existingSiteIdByDomain: Map<string, number>;
  /** existing placeholder capability + its current max path version, keyed by domain. */
  existingCapByDomain: Map<string, { capabilityId: number; maxVersion: number }>;
  nowIso: string;
}

// ---- pure mappers ---------------------------------------------------------

/** visible_text (TEXT on captures) → target_text_json (JSON on steps). Primary anchor. */
export function wrapTargetText(visibleText: string | null): { candidates: string[] } | null {
  const t = (visibleText ?? '').trim();
  return t ? { candidates: [t] } : null;
}

/**
 * Deterministic, template-based step intent (REQUIRED column, ≤255). Zero
 * model calls (dry-run reproducible; LLM polish is a v2 concern). Uses only
 * the visible anchor text + domain — never `input_value` (redacted at B2;
 * never read here), so no typed-secret can leak into a path.
 */
export function deriveStepIntent(
  stepType: string,
  visibleText: string | null,
  siteDomain: string | null,
): string {
  const t = truncateChars((visibleText ?? '').trim(), VISIBLE_TEXT_IN_INTENT_MAX);
  const dom = (siteDomain ?? '').trim();
  let s: string;
  switch (stepType) {
    case 'navigate':
      s = dom ? `打开 ${dom}` : '打开页面';
      break;
    case 'click':
      s = t ? `点击"${t}"` : '点击页面元素';
      break;
    case 'type':
      s = t ? `在"${t}"输入文本` : '输入文本';
      break;
    case 'scroll':
      s = '滚动页面';
      break;
    default:
      s = t ? `${stepType}"${t}"` : stepType || '执行动作';
  }
  return truncateChars(s, INTENT_MAX);
}

export function buildPathMetadata(task: SourceTaskRow, nowIso: string): PathMetadata {
  return {
    sourceTaskId: task.id,
    sourceTaskExternalId: task.externalId,
    sourceTaskIntent: task.intent, // FULL text — v2 clustering material, never truncated
    crystallizedAt: nowIso,
    crystallizerVersion: CRYSTALLIZER_VERSION,
  };
}

function hasDomain(c: CaptureRow): boolean {
  return typeof c.siteDomain === 'string' && c.siteDomain.trim() !== '';
}

// ---- pure planner ---------------------------------------------------------

/**
 * Pure: given the candidate tasks + their captures + the existing Pack A
 * state, decide what to crystallize. No DB, no IO, no clock (now is passed
 * in) — so a dry-run and a commit compute the IDENTICAL plan.
 */
export function planCrystallization(input: PlanInput): Omit<CrystallizeResult, 'committed'> {
  const planned: PlannedPath[] = [];
  const skipped: SkippedTask[] = [];

  // in-run state so a dry-run faithfully predicts a commit's create/reuse +
  // version sequence WITHOUT any writes.
  const sitesSeen = new Set<string>(); // domains we've decided to create this run
  const capsSeen = new Set<string>(); // domains whose placeholder cap we've decided to create this run
  const versionCursor = new Map<string, number>(); // domain → last assigned version (one cap per domain in v1)

  const orderedTasks = [...input.tasks].sort((a, b) => a.id - b.id);

  for (const task of orderedTasks) {
    const captures = (input.capturesByTaskId.get(task.id) ?? [])
      .slice()
      .sort((a, b) => a.actionIndex - b.actionIndex); // MONOTONIC but NON-CONTIGUOUS — order only

    if (captures.length === 0) {
      skipped.push({
        sourceTaskId: task.id,
        sourceTaskExternalId: task.externalId,
        reason: 'no_captures',
      });
      continue;
    }
    if (input.alreadyCrystallizedTaskIds.has(task.id)) {
      skipped.push({
        sourceTaskId: task.id,
        sourceTaskExternalId: task.externalId,
        reason: 'already_crystallized',
      });
      continue;
    }

    const domainCaptures = captures.filter(hasDomain);
    const entry = domainCaptures[0];
    if (!entry) {
      skipped.push({
        sourceTaskId: task.id,
        sourceTaskExternalId: task.externalId,
        reason: 'no_site_domain',
      });
      continue;
    }

    const primaryDomain = (entry.siteDomain as string).trim(); // entry domain anchors the path

    const siteInDb = input.existingSiteIdByDomain.has(primaryDomain);
    const siteAction: SiteAction = siteInDb || sitesSeen.has(primaryDomain) ? 'reuse' : 'create';
    if (siteAction === 'create') sitesSeen.add(primaryDomain);

    const capInDb = input.existingCapByDomain.has(primaryDomain);
    const capabilityAction: SiteAction =
      capInDb || capsSeen.has(primaryDomain) ? 'reuse' : 'create';
    if (capabilityAction === 'create') capsSeen.add(primaryDomain);

    if (!versionCursor.has(primaryDomain)) {
      versionCursor.set(
        primaryDomain,
        input.existingCapByDomain.get(primaryDomain)?.maxVersion ?? 0,
      );
    }
    const version = (versionCursor.get(primaryDomain) as number) + 1;
    versionCursor.set(primaryDomain, version);

    // dense re-index 0..N over the kept (non-null-domain) captures, in action_index order
    const steps: PlannedStep[] = domainCaptures.map((c, i) => ({
      stepIndex: i,
      stepType: c.stepType,
      intent: deriveStepIntent(c.stepType, c.visibleText, c.siteDomain),
      targetTextJson: wrapTargetText(c.visibleText),
      targetSelectorJson: c.targetSelectorJson ?? null,
      coordinateFallbackJson: c.coordinateJson ?? null,
      framePath: c.framePath ?? null,
      screenshotAnchorId: c.screenshotAnchorId ?? null,
    }));

    planned.push({
      sourceTaskId: task.id,
      sourceTaskExternalId: task.externalId,
      siteDomain: primaryDomain,
      siteAction,
      capabilityKey: PLACEHOLDER_CAPABILITY_KEY,
      capabilityAction,
      version,
      status: 'draft',
      crossDomain: domainCaptures.some((c) => (c.siteDomain as string).trim() !== primaryDomain),
      metadata: buildPathMetadata(task, input.nowIso),
      steps,
    });
  }

  return { scannedTasks: orderedTasks.length, planned, skipped };
}

// ---- DB glue --------------------------------------------------------------

function uniqueDomains(captures: CaptureRow[]): string[] {
  const set = new Set<string>();
  for (const c of captures) if (hasDomain(c)) set.add((c.siteDomain as string).trim());
  return [...set];
}

export interface CrystallizeOptions {
  /** DEFAULT true. When true, NO writes — reads + plan only. */
  dryRun: boolean;
  /** Cap the number of candidate tasks scanned (newest-... actually lowest-id first). */
  limit?: number;
}

/**
 * Read the current state, build the plan, and (only when `dryRun:false`)
 * write it. Returns the plan either way. `now` is read once here so the
 * whole run shares a single crystallizedAt.
 */
export async function crystallizeTasks(
  deps: { db: DB; now?: Date },
  opts: CrystallizeOptions,
): Promise<CrystallizeResult> {
  const { db } = deps;
  const playbook = new PlaybookRepository(db);
  const siteRepo = new SiteRepository(db);

  // 1. candidate successful tasks that HAVE captures
  let candidates = await db
    .selectDistinct({
      id: tasks.id,
      externalId: tasks.externalId,
      intent: tasks.intent,
      status: tasks.status,
    })
    .from(taskActionCaptures)
    .innerJoin(tasks, eq(taskActionCaptures.taskId, tasks.id))
    .where(inArray(tasks.status, [...SUCCESS_STATUSES]));
  candidates = candidates.sort((a, b) => a.id - b.id);
  if (typeof opts.limit === 'number' && opts.limit >= 0)
    candidates = candidates.slice(0, opts.limit);

  const taskIds = candidates.map((t) => t.id);
  if (taskIds.length === 0) {
    return { scannedTasks: 0, planned: [], skipped: [], committed: !opts.dryRun };
  }

  // 2. captures for those tasks
  const captureRows = await db
    .select({
      taskId: taskActionCaptures.taskId,
      actionIndex: taskActionCaptures.actionIndex,
      stepType: taskActionCaptures.stepType,
      siteDomain: taskActionCaptures.siteDomain,
      visibleText: taskActionCaptures.visibleText,
      targetSelectorJson: taskActionCaptures.targetSelectorJson,
      coordinateJson: taskActionCaptures.coordinateJson,
      framePath: taskActionCaptures.framePath,
      screenshotAnchorId: taskActionCaptures.screenshotAnchorId,
    })
    .from(taskActionCaptures)
    .where(inArray(taskActionCaptures.taskId, taskIds))
    .orderBy(asc(taskActionCaptures.actionIndex));

  const capturesByTaskId = new Map<number, CaptureRow[]>();
  const allCaptures: CaptureRow[] = [];
  for (const r of captureRows) {
    const row: CaptureRow = {
      actionIndex: r.actionIndex,
      stepType: r.stepType,
      siteDomain: r.siteDomain,
      visibleText: r.visibleText,
      targetSelectorJson: r.targetSelectorJson,
      coordinateJson: r.coordinateJson,
      framePath: r.framePath,
      screenshotAnchorId: r.screenshotAnchorId,
    };
    allCaptures.push(row);
    const list = capturesByTaskId.get(r.taskId);
    if (list) list.push(row);
    else capturesByTaskId.set(r.taskId, [row]);
  }

  // 3. dedup — tasks that already have a crystallized path (0037 source_task_id)
  const existingPaths = await db
    .select({ sourceTaskId: operationPaths.sourceTaskId })
    .from(operationPaths)
    .where(inArray(operationPaths.sourceTaskId, taskIds));
  const alreadyCrystallizedTaskIds = new Set<number>();
  for (const p of existingPaths)
    if (p.sourceTaskId != null) alreadyCrystallizedTaskIds.add(p.sourceTaskId);

  // 4. existing sites + placeholder capabilities (+ max path version) per domain
  const existingSiteIdByDomain = new Map<string, number>();
  const existingCapByDomain = new Map<string, { capabilityId: number; maxVersion: number }>();
  for (const domain of uniqueDomains(allCaptures)) {
    const site = await siteRepo.findGlobalByDomain(domain);
    if (!site) continue;
    existingSiteIdByDomain.set(domain, site.id);
    const caps = await playbook.listCapabilitiesForSite(site.id);
    const placeholder = caps.find((c) => c.capabilityKey === PLACEHOLDER_CAPABILITY_KEY);
    if (placeholder) {
      existingCapByDomain.set(domain, {
        capabilityId: placeholder.id,
        maxVersion: await playbook.maxPathVersion(placeholder.id),
      });
    }
  }

  // 5. PURE plan
  const nowIso = (deps.now ?? new Date()).toISOString();
  const plan = planCrystallization({
    tasks: candidates,
    capturesByTaskId,
    alreadyCrystallizedTaskIds,
    existingSiteIdByDomain,
    existingCapByDomain,
    nowIso,
  });

  // 6. dry-run → return; commit → write from the plan
  if (opts.dryRun) {
    return { ...plan, committed: false };
  }

  for (const p of plan.planned) {
    // Site + placeholder capability: idempotent upserts resolved OUTSIDE the
    // transaction. An orphan site/cap (created without a path) is benign and
    // reused on the next run, so they need not be in the path's atomic unit.
    let site = await siteRepo.findGlobalByDomain(p.siteDomain);
    if (!site) {
      site = await siteRepo.create({
        ownerUserId: null,
        canonicalDomain: p.siteDomain,
        displayName: p.siteDomain,
        homepageUrl: `https://${p.siteDomain}/`,
      });
    }
    const caps = await playbook.listCapabilitiesForSite(site.id);
    let cap = caps.find((c) => c.capabilityKey === PLACEHOLDER_CAPABILITY_KEY);
    if (!cap) {
      cap = await playbook.createCapability({
        siteId: site.id,
        capabilityKey: PLACEHOLDER_CAPABILITY_KEY,
        displayName: PLACEHOLDER_CAPABILITY_DISPLAY,
        description: PLACEHOLDER_CAPABILITY_DESCRIPTION,
      });
    }
    const siteId = site.id;
    const capabilityId = cap.id;

    // The path row + ALL its steps are ONE atomic unit, written via a direct
    // tx insert (the repos are db-bound, not tx-bound). Without this, a crash
    // mid-steps would leave a draft path with missing steps — and because the
    // dedup keys on operation_paths.source_task_id, the next run would mark the
    // task already_crystallized and SKIP it forever (unrecoverable partial path).
    // Steps are batch-inserted in one statement.
    const pathExternalId = newExternalId('operationPath');
    await db.transaction(async (tx) => {
      const insertPath = await tx.insert(operationPaths).values({
        externalId: pathExternalId,
        siteId,
        capabilityId,
        version: p.version,
        status: 'draft',
        sourceTaskId: p.sourceTaskId,
        metadataJson: p.metadata,
      });
      const pathId = readInsertId(insertPath);
      if (p.steps.length > 0) {
        await tx.insert(operationPathSteps).values(
          p.steps.map((s) => ({
            pathId,
            stepIndex: s.stepIndex,
            stepType: s.stepType,
            intent: s.intent,
            targetTextJson: s.targetTextJson,
            targetSelectorJson: s.targetSelectorJson,
            coordinateFallbackJson: s.coordinateFallbackJson,
            framePath: s.framePath,
            screenshotAnchorId: s.screenshotAnchorId,
          })),
        );
      }
    });
    p.committedPathExternalId = pathExternalId;
  }

  return { ...plan, committed: true };
}
