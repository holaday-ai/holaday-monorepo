/**
 * Phase 2 Day 2 — Expert Workflow registry / matcher.
 *
 * Pure function. Given the user's intent + optional role/skill id,
 * returns the typed `ExpertWorkflowContract` for whichever workflow
 * applies, or null. Used by `runGenerateTask` to decide whether to
 * route through the workflow intake gate.
 *
 * Phase 2b — three workflows registered:
 *   - douyin-review   (事后复盘 — 抖音直播复盘)
 *   - content-topic   (事前生成 — 内容选题策划)
 *   - ecom-daily      (日度复盘 — 电商日报)
 *
 * Distinct from the legacy `agent/supercar/expert-workflows.ts`
 * matcher: that one returns abstract `missingInputs:
 * ['liveSession'|'dataSource']` for routing decisions (browser vs
 * generate). This one returns the concrete typed contract for
 * deterministic input parsing + arithmetic validation.
 *
 * Matcher precedence: workflows shouldn't overlap by design (different
 * keyword buckets), but if two ever match the same intent, FIRST one
 * in the WORKFLOWS array wins. Order is: douyin-review → content-topic
 * → ecom-daily. Adjust the array if a future workflow needs priority.
 */
import { DOUYIN_REVIEW_WORKFLOW } from './expert-workflow-douyin.js';
import { CONTENT_TOPIC_WORKFLOW } from './expert-workflow-content-topic.js';
import { ECOM_DAILY_WORKFLOW } from './expert-workflow-ecom-daily.js';
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
  CONTENT_TOPIC_WORKFLOW,
  ECOM_DAILY_WORKFLOW,
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
    case 'content-topic':
      return matchesContentTopic(opts);
    case 'ecom-daily':
      return matchesEcomDaily(opts);
    default:
      // Unknown workflow id (defensive — can't reach today). Fall
      // through to keyword check based on the workflow's name.
      return new RegExp(workflow.name, 'i').test(opts.intent);
  }
}

const DOUYIN_TERMS = ['抖音', 'douyin', 'tiktok'];
const LIVE_TERMS = ['直播', '直播间', '带货', '主播'];
const REVIEW_TERMS = ['复盘', '诊断', '分析直播', '直播分析', '直播报告'];

// Buckets for content-topic. Two-of-two required:
//   TASK   — 选题/内容策划/爆款/标题
//   PLATFORM — any of the supported platform names
// "标题" alone (e.g. "帮我起个标题") doesn't fire because no platform.
// "做小红书" alone doesn't fire because no task term. The conjunction
// pattern is what makes content-topic distinct from douyin-review.
const CONTENT_TASK_TERMS = [
  '选题',
  '内容策划',
  '爆款',
  '标题',
  '内容方向',
  '种草',
];
const CONTENT_PLATFORM_TERMS = [
  '小红书',
  '抖音',
  'douyin',
  'tiktok',
  '视频号',
  'b站',
  'bilibili',
  '公众号',
  '知乎',
  '微博',
  'xiaohongshu',
];

// Buckets for ecom-daily. Two-of-two required:
//   TIME — 日报/昨日/今日/每日/当日/yesterday/today
//   ECOM — 电商/营收/销售/店铺/营业额/GMV
// "GMV 100万" alone (without time term) doesn't fire — could be a
// douyin-review or content-topic. "昨日 销售" without 营收 keyword does
// fire because both 销售 and 昨日 are present. The ECOM bucket is
// generous on purpose: ecom-daily reports are about店铺业绩拆解, and
// we want to match the user's natural phrasing without making them
// say "电商" explicitly.
const TIME_TERMS = [
  '日报',
  '昨日',
  '昨天',
  '今日',
  '今天',
  '前日',
  '前天',
  '每日',
  '当日',
  'yesterday',
  'today',
];
const ECOM_TERMS = [
  '电商',
  '营收',
  '营业额',
  '销售额',
  '店铺',
  'GMV',
  '日销售',
  '日gmv',
];

