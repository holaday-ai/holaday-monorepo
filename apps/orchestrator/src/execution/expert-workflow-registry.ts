/**
 * Phase 2 Day 2 — Expert Workflow registry / matcher.
 *
 * Pure function. Given the user's intent + optional role/skill id,
 * returns the typed `ExpertWorkflowContract` for whichever workflow
 * applies, or null. Used by `runGenerateTask` to decide whether to
 * route through the workflow intake gate.
 *
 * Today: only `douyin-review`. The shape supports adding more
 * workflows by registering them in WORKFLOWS — content-topic and
 * ecom-daily land in Phase 2b.
 *
 * Distinct from the legacy `agent/supercar/expert-workflows.ts`
 * matcher: that one returns abstract `missingInputs:
 * ['liveSession'|'dataSource']` for routing decisions (browser vs
 * generate). This one returns the concrete typed contract for
 * deterministic input parsing + arithmetic validation.
 */
import { DOUYIN_REVIEW_WORKFLOW } from './expert-workflow-douyin.js';
import type { ExpertWorkflowContract } from './expert-workflow-contract.js';

interface MatchOpts {
  intent: string;
  /** Explicit role/skill id chosen by the user (UI dropdown). */
  roleId?: string | null;
}

/**
 * Registered workflows. Order matters only when matchers overlap
 * (first hit wins).
 */
const WORKFLOWS: readonly ExpertWorkflowContract[] = [
  DOUYIN_REVIEW_WORKFLOW,
];

/**
 * Per-workflow matcher logic. Decoupled from the contract data so
 * the contract stays declarative + serialisable. New workflows
 * register a matcher by adding a case here.
 */
function matchOne(
  workflow: ExpertWorkflowContract,
  opts: MatchOpts,
): boolean {
  switch (workflow.workflowId) {
    case 'douyin-review':
      return matchesDouyinReview(opts);
    default:
      // Unknown workflow id (defensive — can't reach today). Fall
      // through to keyword check based on the workflow's name.
      return new RegExp(workflow.name, 'i').test(opts.intent);
  }
}

const DOUYIN_TERMS = ['抖音', 'douyin', 'tiktok'];
const LIVE_TERMS = ['直播', '直播间', '带货', '主播'];
const REVIEW_TERMS = ['复盘', '诊断', '分析直播', '直播分析', '直播报告'];

function matchesDouyinReview(opts: MatchOpts): boolean {
  // 1. Explicit role hit — any of the douyin-review roleIds, or a
  //    pattern starting with `douyin` (covers `douyin-strategist`,
  //    `douyin-operator`, etc. that the existing UI uses).
  if (opts.roleId) {
    const role = opts.roleId.toLowerCase();
    if (role.startsWith('douyin')) return true;
    if (DOUYIN_REVIEW_WORKFLOW.roleIds.includes(opts.roleId)) return true;
  }
  // 2. Keyword match on intent. Need ALL THREE buckets:
  //    site (抖音), surface (直播), task (复盘). Two out of three
  //    isn't enough — "分析抖音的内容生态" shouldn't trigger this.
  const lower = opts.intent.toLowerCase();
  const hasSite = DOUYIN_TERMS.some((t) => lower.includes(t.toLowerCase()));
  const hasSurface = LIVE_TERMS.some((t) => lower.includes(t.toLowerCase()));
  const hasTask = REVIEW_TERMS.some((t) => lower.includes(t.toLowerCase()));
  return hasSite && hasSurface && hasTask;
}

/**
 * Match the intent against every registered workflow. Returns the
 * first match (no priority resolution — workflows shouldn't overlap).
 * Returns null when no workflow applies; caller falls back to the
 * default generate path.
 */
export function matchExpertWorkflow(
  opts: MatchOpts,
): ExpertWorkflowContract | null {
  for (const w of WORKFLOWS) {
    if (matchOne(w, opts)) return w;
  }
  return null;
}

/**
 * Lookup by stable workflow id. Used by the verifier to resolve
 * the typed workflow from a persisted `ExecutionContract.
 * expertWorkflowId` without re-running the matcher (the matcher
 * needs the original intent text, which is awkward to reconstruct
 * mid-pipeline). Returns null when the id isn't registered —
 * caller falls back to non-workflow verification.
 */
export function getExpertWorkflowById(
  workflowId: string,
): ExpertWorkflowContract | null {
  for (const w of WORKFLOWS) {
    if (w.workflowId === workflowId) return w;
  }
  return null;
}

/**
 * Test-only — get all registered workflows for shape introspection.
 */
export function _getRegisteredWorkflowsForTest(): readonly ExpertWorkflowContract[] {
  return WORKFLOWS;
}