function matchesEcomDaily(opts: MatchOpts): boolean {
  // Precedence: registry order means douyin-review and content-topic
  // are checked first. ecom-daily intent like "昨日营收 30万" should
  // not collide with douyin-review (no 直播/复盘 keyword) or
  // content-topic (no 选题/标题 keyword), so the conjunction is
  // sufficient.
  const lower = opts.intent.toLowerCase();
  const hasTime = TIME_TERMS.some((t) => lower.includes(t.toLowerCase()));
  const hasEcom = ECOM_TERMS.some((t) => lower.includes(t.toLowerCase()));
  return hasTime && hasEcom;
}

function matchesContentTopic(opts: MatchOpts): boolean {
  // Crucial overlap guard: douyin-review fires on 抖音 + 直播 + 复盘.
  // content-topic also accepts 抖音 in its PLATFORM bucket. If a user
  // asks "复盘抖音直播", that's douyin-review; if they ask "抖音爆款选题"
  // without 直播 + 复盘, that's content-topic. Because douyin-review
  // is checked FIRST in WORKFLOWS, intent that fits both lands in
  // douyin-review (correct precedence — review trumps planning when
  // BOTH are explicitly asked). This function therefore doesn't need
  // an exclusion clause — the order in WORKFLOWS handles it.
  const lower = opts.intent.toLowerCase();
  const hasTask = CONTENT_TASK_TERMS.some((t) =>
    lower.includes(t.toLowerCase()),
  );
  const hasPlatform = CONTENT_PLATFORM_TERMS.some((t) =>
    lower.includes(t.toLowerCase()),
  );
  return hasTask && hasPlatform;
}

function matchesDouyinReview(opts: MatchOpts): boolean {
  // Keyword match on intent — three buckets, all required:
  //   site (抖音), surface (直播), task (复盘). Two-of-three isn't
  //   enough; "分析抖音的内容生态" shouldn't trigger this.
  //
  // Earlier this had a `roleId.startsWith('douyin')` fast-path that
  // fired the workflow whenever the user had a douyin role selected,
  // even on intents like "复盘直播 GMV..." that omit the 抖音 site
  // keyword. The eval bypass user has `douyin-strategist` configured
  // by default, so that fast-path was grabbing P0_009 (an
  // intentionally non-douyin contradiction case meant to exercise
  // the LLM-driven contradiction surfacing path) and forcing it
  // through the workflow gate. Dropping the role fast-path makes
  // the routing decision driven by intent content alone — saner
  // default, since the role is a persona not a routing key. Users
  // who select douyin-strategist + paste data still fire the
  // workflow as long as they mention 抖音 in the intent.
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
 * Resolve the two distinct workflow responsibilities for a newly-created
 * follow-up task.
 *
 * A parent workflow is useful for routing a chip action such as "生成发布日历"
 * back to the generate lane, but its original report schema must not be
 * applied to the new deliverable. Only a workflow matched by the follow-up's
 * own text is allowed to become the new task's report/verifier contract.
 */
export function resolveExpertWorkflowDispatch(input: {
  matchedWorkflow: ExpertWorkflowContract | null;
  parentWorkflow: ExpertWorkflowContract | null;
  isFollowUp: boolean;
}): {
  reportWorkflow: ExpertWorkflowContract | null;
  routingWorkflow: ExpertWorkflowContract | null;
} {
  const reportWorkflow = input.matchedWorkflow;
  const routingWorkflow =
    reportWorkflow ?? (input.isFollowUp ? input.parentWorkflow : null);
  return { reportWorkflow, routingWorkflow };
}

/**
 * Test-only — get all registered workflows for shape introspection.
 */
export function _getRegisteredWorkflowsForTest(): readonly ExpertWorkflowContract[] {
  return WORKFLOWS;
}
