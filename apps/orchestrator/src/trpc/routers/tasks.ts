import Anthropic from '@anthropic-ai/sdk';
import {
  BASIC_ROLE_PICK_LIMIT,
  gateRoleForUser,
  newExternalId,
  OPEN_POOL_ROLE_IDS,
  type PlanId,
} from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gte, inArray, like, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SkillCatalogueEntry } from '../../agent/planner.js';
import { injectResolvedUrl, resolveIntentUrl } from '../../agent/url-resolver.js';
import { env as appEnv } from '../../config/env.js';
import { buildBaiduSmokePlan } from '../../agent/smoke-plans.js';
import type { PlannedStep } from '../../agent/task-controller.js';
import { TaskController } from '../../agent/task-controller.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { classifyExecutionMode } from '../../agent/intent-classifier.js';
import { runGenerateTask } from '../../agent/generate-runner.js';
import { runScrapeTask } from '../../agent/scrape-runner.js';
import { tryAcquire as rateLimitTryAcquire } from '../../quota/rate-limiter.js';
import { describeSignal } from '../../agent/vision-loop/anti-bot-detector.js';
import { classify as classifyDomain } from '../../agent/vision-loop/domain/classifier.js';
import { startVisionLoopTask } from '../../agent/vision-loop/task-runner.js';
import type { PlaywrightExecutor } from '../../agent/vision-loop/playwright-executor.js';
import {
  classifyAsCrossPlatformAutomation,
  classifyAsSimpleSearch,
  hasParkedSupercarHandle,
  runSupercarTask,
  supercarAbort,
  supercarHandoffToGenerate,
  supercarReply,
  type SupercarOutcome,
} from '../../agent/supercar/index.js';
import {
  classifyRole,
  selectModelAndEffort,
} from '../../agent/supercar/prompt-layers.js';
import { generatePlan, shouldSkipPlan } from '../../agent/supercar/plan-service.js';
import { MemoryService } from '../../agent/supercar/memory-service.js';
import { generateSuggestions } from '../../agent/suggestions-generator.js';
import {
  runResponseLayerForLane,
  stampResponseLayerColumns,
} from '../../response-layer/lane-integration.js';
import {
  StatsService,
  classifyTaskType,
  extractDomain,
} from '../../agent/supercar/stats-service.js';
import {
  formatForPrompt as formatPlaybooksForPrompt,
  matchPlaybooks,
} from '../../agent/supercar/playbook-service.js';
import { matchExpertWorkflow } from '../../agent/supercar/expert-workflows.js';
import {
  getExpertWorkflowById,
  matchExpertWorkflow as matchTypedExpertWorkflow,
} from '../../execution/expert-workflow-registry.js';
import { parseInputs } from '../../execution/expert-workflow-parser.js';
import { getFeatureFlags as getExecutionFeatureFlags } from '../../execution/feature-flags.js';
import { FileService, taskInternalIdFor } from '../../files/file-service.js';
import { parseFileForPrompt } from '../../files/parsers.js';
import {
  allowedFormatsForPlan,
  isCreateFileFormat,
  renderFile,
} from '../../files/writers.js';
import {
  QuotaService,
  concurrencyExhaustedMessage,
  getConcurrencyLimit,
  quotaErrorFor,
} from '../../quota/quota-service.js';
import { projects } from '../../db/schema/projects.js';
import { skills } from '../../db/schema/skills.js';
import { taskEvents } from '../../db/schema/task-events.js';
import { taskSteps } from '../../db/schema/task-steps.js';
import { tasks as tasksTable } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import {
  broadcastToUser,
  getExtensionLoginState,
  hasConnectedSwClient,
  updateTaskStateForUser,
} from '../../ws/server.js';
import { protectedProcedure, router } from '../trpc.js';
// Phase 1 Day 5 — execution-pipeline glue. All four entry points are
// no-ops when the corresponding feature flag is off (default), so
// importing them adds no runtime cost on a baseline deploy.
import {
  disposeExecution,
  initExecution,
  persistExecution,
  recordEvidence,
  verifyAndFinalize,
  type VerifyOutput,
} from '../../execution/execution-pipeline.js';
import type { VerificationResult } from '../../execution/answer-verifier.js';
// Phase 1 follow-up — final-text sanitiser + scrape-failure
// humaniser. Strips tool-XML / base64 / stop-reason markers from
// outcome.summary BEFORE it goes through verify + persist.
import {
  humaniseScrapeFailure,
  sanitizeFinalText,
} from '../../agent/text-sanitizer.js';
// Phase 24 RC follow-up — nav-failure safety net. Catches the
// "false success" case where the agent calls task_done with a body
// that is just a DNS/SSL/timeout/refused error message; the sidebar
// would otherwise label it "已完成" because the runner respected the
// agent's terminal decision.
import { detectNavFailure } from '../../agent/nav-failure-detector.js';

const taskController = new TaskController();

/**
 * Phase 24 — controlled quota bypass for the test account.
 *
 * The per-mode (browser / generate) split that 21b had was needed
 * because the per-user shared Brave was a single contended resource.
 * Phase 24's per-task pool means there's no shared resource to
 * starve — every task gets its own Brave (capped by pool capacity)
 * and generate tasks don't touch the pool at all.
 *
 * RC follow-up: with the global TaskQueue gating dispatch to the
 * 10-slot pool, this admit-time concurrency check no longer needs
 * to mirror pool capacity. The queue handles the actual throttling
 * (10 in flight, the rest sit in 'queued' status). Sizing this to
 * match the queue's depth ceiling lets the test account submit a
 * full RC batch (165 tasks) without hitting an admit-time wall
 * before the queue can do its job.
 *
 * Plan limits (daily/monthly task counter) are still skipped for
 * bypass users so smoke testing isn't blocked by the 3/day cap.
 */
const QUOTA_BYPASS_USERS: ReadonlySet<string> = new Set([
  'usr_EeYpvsvLtyDzN4VLQi7BT',
]);
const BYPASS_CONCURRENCY = 100;
const BYPASS_RATE = { max: 30, windowMs: 60_000 };
const GLOBAL_QUEUE_DEPTH_LIMIT = 100;

// Module-scope Anthropic client for url-resolver. Cheap to construct
// but no reason to pay per request — cache once at import time.
const anthropicForResolver: Anthropic | null = appEnv.ANTHROPIC_API_KEY
  ? new Anthropic()
  : null;

const taskIdInput = z.object({ taskId: z.string().min(1) });

const createInput = z.object({
  intent: z.string().min(1).max(4_000),
  occupation: z.string().optional(),
  /**
   * Phase 10 Tier 3 — external ids for files the user uploaded
   * BEFORE this tasks.create call (via POST /files/upload). The
   * server reads them, parses each into the right Anthropic content
   * block, and prepends them to the agent's first user message.
   */
  fileIds: z.array(z.string()).max(5).optional(),
  /**
   * Phase 14 audit follow-up — multi-turn追问. When the user is
   * looking at a completed/failed task and types a follow-up
   * (e.g. "为什么失败"), the SPA passes the parent task's
   * external id here. Server then:
   *   1. Validates the parent belongs to the same user and is in
   *      a terminal state (completed / failed / cancelled).
   *   2. Skips quota consumption — follow-ups are free; they
   *      reuse the cost the user already paid.
   *   3. Prepends a "前一个任务"<intent>"，结果：<summary>" block
   *      to the agent's intent so the model has full context.
   * Concurrency limit still applies — a runaway loop of follow-ups
   * would still hammer the agent loop.
   */
  replyToTaskId: z.string().min(1).optional(),
  /**
   * O4 — execution mode. 'auto' (default) runs the agent immediately.
   * 'plan' instructs the agent to first emit a plan + wait for user
   * approval (the agent stops on awaiting_user; user replies "执行"
   * via tasks.reply to continue). Quota is consumed on submit either
   * way — the plan-mode pause is a UX moment, not a billing dodge.
   */
  mode: z.enum(['auto', 'plan']).optional(),
  /**
   * Phase 21a — explicit skill/role id chosen for this task. When
   * present, the looksLikeCodeIntent guard is skipped: the user has
   * picked a domain expert, so "帮我写个网站翻译脚本" under 技术翻译
   * is intended, not a stray app-building request. The resolved
   * AgentRole isn't used here in the gate — the supercar layer
   * picks roles via classifyRole on its own — but having the id on
   * the wire lets us short-circuit the guard cleanly.
   */
  skillId: z.string().min(1).max(64).optional(),
  /**
   * Optimization #3 R1 — viewport profile the SPA wants for this
   * task's per-Brave geometry. Picked from the user's current
   * panel layout: sidepanel / desktop / fullscreen / mobile. The
   * pool reads this at allocate time to size Xvfb + Brave's
   * `--window-size` + the CDP streamer's frame cap. Validated as
   * a literal union so unknown values land as a tRPC BAD_REQUEST
   * rather than silently falling through to the default geometry.
   * Optional — omitted requests get the legacy 'desktop' default.
   */
  viewportProfile: z
    .enum(['sidepanel', 'desktop', 'fullscreen', 'mobile'])
    .optional(),
});

/**
 * O15 — friendly refusal for coding / app-building intents. HOLA DAY
 * is a browser-task agent, not a code IDE; trying to satisfy a "帮我
 * 写一个 React 组件" prompt burns Anthropic budget on something Claude
 * Code or Cursor does much better. Match BEFORE quota consumption so
 * the user sees a fast no-cost rejection instead of "executing → fail
 * after 8 turns".
 *
 * Pattern: requires a CODE keyword (write/build/develop/debug/deploy
 * + 中文 写代码/编程/开发) AND a SUBJECT keyword (网站/网页/app/组件/
 * 接口/api/sdk/库). A standalone "写" without subject is too vague to
 * reject; "做个网站" alone could be a website-research task. Both
 * dimensions in the same intent → refuse.
 */
const CODE_VERBS = [
  '写代码', '写程序', '编程', '编写', '写一个', '写一段', '写个',
  '做', '做个', '做一个',
  '开发', '搭建', '搭一个', '搭个', '建', '建个', '建一个', '构建',
  '调试', '部署', '上线',
  '修复 bug', '修 bug', 'debug', '重构', '实现一个',
  'write code', 'build a', 'build me', 'develop', 'deploy', 'compile', 'refactor',
];
const CODE_SUBJECTS = [
  '网站', '网页', '后台', '前端', '后端', '应用', '系统', '组件',
  '函数', '接口', 'api', 'sdk', '库', '插件', '扩展', '小程序', '页面',
  '脚本', '程序', '代码', '小工具', '数据库', '服务器',
  'website', 'webapp', 'web app', 'app', 'component', 'function',
  'script', 'plugin', 'package', 'module', 'library',
];
// Full-phrase fast-path. The verb-AND-subject double-keyword check
// can miss compact intents like "做个网站" because "做" is too
// generic to whitelist on its own (BOSS reported false-negative).
// These exact substrings light up regardless of the strict pair check.
const CODE_PHRASES = [
  '做个网站', '做一个网站', '建个网站', '建一个网站', '搭个网站', '搭一个网站',
  '帮我做网站', '帮我建网站', '帮我搭网站', '帮我建站', '建站',
  '写个网站', '写个 app', '写个app', '写个应用', '做个 app', '做个app',
  '做个小程序', '建个小程序',
  '帮我开发', '帮我编程', '帮我写代码',
  'build me a website', 'build a website', 'make me an app', 'build a webapp',
];
/**
 * Phase 1 follow-up — analysis-intent whitelist. The verb+subject
 * heuristic was too aggressive: prompts like "总结人工智能应用系统的
 * 发展趋势" matched `开发` (verb) + `应用系统` (subject) and triggered
 * the rejection. Real users asking for analysis got told to use
 * Cursor.
 *
 * The whitelist applies ONLY to the verb+subject pair; CODE_PHRASES
 * (full unambiguous phrases like "做个网站") still always trigger.
 * The user's analytical framing is the signal — if any of these
 * words is present, the intent is "explain / analyze / report ON
 * the technology" rather than "build the technology for me".
 */
const ANALYSIS_INTENT_WORDS = [
  '分析', '总结', '复盘', '报告',
  '研究', '调研', '调查',
  '说明', '解释', '介绍', '描述', '阐述', '讲讲', '讲一下',
  '方法', '方法论', '方案', '策略', '思路',
  '趋势', '现状', '特点', '特征', '原理', '架构思路', '本质',
  '是什么', '什么是', '如何理解', '怎么看',
  // English
  'analyze ', 'analyse ', 'summarize ', 'summarise ',
  'explain ', 'describe ', 'compare ', 'overview',
  'introduction', 'what is', 'how does',
];
function hasAnalysisIntent(lower: string): boolean {
  return ANALYSIS_INTENT_WORDS.some((w) => lower.includes(w));
}
function looksLikeCodeIntent(intent: string): boolean {
  const lower = intent.toLowerCase();
  // Unambiguous full phrases always trigger — the user explicitly
  // said "build me a website" / "做个网站". No whitelist for these.
  if (CODE_PHRASES.some((p) => lower.includes(p))) return true;
  const hasVerb = CODE_VERBS.some((v) => lower.includes(v));
  if (!hasVerb) return false;
  if (!CODE_SUBJECTS.some((s) => lower.includes(s))) return false;
  // Verb + subject pair matched — but if the prompt also has an
  // analysis-intent word, the user is asking ABOUT the tech, not
  // asking us to build it. Skip the rejection.
  if (hasAnalysisIntent(lower)) return false;
  return true;
}

export const tasksRouter = router({
  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    // O15 — code-task refusal lands BEFORE user lookup so even an
    // unauthenticated-token-in-fail-path doesn't get scaffolding.
    //
    // Phase 21a — whitelist this guard when the user has signaled
    // they're operating in a specialist context: either explicit
    // skillId on the task, or the role classifier (keyword-only,
    // free) matched something. A user asking 技术翻译专家 to "帮我
    // 写个网站本地化脚本" knows what they want; a guard that says
    // "用 Cursor" insults them. The guard is meant to catch raw
    // free-form attempts to build apps in HOLA DAY, not legitimate
    // expert-mode scripting.
    const intentImpliesRole = classifyRole(input.intent) !== 'none';
    const inSpecialistContext = Boolean(input.skillId) || intentImpliesRole;
    if (!inSpecialistContext && looksLikeCodeIntent(input.intent)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'HOLA DAY 专注浏览器任务执行（搜索 / 操作 / 比价 / 抓内容）。代码开发请用 Claude Code 或 Cursor 等专业工具。',
      });
    }
    const [userRow] = await ctx.db
      .select({
        id: users.id,
        plan: users.plan,
        selectedRoles: users.selectedRoles,
      })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!userRow) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }

    // Phase 14 audit follow-up — multi-turn 追问. When `replyToTaskId`
    // is set, the new task piggybacks on a previously completed/failed
    // task: skips quota and prefixes the agent's intent with the parent's
    // intent + result so the model has full context for "为什么失败" /
    // "再试一次" style follow-ups.
    let parentContextBlock = '';
    let isFollowUp = false;
    /**
     * Phase 3 R1 (Codex follow-up #2) — recovered parent workflow id.
     * When this is a follow-up tasks.create (replyToTaskId set), we
     * read the parent's `result.metadata.expertWorkflowId` so the
     * follow-up inherits the parent's workflow even if the chip's
     * prompt doesn't trip the typed matcher (e.g. "生成发布日历"
     * has no platform keyword). Null if no parent or parent wasn't
     * a workflow task.
     */
    let parentWorkflowId: string | null = null;
    if (input.replyToTaskId) {
      const [parent] = await ctx.db
        .select({
          intent: tasksTable.intent,
          status: tasksTable.status,
          result: tasksTable.result,
          errorMessage: tasksTable.errorMessage,
        })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.externalId, input.replyToTaskId),
            eq(tasksTable.userId, userRow.id),
          ),
        )
        .limit(1);
      if (!parent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '找不到要追问的任务（可能已删除或不属于你）',
        });
      }
      const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
      if (!TERMINAL.has(parent.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '只能追问已完成/失败/取消的任务，正在执行的任务请用回复',
        });
      }
      const parentResult = (parent.result ?? null) as
        | {
            summary?: string;
            reason?: string;
            metadata?: { expertWorkflowId?: string | null };
            expertWorkflowId?: string | null;
          }
        | null;
      // Workflow id can be either nested under metadata (newer tasks)
      // or top-level on result (older / generate-resume rows). Probe
      // both so old tasks don't lose context on follow-up.
      const candidateWfId =
        parentResult?.metadata?.expertWorkflowId ??
        parentResult?.expertWorkflowId ??
        null;
      if (typeof candidateWfId === 'string' && candidateWfId.length > 0) {
        parentWorkflowId = candidateWfId;
      }
      const summary = parentResult?.summary?.trim() ?? '';
      const reason =
        parentResult?.reason?.trim() ?? (parent.errorMessage ?? '').trim();
      const outcomeLine =
        parent.status === 'completed' && summary
          ? `结果：${summary}`
          : reason
            ? `${parent.status === 'failed' ? '失败原因' : '终止原因'}：${reason}`
            : `状态：${parent.status}（无详细输出）`;
      parentContextBlock = [
        '---',
        '【追问上下文】',
        `前一个任务："${parent.intent}"`,
        outcomeLine,
        '---',
        '',
      ].join('\n');
      isFollowUp = true;
    }

    /**
     * The intent the AGENT sees. For a follow-up, the parent's
     * intent + outcome are prepended so the model has full context.
     * The DB still stores `input.intent` verbatim — that's what the
     * user actually typed and what they expect to see in history.
     */
    // O4 plan-mode preamble. Cache-safe: appended to the first user
    // message (not the system prompt), so cache hit rate stays
    // intact. The agent obeys this by emitting a plan and stopping
    // on a question-suffix line, which the supercar awaiting_user
    // detector parks the loop on; tasks.reply ("执行" / "开始" /
    // "go" or any free-form approval) unblocks it.
    const planPreamble =
      input.mode === 'plan'
        ? [
            '【执行模式】先列计划，等用户确认',
            '请先输出 2-5 步执行计划（用编号列表），不要立刻调任何工具。',
            '末尾用一句问句问用户是否同意：例如"按这个计划执行吗？"',
            '用户回复"执行"/"开始"/"go"/"按计划做" → 继续；回复修改意见 → 调整后再问；',
            '从计划开始到用户回复期间，禁止调 navigate/computer/web_search/create_file。',
            '',
          ].join('\n')
        : '';
    const expertWorkflow = matchExpertWorkflow(input.intent, {
      hasAttachments: Boolean(input.fileIds && input.fileIds.length > 0),
    });
    const expertWorkflowPreamble = expertWorkflow?.promptPreamble ?? '';
    const effectiveIntent =
      planPreamble +
      (expertWorkflowPreamble ? `${expertWorkflowPreamble}\n` : '') +
      (parentContextBlock ? parentContextBlock : '') +
      input.intent;

    // Phase 10 Tier 2 — quota + concurrency gate. Both block task
    // creation BEFORE the row is inserted, so the user gets a clean
    // error rather than a half-spawned task. Role classification is
    // also done here so we can record role_id + opus_used on the
    // task row at insert time (avoids a follow-up UPDATE).
    const planId: PlanId =
      userRow.plan === 'basic' || userRow.plan === 'pro' ? userRow.plan : 'free';
    const rawSelectedRoles = (userRow.selectedRoles ?? []) as string[];
    // P1-final — sanitize for Basic. Mirror what roles.list does so
    // a Basic user whose persisted selected_roles still contains
    // legacy Pro-only ids (e.g. contract-reviewer left over from the
    // skill/role split migration) doesn't get gated on a count that
    // includes ids they can't actually benefit from. The gate runs
    // against OPEN_POOL-only ids; gateRoleForUser also receives the
    // sanitized list so the keyword-classifier path stays consistent.
    const OPEN_POOL_SET = new Set<string>(OPEN_POOL_ROLE_IDS);
    const selectedRoles =
      planId === 'basic'
        ? rawSelectedRoles.filter((id) => OPEN_POOL_SET.has(id))
        : rawSelectedRoles;

    // P1-A — Basic-plan over-limit gate. The skill/role split
    // migration left some users with > 5 entries in selected_roles.
    // gateRoleForUser would happily inject any of the 8 detected
    // matches, effectively letting Basic users benefit from a 8-pick
    // allowance they never paid for. Refuse the task until they
    // trim back to ≤ 5 in /settings/roles. Auto-trim is intentionally
    // avoided — the user should pick which 5 to keep.
    if (planId === 'basic' && selectedRoles.length > BASIC_ROLE_PICK_LIMIT) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `你当前选择 ${selectedRoles.length} 个角色，超出基础版 ${BASIC_ROLE_PICK_LIMIT} 个上限。请到 /settings/roles 调整，或升级到专业版解除限制。`,
      });
    }

    // Role gate. classifyRole runs the same keyword classifier the
    // agent-loop uses; gateRoleForUser then drops it back to 'none'
    // when the plan / selection forbids it. Free → always 'none'.
    // Basic → 'none' unless the role is open-pool AND in the user's
    // pick. Pro → all roles allowed.
    const detectedRole = classifyRole(input.intent);
    let gatedRole = gateRoleForUser(detectedRole, planId, selectedRoles);
    // Pro upgrade: when the classifier picked an open-pool role that
    // has a Pro-only counterpart, swap up. Today the only such pair
    // is xiaohongshu-{operator → expert}; the basic role stays for
    // Basic-plan users to keep the upsell visible. If we add more
    // tiered roles, encode them here as a flat map.
    if (planId === 'pro' && gatedRole === 'xiaohongshu-operator') {
      gatedRole = 'xiaohongshu-expert';
    }
    const routed = selectModelAndEffort(input.intent, gatedRole);
    const isOpus = routed.model === 'claude-opus-4-7';

    // Free + Basic don't have an Opus quota; selectModelAndEffort
    // only routes to Opus for COMPLEX_ROLES, all of which are
    // pro-exclusive. So in practice isOpus is true only for Pro
    // users — but defend against future config drift by clamping
    // here rather than relying on prompt-layers' invariants.
    const willConsumeOpus = isOpus && planId === 'pro';

    const quotaService = new QuotaService(ctx.db);
    const isBypass = QUOTA_BYPASS_USERS.has(ctx.userId);

    // Phase 21b — classify execution mode FIRST so the concurrency
    // gate can apply per-mode caps (bypass users have separate
    // browser/generate budgets). Adds ~500ms latency on cache miss;
    // skill-hint + keyword fast paths inside the classifier short-
    // circuit most cases for free.
    const classifiedExecutionMode = await classifyExecutionMode({
      intent: input.intent,
      skillId: input.skillId,
      logger: ctx.logger.child({ userId: ctx.userId, stage: 'router' }),
    });
    // Phase 2b — typed expert workflow lane override. When the new
    // typed matcher (content-topic / ecom-daily / douyin-review)
    // fires AND the EXPERT_WORKFLOW flag is on, force generate-mode
    // — these workflows never want a browser. This sits after the
    // legacy matcher so routeOverride='browser' from the legacy
    // douyin-livestream-review (when user has platform-source
    // keywords) still wins; in practice the two matchers don't
    // overlap on browser-needing intents.
    const typedWorkflowFromMatcher = getExecutionFeatureFlags().EXPERT_WORKFLOW
      ? matchTypedExpertWorkflow({
          intent: input.intent,
          roleId: input.skillId ?? null,
        })
      : null;
    // Phase 3 R1 (Codex follow-up #2) — on follow-up tasks the chip
    // prompt usually doesn't carry workflow keywords ("生成发布日历"
    // / "深挖 ROI 不达预期" / "生成下场直播 SOP"). Fall back to the
    // parent task's workflow id so the contract stays full-tier and
    // the verifier's section_presence + source_annotation checks
    // continue to fire on the follow-up's report.
    const typedWorkflowFromParent =
      isFollowUp && parentWorkflowId
        ? getExpertWorkflowById(parentWorkflowId)
        : null;
    const typedWorkflow = typedWorkflowFromMatcher ?? typedWorkflowFromParent;
    const typedWorkflowOverride =
      typedWorkflow != null && expertWorkflow?.routeOverride !== 'browser'
        ? ('generate' as const)
        : null;
    const executionMode =
      typedWorkflowOverride ??
      expertWorkflow?.routeOverride ??
      classifiedExecutionMode;
    if (typedWorkflow != null && executionMode === 'generate') {
      ctx.logger.info(
        {
          typedWorkflowId: typedWorkflow.workflowId,
          classifiedExecutionMode,
          legacyRouteOverride: expertWorkflow?.routeOverride ?? null,
        },
        'typed-workflow: forced generate lane',
      );
    }
    if (expertWorkflow?.routeOverride) {
      ctx.logger.info(
        {
          workflowId: expertWorkflow.id,
          routeOverride: expertWorkflow.routeOverride,
          classifiedExecutionMode,
          missingInputs: expertWorkflow.missingInputs,
        },
        'expert-workflow: route override applied',
      );
    }

    // Phase 21a P0 — global queue-depth guard. Applies to ALL users,
    // bypass or not, so a runaway client (or a bug elsewhere) can't
    // pile tasks faster than the executor pool drains. Counts across
    // pending/executing/planning, the same set the boot sweep cleans
    // up on restart. The query hits an index on `status`, so this is
    // sub-ms even at high concurrency.
    const [activeRow] = await ctx.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(tasksTable)
      .where(inArray(tasksTable.status, ['pending', 'executing', 'planning']));
    const queueDepth = Number(activeRow?.count ?? 0);
    if (queueDepth >= GLOBAL_QUEUE_DEPTH_LIMIT) {
      ctx.logger.warn(
        { userId: ctx.userId, queueDepth, limit: GLOBAL_QUEUE_DEPTH_LIMIT },
        'tasks.create: rejected — global queue depth exceeded',
      );
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `系统繁忙（队列深度 ${queueDepth}/${GLOBAL_QUEUE_DEPTH_LIMIT}），请稍后再试。`,
      });
    }

    // Phase 24 — per-user concurrency. With per-task browsers (one
    // task = one Brave) the in-memory mode tracker is no longer
    // needed — the DB total count of active tasks is the source of
    // truth. Bypass users still get a higher ceiling (matches pool
    // capacity so a single bypass user can saturate the pool, fine
    // for testing). Non-bypass users get their plan limit (1/3/5).
    const concurrencyLimit = isBypass
      ? BYPASS_CONCURRENCY
      : getConcurrencyLimit(planId);
    const concurrentCount = await quotaService.getActiveTaskCount(userRow.id);
    if (concurrentCount >= concurrencyLimit) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: isBypass
          ? `bypass 并发上限 ${concurrencyLimit}（当前 ${concurrentCount}），请稍后再试。`
          : concurrencyExhaustedMessage(planId),
      });
    }

    // Phase 21a P0 — per-bypass-user submission rate limit. In-memory
    // sliding window (see quota/rate-limiter.ts). Only fires for users
    // in QUOTA_BYPASS_USERS today; non-bypass users are governed by
    // their plan's monthly/daily counter (see tryConsume below) which
    // is already a different shape of throttle.
    if (isBypass) {
      const rl = rateLimitTryAcquire(ctx.userId, BYPASS_RATE);
      if (!rl.ok) {
        ctx.logger.warn(
          { userId: ctx.userId, count: rl.count, retryAfterMs: rl.retryAfterMs },
          'tasks.create: bypass rate limit hit',
        );
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `bypass 速率上限 ${BYPASS_RATE.max}/分钟，约 ${Math.ceil(rl.retryAfterMs / 1000)} 秒后重试。`,
        });
      }
    }

    // Follow-ups are free — they reuse the cost of the parent task. Skip
    // tryConsume entirely so a quota-exhausted user can still ask
    // "为什么失败" without paying again. opus_used flag stays false on
    // the DB row for the same reason (the follow-up doesn't count).
    //
    // Bypass users also skip tryConsume — they're not on a metered
    // plan for testing purposes. Concurrency + rate-limit + global
    // queue-depth (above) provide all the throttling we need.
    let opusActuallyConsumed = false;
    if (isBypass) {
      opusActuallyConsumed = willConsumeOpus;
      ctx.logger.info(
        {
          userId: ctx.userId,
          queueDepth,
          concurrentCount,
          taskIntent: input.intent.slice(0, 60),
        },
        'tasks.create: bypass admit (concurrency + rate-limit ok)',
      );
    } else if (!isFollowUp) {
      const consume = await quotaService.tryConsume(userRow.id, planId, willConsumeOpus);
      if (!consume.ok) {
        // Pro running out of Opus mid-task should downgrade to Sonnet
        // automatically rather than block the task. Re-attempt with
        // isOpus=false so the regular pool absorbs it.
        if (consume.reason === 'opus_limit' && planId === 'pro') {
          const fallback = await quotaService.tryConsume(userRow.id, planId, false);
          if (!fallback.ok) {
            throw quotaErrorFor(fallback.reason);
          }
          ctx.logger.info(
            { userId: ctx.userId, taskIntent: input.intent.slice(0, 60) },
            'quota: opus exhausted — task will run on Sonnet',
          );
        } else {
          throw quotaErrorFor(consume.reason);
        }
      }
      opusActuallyConsumed = consume.ok && willConsumeOpus;
    } else {
      ctx.logger.info(
        {
          userId: ctx.userId,
          replyToTaskId: input.replyToTaskId,
          taskIntent: input.intent.slice(0, 60),
        },
        'tasks.create: follow-up reply mode (quota skipped)',
      );
    }

    // Phase 10 Tier 3 — resolve attachments BEFORE the supercar / vision
    // branch decision. We read the buffers + parse them up front so the
    // user message we hand the agent is fully baked; both paths get
    // identical attachment semantics. Failures (missing file, expired
    // row, parse error) log + skip — the task still runs without that
    // file rather than failing creation outright.
    const fileService = new FileService(ctx.db, ctx.logger);
    const attachmentBlocks: Awaited<ReturnType<typeof parseFileForPrompt>>['blocks'] = [];
    if (input.fileIds && input.fileIds.length > 0) {
      const loaded = await fileService.loadMany(input.fileIds, userRow.id);
      for (const f of loaded) {
        try {
          const parsed = await parseFileForPrompt(f.buffer, f.row.filename, f.row.mimetype);
          attachmentBlocks.push(...parsed.blocks);
        } catch (err) {
          ctx.logger.warn(
            { err: err instanceof Error ? err.message : String(err), fileId: f.row.externalId },
            'tasks.create: file parse failed — skipping',
          );
        }
      }
    }

    // Compute these once — used both by the diagnostic log AND by the
    // gate. Hoisting them up avoids re-classifying the intent twice.
    const isSimpleSearchIntent = classifyAsSimpleSearch(input.intent);
    /**
     * Per-user pool fast lane: when the global headless singleton is
     * dead but this user has (or can spawn) their own pool slot, we
     * can still run supercar — the per-user Brave is functionally
     * equivalent to the singleton from runSupercarTask's view. Sync
     * `canAllocate` peek; the actual `allocate` happens inside the
     * branch and may fail under race (Brave crash mid-spawn). When
     * it does, primaryExecutor stays null and runSupercarTask's null
     * guard fails the task gracefully — the gate doesn't have to
     * second-guess. Without this condition, every PRD / 笔记 / 分析
     * task fell through to vision-loop the moment the singleton
     * crashed, defeating Phase 8 + Phase 10 entirely.
     */
    const browserPoolEligible = Boolean(
      ctx.browserPool &&
        shouldUseBrowserPool(ctx.userId) &&
        ctx.browserPool.canAllocate(),
    );

    // ===== Phase 21b — generate-mode fork =====
    // Pure-generation tasks (write a PRD, translate this, summarize that)
    // skip the supercar agent loop entirely. One Anthropic call with
    // web_search available, persists outcome, broadcasts terminal frame,
    // returns immediately. No pool slot, no Playwright, no plan-step
    // state machine. Falls through to the existing supercar branch
    // below for executionMode === 'browser'.
    if (executionMode === 'generate' && appEnv.ANTHROPIC_API_KEY && anthropicForResolver) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);

      await repo.insertTask(
        {
          taskId,
          status: 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        {
          userId: userRow.id,
          intent: input.intent,
          roleId: gatedRole === 'none' ? null : gatedRole,
          opusUsed: opusActuallyConsumed,
        },
      );

      ctx.logger.info(
        { taskId, userId: ctx.userId, executorLane: 'generate', executionMode },
        'task: executor lane selected',
      );

      // Phase 1 Day 5 — initialise execution pipeline. No-op when
      // every feature flag is off (default). When flags are flipped
      // on, this seeds the ledger with the user_input fact and
      // generates the contract for later verification.
      initExecution({
        taskId,
        intent: input.intent,
        executionMode: 'generate',
        expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
        hasAttachments: attachmentBlocks.length > 0,
      });

      // Fire-and-forget — generate doesn't share Brave instances so
      // there's no per-user FIFO queue to enqueue into. Concurrent
      // generate tasks parallelize on the Anthropic API.
      const anthropicClient = anthropicForResolver;
      const generateStartedAt = Date.now();
      void (async () => {
        // A2 deferred — generate→browser fallback would re-enter the
        // supercar branch which needs pool slots, queueing, and a
        // distinct outcome shape. Tracked as fallbackChain=['generate']
        // here for the eval pipeline; if generate fails today, we
        // surface the failure as-is rather than risk the cross-runner
        // re-dispatch.
        const fallbackChain: string[] = ['generate'];
        let outcome;
        try {
          outcome = await runGenerateTask({
            taskId,
            userId: ctx.userId,
            // Use effectiveIntent (with parent context block when in
            // a follow-up + workflow preambles) whenever EITHER the
            // legacy or typed matcher fires. Earlier this only checked
            // legacy; P2_CT_008 surfaced the gap — typed-only matches
            // (content-topic / ecom-daily) lost their parent context
            // on follow-up tasks.create with replyToTaskId.
            // Phase 3 R1 (Codex #2): use effectiveIntent (parent
            // context block + workflow preamble prepended) whenever
            // any of:
            //   - legacy matcher fires
            //   - typed matcher fires (or recovered from parent)
            //   - this is a follow-up (replyToTaskId set) — the
            //     parent's outcome is load-bearing context for the
            //     model regardless of whether a workflow matched
            // Otherwise pass the bare user input.
            intent:
              expertWorkflow || typedWorkflow || isFollowUp
                ? effectiveIntent
                : input.intent,
            // Phase 2b — pass the resolved typed workflow so the
            // runner skips its inline matcher (which would re-match
            // against the parent-context-prefixed intent and could
            // pick a different workflow — P2_ED_008 surfaced this
            // when the parent ecom-daily report's summary text
            // happened to contain douyin-review keywords like 诊断).
            workflowOverride: typedWorkflow,
            skillId:
              gatedRole !== 'none'
                ? gatedRole
                : input.skillId ?? undefined,
            client: anthropicClient,
            logger: ctx.logger,
            ...(attachmentBlocks.length > 0 ? { attachments: attachmentBlocks } : {}),
            // Phase 24 RC follow-up — stream LLM deltas to the SPA
            // so users see incremental output instead of a blank
            // panel for 30-90s. broadcast errors are swallowed by
            // the runner; we never let WS issues stall the loop.
            onStreamDelta: (delta) => {
              try {
                broadcastToUser(ctx.userId, {
                  type: 'server.task.stream',
                  taskId,
                  delta,
                });
              } catch (err) {
                ctx.logger.warn({ err, taskId }, 'generate: broadcast stream delta failed');
              }
            },
          });
        } catch (err) {
          ctx.logger.error({ err, taskId }, 'generate: runner threw');
          outcome = {
            status: 'failed' as const,
            summary: '',
            reason: err instanceof Error ? err.message : 'generate: unknown error',
            inputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
          };
        }

        // Phase 1 follow-up — sanitise outcome.summary BEFORE the
        // verifier sees it. Tool-XML / base64 / stop-reason fragments
        // that occasionally leak into the model's visible output
        // would otherwise pollute persisted result.summary and the
        // verifier's grounding check (the URL regex inside a
        // base64 blob is not a real URL the user can click).
        if (outcome.status === 'completed' && outcome.summary) {
          const cleaned = sanitizeFinalText(outcome.summary);
          if (cleaned !== outcome.summary) {
            outcome = { ...outcome, summary: cleaned };
          }
        }

        // Phase 1 Day 5 — pipeline verification on the runner's
        // final answer. No-op when EXECUTION_VERIFIER_ENABLED is
        // off; in that case verifiedSummary === outcome.summary
        // and executionVerification === null.
        let executionVerification: VerificationResult | null = null;
        if (outcome.status === 'completed') {
          recordEvidence(taskId, {
            fact: `response_length=${outcome.summary.length}`,
            sourceType: 'tool_result',
            sourceDetail: 'llm_generate_response',
            confidence: 'observed',
          });
          const verified: VerifyOutput = await verifyAndFinalize({
            taskId,
            answerText: outcome.summary,
            client: anthropicClient,
            logger: ctx.logger,
          });
          if (verified.finalText !== outcome.summary) {
            outcome = { ...outcome, summary: verified.finalText };
          }
          executionVerification = verified.verification;
        }

        // B3 — structured task:completed log.
        const elapsedMs = Date.now() - generateStartedAt;
        const metadata = {
          executionMode: 'generate' as const,
          finalExecutionMode: 'generate' as const,
          expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
          selectedRole: gatedRole === 'none' ? null : gatedRole,
          model: 'claude-sonnet-4-6',
          fallbackChain,
          elapsedMs,
          modelFinalText:
            outcome.status === 'completed' ? outcome.summary.slice(0, 200) : null,
        };
        ctx.logger.info(
          {
            taskId,
            userId: ctx.userId,
            finalStatus: outcome.status,
            ...metadata,
            failureReason: outcome.status === 'failed' ? outcome.reason : null,
          },
          'task:completed',
        );

        // Optimization #2 (Codex follow-up) — response-layer formatter
        // runs AFTER the verifier (already done above) + BEFORE
        // persist so the row's `result.summary` carries the polished
        // text. `runResponseLayerForLane` is a no-op when the flag
        // is off; on flag-on it dynamic-imports the formatter +
        // OpenAI SDK. We stamp the metadata columns AFTER persist
        // (see `stampResponseLayerColumns` call below) so we don't
        // UPDATE a row that doesn't exist yet on failure path.
        const generateRl = await runResponseLayerForLane({
          taskId,
          status: outcome.status,
          summary: outcome.status === 'completed' ? outcome.summary : '',
          expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
          logger: ctx.logger,
        });
        if (
          outcome.status === 'completed' &&
          generateRl.summary !== outcome.summary
        ) {
          outcome = { ...outcome, summary: generateRl.summary };
        }

        try {
          if (outcome.status === 'completed') {
            await repo.persistVisionOutcome(taskId, {
              status: 'completed',
              summary: outcome.summary,
              tickCount: 1,
              metadata,
            });
          } else if (outcome.status === 'awaiting_user') {
            // Expert-workflow intake park out of the generate runner.
            // Persist status='awaiting_user' + the visible question
            // so a refresh during the pause re-renders correctly,
            // and stamp `awaiting_kind='clarification'` so the SPA's
            // BrowserPanel does NOT auto-expand / show the verify
            // banner — this is a chat-only intake. We also stamp
            // `result.executionMode='generate'` (rather than going
            // through persistVisionOutcome) so the reply path can
            // tell this task is parked from generate, not supercar.
            await ctx.db
              .update(tasksTable)
              .set({
                status: 'awaiting_user',
                awaitingQuestion: outcome.summary,
                awaitingKind: 'clarification',
                result: { ...metadata, executionMode: 'generate' as const },
              })
              .where(eq(tasksTable.externalId, taskId));
          } else {
            await repo.persistVisionOutcome(taskId, {
              status: 'failed',
              reason: outcome.reason ?? 'generate: api failed',
              tickCount: 1,
              metadata,
            });
          }
        } catch (err) {
          ctx.logger.error({ err, taskId }, 'generate: persist failed');
        }

        // Stamp the response-layer metadata columns now that persist
        // has landed. Best-effort: a stamp failure logs but doesn't
        // tear down terminal broadcast. Only fires when the formatter
        // actually ran (flag on); the awaiting_user branch never
        // produces a formatter run (non-terminal status filter
        // inside `runResponseLayerForLane`).
        await stampResponseLayerColumns(
          ctx.db,
          taskId,
          generateRl.responseLayerOriginal,
          outcome.status === 'completed' ? outcome.summary : '',
          generateRl.responseLayerMetadata,
          ctx.logger,
        );

        try {
          if (outcome.status === 'completed') {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'completed',
              ...(outcome.summary ? { summary: outcome.summary } : {}),
            });
          } else if (outcome.status === 'awaiting_user') {
            broadcastToUser(ctx.userId, {
              type: 'server.supercar.awaiting_user',
              taskId,
              question: outcome.summary,
              awaitingKind: 'clarification',
            });
          } else {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'failed',
              ...(outcome.reason ? { reason: outcome.reason } : {}),
            });
          }
        } catch (err) {
          ctx.logger.warn({ err, taskId }, 'generate: broadcast terminal failed');
        }

        // Phase 1 Day 5 — fire-and-forget execution-pipeline persist
        // + always cleanup the in-memory contract / ledger registries
        // even when persist is a no-op (flags off) so the maps don't
        // leak across long-running PM2 lifetimes.
        void persistExecution({
          taskId,
          verification: executionVerification,
          db: ctx.db,
          logger: ctx.logger,
        }).finally(() => disposeExecution(taskId));
      })();

      return {
        taskId,
        status: 'executing' as const,
        steps: [],
        executionMode: 'generate' as const,
      };
    }
    // ===== end generate-mode fork =====

    // ===== scrape-mode fork (Phase 24 RC follow-up) =====
    // Tasks classified as 'scrape' want page content but NOT live
    // browser interaction. Firecrawl pulls markdown in 2-3s, then
    // Claude synthesises an answer from those bytes. Cost is roughly
    // 5-10× cheaper than the browser path; latency 5-10× faster.
    //
    // If FIRECRAWL_API_KEY is missing at boot, ctx.firecrawl is null
    // and the scrape branch persists a clear failure (rather than
    // silently degrading to the browser path which is what the
    // classifier explicitly avoided routing to).
    if (executionMode === 'scrape' && appEnv.ANTHROPIC_API_KEY && anthropicForResolver) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);

      await repo.insertTask(
        {
          taskId,
          status: 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        {
          userId: userRow.id,
          intent: input.intent,
          roleId: gatedRole === 'none' ? null : gatedRole,
          opusUsed: opusActuallyConsumed,
        },
      );

      ctx.logger.info(
        { taskId, userId: ctx.userId, executorLane: 'scrape', executionMode },
        'task: executor lane selected',
      );

      // Defensive — if the adapter wasn't configured at boot, fail
      // loudly with the exact reason. SPA / translateError surfaces
      // a clear "Firecrawl 未配置" instead of "服务繁忙".
      if (!ctx.firecrawl) {
        try {
          await repo.persistVisionOutcome(taskId, {
            status: 'failed',
            reason: 'scrape: Firecrawl 未配置（FIRECRAWL_API_KEY 缺失），任务无法执行',
            tickCount: 0,
          });
        } catch (err) {
          ctx.logger.warn({ err, taskId }, 'scrape: persist failed-row write threw');
        }
        try {
          broadcastToUser(ctx.userId, {
            type: 'server.task.terminal',
            taskId,
            status: 'failed',
            reason: 'Firecrawl 未配置',
          });
        } catch {
          /* swallow — best-effort */
        }
        return {
          taskId,
          status: 'executing' as const,
          steps: [],
          executionMode: 'scrape' as const,
        };
      }

      // Phase 1 Day 5 — initialise execution pipeline. No-op when
      // every feature flag is off (default). The firecrawl-null
      // early return above bails BEFORE this init so the registries
      // never see a task that won't terminate.
      initExecution({
        taskId,
        intent: input.intent,
        executionMode: 'scrape',
        expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
        hasAttachments: attachmentBlocks.length > 0,
      });

      const firecrawl = ctx.firecrawl;
      const anthropicClient = anthropicForResolver;
      const scrapeStartedAt = Date.now();
      void (async () => {
        // Fallback chain (A4) — every lane the dispatcher actually
        // tried for this task. Logged + persisted under
        // result.metadata.fallbackChain so the eval pipeline can see
        // which path produced the final outcome.
        const fallbackChain: string[] = ['scrape'];
        let finalExecutionMode: 'scrape' | 'generate' = 'scrape';
        let scrapeOutcome;
        try {
          scrapeOutcome = await runScrapeTask({
            taskId,
            userId: ctx.userId,
            // Use effectiveIntent (with parent context block when in
            // a follow-up + workflow preambles) whenever EITHER the
            // legacy or typed matcher fires. Earlier this only checked
            // legacy; P2_CT_008 surfaced the gap — typed-only matches
            // (content-topic / ecom-daily) lost their parent context
            // on follow-up tasks.create with replyToTaskId.
            // Phase 3 R1 (Codex #2): use effectiveIntent (parent
            // context block + workflow preamble prepended) whenever
            // any of:
            //   - legacy matcher fires
            //   - typed matcher fires (or recovered from parent)
            //   - this is a follow-up (replyToTaskId set) — the
            //     parent's outcome is load-bearing context for the
            //     model regardless of whether a workflow matched
            // Otherwise pass the bare user input.
            intent:
              expertWorkflow || typedWorkflow || isFollowUp
                ? effectiveIntent
                : input.intent,
            skillId:
              gatedRole !== 'none'
                ? gatedRole
                : input.skillId ?? undefined,
            client: anthropicClient,
            firecrawl,
            logger: ctx.logger,
            // Phase 24 RC follow-up — stream LLM deltas + push
            // coarse Firecrawl-phase progress to the SPA. Same
            // contract as generate-runner; broadcast errors are
            // swallowed.
            onStreamDelta: (delta) => {
              try {
                broadcastToUser(ctx.userId, {
                  type: 'server.task.stream',
                  taskId,
                  delta,
                });
              } catch (err) {
                ctx.logger.warn({ err, taskId }, 'scrape: broadcast stream delta failed');
              }
            },
            onProgress: (message) => {
              try {
                broadcastToUser(ctx.userId, {
                  type: 'server.task.progress',
                  taskId,
                  message,
                });
              } catch (err) {
                ctx.logger.warn({ err, taskId }, 'scrape: broadcast progress failed');
              }
            },
          });
        } catch (err) {
          ctx.logger.error({ err, taskId }, 'scrape: runner threw');
          scrapeOutcome = {
            status: 'failed' as const,
            summary: '',
            reason: err instanceof Error ? err.message : 'scrape: unknown error',
            inputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
            source: 'scrape' as const,
            sources: [] as string[],
          };
        }

        // A1 — scrape failed → fall back to generate. Generate has
        // zero infra dependencies (no Brave, no Firecrawl) so it's
        // always reachable; if the model can't answer the intent
        // directly, generate itself will return failed and we keep
        // the chain visible in metadata for triage. The intent +
        // skill + attachments are identical between the two runners,
        // so the fallback produces the same surface for the user.
        let outcome:
          | {
              status: 'completed';
              summary: string;
              reason?: string;
            }
          | {
              status: 'failed';
              summary?: string;
              reason: string;
            };
        if (scrapeOutcome.status === 'completed') {
          outcome = {
            status: 'completed',
            summary: scrapeOutcome.summary,
          };
        } else {
          ctx.logger.warn(
            {
              taskId,
              scrapeReason: scrapeOutcome.reason,
              fallbackTo: 'generate',
            },
            'scrape failed, falling back to generate',
          );
          fallbackChain.push('generate');
          finalExecutionMode = 'generate';
          let generateOutcome;
          try {
            generateOutcome = await runGenerateTask({
              taskId,
              userId: ctx.userId,
              // Phase 3 R1 (Codex #2): use effectiveIntent (parent
            // context block + workflow preamble prepended) whenever
            // any of:
            //   - legacy matcher fires
            //   - typed matcher fires (or recovered from parent)
            //   - this is a follow-up (replyToTaskId set) — the
            //     parent's outcome is load-bearing context for the
            //     model regardless of whether a workflow matched
            // Otherwise pass the bare user input.
            intent:
              expertWorkflow || typedWorkflow || isFollowUp
                ? effectiveIntent
                : input.intent,
              workflowOverride: typedWorkflow,
              skillId:
                gatedRole !== 'none'
                  ? gatedRole
                  : input.skillId ?? undefined,
              client: anthropicClient,
              logger: ctx.logger,
              ...(attachmentBlocks.length > 0 ? { attachments: attachmentBlocks } : {}),
              onStreamDelta: (delta) => {
                try {
                  broadcastToUser(ctx.userId, {
                    type: 'server.task.stream',
                    taskId,
                    delta,
                  });
                } catch (err) {
                  ctx.logger.warn({ err, taskId }, 'fallback-generate: broadcast stream delta failed');
                }
              },
            });
          } catch (err) {
            ctx.logger.error({ err, taskId }, 'fallback-generate: runner threw');
            generateOutcome = {
              status: 'failed' as const,
              summary: '',
              reason: err instanceof Error ? err.message : 'fallback-generate: unknown error',
              inputTokens: 0,
              outputTokens: 0,
              durationMs: 0,
            };
          }
          if (generateOutcome.status === 'completed') {
            outcome = {
              status: 'completed',
              summary: generateOutcome.summary,
            };
          } else {
            // Phase 1 follow-up — humanise the failure reason so the
            // user sees actionable Chinese guidance instead of a raw
            // stack trace / English error code.
            outcome = {
              status: 'failed',
              reason: humaniseScrapeFailure(
                `scrape failed (${scrapeOutcome.reason}); generate fallback also failed (${generateOutcome.reason ?? 'unknown'})`,
              ),
            };
          }
        }

        // Phase 1 follow-up — sanitise the completed-path summary
        // before verification. Same rationale as the generate lane.
        if (outcome.status === 'completed' && outcome.summary) {
          const cleaned = sanitizeFinalText(outcome.summary);
          if (cleaned !== outcome.summary) {
            outcome = { ...outcome, summary: cleaned };
          }
        }

        // Phase 1 Day 5 — pipeline verification on the runner's
        // final answer. Same pattern as the generate fork: ledger
        // gets a tool_result for each scraped source + a
        // response_length entry, then the verifier runs.
        let executionVerification: VerificationResult | null = null;
        if (outcome.status === 'completed') {
          for (const url of scrapeOutcome.sources.slice(0, 10)) {
            recordEvidence(taskId, {
              fact: `scraped_url=${url}`,
              sourceType: 'tool_result',
              sourceDetail: `firecrawl_${scrapeOutcome.source}`,
              confidence: 'extracted',
            });
          }
          recordEvidence(taskId, {
            fact: `response_length=${outcome.summary.length}`,
            sourceType: 'tool_result',
            sourceDetail: 'llm_scrape_response',
            confidence: 'observed',
          });
          const verified: VerifyOutput = await verifyAndFinalize({
            taskId,
            answerText: outcome.summary,
            client: anthropicClient,
            logger: ctx.logger,
          });
          if (verified.finalText !== outcome.summary) {
            outcome = { ...outcome, summary: verified.finalText };
          }
          executionVerification = verified.verification;
        }

        // B3 — structured task:completed log. Single record per task
        // termination with all fields the eval pipeline needs.
        const elapsedMs = Date.now() - scrapeStartedAt;
        const metadata = {
          executionMode: 'scrape' as const,
          finalExecutionMode,
          expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
          selectedRole: gatedRole === 'none' ? null : gatedRole,
          model: 'claude-sonnet-4-6',
          fallbackChain,
          elapsedMs,
          modelFinalText:
            outcome.status === 'completed' ? outcome.summary.slice(0, 200) : null,
        };
        ctx.logger.info(
          {
            taskId,
            userId: ctx.userId,
            finalStatus: outcome.status,
            ...metadata,
            failureReason:
              outcome.status === 'failed' ? outcome.reason : null,
          },
          'task:completed',
        );

        // Optimization #2 (Codex follow-up) — same wire-up pattern
        // as the generate lane: format after verifier, before
        // persist; stamp metadata columns after persist.
        const scrapeRl = await runResponseLayerForLane({
          taskId,
          status: outcome.status,
          summary: outcome.status === 'completed' ? outcome.summary : '',
          expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
          logger: ctx.logger,
        });
        if (
          outcome.status === 'completed' &&
          scrapeRl.summary !== outcome.summary
        ) {
          outcome = { ...outcome, summary: scrapeRl.summary };
        }

        try {
          if (outcome.status === 'completed') {
            await repo.persistVisionOutcome(taskId, {
              status: 'completed',
              summary: outcome.summary,
              tickCount: 1,
              metadata,
            });
          } else {
            await repo.persistVisionOutcome(taskId, {
              status: 'failed',
              reason: outcome.reason,
              tickCount: 1,
              metadata,
            });
          }
        } catch (err) {
          ctx.logger.error({ err, taskId }, 'scrape: persist failed');
        }

        await stampResponseLayerColumns(
          ctx.db,
          taskId,
          scrapeRl.responseLayerOriginal,
          outcome.status === 'completed' ? outcome.summary : '',
          scrapeRl.responseLayerMetadata,
          ctx.logger,
        );

        try {
          if (outcome.status === 'completed') {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'completed',
              ...(outcome.summary ? { summary: outcome.summary } : {}),
            });
          } else {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'failed',
              ...(outcome.reason ? { reason: outcome.reason } : {}),
            });
          }
        } catch (err) {
          ctx.logger.warn({ err, taskId }, 'scrape: broadcast terminal failed');
        }

        // Phase 1 Day 5 — fire-and-forget execution-pipeline persist
        // + cleanup. Same pattern as the generate fork.
        void persistExecution({
          taskId,
          verification: executionVerification,
          db: ctx.db,
          logger: ctx.logger,
        }).finally(() => disposeExecution(taskId));
      })();

      return {
        taskId,
        status: 'executing' as const,
        steps: [],
        executionMode: 'scrape' as const,
      };
    }
    // ===== end scrape-mode fork =====

    // Diagnostic: log the supercar-gate inputs on every tasks.create
    // so BOSS can tell from pm2 logs exactly why a task fell into the
    // legacy branch. Happens BEFORE the gate so the log always lands.
    ctx.logger.info(
      {
        gate: 'supercar-vs-legacy',
        AGENT_MODE: appEnv.AGENT_MODE,
        playwrightExecutorPresent: Boolean(ctx.playwrightExecutor),
        anthropicKeyPresent: Boolean(appEnv.ANTHROPIC_API_KEY),
        isSimpleSearchIntent,
        browserPoolEligible,
        willUseSupercar:
          appEnv.AGENT_MODE === 'supercar' &&
          Boolean(appEnv.ANTHROPIC_API_KEY) &&
          (Boolean(ctx.playwrightExecutor) || browserPoolEligible),
      },
      'tasks.create: control-plane decision',
    );

    // Supercar path — Anthropic's official computer_20251124 +
    // web_search_20260209 tools driving Playwright directly, with
    // adaptive thinking + prompt caching. This is the default starting
    // with the superstar rewrite; flip AGENT_MODE=legacy to fall back
    // to the hand-rolled vision-loop.
    if (
      appEnv.AGENT_MODE === 'supercar' &&
      appEnv.ANTHROPIC_API_KEY &&
      (ctx.playwrightExecutor || browserPoolEligible)
    ) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);

      // Phase 13 Dim 1 — first-frame plan. Skipped for simple-search
      // (the model's web_search tool handles those in one shot),
      // trivial intents, and any intent shorter than 8 chars. Plan
      // failures are non-fatal — generatePlan returns { planText:
      // null, planStatus: null } and the loop continues without one.
      // Run in parallel with memory retrieval below to keep the
      // tasks.create RTT close to its pre-Phase-13 footprint.
      const skipPlan = isSimpleSearchIntent || shouldSkipPlan(input.intent);
      const memoryService = new MemoryService(ctx.db, ctx.logger);
      const [planResult, relevantMemories] = await Promise.all([
        skipPlan
          ? Promise.resolve({ planText: null, planStatus: null })
          : generatePlan({
              apiKey: appEnv.ANTHROPIC_API_KEY,
              intent: input.intent,
              logger: ctx.logger,
              taskId,
            }),
        memoryService.pickRelevant(userRow.id, input.intent),
      ]);
      const memoryPreamble = memoryService.formatForPrompt(relevantMemories);
      // Phase 14 — site-playbook injection. Match the user's intent
      // against the playbook catalogue (中文 name / domain / English
      // name); render the matched tips into a user-message preamble.
      // Empty when no site is mentioned — keeps unrelated tasks
      // unaffected. matchPlaybooks is a small in-memory loop over
      // ~25 entries (microseconds). The matched array is also reused
      // below by the router cold-start recommendation when stats has
      // < 3 samples for the target site.
      const matchedPlaybooks = matchPlaybooks(input.intent);
      const playbookContext = formatPlaybooksForPrompt(matchedPlaybooks);
      if (matchedPlaybooks.length > 0) {
        ctx.logger.info(
          { taskId, sites: matchedPlaybooks.map((p) => p.domain) },
          'playbook: injected site context',
        );
      }

      // Phase 24 RC follow-up — TaskQueue gates dispatch when the
      // per-task BrowserPool is at its 10-slot capacity. We seed the
      // row with status='queued' so a 30-task burst doesn't show 30
      // fake-executing rows while 20 of them are actually waiting.
      // The queue's onStart callback flips the row to 'executing' the
      // moment a slot frees; if the queue isn't wired (e.g. legacy
      // boot without MULTI_USER) we fall back to the historical
      // 'executing' seed.
      const willQueueDispatch = Boolean(
        ctx.taskQueue && executionMode === 'browser' && shouldUseBrowserPool(ctx.userId),
      );
      await repo.insertTask(
        {
          taskId,
          status: willQueueDispatch ? 'queued' : 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        {
          userId: userRow.id,
          intent: input.intent,
          roleId: gatedRole === 'none' ? null : gatedRole,
          opusUsed: opusActuallyConsumed,
        },
      );
      // Phase 13 Dim 1 — persist plan onto the task row and broadcast
      // it to the SPA so the user sees upcoming steps before any
      // tool fires. Best-effort: write failures log + continue.
      if (planResult.planText) {
        await ctx.db
          .update(tasksTable)
          .set({
            planText: planResult.planText,
            planStatus: planResult.planStatus as unknown,
          })
          .where(eq(tasksTable.externalId, taskId))
          .catch((err) => ctx.logger.warn({ err, taskId }, 'plan persist failed'));
        try {
          broadcastToUser(ctx.userId, {
            type: 'server.task.plan',
            taskId,
            planText: planResult.planText,
            planStatus: planResult.planStatus ?? [],
          });
        } catch (err) {
          ctx.logger.warn({ err, taskId }, 'plan broadcast failed');
        }
      }
      // Phase 10 Tier 3 — back-fill task_files.task_id once the task
      // row exists. Best-effort so a failed link doesn't kill the run;
      // worst case the file is orphaned (still readable by id, just
      // not linkable from /tasks/:id).
      if (input.fileIds && input.fileIds.length > 0) {
        const [taskDb] = await ctx.db
          .select({ id: tasksTable.id })
          .from(tasksTable)
          .where(eq(tasksTable.externalId, taskId))
          .limit(1);
        if (taskDb) {
          await fileService
            .linkToTask(input.fileIds, taskDb.id, userRow.id)
            .catch((err) => ctx.logger.warn({ err }, 'tasks.create: file link failed'));
        }
      }

      const classification = classifyDomain(input.intent);
      ctx.logger.info(
        { taskId, domain: classification.domain, confidence: classification.confidence },
        'supercar: task domain classified',
      );

      const userId = ctx.userId;
      const [taskDbRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(eq(tasksTable.externalId, taskId))
        .limit(1);
      const taskDbId = taskDbRow?.id;

      // Phase 8.1: HEADED Brave is the primary browser. Phase 6-2
      // shipped with headless as primary + headed as a stuck/anti-bot
      // fallback, but that meant the user watched the Panel VNC stream
      // (wired to the headed Xvfb) while the agent was actually
      // driving the hidden headless instance — they never matched
      // up in the UI. Demoting headless to "last-resort fallback"
      // makes the UI stream and the agent's focus the same browser.
      //
      // Empty headed lane (dev boxes without Xvfb + Brave) falls back
      // to headless → plain injected executor → router-less deploy
      // ancestor. Each null just hops to the next layer.
      const headedExec = ctx.executionRouter?.getExecutor('headed') ?? null;
      const headlessExec =
        ctx.executionRouter?.getExecutor('headless') ?? ctx.playwrightExecutor ?? null;

      // Phase 21b — executionMode was decided up at the admission
      // gate (so per-mode concurrency could apply). It's reused here
      // to gate pool.allocate; for 'generate' we don't need a per-
      // user pool slot. Note that this branch only fires for the
      // BROWSER execution mode under 21b — pure-generate tasks fork
      // off into runGenerateTask before reaching the supercar gate.
      ctx.logger.info(
        { taskId, userId: ctx.userId, executionMode },
        'tasks.create: supercar branch — execution mode',
      );

      // Phase 8.2: when the caller is in MULTI_USER_USERS allow-list,
      // replace the shared headed singleton with their own pool slot.
      // The pool's executor is a freshly-connected PlaywrightExecutor
      // pointing at a dedicated Brave + Xvfb + VNC quartet — the rest
      // of the supercar loop sees a plain PlaywrightExecutor and
      // doesn't know the difference. If allocate throws (capacity
      // exceeded, spawn timeout) we surface a typed error so the UI
      // can show "browser-pool busy" rather than an opaque 500.
      //
      // 21a — also skip when executionMode='generate' (no per-user
      // browser slot needed for pure-generation tasks).
      // Phase 24 RC follow-up — wrap allocate + supercarArgs build +
      // runFn invocation in dispatchToBrave so the global TaskQueue
      // can hold it past the 10-slot pool cap. Body unchanged from
      // the pre-queue flow; only outer scheduling differs (taskQueue
      // .enqueue vs `void runFn()`).
      const dispatchToBrave = async (): Promise<void> => {
      let perUserExec = null;
      if (
        ctx.browserPool &&
        shouldUseBrowserPool(ctx.userId) &&
        executionMode === 'browser'
      ) {
        try {
          // Phase 24 — keyed by taskId, not userId. One task = one
          // Brave (no shared instance, no refcount). The runFn
          // .finally below calls release(taskId) to tear down
          // immediately on completion. Per-user concurrency is gated
          // upstream via getActiveTaskCount + plan limits.
          const instance = await ctx.browserPool.allocate(
            taskId,
            ctx.userId,
            input.viewportProfile,
          );
          // P0 SAFETY GUARD — Phase 24 RC follow-up. The per-task pool
          // allocates CDP ports in the inclusive range
          // [cdpPortStart, cdpPortStart + maxInstances - 1] = [9300,
          // 9309]. Any executor returned with a port outside that
          // window CANNOT be a server-side pool Brave — it would have
          // to be a singleton fallback, the headed lane (9223), or
          // worst-case the user's local Chrome via the extension's
          // chrome.debugger surface. Refuse to dispatch on anything
          // we don't recognise; release the instance so no Brave
          // leaks. The caller's catch below logs and falls through.
          if (instance.cdpPort < 9300 || instance.cdpPort > 9309) {
            ctx.logger.error(
              {
                taskId,
                userId: ctx.userId,
                cdpPort: instance.cdpPort,
              },
              'pool: P0 GUARD — allocated port outside server-pool range [9300,9309]; refusing to dispatch',
            );
            await ctx.browserPool
              .release(taskId, `P0-guard-${taskId}`)
              .catch(() => {
                /* best-effort */
              });
            throw new Error(
              `P0 guard: refusing to dispatch on cdpPort=${instance.cdpPort} (outside server-pool range)`,
            );
          }
          perUserExec = instance.executor;
          ctx.logger.info(
            { taskId, userId: ctx.userId, cdpPort: instance.cdpPort, displayNum: instance.display },
            'pool: allocated browser for task',
          );
        } catch (err) {
          // No singleton fallback. The earlier behaviour ("degrade to
          // shared Brave") could land a user's clicks on another
          // user's session and bypassed the per-task hijack guards.
          // Re-throw so dispatchToBrave aborts; the runFn .finally
          // marks the task failed and the queue slot releases.
          // Capacity errors should be rare since the queue gates on
          // pool depth; treat them as alert-worthy when they hit.
          ctx.logger.error(
            { err: err instanceof Error ? err.message : String(err), userId: ctx.userId, taskId },
            'pool: allocate failed — refusing to fall back to singleton, failing task',
          );
          throw err instanceof Error
            ? err
            : new Error(`pool allocate failed: ${String(err)}`);
        }
      }

      // primaryExecutor may be null when:
      //   - the gate admitted via canShortCircuitBrave (simple-search,
      //     no browser needed — Brave handles it); or
      //   - the gate admitted via browserPoolEligible but pool.allocate
      //     above raced and lost (Brave crashed mid-spawn).
      // runSupercarTask's null-executor guard handles both: Brave/Zapier
      // short-circuits fire first, and if neither matches it returns
      // status='failed' with a clear "browser unavailable" reason.
      // That marks the task failed in the DB rather than 500ing the
      // tasks.create call, which would lose the audit trail.
      const primaryExecutor = perUserExec ?? headedExec ?? headlessExec;
      // Phase 22a — captured once at admit time so the runFn .finally
      // below can release the slot without re-checking pool state.
      const didAllocatePool = perUserExec !== null;
      // Phase 19c follow-up — log which executor lane this task
      // landed on. Lets BOSS confirm in pm2 logs that the per-user
      // pool path is actually winning (and falling back to a
      // singleton lane is the exception, not the rule). Helps
      // future "agent operates on a different browser than the
      // user is watching" reports get diagnosed in one log line.
      const executorLane = perUserExec
        ? 'per-user-pool'
        : primaryExecutor === headedExec
          ? 'singleton-headed-fallback'
          : primaryExecutor === headlessExec
            ? 'singleton-headless-fallback'
            : 'none';
      ctx.logger.info(
        { taskId, userId: ctx.userId, executorLane },
        'task: executor lane selected',
      );
      // Phase 13 Dim 6 — single StatsService instance shared across
      // all stats records the loop emits. Wiring is best-effort
      // (StatsService.record swallows its own errors), so a stats
      // backend hiccup never stalls the agent.
      const statsService = new StatsService(ctx.db, ctx.logger);
      const taskTypeForStats = classifyTaskType(input.intent);
      // Phase 13 Dim 6 — optimal-lane hint from prior stats. Best-
      // effort observability: derives the target site from any URL
      // mention in the intent (e.g. "在 jd.com 搜..."), then logs
      // the historically winning lane for (this user, that site).
      // Routing decisions are unchanged this commit; the log line
      // exists so we can validate the recommender empirically before
      // wiring it to the gate. Null target_site → no lookup.
      const intentSiteMatch = input.intent.match(
        /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+(?:com|cn|net|org|tech|ai|io|co))\b/i,
      );
      const intentTargetSite = intentSiteMatch
        ? extractDomain(intentSiteMatch[1] ?? null)
        : null;
      // Phase 14 — playbook-driven cold-start lane recommendation.
      // The "router: cold-start lane from playbook" log fires when:
      //   (a) intent has a URL but stats < 3 samples, OR
      //   (b) intent has no URL but a playbook matched by name.
      // The intent-only branch is a best-effort observability hook;
      // routing decisions still go through the legacy gate this
      // commit. Stats stay primary once they exceed the sample
      // threshold (priority order in router-decision.ts).
      const playbookForRouter = matchedPlaybooks[0] ?? null;
      const routerTargetSite = intentTargetSite ?? playbookForRouter?.domain ?? null;
      if (routerTargetSite) {
        try {
          const optimalLane = await statsService.getOptimalLane({
            userIdInternal: userRow.id,
            targetSite: routerTargetSite,
          });
          if (optimalLane) {
            ctx.logger.info(
              {
                taskId,
                taskType: taskTypeForStats,
                targetSite: routerTargetSite,
                optimalLane,
                source: 'stats',
              },
              'router: optimal lane from stats',
            );
          } else if (playbookForRouter) {
            ctx.logger.info(
              {
                taskId,
                taskType: taskTypeForStats,
                targetSite: routerTargetSite,
                recommendedLane: playbookForRouter.preferredLane,
                source: 'playbook',
              },
              'router: cold-start lane from playbook',
            );
            // Phase 14 (extension follow-up) — when the matched
            // playbook flags this site as login-required AND the
            // user has a live extension WS connection AND the
            // extension reports them as logged in there, log a
            // hint so we can later wire the chrome-extension
            // transport as a higher-priority lane than headed.
            // Read-only observability this commit; no routing
            // change. Treats the playbook's own domain as
            // canonical (covers the case where intent has no URL).
            if (
              playbookForRouter.loginRequired !== false &&
              hasConnectedSwClient(ctx.userId) &&
              getExtensionLoginState(ctx.userId, playbookForRouter.domain) === true
            ) {
              ctx.logger.info(
                {
                  taskId,
                  targetSite: playbookForRouter.domain,
                  loginRequired: playbookForRouter.loginRequired,
                },
                'router: extension lane available with verified login state',
              );
            }
          } else {
            ctx.logger.info(
              { taskId, targetSite: routerTargetSite },
              'router: no usable stats history for site (default route)',
            );
          }
        } catch (err) {
          ctx.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'router: stats lookup failed (non-fatal)',
          );
        }
      }
      // Per-task buffer of web_search results from the current
      // iteration. onWebSearch pushes here; onTick (which fires once
      // at the end of each iteration) flushes them into the persisted
      // step's output JSON so a refresh-after-completion can rebuild
      // webSearchByTask without replaying the WS frames. Local to
      // dispatchToBrave so concurrent tasks don't share a buffer.
      let pendingWebSearches: Array<{
        readonly query: string;
        readonly sources: ReadonlyArray<{ title: string; url: string; snippet?: string }>;
      }> = [];
      // Codex P3 follow-up — per-task buffer of save_page_as_pdf
      // results. Each successful call appends one entry here; the
      // terminal-state merge below folds the list into
      // `metadata.attachments` so the eval haystack + SPA AttachmentBar
      // see every PDF the agent saved during the run (not just the
      // last one). Local to the .create closure so concurrent tasks
      // don't share state. Each entry mirrors the L1 screenshot
      // attachment shape (`kind: 'pdf'`).
      const pdfAttachments: Array<{
        fileId: string;
        downloadUrl: string;
        filename: string;
        mimetype: string;
        sizeBytes: number;
        expiresAt: string;
        kind: 'pdf';
      }> = [];
      const supercarArgs: Parameters<typeof runSupercarTask>[0] = {
          taskId,
          // Phase 14 audit follow-up — feed the agent the parent-task
          // context block when this is a 追问. DB still stores
          // `input.intent` (what the user typed); only the model sees
          // the prefixed version.
          intent: effectiveIntent,
          ...(memoryPreamble ? { memoryPreamble } : {}),
          ...(playbookContext ? { playbookContext } : {}),
          ...(planResult.planText ? { planText: planResult.planText } : {}),
          ...(planResult.planStatus ? { planSteps: planResult.planStatus } : {}),
          // Phase 13 Dim 1 follow-up — persist + broadcast every
          // plan-step state change as the model emits markers. Best-
          // effort: a DB blip or broadcast failure logs and continues
          // (the loop already has the up-to-date state in memory).
          onPlanStepUpdate: (steps) => {
            void ctx.db
              .update(tasksTable)
              .set({ planStatus: steps as unknown })
              .where(eq(tasksTable.externalId, taskId))
              .catch((err) =>
                ctx.logger.warn({ err, taskId }, 'plan-step persist failed'),
              );
            try {
              broadcastToUser(ctx.userId, {
                type: 'server.task.plan_step',
                taskId,
                planStatus: steps,
              });
            } catch (err) {
              ctx.logger.warn(
                { err, taskId },
                'plan-step broadcast failed',
              );
            }
          },
          onStatsRecord: ({ laneUsed, targetSite, success, latencyMs, errorType }) => {
            void statsService.record({
              userIdInternal: userRow.id,
              taskExternalId: taskId,
              taskType: taskTypeForStats,
              targetSite,
              laneUsed,
              success,
              latencyMs,
              errorType,
            });
          },
          executor: primaryExecutor,
          domain: classification.domain,
          // Swap target: the NON-primary browser. When headed was
          // used as primary, a stuck/anti-bot signal falls back to
          // headless (in case Brave is what's being fingerprinted).
          // When headless is primary (Brave unavailable), swap
          // points at nothing — agent-loop no-ops the swap. Per-user
          // pool mode has no fallback — the user's own Brave is the
          // only tab they're watching, swapping to a shared headless
          // would stream frames of the wrong page.
          headedExecutor:
            perUserExec
              ? null
              : primaryExecutor === headedExec
                ? headlessExec ?? null
                : null,
          zapierAdapter: ctx.executionRouter?.zapier ?? null,
          apifyAdapter: ctx.executionRouter?.apify ?? null,
          firecrawl: ctx.firecrawl ?? null,
          isSimpleSearch: isSimpleSearchIntent,
          isCrossPlatformAutomation: classifyAsCrossPlatformAutomation(input.intent),
          zapierWebhookPath: process.env.ZAPIER_WEBHOOK_PATH ?? null,
          // Pass the post-gate role so prompt-layers cannot accidentally
          // resurrect the raw classifier match. Gated value is 'none' for
          // free users, 'none' or open-pool for basic, anything for pro.
          roleIdOverride: gatedRole,
          // Phase 10 Tier 3 — attachments parsed above, prepended to
          // the agent's first user message before the screenshot.
          ...(attachmentBlocks.length > 0 ? { attachments: attachmentBlocks } : {}),
          // Phase 10 Tier 3 — per-plan create_file format whitelist.
          // Empty list (free) suppresses the tool entirely; basic gets
          // text-shaped formats only; pro gets office formats too.
          createFileFormats: allowedFormatsForPlan(planId),
          // Closure that lazily resolves the task's DB id (the supercar
          // queue runs async; the row exists by the time the model
          // calls a tool). Stores the buffer + index row, then returns
          // a download URL the model embeds in the final summary.
          // Phase 3 R3 L2 — save_page_as_pdf storage callback. The
          // supercar loop renders the page to a PDF Buffer; we just
          // persist it via DownloadManager (which enforces the 50MB
          // cap + builds the URL). Only wired when downloadManager
          // exists on ctx (always true in prod boot path; nullable
          // in test deps).
          ...(ctx.downloadManager
            ? {
                async onSavePageAsPdf({
                  filename,
                  pdfBuffer,
                }: {
                  filename: string;
                  pdfBuffer: Buffer;
                }) {
                  try {
                    const taskInternalId = await taskInternalIdFor(ctx.db, taskId);
                    if (taskInternalId == null) {
                      return { error: 'task row not found' };
                    }
                    const saved = await ctx.downloadManager!.save({
                      userIdInternal: userRow.id,
                      userExternalId: ctx.userId,
                      taskIdInternal: taskInternalId,
                      content: pdfBuffer,
                      filename,
                      mimetype: 'application/pdf',
                    });
                    // Codex P3 follow-up — accumulate per-task so the
                    // terminal-state merge folds every saved PDF into
                    // metadata.attachments. Previously the model's tool
                    // result text was the only record of the PDF, which
                    // meant the SPA's AttachmentBar + eval haystack saw
                    // none of the saved PDFs.
                    pdfAttachments.push({
                      fileId: saved.fileId,
                      downloadUrl: saved.downloadUrl,
                      filename: saved.filename,
                      mimetype: saved.mimetype,
                      sizeBytes: saved.sizeBytes,
                      expiresAt: saved.expiresAt.toISOString(),
                      kind: 'pdf',
                    });
                    return {
                      fileId: saved.fileId,
                      filename: saved.filename,
                      sizeBytes: saved.sizeBytes,
                      downloadUrl: saved.downloadUrl,
                    };
                  } catch (err) {
                    return {
                      error: err instanceof Error ? err.message : String(err),
                    };
                  }
                },
              }
            : {}),
          async onCreateFile({ filename, format, content }) {
            if (!isCreateFileFormat(format)) {
              return { error: `unsupported format: ${format}` };
            }
            try {
              const rendered = await renderFile(format, content);
              const taskInternalId = await taskInternalIdFor(ctx.db, taskId);
              if (taskInternalId == null) {
                return { error: 'task row not found' };
              }
              const stored = await fileService.storeOutput({
                userIdInternal: userRow.id,
                userExternalId: ctx.userId,
                taskIdInternal: taskInternalId,
                filename,
                mimetype: rendered.mimetype,
                buffer: rendered.buffer,
              });
              return {
                fileId: stored.externalId,
                filename: stored.filename,
                size: stored.sizeBytes,
                downloadUrl: `/api/files/${stored.externalId}/download`,
              };
            } catch (err) {
              return {
                error: err instanceof Error ? err.message : String(err),
              };
            }
          },
          onTick(ev) {
            // Synthesise a tick.start + tick.end pair per iteration so
            // the existing UI step cards light up without frontend
            // changes. actionKind is the first client-side tool the
            // model invoked this turn, or "text" when Claude just
            // spoke (e.g. mid-turn thinking → commentary).
            //
            // Also bump the per-user pool's lastActiveAt so an active
            // task never trips the 30-min idle GC — pool.touch is a
            // no-op when the user isn't on a pool slot.
            if (ctx.browserPool && perUserExec) {
              ctx.browserPool.touch(taskId);
            }
            const actionKind = ev.toolsInTurn[0] ?? 'text';
            const actionSummary = ev.textPreamble
              ? truncateString(stripPlanTrackerMarkers(ev.textPreamble), 80)
              : ev.toolsInTurn.join(', ') || 'thinking';
            const now = Date.now();
            try {
              broadcastToUser(userId, {
                type: 'server.vision.tick.start',
                taskId,
                tickIndex: ev.iteration,
                mode: 'screenshot',
              });
              broadcastToUser(userId, {
                type: 'server.vision.tick.end',
                taskId,
                tickIndex: ev.iteration,
                mode: 'screenshot',
                actionKind,
                actionSummary,
                durationMs: ev.apiLatencyMs,
                ok: true,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast tick failed');
            }
            // Persist the iteration to task_steps so history survives
            // reloads — same shape the legacy vision-loop uses.
            // Snapshot + reset pendingWebSearches so the async insert
            // below sees this iteration's batch even if the next
            // iteration starts before the insert finishes.
            const webSearches = pendingWebSearches;
            pendingWebSearches = [];
            if (taskDbId) {
              void (async () => {
                try {
                  await ctx.db.insert(taskSteps).values({
                    externalId: newExternalId('taskStep'),
                    taskId: taskDbId,
                    seq: ev.iteration,
                    kind: actionKind,
                    status: 'done',
                    riskLevel: 'low',
                    input: { summary: actionSummary },
                    output: {
                      apiLatencyMs: ev.apiLatencyMs,
                      tools: ev.toolsInTurn,
                      ...(webSearches.length > 0 ? { webSearches } : {}),
                    },
                    startedAt: new Date(now - ev.apiLatencyMs),
                    completedAt: new Date(now),
                  });
                } catch (err) {
                  ctx.logger.warn(
                    { err, taskId, iteration: ev.iteration },
                    'supercar: persist step failed',
                  );
                }
              })();
            }
          },
          onScreencast(ev) {
            try {
              broadcastToUser(userId, {
                type: 'server.vision.screencast',
                taskId,
                tickIndex: ev.iteration,
                imageBase64: ev.imageBase64,
                url: ev.url,
                viewport: { width: ev.viewportWidth, height: ev.viewportHeight },
                timestamp: new Date().toISOString(),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast screencast failed');
            }
          },
          onWebSearch(ev) {
            // Broadcasts as a synthetic tick so the UI shows a step
            // card for the search. No screencast — web_search is
            // server-side and has no DOM to capture. Sources (when
            // present) are forwarded so the SearchResultCard can
            // render favicon + title + snippet rows.
            //
            // Also buffer for the next onTick so the persisted step
            // row carries the sources — this is what lets a SPA
            // refresh-after-completion rebuild webSearchByTask from
            // tasks.detail instead of needing a WS replay.
            pendingWebSearches.push({
              query: ev.query,
              sources: ev.sources ?? [],
            });
            try {
              broadcastToUser(userId, {
                type: 'server.supercar.web_search',
                taskId,
                iteration: ev.iteration,
                query: ev.query,
                ...(ev.sources && ev.sources.length > 0 ? { sources: ev.sources } : {}),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast web_search failed');
            }
          },
          async onAwaitingUser(ev) {
            try {
              broadcastToUser(userId, {
                type: 'server.supercar.awaiting_user',
                taskId,
                question: ev.question,
                // P2-A — propagate kind to the SPA so the BrowserPanel
                // doesn't have to guess. WS receivers older than this
                // build will ignore the field (zod passthrough).
                awaitingKind: ev.awaitingKind,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast awaiting_user failed');
            }
            // Codex P3 follow-up — AWAIT the status flip before the
            // agent loop suspends. Previously this was fire-and-forget
            // (`.catch()` only), so a fast tasks.reply landing within
            // the same event-loop tick could read the row before the
            // status / awaitingQuestion / awaitingKind columns were
            // committed, and fall through the "no parked supercar"
            // branch. Awaiting here closes that race; safeCall on the
            // agent side already awaits this callback's promise.
            try {
              await ctx.db
                .update(tasksTable)
                .set({
                  status: 'awaiting_user',
                  awaitingQuestion: ev.question,
                  awaitingKind: ev.awaitingKind,
                })
                .where(eq(tasksTable.externalId, taskId));
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: persist awaiting_user state failed');
            }
            // Phase 1 follow-up — stamp `executionMode='browser'`,
            // `finalUrl`, AND `finalScreenshot` into result on park.
            //
            // Why screenshot on park (not just on terminal):
            // when the user refreshes the page during a login park,
            // the WS screencast disconnects and the BrowserPanel
            // would otherwise show a blank `about:blank`. With a
            // persisted `finalScreenshot` the SPA renders the last
            // visible frame instead of empty space.
            //
            // Why executionMode here: analytics / eval pipeline lane
            // classification reads result.metadata.executionMode OR
            // result.executionMode; without this, login parks fall
            // through to lane='unknown'.
            const parkUrl = ev.currentUrl;
            void (async () => {
              try {
                // Capture a screenshot off the per-task Brave. This
                // shares the captureFinalState helper used at terminal
                // — best-effort, returns {} on any failure (no
                // executor / page closed / capture timeout).
                const captured = perUserExec
                  ? await captureFinalState(perUserExec, ctx.logger, taskId)
                  : ({} as { finalScreenshot?: string; finalUrl?: string });
                const [row] = await ctx.db
                  .select({ result: tasksTable.result })
                  .from(tasksTable)
                  .where(eq(tasksTable.externalId, taskId))
                  .limit(1);
                const prev = (row?.result ?? {}) as Record<string, unknown>;
                const next: Record<string, unknown> = {
                  ...prev,
                  executionMode: 'browser',
                };
                // Prefer the URL the agent gave us via the event;
                // fall back to whatever captureFinalState read off
                // the page if `ev.currentUrl` was undefined.
                const finalUrl = parkUrl ?? captured.finalUrl;
                if (finalUrl) next.finalUrl = finalUrl;
                if (captured.finalScreenshot) {
                  next.finalScreenshot = captured.finalScreenshot;
                }
                await ctx.db
                  .update(tasksTable)
                  .set({ result: next })
                  .where(eq(tasksTable.externalId, taskId));
              } catch (err) {
                ctx.logger.warn(
                  { err, taskId },
                  'supercar: persist park metadata failed',
                );
              }
            })();
          },
          onThinking(summary) {
            try {
              broadcastToUser(userId, {
                type: 'server.supercar.thinking',
                taskId,
                summary: truncateString(summary, 2_000),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast thinking failed');
            }
          },
          onAntiBotSignal(ev) {
            // Reuse the vision-loop captcha_detected frame shape so the
            // task-store's existing captcha-wait banner lights up
            // without any frontend changes. BrowserPanel auto-flips to
            // interactive mode (Phase 2) when this fires, so the user
            // can solve a slider captcha in-panel.
            try {
              broadcastToUser(userId, {
                type: 'server.vision.captcha_detected',
                taskId,
                antiBotType: ev.signal.type,
                message: describeSignal(ev.signal),
                waitTimeoutMs: ev.waitTimeoutMs,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast captcha_detected failed');
            }
          },
          onAntiBotResolved(ev) {
            try {
              broadcastToUser(userId, {
                type: 'server.vision.captcha_resolved',
                taskId,
                reason: ev.reason,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast captcha_resolved failed');
            }
          },
        };
      // Phase 1 Day 5 Round 2 — initialise execution pipeline for
      // the supercar/browser lane. No-op when flags are off. Light
      // tier per the original Phase 1 spec (browser → light): the
      // verifier checks data_present + URL grounding + the optional
      // url_match (only when the resolver supplied a target domain).
      // Per-step navigation evidence isn't instrumented in agent-loop
      // yet — the post-runner hook below seeds the ledger with the
      // terminal browser state + response_length, which is enough
      // for the light-tier criteria to evaluate meaningfully.
      initExecution({
        taskId,
        intent: input.intent,
        executionMode: 'browser',
        expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
        hasAttachments: attachmentBlocks.length > 0,
      });
      // Captures the verifier's verdict so the .finally() persist
      // block can serialise it after the run terminates. Stays null
      // for any path that doesn't reach the verify hook (failures,
      // handoffs to generate, runner exceptions) — those rows just
      // get contract + ledger persisted with verification=null.
      let executionVerification: VerificationResult | null = null;
      const browserStartedAt = Date.now();
      // Phase 3 R1 — outer watchdog. The agent-loop has its OWN
      // deadline (SUPERCAR_TIMEOUT_MS, default 10 min) but if the
      // loop wedges (an Anthropic fetch never resolves, a Playwright
      // command hangs, etc.) the .finally() below never fires and
      // Brave + the per-task pool slot stay allocated until the
      // process restarts. The watchdog fires `internalDeadline +
      // 30s` and force-releases Brave + clears the pool slot. Idempotent
      // with the .finally release (browser-pool.release on a
      // non-allocated slot no-ops).
      const SUPERCAR_TIMEOUT_MS = Number.parseInt(
        process.env.SUPERCAR_TIMEOUT_MS ?? '600000',
        10,
      );
      const WATCHDOG_GRACE_MS = 30_000;
      const watchdogTimer = setTimeout(() => {
        ctx.logger.warn(
          {
            taskId,
            userId: ctx.userId,
            watchdogMs: SUPERCAR_TIMEOUT_MS + WATCHDOG_GRACE_MS,
          },
          'supercar: watchdog fired — forcing brave release (agent-loop may be wedged)',
        );
        // Step 1: tell agent-loop to abort. If it's in a non-blocking
        // state (between API calls / tool steps) it'll exit cleanly
        // and the .finally below still fires the regular release.
        try {
          supercarAbort(taskId);
        } catch {
          /* swallow — abort is best-effort */
        }
        // Step 2: force-release the per-task Brave even if abort
        // didn't take. The pool's release method is idempotent: a
        // second call when the slot is already torn down no-ops.
        if (didAllocatePool && ctx.browserPool) {
          void ctx.browserPool
            .release(taskId, 'watchdog-force-release')
            .catch((relErr) => {
              ctx.logger.warn(
                { err: relErr, taskId, userId: ctx.userId },
                'pool: watchdog force-release failed',
              );
            });
        }
      }, SUPERCAR_TIMEOUT_MS + WATCHDOG_GRACE_MS);
      // Mark the timer as unref'd so it doesn't keep the Node process
      // alive on shutdown — the pool's own draining handles cleanup.
      watchdogTimer.unref?.();
      const runFn = () =>
        runSupercarWithRetry(supercarArgs, { userId, taskId, logger: ctx.logger })
          .then(async (outcome) => {
            ctx.logger.info(
              { taskId, status: outcome.status, iterations: outcome.iterations, toolsUsed: outcome.toolsUsed },
              'supercar: task terminated',
            );
            // F1 — handoff to generate. User replied with manual data
            // (numeric metrics, "数据如下:", etc.); supercar exited
            // without continuing the browser loop. Run generate against
            // the original intent + the user's data and persist THAT
            // outcome under this task id. No new task row, no quota
            // re-charge — same task, same id, just a different runner.
            if (outcome.status === 'handoff_to_generate') {
              const userManualData = outcome.question ?? '';
              const combinedIntent = [
                input.intent,
                userManualData
                  ? `\n\n[用户提供的数据]\n${userManualData}`
                  : '',
              ].join('').trim();
              ctx.logger.info(
                {
                  taskId,
                  userId,
                  manualDataLen: userManualData.length,
                  combinedIntentLen: combinedIntent.length,
                },
                'supercar: handoff to generate runner',
              );
              const handoffStartedAt = Date.now();
              let generateOutcome;
              try {
                generateOutcome = await runGenerateTask({
                  taskId,
                  userId: ctx.userId,
                  intent: combinedIntent,
                  workflowOverride: typedWorkflow,
                  skillId:
                    gatedRole !== 'none'
                      ? gatedRole
                      : input.skillId ?? undefined,
                  client: anthropicForResolver!,
                  logger: ctx.logger,
                  ...(attachmentBlocks.length > 0
                    ? { attachments: attachmentBlocks }
                    : {}),
                  onStreamDelta: (delta) => {
                    try {
                      broadcastToUser(userId, {
                        type: 'server.task.stream',
                        taskId,
                        delta,
                      });
                    } catch (err) {
                      ctx.logger.warn(
                        { err, taskId },
                        'handoff-generate: broadcast stream delta failed',
                      );
                    }
                  },
                });
              } catch (err) {
                ctx.logger.error(
                  { err, taskId },
                  'handoff-generate: runner threw',
                );
                generateOutcome = {
                  status: 'failed' as const,
                  summary: '',
                  reason:
                    err instanceof Error
                      ? err.message
                      : 'handoff-generate: unknown error',
                  inputTokens: 0,
                  outputTokens: 0,
                  durationMs: 0,
                };
              }
              const elapsedMs = Date.now() - handoffStartedAt;
              const metadata = {
                executionMode: 'browser' as const,
                finalExecutionMode: 'generate' as const,
                expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
                selectedRole: gatedRole === 'none' ? null : gatedRole,
                model: 'claude-sonnet-4-6',
                fallbackChain: ['browser', 'generate'],
                elapsedMs,
                modelFinalText:
                  generateOutcome.status === 'completed'
                    ? (generateOutcome.summary ?? '').slice(0, 200)
                    : null,
              };
              ctx.logger.info(
                {
                  taskId,
                  userId,
                  finalStatus: generateOutcome.status,
                  ...metadata,
                  failureReason:
                    generateOutcome.status === 'failed'
                      ? generateOutcome.reason
                      : null,
                },
                'task:completed',
              );
              // Optimization #2 (Codex follow-up) — format the
              // handoff-generate output. Unlike the standalone
              // generate/scrape lanes this path has no upstream
              // verifier, but the formatter's deterministic
              // post-check (no new URLs / numbers, no marker drops)
              // still applies. Flag-off → no-op.
              const handoffRl = await runResponseLayerForLane({
                taskId,
                status: generateOutcome.status,
                summary:
                  generateOutcome.status === 'completed'
                    ? generateOutcome.summary
                    : '',
                expertWorkflowId:
                  typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
                logger: ctx.logger,
              });
              if (
                generateOutcome.status === 'completed' &&
                handoffRl.summary !== generateOutcome.summary
              ) {
                generateOutcome = {
                  ...generateOutcome,
                  summary: handoffRl.summary,
                };
              }
              try {
                if (generateOutcome.status === 'completed') {
                  await repo.persistVisionOutcome(taskId, {
                    status: 'completed',
                    summary: generateOutcome.summary,
                    tickCount: outcome.iterations,
                    metadata,
                  });
                  // P1 — generate has no plan-step marker discipline
                  // (no [STEP N done] emission), so any pending /
                  // running steps left over from the supercar's
                  // browser phase would freeze at "x/N 完成" forever
                  // even though the user just got a complete answer.
                  // Roll them all to done now and broadcast so the
                  // PlanCard catches up. Best-effort: a DB blip
                  // can't block terminal broadcast.
                  void convergePlanStatusOnSuccess(ctx, taskId, userId);
                  broadcastToUser(userId, {
                    type: 'server.task.terminal',
                    taskId,
                    status: 'completed',
                    ...(generateOutcome.summary
                      ? { summary: generateOutcome.summary }
                      : {}),
                  });
                } else {
                  await repo.persistVisionOutcome(taskId, {
                    status: 'failed',
                    reason:
                      generateOutcome.reason ?? 'handoff-generate: api failed',
                    tickCount: outcome.iterations,
                    metadata,
                  });
                  broadcastToUser(userId, {
                    type: 'server.task.terminal',
                    taskId,
                    status: 'failed',
                    ...(generateOutcome.reason
                      ? { reason: generateOutcome.reason }
                      : {}),
                  });
                }
              } catch (err) {
                ctx.logger.error(
                  { err, taskId },
                  'handoff-generate: persist/broadcast failed',
                );
              }
              // Stamp metadata columns after persist. Safe to call
              // even on the failed branch (the helper no-ops when
              // metadata is undefined; metadata is only defined
              // when format() actually ran, which requires
              // status='completed' + summary).
              await stampResponseLayerColumns(
                ctx.db,
                taskId,
                handoffRl.responseLayerOriginal,
                generateOutcome.status === 'completed'
                  ? generateOutcome.summary
                  : '',
                handoffRl.responseLayerMetadata,
                ctx.logger,
              );
              return;
            }
            // R7 — grab the final-state evidence BEFORE persistSupercar
            // and pool.release. The BrowserPanel renders the static
            // screenshot for terminal tasks instead of trying to
            // reconnect the screencast WS to a torn-down Brave.
            // Skip for non-browser-mode tasks (perUserExec is null
            // when executionMode='generate' / 'scrape' — there's no
            // browser to screenshot).
            const finalState = perUserExec
              ? await captureFinalState(perUserExec, ctx.logger, taskId)
              : {};
            // B3 — structured eval log fields. Persisted under
            // result.metadata so tasks.detail consumers (Codex eval
            // pipeline) get them without a schema migration. Same
            // shape as the scrape / generate fork logs above so
            // downstream parsing is uniform.
            const elapsedMs = Date.now() - browserStartedAt;
            const metadata: Record<string, unknown> = {
              executionMode: executionMode === 'browser' ? 'browser' : executionMode,
              finalExecutionMode: executionMode === 'browser' ? 'browser' : executionMode,
              expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
              selectedRole: gatedRole === 'none' ? null : gatedRole,
              model: opusActuallyConsumed ? 'claude-opus-4-7' : 'claude-sonnet-4-6',
              fallbackChain: ['browser'],
              elapsedMs,
              iterations: outcome.iterations,
              toolsUsed: outcome.toolsUsed,
              // awaitingUserCount isn't exposed on SupercarOutcome
              // today — Codex pipeline can derive it from
              // task_events `vision.paused` rows for now. Stub at 0.
              awaitingUserCount: 0,
              modelFinalText:
                outcome.status === 'completed'
                  ? (outcome.summary ?? '').slice(0, 200)
                  : null,
              ...(finalState.finalUrl ? { finalUrl: finalState.finalUrl } : {}),
              hasFinalScreenshot: Boolean(finalState.finalScreenshot),
            };
            // Phase 3 R3 — L1 auto-save final screenshot as a
            // downloadable file. Only fires when:
            //   1. The task is in browser-mode (finalState came from
            //      captureFinalState which is null for generate/scrape)
            //   2. We actually captured a screenshot (lone "browser
            //      crashed before goto" failures leave finalScreenshot
            //      empty)
            //   3. There's a task DB id to attach to (taskDbId is set
            //      after the initial insert; falsy only on a code-path
            //      bug we'd want to log anyway)
            // Failures here log + continue — the user's task still
            // completes; they just lose the downloadable artifact.
            // The screenshot's base64 form is already inside
            // metadata.result via persistVisionOutcome, so the SPA's
            // BrowserPanel still has a frame to render.
            let screenshotAttachment: import('../../files/download-manager.js').DownloadResult | null = null;
            if (
              finalState.finalScreenshot &&
              taskDbId &&
              outcome.status !== 'cancelled' &&
              ctx.downloadManager
            ) {
              try {
                // captureFinalState pulls a JPEG (quality 80) off the
                // PlaywrightExecutor (vision-loop/playwright-executor.ts
                // L610: `page.screenshot({ type: 'jpeg', quality: 80 })`).
                // Earlier this code labeled it as PNG, so downloads ended
                // up as foo.png containing JPEG bytes — most viewers fall
                // back on sniffing, but eval pipelines + strict viewers
                // (Slack preview, some PDF embedders) refuse to render.
                screenshotAttachment = await ctx.downloadManager.save({
                  userIdInternal: userRow.id,
                  userExternalId: ctx.userId,
                  taskIdInternal: taskDbId,
                  content: finalState.finalScreenshot,
                  filename: `screenshot-${taskId}.jpg`,
                  mimetype: 'image/jpeg',
                });
                ctx.logger.info(
                  {
                    taskId,
                    fileId: screenshotAttachment.fileId,
                    sizeBytes: screenshotAttachment.sizeBytes,
                  },
                  'L1: final screenshot saved as downloadable file',
                );
                // Surface to SPA + eval-runner via result.metadata.
                // The shape mirrors what the L2 save_pdf tool will
                // produce, so consumers iterate one homogeneous list.
                const attachments = (metadata.attachments as unknown[]) ?? [];
                metadata.attachments = [
                  ...attachments,
                  {
                    fileId: screenshotAttachment.fileId,
                    downloadUrl: screenshotAttachment.downloadUrl,
                    filename: screenshotAttachment.filename,
                    mimetype: screenshotAttachment.mimetype,
                    sizeBytes: screenshotAttachment.sizeBytes,
                    expiresAt: screenshotAttachment.expiresAt.toISOString(),
                    kind: 'screenshot',
                  },
                ];
              } catch (err) {
                ctx.logger.warn(
                  { err: err instanceof Error ? err.message : String(err), taskId },
                  'L1: final screenshot save failed (non-fatal)',
                );
              }
            }
            // Codex P3 follow-up — fold any save_page_as_pdf outputs the
            // agent accumulated during the run into metadata.attachments
            // alongside the L1 screenshot. The accumulator is appended
            // (not replaced) so the screenshot block above (which
            // already wrote to metadata.attachments) stays intact.
            if (pdfAttachments.length > 0) {
              const existing = (metadata.attachments as unknown[]) ?? [];
              metadata.attachments = [...existing, ...pdfAttachments];
              ctx.logger.info(
                {
                  taskId,
                  pdfCount: pdfAttachments.length,
                  fileIds: pdfAttachments.map((a) => a.fileId),
                },
                'L2: folded save_page_as_pdf outputs into metadata.attachments',
              );
            }
            ctx.logger.info(
              {
                taskId,
                userId,
                finalStatus: outcome.status,
                ...metadata,
                failureReason:
                  outcome.status === 'failed' || outcome.status === 'timeout'
                    ? outcome.reason
                    : null,
              },
              'task:completed',
            );
            // Phase 1 follow-up — sanitise the supercar's final
            // answer before any downstream step (verification,
            // persistence, broadcast). Tool-XML scaffolding from
            // computer_20251124 traces leaks here more often than
            // in the generate / scrape lanes.
            if (outcome.status === 'completed' && outcome.summary) {
              const cleaned = sanitizeFinalText(outcome.summary);
              if (cleaned !== outcome.summary) {
                outcome = { ...outcome, summary: cleaned };
              }
            }
            // Phase 24 RC follow-up — nav-failure safety net.
            // Codex caught the "false success" case: bare-URL tasks
            // like `打开 https://thisdomaindoesnotexist12345.com`
            // would land with status=completed and a summary that's
            // just the friendly DNS error message. The agent thinks
            // it completed (it accurately reported the failure), but
            // the user's goal (open the page) was never reached, so
            // labelling the row "已完成" is misleading. detectNavFailure
            // pattern-matches a short summary against DNS / SSL /
            // timeout / refused signals; on a hit we flip the row
            // to failed BEFORE the verifier + persist run. Long
            // legitimate reports that happen to mention a nav error
            // as one bullet are not flipped (≤400 char gate).
            if (outcome.status === 'completed' && outcome.summary) {
              const navSignal = detectNavFailure(outcome.summary);
              if (navSignal.detected) {
                ctx.logger.info(
                  {
                    taskId,
                    matchedPattern: navSignal.matchedPattern,
                    kind: navSignal.kind,
                  },
                  'supercar: nav-failure detector tripped — downgrading completed → failed',
                );
                outcome = {
                  ...outcome,
                  status: 'failed',
                  reason: navSignal.reason ?? '导航失败，未完成任务',
                };
              }
            }
            // Phase 1 Day 5 Round 2 — pipeline verification on the
            // supercar/browser final answer. Mirrors the generate +
            // scrape pattern: seed terminal-state evidence into the
            // ledger, then run the verifier. autoFix can substitute
            // a fabricated URL with a grounded one BEFORE
            // persistSupercarOutcome writes the row, so the user
            // sees the corrected text on first render.
            if (outcome.status === 'completed' && outcome.summary) {
              if (finalState.finalUrl) {
                recordEvidence(taskId, {
                  fact: `final_url=${finalState.finalUrl}`,
                  sourceType: 'browser_state',
                  sourceDetail: 'supercar terminal state',
                  confidence: 'observed',
                });
              }
              recordEvidence(taskId, {
                fact: `response_length=${outcome.summary.length}`,
                sourceType: 'tool_result',
                sourceDetail: 'supercar agent response',
                confidence: 'observed',
              });
              const verified: VerifyOutput = await verifyAndFinalize({
                taskId,
                answerText: outcome.summary,
                ...(finalState.finalUrl ? { finalUrl: finalState.finalUrl } : {}),
                client: anthropicForResolver,
                logger: ctx.logger,
              });
              if (verified.finalText !== outcome.summary) {
                outcome = { ...outcome, summary: verified.finalText };
              }
              executionVerification = verified.verification;
            }
            // Optimization #2 — OpenAI response formatter / style
            // layer. Runs AFTER the verifier (so we polish facts that
            // have already been grounded) and BEFORE persistence. The
            // shouldFormat guard short-circuits on short response
            // (unless expert workflow); the deterministic post-check
            // refuses any rewrite that introduces new URLs / numbers
            // or drops a marker. On fallback the formatted text equals
            // the original — caller sees no visible change, the
            // metadata records the reason.
            //
            // Codex P2 follow-up — the flag check is hoisted to the
            // CALLER so flag-off → zero DB writes (original_summary /
            // formatted_summary / response_layer_metadata stay NULL).
            // Without this gate, the always-flow wrote an audit row
            // for every terminal task even when no user had opted in.
            let responseLayerOriginal: string | undefined;
            let responseLayerMetadata: unknown = undefined;
            const isTerminal =
              outcome.status === 'completed' ||
              outcome.status === 'failed' ||
              outcome.status === 'cancelled';
            // Inline flag gate — kept in sync with
            // openai-response-layer.ts `isResponseLayerEnabled`. Inline
            // (vs. import + call) so the common flag-off path avoids
            // loading the response-layer module + its `openai` dep at
            // every terminal.
            const responseLayerFlag = (
              process.env.OPENAI_RESPONSE_LAYER_ENABLED ?? 'false'
            ).toLowerCase();
            const responseLayerActive =
              (responseLayerFlag === 'true' || responseLayerFlag === '1') &&
              !!process.env.OPENAI_API_KEY;
            if (isTerminal && outcome.summary && responseLayerActive) {
              try {
                const { format: formatResponse } = await import(
                  '../../response-layer/openai-response-layer.js'
                );
                const fmt = await formatResponse(
                  {
                    original: outcome.summary,
                    terminalStatus: outcome.status as
                      | 'completed'
                      | 'failed'
                      | 'cancelled',
                    expertWorkflowId:
                      typeof metadata?.expertWorkflowId === 'string'
                        ? metadata.expertWorkflowId
                        : undefined,
                  },
                  { logger: ctx.logger },
                );
                if (fmt.formatted !== outcome.summary) {
                  responseLayerOriginal = outcome.summary;
                  outcome = { ...outcome, summary: fmt.formatted };
                }
                responseLayerMetadata = fmt.metadata;
              } catch (err) {
                // Belt-and-braces — format() already catches its own
                // errors; a throw here would be a programming bug.
                ctx.logger.warn(
                  { err: err instanceof Error ? err.message : String(err), taskId },
                  'openai-response-layer: unexpected throw — keeping original',
                );
              }
            }
            const { persisted: terminalPersisted } = await persistSupercarOutcome(
              repo,
              taskId,
              outcome,
              finalState,
              metadata,
            );
            // Optimization #2 — stamp the formatter columns. Best-
            // effort UPDATE after the row landed; failure here logs
            // but doesn't tear down the terminal flow. Only writes
            // when we actually have something to record (formatter
            // ran, even if it fell back).
            if (terminalPersisted && responseLayerMetadata) {
              try {
                await ctx.db
                  .update(tasksTable)
                  .set({
                    originalSummary:
                      responseLayerOriginal ?? outcome.summary ?? null,
                    formattedSummary: outcome.summary ?? null,
                    responseLayerMetadata: responseLayerMetadata as Record<
                      string,
                      unknown
                    >,
                  })
                  .where(eq(tasksTable.externalId, taskId));
              } catch (err) {
                ctx.logger.warn(
                  { err: err instanceof Error ? err.message : String(err), taskId },
                  'openai-response-layer: persist metadata failed (non-fatal)',
                );
              }
            }
            // Reconcile-driven step rewrite. When the agent loop's
            // reconcileFinalAnswer rewrote the model's text (URL or
            // title mismatched the live page), the LAST step row's
            // `input.summary` and the matching `tick.end` actionSummary
            // are now stale. The "最近操作" overlay reads from steps,
            // not summary, so without this rewrite the user opens the
            // overlay and still sees the wrong URL the model invented.
            // Best-effort: a DB / broadcast blip leaves the row stale
            // but doesn't impact terminal flow.
            if (outcome.reconciledStepUpdate && taskDbId) {
              const upd = outcome.reconciledStepUpdate;
              try {
                await ctx.db
                  .update(taskSteps)
                  .set({ input: { summary: upd.actionSummary } })
                  .where(
                    and(
                      eq(taskSteps.taskId, taskDbId),
                      eq(taskSteps.seq, upd.tickIndex),
                    ),
                  );
              } catch (err) {
                ctx.logger.warn(
                  { err, taskId, tickIndex: upd.tickIndex },
                  'supercar: persist reconciled step failed',
                );
              }
              try {
                broadcastToUser(userId, {
                  type: 'server.vision.tick.end',
                  taskId,
                  tickIndex: upd.tickIndex,
                  mode: 'screenshot',
                  actionKind: 'text',
                  actionSummary: upd.actionSummary,
                  durationMs: 0,
                  ok: true,
                });
              } catch (err) {
                ctx.logger.warn(
                  { err, taskId, tickIndex: upd.tickIndex },
                  'supercar: broadcast reconciled step failed',
                );
              }
            }
            // Codex P3 follow-up — gate terminal-only side effects on
            // `terminalPersisted`. When the atomic state-machine guard
            // refused the UPDATE (row still in awaiting_user — happens
            // when a takeover-timeout fires AFTER the user already
            // came back and replied), the WS terminal frame would
            // clobber the in-progress state in the SPA store, memory
            // extraction would store a half-finished summary, and a
            // stale suggestion bubble would surface alongside the
            // running task. Skip all three when the row didn't move.
            if (!terminalPersisted) {
              ctx.logger.info(
                { taskId },
                'supercar: terminal persist refused by state guard — skipping broadcast / memory / suggestions',
              );
            }
            if (terminalPersisted) {
              try {
                broadcastToUser(userId, buildTaskTerminalMessage(taskId, outcome));
              } catch (err) {
                ctx.logger.warn({ err, taskId }, 'supercar: broadcast terminal failed');
              }
            }
            // Phase 13 Dim 5 — memory extraction. Run only on
            // completed tasks to avoid storing tips from the
            // partial / failed state of the agent. Best-effort:
            // rejections log + continue (the user's task is done
            // regardless of memory outcome).
            if (terminalPersisted && outcome.status === 'completed' && outcome.summary && appEnv.ANTHROPIC_API_KEY) {
              void memoryService
                .extractAndStore({
                  apiKey: appEnv.ANTHROPIC_API_KEY,
                  userIdInternal: userRow.id,
                  intent: input.intent,
                  summary: outcome.summary,
                  taskId,
                })
                .catch((err) =>
                  ctx.logger.warn({ err, taskId }, 'memory: extract crashed'),
                );

              // O5 — backend-generated suggestions. The agent's
              // in-summary `suggestions` block is unreliable
              // (model omits it under some prompts); a dedicated
              // Sonnet call is more consistent. Fire-and-forget so
              // the user gets the terminal frame immediately and
              // suggestions trickle in a second later.
              void generateSuggestions({
                apiKey: appEnv.ANTHROPIC_API_KEY,
                intent: input.intent,
                summary: outcome.summary,
              })
                .then((suggestions) => {
                  if (suggestions.length === 0) return;
                  try {
                    broadcastToUser(userId, {
                      type: 'server.supercar.suggestions',
                      taskId,
                      suggestions,
                    });
                  } catch (err) {
                    ctx.logger.warn(
                      { err, taskId },
                      'suggestions: broadcast failed',
                    );
                  }
                })
                .catch((err) =>
                  ctx.logger.warn({ err, taskId }, 'suggestions: generate crashed'),
                );
            }
          })
          .catch(async (err) => {
            // Phase 22a — uncaught throws used to leave the task at
            // status='executing' forever (the .then chain didn't run,
            // so persistSupercarOutcome was never called). Persist a
            // failed outcome here BEFORE logging so the task always
            // reaches a terminal state. Wrapped in its own try so a
            // DB blip during the recovery persist doesn't bubble up
            // and tear down the .finally below.
            const reason = err instanceof Error ? err.message : String(err);
            ctx.logger.error(
              { err, taskId },
              'supercar: loop threw — persisting failed',
            );
            // Codex P3 follow-up — same `persisted` gate as the happy
            // path. If the runner threw AFTER the row landed in
            // awaiting_user (rare but possible: runtime stack unwind
            // after the agent fired onAwaitingUser), don't broadcast
            // terminal-failed and clobber the park state.
            let catchPersisted = false;
            try {
              const out = await repo.persistVisionOutcome(taskId, {
                status: 'failed',
                reason: `runner threw: ${reason}`.slice(0, 500),
                tickCount: 0,
              });
              catchPersisted = out.persisted;
            } catch (persistErr) {
              ctx.logger.error(
                { err: persistErr, taskId },
                'supercar: catch-block persist also failed',
              );
            }
            if (catchPersisted) {
              try {
                broadcastToUser(userId, {
                  type: 'server.task.terminal',
                  taskId,
                  status: 'failed',
                  reason: `runner threw: ${reason}`.slice(0, 200),
                });
              } catch {
                /* swallow — broadcast is best-effort */
              }
            }
          })
          .finally(() => {
            // Phase 3 R1 — clear the watchdog now that the runner
            // settled normally. If it already fired, clearTimeout is
            // a no-op and the watchdog's release call has already
            // happened (idempotent with the regular release below).
            clearTimeout(watchdogTimer);
            // Phase 24 — release the per-task Brave immediately on
            // completion. One task = one Brave; no shared instance,
            // no refcount. The per-user concurrency limit is enforced
            // upstream at admit time via getActiveTaskCount.
            if (didAllocatePool && ctx.browserPool) {
              void ctx.browserPool
                .release(taskId, `task-${taskId}-done`)
                .catch((relErr) => {
                  ctx.logger.warn(
                    { err: relErr, taskId, userId: ctx.userId },
                    'pool: post-task release failed',
                  );
                });
            }
            // Phase 24 RC follow-up — wake the TaskQueue worker so
            // the next queued task fires immediately instead of
            // waiting for the next 5s tick. Safe even when no queue
            // is wired (the optional-chain shorts).
            ctx.taskQueue?.signalSlotFreed();
            // Phase 1 Day 5 Round 2 — fire-and-forget pipeline
            // persist + cleanup. Same pattern as the generate +
            // scrape lanes. Always runs (then OR catch path), so
            // even a runner exception still serialises the contract
            // + ledger that were inited at task start.
            void persistExecution({
              taskId,
              verification: executionVerification,
              db: ctx.db,
              logger: ctx.logger,
            }).finally(() => disposeExecution(taskId));
          });

      // Phase 24 — fire the runFn directly (pre-queue path). Per-task
      // isolation removes the need for serialisation — each task gets
      // its own Brave, can run in parallel up to the user's plan-
      // derived concurrency limit (already gated at admit time via
      // getActiveTaskCount).
      await runFn();
      };
      // ↑ end of dispatchToBrave wrap

      // Phase 24 RC follow-up — global pool-capacity-aware queue.
      // Without this, a 30-task burst overruns the 10-slot pool;
      // pool.allocate throws PoolCapacityError, the catch falls
      // through to a shared singleton, and every overflow task races
      // the same Brave on `initial screenshot failed`. The queue
      // holds overflow in 'queued' status until pool capacity frees,
      // then dispatches FIFO.
      if (willQueueDispatch && ctx.taskQueue) {
        const enqueueResult = ctx.taskQueue.enqueue({
          taskId,
          userId: ctx.userId,
          runFn: dispatchToBrave,
          onStart: async (): Promise<void> => {
            try {
              await ctx.db
                .update(tasksTable)
                .set({ status: 'executing', startedAt: new Date() })
                .where(eq(tasksTable.externalId, taskId));
              // No queued→executing WS frame — supercar's own
              // `server.task.plan` / step events fire next from the
              // dispatched runFn, and the SPA's task store reads the
              // fresh row on its existing tRPC poll. Avoid adding a
              // new message type for a transition that's already
              // observable via the next event.
            } catch (err) {
              ctx.logger.warn(
                { err: err instanceof Error ? err.message : String(err), taskId },
                'task-queue: onStart DB update failed',
              );
            }
          },
          onTimeout: async (): Promise<void> => {
            ctx.logger.warn(
              { taskId, userId: ctx.userId },
              'task-queue: queue timeout — marking failed',
            );
            try {
              await ctx.db
                .update(tasksTable)
                .set({
                  status: 'failed',
                  errorMessage: 'queue timeout: 排队等待时间过长，请稍后重试',
                  completedAt: new Date(),
                })
                .where(eq(tasksTable.externalId, taskId));
              broadcastToUser(ctx.userId, {
                type: 'server.task.terminal',
                taskId,
                status: 'failed',
                reason: 'queue timeout',
              });
            } catch (err) {
              ctx.logger.warn(
                { err: err instanceof Error ? err.message : String(err), taskId },
                'task-queue: onTimeout persist failed',
              );
            }
          },
        });
        if (enqueueResult.kind === 'rejected') {
          ctx.logger.warn(
            { taskId, userId: ctx.userId, reason: enqueueResult.reason },
            'task-queue: enqueue rejected (queue at depth cap)',
          );
          try {
            await ctx.db
              .update(tasksTable)
              .set({
                status: 'failed',
                errorMessage: enqueueResult.reason,
                completedAt: new Date(),
              })
              .where(eq(tasksTable.externalId, taskId));
          } catch (err) {
            ctx.logger.warn(
              { err: err instanceof Error ? err.message : String(err), taskId },
              'task-queue: rejection-row update failed',
            );
          }
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: enqueueResult.reason,
          });
        }
        ctx.logger.info(
          {
            taskId,
            userId: ctx.userId,
            kind: enqueueResult.kind,
            position: enqueueResult.position,
            queueSize: ctx.taskQueue.size(),
          },
          'task-queue: task enqueued',
        );
        const statusOut = enqueueResult.kind === 'dispatched' ? 'executing' : 'queued';
        return {
          taskId,
          status: statusOut as 'executing' | 'queued',
          steps: [],
          executionMode: 'browser' as const,
        };
      }

      // Legacy / non-pool path — fire directly without queue gating.
      void dispatchToBrave();

      return {
        taskId,
        status: 'executing' as const,
        steps: [],
        executionMode: 'browser' as const,
      };
    }

    // Vision-loop path — the new control plane. Claude looks at each
    // tick's screenshot and picks one action at a time; there is no
    // pre-generated plan, no ResilientSelector, no Skill matching.
    // Activates when the env flag is off AND a vision commander is
    // wired at boot (needs ANTHROPIC_API_KEY). Falls through to the
    // legacy plan-once path otherwise.
    if (ctx.visionCommander) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);
      // Seed task row with status='executing' and empty plan — the
      // vision loop has no pre-planned steps; task_steps rows get
      // written as the loop progresses (Phase B: per-tick row; Phase
      // A: single synthetic row reflecting terminal outcome).
      await repo.insertTask(
        {
          taskId,
          status: 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        {
          userId: userRow.id,
          intent: input.intent,
          roleId: gatedRole === 'none' ? null : gatedRole,
          opusUsed: opusActuallyConsumed,
        },
      );
      // Start the loop asynchronously. We return to the popup
      // immediately with the taskId; the loop proceeds in the
      // background, driven by WS round-trips to the connected SW.
      // Outcome persistence is best-effort: we log failures instead
      // of surfacing them to the caller (they already got the taskId
      // and can poll tasks.detail).
      // F3: serialise per-user through the vision-loop task queue.
      // Multiple Run clicks for the same user (popup glitch / user
      // queueing intentional follow-ups) FIFO onto a single
      // Playwright Page — no racing clicks. Different users don't
      // block each other.
      // Bug 1 — URL resolver. Turn colloquial references ("openclaw")
      // into authoritative URLs before the commander starts guessing.
      // One Claude call per task create; null on vague intents (safe
      // fall-through to the commander's search-first prompt).
      const resolved = await resolveIntentUrl(input.intent, {
        client: anthropicForResolver,
      });
      const enrichedIntent = resolved
        ? injectResolvedUrl(input.intent, resolved)
        : input.intent;
      if (resolved && resolved.source === 'model') {
        ctx.logger.info(
          { taskId, token: resolved.token, url: resolved.url },
          'urlResolve: injected resolved URL into intent',
        );
      }

      // Per-task domain specialisation. Classifier is keyword-only
      // (no LLM call), safe to run on every create. If the commander
      // supports per-task specialisation, clone it with the classified
      // domain; otherwise fall back to the generic singleton.
      const classification = classifyDomain(enrichedIntent);
      const commander = ctx.visionCommander.withDomain
        ? ctx.visionCommander.withDomain(classification.domain)
        : ctx.visionCommander;
      ctx.logger.info(
        {
          taskId,
          domain: classification.domain,
          confidence: classification.confidence,
          matched: classification.matched,
        },
        'vision-loop domain classification',
      );
      const userId = ctx.userId;
      // Resolve the tasks.id once — every onTickEnd needs it to insert
      // the task_steps row. Avoids a DB lookup on every tick.
      const [taskDbRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(eq(tasksTable.externalId, taskId))
        .limit(1);
      const taskDbId = taskDbRow?.id;
      const runTaskFn = () =>
        startVisionLoopTask({
          userId: ctx.userId,
          taskId,
          // Pass the URL-enriched intent to the vision loop. The
          // *displayed* intent (saved to the tasks row above + shown
          // in the UI's user bubble) stays the user's original text.
          intent: enrichedIntent,
          commander,
          // Phase D Step 3: when PlaywrightExecutor is wired at boot,
          // the runner bypasses the WS/SW path and drives Chrome
          // directly via CDP. Falls through to the legacy WS transport
          // automatically when absent.
          ...(ctx.playwrightExecutor ? { playwrightExecutor: ctx.playwrightExecutor } : {}),
          // G4: stream per-tick progress to the web workbench. Best-
          // effort — a broadcast throw is swallowed so loop progress
          // is never gated on the UI being online.
          onTickStart(info) {
            try {
              broadcastToUser(userId, {
                type: 'server.vision.tick.start',
                taskId,
                tickIndex: info.tickIndex,
                mode: info.mode,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId, tickIndex: info.tickIndex }, 'broadcast tick.start failed');
            }
          },
          onTickEnd(info) {
            // Bug 4 — persist every tick as a task_steps row so task
            // history survives page reloads + clicking back into old
            // tasks. Fire-and-forget: DB failure logs but must not
            // stall the loop.
            if (taskDbId) {
              void (async () => {
                try {
                  await ctx.db
                    .insert(taskSteps)
                    .values({
                      externalId: newExternalId('taskStep'),
                      taskId: taskDbId,
                      seq: info.tickIndex,
                      kind: info.actionKind,
                      status: info.ok ? 'done' : 'failed',
                      riskLevel: 'low',
                      input: { summary: info.actionSummary },
                      output: {
                        durationMs: info.durationMs,
                        mode: info.mode,
                        ...(info.message ? { message: info.message } : {}),
                        ...(info.antiBot ? { antiBot: info.antiBot } : {}),
                      },
                      ...(info.ok ? {} : { errorMessage: (info.message ?? '').slice(0, 2000) }),
                      startedAt: new Date(Date.now() - info.durationMs),
                      completedAt: new Date(),
                    });
                } catch (err) {
                  ctx.logger.warn(
                    { err, taskId, tickIndex: info.tickIndex },
                    'persist step row failed',
                  );
                }
              })();
            }
            try {
              broadcastToUser(userId, {
                type: 'server.vision.tick.end',
                taskId,
                tickIndex: info.tickIndex,
                mode: info.mode,
                actionKind: info.actionKind,
                actionSummary: info.actionSummary,
                durationMs: info.durationMs,
                ok: info.ok,
                ...(info.message ? { message: info.message } : {}),
                ...(info.antiBot
                  ? {
                      // Flatten the server-side signal into the
                      // WS-facing shape: the UI wants a human-readable
                      // Chinese tag + the raw match concatenated, and
                      // never sees rawMatch as a separate field.
                      antiBot: {
                        type: info.antiBot.type,
                        confidence: info.antiBot.confidence,
                        message: `${describeSignal(info.antiBot)}（匹配：${info.antiBot.rawMatch}）`,
                      },
                    }
                  : {}),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId, tickIndex: info.tickIndex }, 'broadcast tick.end failed');
            }
          },
          onScreencast(info) {
            try {
              broadcastToUser(userId, {
                type: 'server.vision.screencast',
                taskId,
                tickIndex: info.tickIndex,
                imageBase64: info.imageBase64,
                url: info.url,
                viewport: { width: info.viewportWidth, height: info.viewportHeight },
                timestamp: new Date().toISOString(),
              });
            } catch (err) {
              ctx.logger.warn(
                { err, taskId, tickIndex: info.tickIndex },
                'broadcast screencast failed',
              );
            }
          },
          onCaptchaDetected(info) {
            ctx.logger.info(
              { taskId, antiBotType: info.antiBotType, waitTimeoutMs: info.waitTimeoutMs },
              'vision loop paused on captcha signal',
            );
            try {
              broadcastToUser(userId, {
                type: 'server.vision.captcha_detected',
                taskId,
                antiBotType: info.antiBotType,
                message: info.message,
                waitTimeoutMs: info.waitTimeoutMs,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast captcha_detected failed');
            }
          },
          onCaptchaResolved(info) {
            ctx.logger.info({ taskId, reason: info.reason }, 'vision loop captcha wait ended');
            try {
              broadcastToUser(userId, {
                type: 'server.vision.captcha_resolved',
                taskId,
                reason: info.reason,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast captcha_resolved failed');
            }
          },
          onDegrade(info) {
            ctx.logger.info(
              { taskId, level: info.level, strategy: info.strategy, ok: info.ok },
              'degradation tier attempted',
            );
            try {
              broadcastToUser(userId, {
                type: 'server.vision.degrade',
                taskId,
                level: info.level,
                strategy: info.strategy,
                ok: info.ok,
                message: info.message,
                ...(info.handoffToExtension ? { handoffToExtension: true } : {}),
                ...(info.nextUrl ? { nextUrl: info.nextUrl } : {}),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast degrade failed');
            }
          },
          onExecutorFallback(info) {
            ctx.logger.info(
              { taskId, reason: info.reason, available: info.available },
              'vision loop executor fallback triggered',
            );
            try {
              broadcastToUser(userId, {
                type: 'server.vision.executor_fallback',
                taskId,
                reason: info.reason,
                available: info.available,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast executor_fallback failed');
            }
          },
        })
          .then(async (outcome) => {
            ctx.logger.info(
              {
                taskId,
                status: outcome.status,
                tickCount: outcome.history.length,
              },
              'vision loop terminated',
            );
            try {
              if (outcome.status === 'completed') {
                await repo.persistVisionOutcome(taskId, {
                  status: 'completed',
                  summary: outcome.summary,
                  tickCount: outcome.history.length,
                });
              } else if (outcome.status === 'failed') {
                await repo.persistVisionOutcome(taskId, {
                  status: 'failed',
                  reason: outcome.reason,
                  tickCount: outcome.history.length,
                });
              } else if (outcome.status === 'paused') {
                await repo.persistVisionOutcome(taskId, {
                  status: 'paused',
                  reason: outcome.reason,
                  tickCount: outcome.history.length,
                });
              } else {
                await repo.persistVisionOutcome(taskId, {
                  status: 'cancelled',
                  tickCount: outcome.history.length,
                });
              }
            } catch (err) {
              ctx.logger.error({ err, taskId }, 'persistVisionOutcome failed');
            }
            // Push the terminal state to any connected SW for the user
            // so the popup can update its card without polling. Fire-
            // and-forget — broadcastToUser skips cleanly if no client
            // is connected (task ended while popup/SW was offline;
            // the popup will pick up the DB row on its next mount).
            try {
              broadcastToUser(ctx.userId, {
                type: 'server.task.terminal',
                taskId,
                status: outcome.status,
                ...(outcome.status === 'completed' ? { summary: outcome.summary } : {}),
                ...(outcome.status === 'failed' || outcome.status === 'paused'
                  ? { reason: outcome.reason }
                  : {}),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast task.terminal failed');
            }
          })
          .catch(async (err) => {
            // Phase 22a — same fix as the supercar branch: persist a
            // failed terminal state when the runner throws so the task
            // doesn't sit at 'executing' forever. Independent try so a
            // DB blip during recovery doesn't propagate.
            const reason = err instanceof Error ? err.message : String(err);
            ctx.logger.error(
              { err, taskId },
              'vision loop threw — persisting failed',
            );
            try {
              await repo.persistVisionOutcome(taskId, {
                status: 'failed',
                reason: `vision loop threw: ${reason}`.slice(0, 500),
                tickCount: 0,
              });
            } catch (persistErr) {
              ctx.logger.error(
                { err: persistErr, taskId },
                'vision loop: catch-block persist also failed',
              );
            }
          });

      // Phase 24 — fire directly (no per-user FIFO queue). Per-task
      // isolation removes the need for serialisation; per-user
      // concurrency is gated upstream at admit time.
      void runTaskFn();
      return {
        taskId,
        status: 'executing' as const,
        steps: [],
      };
    }

    const catalogue = await loadSkillCatalogue(ctx.db, input.occupation ?? null);

    let plan: Awaited<ReturnType<typeof ctx.planner.plan>>;
    try {
      plan = await ctx.planner.plan({
        intent: input.intent,
        userId: ctx.userId,
        occupation: input.occupation ?? null,
        skills: catalogue,
      });
    } catch (err) {
      // Upstream planner failures (Anthropic 4xx/5xx, network) are NOT our
      // internal bug — surface them as 502 BAD_GATEWAY with the original
      // message so the popup can show "Anthropic: 403 forbidden" instead
      // of an opaque 500. Full stack is logged for the operator.
      ctx.logger.error(
        { err, userId: ctx.userId, intent: input.intent.slice(0, 200) },
        'planner upstream error',
      );
      const message = err instanceof Error ? err.message : String(err);
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `planner upstream error: ${message}`,
        cause: err,
      });
    }
    if (plan.length === 0) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'planner returned empty plan',
      });
    }

    // Origin allowlist: identify which Skills in the catalogue the
    // generated plan actually reaches (i.e. any Skill whose
    // allowedOrigins covers ≥1 goto URL in the plan). Union the
    // allowedOrigins of just those. When the plan uses NO Skill (free-
    // form intent the commander answered without adopting a Skill — e.g.
    // "在 Bing 搜一下 XXX"), `usedSkills` is empty, `allowedOrigins`
    // comes back `[]`, and the driver treats that as unrestricted.
    //
    // Earlier bug: we used to union allowedOrigins across the ENTIRE
    // active catalogue. That meant a free-form plan emitted bing.com
    // but the union was { douyin.com, xueqiu.com, ... } and the driver
    // refused bing.com as ORIGIN_BLOCKED. The catalogue is a menu, not
    // a restraining order — only Skills the plan actually uses should
    // constrain what the driver is allowed to visit.
    const usedSkills = pickSkillsUsedByPlan(plan, catalogue);
    const allowedOrigins = unionAllowedOrigins(usedSkills);

    const taskId = newExternalId('task');
    const { state, effects } = taskController.start({
      state: {
        taskId,
        status: 'planning',
        plan,
        cursor: 0,
        pendingConfirm: null,
        ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
      },
    });

    const repo = new TaskRepository(ctx.db);
    await repo.insertTask(state, {
      userId: userRow.id,
      intent: input.intent,
      roleId: gatedRole === 'none' ? null : gatedRole,
      opusUsed: opusActuallyConsumed,
    });

    // Drive the first dispatch out to any connected WS clients.
    // Without this the task sits in `executing` in the DB but the
    // extension never receives `server.task.dispatch` and the Agent
    // Loop never starts. Symmetric with pause/resume/confirm below.
    updateTaskStateForUser(ctx.userId, state);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }

    return {
      taskId: state.taskId,
      status: state.status,
      steps: state.plan.map((s) => ({
        id: s.id,
        kind: s.kind,
        risk: s.risk,
        requiresConfirm: s.requiresConfirm ?? false,
      })),
    };
  }),

  /**
   * Diagnostic end-to-end: run a hardcoded Baidu search plan against
   * the real browser driver. No Anthropic call, no Skill catalogue,
   * no user intent — the plan is static, the selectors are known
   * stable (#kw, #su). Use this to confirm the SW ↔ orchestrator ↔
   * adapter loop is healthy when planner-generated plans are
   * failing on selector mismatch.
   */
  smokeTest: protectedProcedure.mutation(async ({ ctx }) => {
    const [userRow] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!userRow) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }

    const plan = buildBaiduSmokePlan();
    const taskId = newExternalId('task');
    // Smoke drives Baidu only; pinning the allowlist here also serves
    // as a live test that the end-to-end wiring (dispatch → SW →
    // driver) actually enforces the list.
    const smokeAllowedOrigins = ['*.baidu.com'] as const;
    const { state, effects } = taskController.start({
      state: {
        taskId,
        status: 'planning',
        plan,
        cursor: 0,
        pendingConfirm: null,
        allowedOrigins: smokeAllowedOrigins,
      },
    });

    const repo = new TaskRepository(ctx.db);
    await repo.insertTask(state, {
      userId: userRow.id,
      intent: '[smoke] Baidu search for "半导体" — diagnostic, not Opus-planned',
    });

    updateTaskStateForUser(ctx.userId, state);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }

    return {
      taskId: state.taskId,
      status: state.status,
      steps: state.plan.map((s) => ({
        id: s.id,
        kind: s.kind,
        risk: s.risk,
        requiresConfirm: s.requiresConfirm ?? false,
      })),
    };
  }),

  pause: protectedProcedure.input(taskIdInput).mutation(async ({ ctx, input }) => {
    const repo = new TaskRepository(ctx.db);
    const prev = await loadTaskState(repo, input.taskId, ctx.userId);

    const { state: next, effects } = taskController.pause(prev, 'user');
    if (next === prev) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `cannot pause from status=${prev.status}`,
      });
    }

    await repo.applyControlTransition(prev, next);
    updateTaskStateForUser(ctx.userId, next);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }
    return { taskId: next.taskId, status: next.status, pauseReason: next.pauseReason ?? null };
  }),

  resume: protectedProcedure.input(taskIdInput).mutation(async ({ ctx, input }) => {
    const repo = new TaskRepository(ctx.db);
    const prev = await loadTaskState(repo, input.taskId, ctx.userId);

    const { state: next, effects } = taskController.resume(prev);
    if (next === prev) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `cannot resume from status=${prev.status}`,
      });
    }

    await repo.applyControlTransition(prev, next);
    updateTaskStateForUser(ctx.userId, next);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }
    return { taskId: next.taskId, status: next.status };
  }),

  confirm: protectedProcedure
    .input(
      z
        .object({
          taskId: z.string().min(1),
          // New decision enum (approve / skip / reject) — maps to the
          // single-confirm and batch-confirm paths on the controller.
          decision: z.enum(['approve', 'skip', 'reject']).optional(),
          // Back-compat: popup v0 sent `approve: boolean`. Translate it
          // to the decision enum when present and no explicit decision.
          approve: z.boolean().optional(),
        })
        .refine((v) => v.decision !== undefined || v.approve !== undefined, {
          message: 'one of decision or approve must be provided',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const repo = new TaskRepository(ctx.db);
      const prev = await loadTaskState(repo, input.taskId, ctx.userId);
      if (prev.status !== 'awaiting_user') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `cannot confirm from status=${prev.status}`,
        });
      }

      const decision: 'approve' | 'skip' | 'reject' =
        input.decision ?? (input.approve ? 'approve' : 'reject');

      const { state: next, effects } = taskController.userConfirm(prev, decision);

      // Pick the repo method by the shape of the transition.
      //   reject                → control transition (cancelled)
      //   batch + approve       → batch-approve (cursor unchanged, clear
      //                           pending blob, NOT a step completion)
      //   otherwise (skip,
      //   single approve)       → step-result (cursor advances, step row
      //                           marked completed)
      const batchApprove = prev.pendingConfirm?.kind === 'batch' && decision === 'approve';
      if (next.status === 'cancelled') {
        await repo.applyControlTransition(prev, next);
      } else if (batchApprove) {
        await repo.applyBatchApprove(prev, next);
      } else {
        await repo.applyStepResult(prev, next, { confirmed: true, decision });
      }
      updateTaskStateForUser(ctx.userId, next);
      for (const eff of effects) {
        if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
      }
      return { taskId: next.taskId, status: next.status };
    }),

  /**
   * Task history, scoped to the caller. DESC-id cursor pagination so
   * the popup's "history" section can lazy-load more rows as the user
   * scrolls without re-fetching the head. Shape mirrors
   * `llmCalls.list` (commit 52ef5fa) so the popup can use one cursor
   * idiom across both lists.
   *
   * Intentionally omits the full step plan / output blobs — those
   * come from `tasks.detail(taskId)` when a row is expanded. Keeps
   * the list payload small even when a user has hundreds of tasks.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          cursor: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(20),
          /**
           * Phase 16b — when set, only return tasks linked to this
           * project. The id is the external prj_… form; we translate
           * to the bigint id once before the WHERE clause.
           */
          projectId: z.string().min(1).optional(),
          /**
           * Spec A — server-side filters. SearchOverlay / HistoryPage /
           * StarredPage / project filter all funnel through this list
           * endpoint instead of filtering the in-memory first-50 slice
           * client-side. Combined with AND; cursor pagination still
           * uses `lt(id, cursor)` so existing infinite-scroll wiring
           * keeps working.
           *
           * `query` matches `intent OR title` with LIKE — the columns
           * use a `_ci` collation in MySQL so LIKE is case-insensitive.
           * `status` is constrained to the canonical UI enum.
           * `starred=true` switches ORDER BY to `starredAt DESC` so the
           * Starred page reads in last-starred order.
           */
          query: z.string().min(1).max(200).optional(),
          // Accepts either one status or a small set — `HistoryPage`'s
          // "进行中" chip OR's together five non-terminal statuses, so
          // a flat enum can't express that filter without round-tripping
          // five separate calls. Single values stay terse on the wire
          // (`status: 'failed'`); arrays encode the bundle.
          status: z
            .union([
              z.enum([
                'pending',
                'planning',
                'queued',
                'executing',
                'awaiting_user',
                'paused',
                'completed',
                'failed',
                'cancelled',
              ]),
              z
                .array(
                  z.enum([
                    'pending',
                    'planning',
                    'queued',
                    'executing',
                    'awaiting_user',
                    'paused',
                    'completed',
                    'failed',
                    'cancelled',
                  ]),
                )
                .min(1)
                .max(9),
            ])
            .optional(),
          starred: z.boolean().optional(),
          dateFrom: z.coerce.date().optional(),
          dateTo: z.coerce.date().optional(),
        })
        .default({ limit: 20 }),
    )
    .query(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const conds = [eq(tasksTable.userId, userRow.id)];
      // Cursor is an opaque numeric token whose interpretation matches
      // the active ORDER BY. In starred mode we order by `starredAt
      // DESC` and treat the cursor as a unix-ms timestamp; otherwise
      // we order by `id DESC` and the cursor is a row id. The frontend
      // just hands `nextCursor` back unchanged, so the contract stays
      // single-field.
      if (input.cursor) {
        conds.push(
          input.starred
            ? lt(tasksTable.starredAt, new Date(input.cursor))
            : lt(tasksTable.id, input.cursor),
        );
      }
      if (input.projectId) {
        const [projRow] = await ctx.db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.externalId, input.projectId),
              eq(projects.userId, userRow.id),
            ),
          )
          .limit(1);
        if (!projRow) {
          // Unknown project for this user → return empty rather
          // than 404 so the SPA renders an empty state.
          return { tasks: [], nextCursor: null };
        }
        conds.push(eq(tasksTable.projectId, projRow.id));
      }
      if (input.query) {
        // Wrap in % — caller passes a bare substring. Drizzle's `like`
        // doesn't auto-escape SQL `%` / `_` wildcards in user input,
        // but the worst case is a slightly-broader match (a query of
        // "5%" would also match "5y" / "5x"). Fine for a search box.
        const needle = `%${input.query}%`;
        const matchIntent = like(tasksTable.intent, needle);
        const matchTitle = like(tasksTable.title, needle);
        const queryCond = or(matchIntent, matchTitle);
        if (queryCond) conds.push(queryCond);
      }
      if (input.status) {
        if (Array.isArray(input.status)) {
          conds.push(
            input.status.length === 1
              ? eq(tasksTable.status, input.status[0]!)
              : inArray(tasksTable.status, input.status),
          );
        } else {
          conds.push(eq(tasksTable.status, input.status));
        }
      }
      if (input.starred) {
        conds.push(sql`${tasksTable.starredAt} IS NOT NULL`);
      }
      if (input.dateFrom) {
        conds.push(gte(tasksTable.createdAt, input.dateFrom));
      }
      if (input.dateTo) {
        conds.push(lte(tasksTable.createdAt, input.dateTo));
      }
      const rows = await ctx.db
        .select({
          id: tasksTable.id,
          externalId: tasksTable.externalId,
          intent: tasksTable.intent,
          title: tasksTable.title,
          status: tasksTable.status,
          pauseReason: tasksTable.pauseReason,
          errorCode: tasksTable.errorCode,
          errorMessage: tasksTable.errorMessage,
          result: tasksTable.result,
          opusUsed: tasksTable.opusUsed,
          starred: tasksTable.starred,
          starredAt: tasksTable.starredAt,
          projectId: tasksTable.projectId,
          createdAt: tasksTable.createdAt,
          updatedAt: tasksTable.updatedAt,
          completedAt: tasksTable.completedAt,
        })
        .from(tasksTable)
        .where(and(...conds))
        // Starred mode reads in last-starred order so the most-recent
        // bookmark surfaces first; everything else stays newest-first
        // by id (autoincrement so monotonic with insertion time).
        .orderBy(
          input.starred ? desc(tasksTable.starredAt) : desc(tasksTable.id),
        )
        .limit(input.limit);

      // Resolve project external ids in one round-trip — mapping
      // bigint project_id back to the public prj_… string the SPA
      // uses for routing. Tasks with no project skip the lookup.
      const internalProjectIds = Array.from(
        new Set(rows.map((r) => r.projectId).filter((v): v is number => v != null)),
      );
      const projectExtById = new Map<number, string>();
      if (internalProjectIds.length > 0) {
        const projectRows = await ctx.db
          .select({ id: projects.id, externalId: projects.externalId })
          .from(projects)
          .where(inArray(projects.id, internalProjectIds));
        for (const p of projectRows) projectExtById.set(p.id, p.externalId);
      }

      return {
        tasks: rows.map((r) => ({
          taskId: r.externalId,
          intent: r.intent,
          title: r.title,
          status: r.status,
          pauseReason: r.pauseReason,
          errorCode: r.errorCode,
          errorMessage: r.errorMessage,
          // R7 — strip the base64 final-state screenshot from the list
          // shape. It can be ~80KB per row (quality-80 JPEG, base64
          // overhead 33%); 100 tasks would bloat the list response by
          // ~8MB. tasks.detail still ships it for the BrowserPanel
          // evidence view; the sidebar doesn't render screenshots.
          result: stripFinalScreenshot(normalizeOutput(r.result)),
          starred: Boolean(r.starred),
          starredAt: r.starredAt,
          projectId: r.projectId != null ? projectExtById.get(r.projectId) ?? null : null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          completedAt: r.completedAt,
        })),
        nextCursor:
          rows.length === input.limit
            ? input.starred
              ? rows[rows.length - 1]?.starredAt?.getTime() ?? null
              : rows[rows.length - 1]?.id ?? null
            : null,
      };
    }),

  /**
   * One task + all its steps. Steps include the `output` blob (extract
   * texts, screenshot metadata, SELECTOR_NOT_FOUND diagnostic payload,
   * etc.) so the popup can render the same ResultsSection it uses for
   * live tasks. Task ownership is verified — unknown or not-owned task
   * returns NOT_FOUND rather than leaking existence via UNAUTHORIZED.
   */
  detail: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select()
        .from(tasksTable)
        .where(and(eq(tasksTable.externalId, input.taskId), eq(tasksTable.userId, userRow.id)))
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      const stepRows = await ctx.db
        .select({
          externalId: taskSteps.externalId,
          seq: taskSteps.seq,
          kind: taskSteps.kind,
          status: taskSteps.status,
          riskLevel: taskSteps.riskLevel,
          input: taskSteps.input,
          output: taskSteps.output,
          errorCode: taskSteps.errorCode,
          errorMessage: taskSteps.errorMessage,
          screenshotKey: taskSteps.screenshotKey,
          startedAt: taskSteps.startedAt,
          completedAt: taskSteps.completedAt,
        })
        .from(taskSteps)
        .where(eq(taskSteps.taskId, taskRow.id))
        .orderBy(asc(taskSteps.seq));

      // P1-C — translate internal projectId to the public prj_… id
      // so the SPA gets the same shape `tasks.list` ships. Without
      // this, an upsert from a deep link would land a UiTask whose
      // projectId is the bigint primary key, which the sidebar
      // can't match to a project route.
      const projectExternalId = await (async (): Promise<string | null> => {
        if (taskRow.projectId == null) return null;
        const [proj] = await ctx.db
          .select({ externalId: projects.externalId })
          .from(projects)
          .where(eq(projects.id, taskRow.projectId))
          .limit(1);
        return proj?.externalId ?? null;
      })();
      return {
        taskId: taskRow.externalId,
        intent: taskRow.intent,
        title: taskRow.title,
        status: taskRow.status,
        pauseReason: taskRow.pauseReason,
        // F11 follow-up — only meaningful while status='awaiting_user'.
        // SPA gates on status, so leaving the column populated for
        // historical rows is harmless. Returned alongside status so
        // a refresh during a pause re-renders the input.
        awaitingQuestion: taskRow.awaitingQuestion ?? null,
        // P2-A — kind classifier for the awaiting state. NULL on
        // legacy rows or non-awaiting tasks; SPA defaults to
        // 'clarification' when missing.
        awaitingKind: taskRow.awaitingKind ?? null,
        errorCode: taskRow.errorCode,
        errorMessage: taskRow.errorMessage,
        // P1-C — extra fields the SPA's UiTask shape needs when this
        // task isn't already in the loaded sidebar list (deep links
        // beyond the first 50). tasks.list ships these too.
        opusUsed: Boolean(taskRow.opusUsed),
        starred: Boolean(taskRow.starred),
        starredAt: taskRow.starredAt,
        projectId: projectExternalId,
        result: normalizeOutput(taskRow.result),
        // Phase 13 Dim 1 — surface plan body so a re-opened tab
        // re-renders the PlanCard from persisted state instead of
        // waiting for a (now-impossible) WS replay.
        planText: taskRow.planText,
        planStatus: normalizeOutput(taskRow.planStatus),
        createdAt: taskRow.createdAt,
        completedAt: taskRow.completedAt,
        steps: stepRows.map((s) => ({
          id: s.externalId,
          seq: s.seq,
          kind: s.kind,
          status: s.status,
          riskLevel: s.riskLevel,
          // MariaDB JSON columns arrive as strings on some driver
          // configs; the repo's normalizeJson handles that, inline
          // the parse here so callers get a real object.
          input: normalizeOutput(s.input),
          output: normalizeOutput(s.output),
          errorCode: s.errorCode,
          errorMessage: s.errorMessage,
          screenshotKey: s.screenshotKey,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
        })),
      };
    }),

  /**
   * Supercar-only: resume a task that parked on `server.supercar.awaiting_user`.
   * Returns `{ ok: false }` when the task isn't currently waiting (already
   * finished, unknown id, wrong user). Does NOT load the full task state —
   * the only valid state for reply is an in-memory handle registered by
   * the running loop, so we bail fast when it's missing.
   */
  reply: protectedProcedure
    .input(
      z.object({
        taskId: z.string().min(1),
        message: z.string().min(1).max(4_000),
        // F2 — attachments uploaded with the reply. Same shape as
        // `tasks.create.fileIds`. Resolved + parsed below into
        // content blocks, then plumbed through `supercarReply`'s
        // attachmentBlocks param. Cap mirrors create.
        fileIds: z.array(z.string()).max(5).optional(),
      }),
    )
    // Explicit return-type annotation breaks the circular type
    // inference: this handler calls `tasksRouter.createCaller` (F4
    // backend handoff), which references the very router this
    // handler is inside. Without the annotation tsc gives up and
    // resolves the whole router as `any`, breaking SPA type-safety.
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{
        ok: boolean;
        state?: 'resumed' | 'stillAwaiting' | 'persistFailed';
        handoff?: 'browser';
        handoffTaskId?: string;
      }> => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(and(eq(tasksTable.externalId, input.taskId), eq(tasksTable.userId, userRow.id)))
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      // F2 — resolve + parse attachments before classification so the
      // resulting blocks are ready for whichever delivery path fires.
      // Same pattern as tasks.create: any individual file that fails
      // to load / parse is skipped with a warn; the reply still
      // delivers with whatever did parse.
      const replyAttachmentBlocks: Awaited<
        ReturnType<typeof parseFileForPrompt>
      >['blocks'] = [];
      if (input.fileIds && input.fileIds.length > 0) {
        const fileService = new FileService(ctx.db, ctx.logger);
        const loaded = await fileService.loadMany(input.fileIds, userRow.id);
        for (const f of loaded) {
          try {
            const parsed = await parseFileForPrompt(
              f.buffer,
              f.row.filename,
              f.row.mimetype,
            );
            replyAttachmentBlocks.push(...parsed.blocks);
          } catch (err) {
            ctx.logger.warn(
              {
                err: err instanceof Error ? err.message : String(err),
                fileId: f.row.externalId,
              },
              'tasks.reply: file parse failed — skipping',
            );
          }
        }
      }
      // F1 — classify the user's reply intent. Four buckets:
      //   manual_data     — user pasted metrics / "数据如下" / numeric
      //                     blob; supercar should hand off to generate.
      //   login_completed — user finished a manual login or captcha
      //                     ("扫完了" / "登录好了"); continue browser.
      //   still_awaiting  — user said "等一下 / 稍等 / wait"; keep
      //                     supercar parked, don't resume the loop.
      //   default         — auto, anything else; continue browser.
      // The classifier is intentionally conservative (favors `default`)
      // — false-handoff aborts a working browser session, so we only
      // hand off when the message is unambiguously self-sufficient.
      const replyKind = classifyReplyIntent(input.message);
      ctx.logger.info(
        { taskId: input.taskId, replyKind, msgLen: input.message.length },
        'reply: classified',
      );

      // Fix 2 — still_awaiting short-circuit. Don't deliver to
      // supercarReply, don't resume the loop, don't touch DB status.
      // Task stays in awaiting_user; SPA's replyToTask gates on
      // `state` and preserves the BrowserPanel takeover UI.
      if (replyKind === 'still_awaiting') {
        // Best-effort re-broadcast so any SPA tab that lost its
        // awaitingUserByTask entry (e.g. after a long idle) gets it
        // back without needing tasks.detail re-fetch.
        try {
          const [row] = await ctx.db
            .select({
              awaitingQuestion: tasksTable.awaitingQuestion,
              awaitingKind: tasksTable.awaitingKind,
            })
            .from(tasksTable)
            .where(eq(tasksTable.externalId, input.taskId))
            .limit(1);
          if (row?.awaitingQuestion) {
            const k = row.awaitingKind;
            const validKinds = ['clarification', 'login', 'captcha', 'permission', 'browser_action'] as const;
            const kind =
              typeof k === 'string' && (validKinds as readonly string[]).includes(k)
                ? (k as (typeof validKinds)[number])
                : 'clarification';
            broadcastToUser(ctx.userId, {
              type: 'server.supercar.awaiting_user',
              taskId: input.taskId,
              question: row.awaitingQuestion,
              awaitingKind: kind,
            });
          }
        } catch (err) {
          ctx.logger.warn(
            { err, taskId: input.taskId },
            'reply: still_awaiting rebroadcast failed (non-fatal)',
          );
        }
        return { ok: true, state: 'stillAwaiting' as const };
      }

      // Phase 3 R1 — state-machine invariant requires the row to be
      // in `executing` BEFORE the agent-loop is woken from its
      // awaiting_user park. Otherwise the agent's next iteration
      // could complete + call persistVisionOutcome while the row
      // still says `awaiting_user`, and the new state guard in
      // task-repository would refuse the completed write.
      //
      // Sequence:
      //   1. AWAIT the DB transition awaiting_user → executing.
      //   2. Then call supercarReply / supercarHandoffToGenerate to
      //      wake the agent.
      //   3. Agent's next persistVisionOutcome sees status=executing,
      //      writes complete normally.
      // If the DB write fails we DON'T deliver the reply — the row
      // would be inconsistent and the agent could complete into a
      // refused write, leaving the user with a parked task that
      // never moves.
      const supercarHasHandle = hasParkedSupercarHandle(input.taskId);
      if (supercarHasHandle) {
        try {
          await ctx.db
            .update(tasksTable)
            .set({
              status: 'executing',
              awaitingQuestion: null,
              awaitingKind: null,
            })
            .where(eq(tasksTable.externalId, input.taskId));
        } catch (err) {
          ctx.logger.error(
            { err, taskId: input.taskId },
            'reply: failed to flip awaiting_user → executing; refusing to deliver reply',
          );
          return { ok: false, state: 'persistFailed' as const };
        }
      }

      const delivered =
        replyKind === 'manual_data'
          ? supercarHandoffToGenerate(input.taskId, input.message)
          : supercarReply(
              input.taskId,
              input.message,
              replyAttachmentBlocks.length > 0 ? replyAttachmentBlocks : undefined,
            );
      if (delivered) {
        return { ok: true, state: 'resumed' as const };
      }

      // No supercar handle — could be a generate-lane intake park
      // (expert workflow with `missingInputs > 0` routes through
      // `runGenerateTask`, parks on `[AWAITING_USER_INPUT]`, has no
      // agent loop to register a handle). In that case we resume by
      // re-running runGenerateTask under the same taskId with the
      // combined original-intent + user-reply text.
      const [parkRow] = await ctx.db
        .select({
          intent: tasksTable.intent,
          status: tasksTable.status,
          result: tasksTable.result,
          opusUsed: tasksTable.opusUsed,
          roleId: tasksTable.roleId,
        })
        .from(tasksTable)
        .where(eq(tasksTable.externalId, input.taskId))
        .limit(1);
      const prevResult = (parkRow?.result ?? null) as
        | Record<string, unknown>
        | null;
      const wasGenerateParked =
        Boolean(parkRow) &&
        parkRow!.status === 'awaiting_user' &&
        prevResult?.executionMode === 'generate';
      if (!wasGenerateParked) {
        return { ok: false };
      }

      // Sweep P2 fix: user replies the bare VALUE (e.g. "美妆护肤")
      // for an intake question, but the typed workflow's
      // extractPattern requires an anchor like "品类:" before the
      // value. The re-parse on the unmodified combined intent
      // re-misses the field and we park with the SAME question
      // forever.
      //
      // Mitigation: peek at the typed workflow that was driving the
      // original park and, for each required field whose
      // extractPattern doesn't match the bare reply text, prepend
      // the field's label as an anchor so the regex can pick it up
      // on the next parse round. Uses the EXECUTION registry match
      // (the typed-workflow lane), not the supercar matcher.
      const parkingTypedWorkflow = matchTypedExpertWorkflow({
        intent: parkRow!.intent,
        roleId: parkRow!.roleId ?? null,
      });
      const userReply = input.message.trim();
      let anchoredReply = userReply;
      if (parkingTypedWorkflow && userReply.length > 0) {
        const priorParse = parseInputs(parkRow!.intent, parkingTypedWorkflow);
        const additions: string[] = [];
        for (const field of priorParse.missingRequired) {
          if (!field.extractPattern) continue;
          if (field.extractPattern.test(userReply)) continue;
          const anchor = (field.label ?? field.name).split(/[\s/]/)[0];
          additions.push(`${anchor}: ${userReply}`);
        }
        if (additions.length > 0) {
          anchoredReply = [...additions, userReply].join('\n');
        }
      }

      const combinedIntent = [
        parkRow!.intent,
        `\n\n[用户补充]\n${anchoredReply}`,
      ].join('').trim();

      // Re-evaluate the workflow on the COMBINED intent. Two outcomes
      // matter here:
      //   1. missingInputs is now empty + user supplied platform-source
      //      keywords (罗盘/抖店) → routeOverride='browser'. We can't
      //      cleanly hand off to supercar from inside this handler
      //      today (the supercar dispatch is 1500 lines of inline glue
      //      in tasks.create, not a callable helper). So we surface a
      //      structured response and let the SPA prompt the user to
      //      open a new task with `intent=combinedIntent`. Tracked as
      //      a follow-up to extract `dispatchSupercar` once we have a
      //      dedicated reviewer for the refactor.
      //   2. Otherwise (manual data / paste / "我自己给数据" / still
      //      missing inputs) → re-run runGenerateTask one shot. The
      //      runner will either complete (report) or park again with
      //      a new intake question (the model decides).
      //
      // Short-circuit: if the user clearly pasted metrics/data
      // (`replyKind === 'manual_data'`) we skip the workflow re-run
      // and go straight to generate. The classifier is conservative,
      // so a `manual_data` verdict means there are unambiguous numeric
      // figures or "数据如下" markers — no need to ask whether the
      // user actually wants the browser path. Avoids edge cases where
      // a paste happens to contain platform keywords ("罗盘 GMV 156k
      // UV 28k") and would otherwise trip the browser-handoff branch.
      const newWorkflow = matchExpertWorkflow(combinedIntent, {
        hasAttachments: false,
      });
      const wantsBrowser =
        replyKind !== 'manual_data' &&
        newWorkflow?.routeOverride === 'browser';

      if (wantsBrowser) {
        ctx.logger.info(
          {
            taskId: input.taskId,
            workflowId: newWorkflow!.id,
            missingInputs: newWorkflow!.missingInputs,
          },
          'reply: combined intent now wants browser lane — backend auto-handoff',
        );
        // F4 — backend-orchestrated auto-handoff. The earlier round
        // broadcast `autoHandoff: { intent }` and let the SPA fire
        // createTask, which had two problems:
        //   1. SPA reconnect could replay the terminal frame and
        //      double-create the handoff task.
        //   2. The SPA's createTask charged user quota — even though
        //      the handoff is logically a continuation of the parent.
        // Now the backend invokes `tasksRouter.create` itself via
        // createCaller with `replyToTaskId` set to the parent. That
        // path skips the quota gate (existing follow-up semantics),
        // injects the parent context, and returns the new taskId.
        // Idempotency guard: if `result.handoffTaskId` is already
        // populated for this parent, reuse it instead of creating a
        // duplicate (handles WS replay / double-click).
        const handoffNotice =
          '需要登录浏览器去后台读取数据，已为你新建一个浏览器任务接续执行。';
        let handoffTaskId: string | null =
          typeof prevResult?.handoffTaskId === 'string'
            ? prevResult.handoffTaskId
            : null;
        // F4 ordering fix — createCaller's `tasks.create` follow-up
        // gate (replyToTaskId path) rejects parents in awaiting_user
        // ("只能追问已完成/失败/取消的任务"). We must flip the parent
        // to `completed` BEFORE invoking createCaller, otherwise the
        // call throws and handoffTaskId stays null. Persist the
        // pre-handoff state first, then run createCaller, then patch
        // the result row again to include handoffTaskId on success.
        // If createCaller throws AFTER the status flip, the parent
        // stays completed (with combinedIntent in result) — slightly
        // worse UX than ideal but never blocks the user, and matches
        // the prior behaviour for partial failure.
        try {
          await ctx.db
            .update(tasksTable)
            .set({
              status: 'completed',
              awaitingQuestion: null,
              awaitingKind: null,
              result: {
                ...(prevResult ?? {}),
                executionMode: 'generate',
                handoffSuggestion: 'browser',
                combinedIntent,
                summary: handoffNotice,
              },
              completedAt: new Date(),
            })
            .where(eq(tasksTable.externalId, input.taskId));
        } catch (err) {
          ctx.logger.error(
            { err, taskId: input.taskId },
            'reply: handoff parent-flip persist failed',
          );
        }

        if (!handoffTaskId) {
          try {
            const handoff = await tasksRouter
              .createCaller(ctx)
              .create({
                intent: combinedIntent,
                replyToTaskId: input.taskId,
              });
            handoffTaskId = handoff.taskId;
            ctx.logger.info(
              {
                parentTaskId: input.taskId,
                handoffTaskId,
                handoffStatus: handoff.status,
                handoffExecutionMode: handoff.executionMode,
              },
              'reply: spawned handoff task via createCaller',
            );
          } catch (err) {
            ctx.logger.error(
              {
                err: err instanceof Error ? err.message : String(err),
                parentTaskId: input.taskId,
              },
              'reply: handoff createCaller failed',
            );
            // Continue — parent already marked completed above; SPA
            // shows the completion notice without auto-navigation.
          }
        } else {
          ctx.logger.info(
            { parentTaskId: input.taskId, handoffTaskId },
            'reply: handoff already exists — idempotent reuse',
          );
        }

        // Patch result with handoffTaskId now that createCaller has
        // returned (or failed). Best-effort — terminal broadcast
        // below already carries the field for live SPA listeners.
        try {
          if (handoffTaskId) {
            await ctx.db
              .update(tasksTable)
              .set({
                result: {
                  ...(prevResult ?? {}),
                  executionMode: 'generate',
                  handoffSuggestion: 'browser',
                  combinedIntent,
                  summary: handoffNotice,
                  handoffTaskId,
                },
              })
              .where(eq(tasksTable.externalId, input.taskId));
          }
          broadcastToUser(ctx.userId, {
            type: 'server.task.terminal',
            taskId: input.taskId,
            status: 'completed',
            summary: handoffNotice,
            ...(handoffTaskId ? { handoffTaskId } : {}),
          });
        } catch (err) {
          ctx.logger.error(
            { err, taskId: input.taskId },
            'reply: handoff persist failed',
          );
        }
        return {
          ok: true,
          handoff: 'browser' as const,
          state: 'resumed' as const,
          ...(handoffTaskId ? { handoffTaskId } : {}),
        };
      }

      // Generate-lane resume. Flip to executing, then dispatch the
      // runner with the combined intent. The preamble carries the
      // expert-workflow context (now with `missingInputs.length === 0`
      // → no intake-guard, so the model will produce a real report).
      const anthropicClient = anthropicForResolver;
      if (!anthropicClient) {
        ctx.logger.error(
          { taskId: input.taskId },
          'reply: anthropic client not configured — cannot resume',
        );
        return { ok: false };
      }
      const repo = new TaskRepository(ctx.db);
      const newWorkflowPreamble = newWorkflow?.promptPreamble ?? '';
      const effectiveCombined =
        (newWorkflowPreamble ? `${newWorkflowPreamble}\n` : '') + combinedIntent;
      await ctx.db
        .update(tasksTable)
        .set({
          status: 'executing',
          awaitingQuestion: null,
          awaitingKind: null,
        })
        .where(eq(tasksTable.externalId, input.taskId));
      const resumeStartedAt = Date.now();
      void (async () => {
        let outcome;
        try {
          outcome = await runGenerateTask({
            taskId: input.taskId,
            userId: ctx.userId,
            intent: effectiveCombined,
            ...(parkRow!.roleId ? { skillId: parkRow!.roleId } : {}),
            client: anthropicClient,
            logger: ctx.logger,
            // F2 — pass user-uploaded attachments through to the
            // generate runner so a parked-from-generate task that
            // resumes with a file (e.g. Excel of metrics) sees the
            // attachment alongside the original intent.
            ...(replyAttachmentBlocks.length > 0
              ? { attachments: replyAttachmentBlocks }
              : {}),
            onStreamDelta: (delta) => {
              try {
                broadcastToUser(ctx.userId, {
                  type: 'server.task.stream',
                  taskId: input.taskId,
                  delta,
                });
              } catch (err) {
                ctx.logger.warn(
                  { err, taskId: input.taskId },
                  'reply: broadcast stream delta failed',
                );
              }
            },
          });
        } catch (err) {
          ctx.logger.error({ err, taskId: input.taskId }, 'reply: runner threw');
          outcome = {
            status: 'failed' as const,
            summary: '',
            reason:
              err instanceof Error ? err.message : 'reply: unknown error',
            inputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
          };
        }
        const elapsedMs = Date.now() - resumeStartedAt;
        const metadata = {
          executionMode: 'generate' as const,
          finalExecutionMode: 'generate' as const,
          expertWorkflowId: newWorkflow?.id ?? null,
          selectedRole: parkRow!.roleId ?? null,
          model: 'claude-sonnet-4-6',
          fallbackChain: ['generate-resume'],
          elapsedMs,
          modelFinalText:
            outcome.status === 'completed' ? outcome.summary.slice(0, 200) : null,
        };
        try {
          if (outcome.status === 'completed') {
            await repo.persistVisionOutcome(input.taskId, {
              status: 'completed',
              summary: outcome.summary,
              tickCount: 1,
              metadata,
            });
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId: input.taskId,
              status: 'completed',
              ...(outcome.summary ? { summary: outcome.summary } : {}),
            });
          } else if (outcome.status === 'awaiting_user') {
            // Park again — model still wants more info.
            await ctx.db
              .update(tasksTable)
              .set({
                status: 'awaiting_user',
                awaitingQuestion: outcome.summary,
                awaitingKind: 'clarification',
                result: { ...metadata, executionMode: 'generate' as const },
              })
              .where(eq(tasksTable.externalId, input.taskId));
            broadcastToUser(ctx.userId, {
              type: 'server.supercar.awaiting_user',
              taskId: input.taskId,
              question: outcome.summary,
              awaitingKind: 'clarification',
            });
          } else {
            await repo.persistVisionOutcome(input.taskId, {
              status: 'failed',
              reason: outcome.reason ?? 'generate-resume: api failed',
              tickCount: 1,
              metadata,
            });
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId: input.taskId,
              status: 'failed',
              ...(outcome.reason ? { reason: outcome.reason } : {}),
            });
          }
        } catch (err) {
          ctx.logger.error(
            { err, taskId: input.taskId },
            'reply: persist resume outcome failed',
          );
        }
      })();
      return { ok: true, state: 'resumed' as const };
    },
  ),

  /**
   * Supercar-only: abort a running task. Sets the in-memory abort flag;
   * the next loop iteration exits with status=cancelled.
   */
  abort: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(and(eq(tasksTable.externalId, input.taskId), eq(tasksTable.userId, userRow.id)))
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      const aborted = supercarAbort(input.taskId);
      return { ok: aborted };
    }),

  /**
   * Navigate the headed Brave singleton to about:blank so the VNC
   * stream doesn't show a stale URL from a previous task while the
   * user types the next intent. Idempotent + fire-and-forget — we
   * don't surface errors because there's nothing the user can do
   * about a CDP hiccup except try again. Only runs if the primary
   * executor is the headed lane (guarded in the router).
   */
  /**
   * P3 wake mechanism — explicit "bring my browser back" path. After
   * the 5-minute idle GC reaps the user's pool instance, the SPA
   * shows a hibernation card; the wake button calls this. Returns
   * pool stats so the panel can probe-and-redraw, then the SPA
   * triggers a fresh VNC connection.
   *
   * No quota cost — this is just respawning the per-user Brave
   * (cookies preserved in user-data-dir, so logins don't re-prompt).
   * Concurrency limit doesn't apply either: the user isn't starting
   * a new TASK, just lighting up the browser.
   *
   * Returns:
   *   { status: 'ready' }   — instance is alive and ready to stream
   *   { status: 'spawning' } — allocate is still cold-starting
   *                            (~3-5 s); SPA should show a spinner
   *                            and let VNC retry on its own
   *   { status: 'unavailable' } — pool not configured / capacity full
   */
  wakeBrowser: protectedProcedure.mutation(async ({ ctx }) => {
    // Phase 24 — wakeBrowser is now a no-op. Pre-warming a Brave
    // before the user submits a task made sense in the per-user
    // model (one Brave shared across the user's tasks). Per-task
    // means there's no instance until a task exists, so there's
    // nothing to pre-warm. Kept as a no-op endpoint so the SPA's
    // existing call doesn't 404 — frontend can drop the call in a
    // later phase. Returns the existing instance if the user has
    // any active task; null otherwise.
    if (!ctx.browserPool) {
      return { status: 'unavailable' as const, reason: 'pool_disabled' };
    }
    const existing = ctx.browserPool.peekActiveForUser(ctx.userId);
    if (existing) {
      return { status: 'ready' as const, cdpPort: existing.cdpPort };
    }
    return {
      status: 'unavailable' as const,
      reason: 'no_active_task — submit a task to spawn a browser',
    };
  }),

  resetBrowser: protectedProcedure.mutation(async ({ ctx }) => {
    // Pool users reset their own Brave; everyone else resets the
    // shared headed singleton. peek() never allocates — we don't
    // want a fresh quartet just for a new-task nudge, and if the
    // user doesn't yet have one there's nothing to reset.
    // Phase 24 — peekActiveForUser finds the user's most recently
    // active task instance. If they have multiple concurrent tasks,
    // resetting clobbers the most recent one's page. That's a
    // reasonable default: the SPA's "reset browser" button is meant
    // for the panel-visible browser, which is what peekActiveForUser
    // returns.
    const poolInstance =
      ctx.browserPool && shouldUseBrowserPool(ctx.userId)
        ? ctx.browserPool.peekActiveForUser(ctx.userId)
        : null;
    const exec =
      poolInstance?.executor ??
      ctx.executionRouter?.getExecutor('headed') ??
      ctx.executionRouter?.getExecutor('headless') ??
      ctx.playwrightExecutor ??
      null;
    if (!exec) return { ok: false as const, reason: 'no_executor' };
    try {
      await exec.resetPageForTask();
      return { ok: true as const };
    } catch (err) {
      ctx.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'tasks.resetBrowser: reset failed (non-fatal)',
      );
      return { ok: false as const, reason: 'reset_failed' };
    }
  }),

  /**
   * User-initiated browser chrome navigation on the attached Brave
   * instance. Used by the Panel header's back / forward / reload
   * buttons — the agent loop owns URL changes but the user also needs
   * trivial browser-style navigation when they decide to poke around
   * the rendered site themselves.
   *
   * Fire-and-forget semantics; errors are swallowed and reported as
   * `{ok:false, reason}` so the UI can show a subtle toast rather
   * than a TRPC error banner for something as cheap as "no page yet".
   */
  browserNav: protectedProcedure
    .input(
      z.object({
        direction: z.enum(['back', 'forward', 'reload', 'goto']),
        // For direction='goto': the URL to navigate to. Required for
        // goto, ignored otherwise. Cap at 2KB to keep the request
        // body bounded; longer URLs are almost certainly someone
        // shoving form data into the address bar.
        url: z.string().max(2048).optional(),
        // F3 — when the SPA's BrowserPanel is showing a SPECIFIC
        // task's screencast, it passes that task's id so the nav
        // routes to the right Brave. Without this, peekActiveForUser
        // picked the most-recently-active instance, which races when
        // the user has multiple concurrent tasks. Optional so the
        // explicit "browser live" entrypoint (sidebar globe, no
        // task selected) still falls through to the userId pick.
        taskId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Resolve the executor in two layers: prefer the per-task pool
      // instance when the SPA passed a taskId — that uniquely binds
      // the nav to whichever Brave the panel is actually streaming.
      // Owner check is non-negotiable: pool.peek returns by taskId
      // alone, so without verifying `inst.userId === ctx.userId` a
      // user could navigate someone ELSE's browser by guessing a
      // task id. Fall through to peekActiveForUser only when no
      // taskId is supplied (sidebar globe entry / legacy path).
      let poolInstance = null;
      if (ctx.browserPool && shouldUseBrowserPool(ctx.userId)) {
        if (input.taskId) {
          const inst = ctx.browserPool.peek(input.taskId);
          if (inst && inst.userId === ctx.userId) {
            poolInstance = inst;
          } else if (inst) {
            ctx.logger.warn(
              { taskId: input.taskId, ownerMismatch: true },
              'tasks.browserNav: peek returned non-owner instance — ignoring',
            );
          }
        } else {
          poolInstance = ctx.browserPool.peekActiveForUser(ctx.userId);
        }
      }
      const exec =
        poolInstance?.executor ??
        ctx.executionRouter?.getExecutor('headed') ??
        ctx.executionRouter?.getExecutor('headless') ??
        ctx.playwrightExecutor ??
        null;
      if (!exec) return { ok: false as const, reason: 'no_executor' };
      try {
        const page = await exec.getPage();
        // waitUntil: 'domcontentloaded' — the default 'load' waits for
        // every sub-resource and times out on heavy SPAs (ctrip /
        // jd homepage can easily break 30s). Back/forward on a fresh
        // tab with no history returns null (not an error) — the
        // caller silently gets ok:true which is fine.
        const navOpts = { timeout: 15_000, waitUntil: 'domcontentloaded' as const };
        if (input.direction === 'back') {
          const r = await page.goBack(navOpts);
          if (!r) return { ok: false as const, reason: 'no_history' };
        } else if (input.direction === 'forward') {
          const r = await page.goForward(navOpts);
          if (!r) return { ok: false as const, reason: 'no_history' };
        } else if (input.direction === 'goto') {
          if (!input.url) {
            return { ok: false as const, reason: 'missing_url' };
          }
          // Normalise: bare hostname → https; anything else passes
          // through. Reject schemes other than http(s) so users can't
          // emit `javascript:` / `file:` / `data:` URLs at the remote
          // browser via the panel address bar.
          let target = input.url.trim();
          if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) {
            target = `https://${target}`;
          }
          if (!/^https?:\/\//i.test(target)) {
            return { ok: false as const, reason: 'bad_scheme' };
          }
          await page.goto(target, navOpts);
        } else {
          await page.reload(navOpts);
        }
        return { ok: true as const };
      } catch (err) {
        ctx.logger.warn(
          { err: err instanceof Error ? err.message : String(err), direction: input.direction },
          'tasks.browserNav: nav failed (non-fatal)',
        );
        return { ok: false as const, reason: 'nav_failed' };
      }
    }),

  /**
   * Remove one of the caller's tasks. Cascades to task_steps / task_events
   * via the schema's onDelete. Scoped hard — the WHERE clause requires
   * both the externalId AND caller's userId so a user cannot delete
   * another user's row by guessing its id.
   *
   * In-flight tasks are rejected with PRECONDITION_FAILED rather than
   * silently deleted: the vision loop would continue writing rows for
   * a task that no longer exists, producing an orphaned-step log spam.
   * The UI disables the delete action on non-terminal tasks too, but we
   * defend in depth.
   */
  delete: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id, status: tasksTable.status })
        .from(tasksTable)
        .where(
          and(eq(tasksTable.externalId, input.taskId), eq(tasksTable.userId, userRow.id)),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      if (
        taskRow.status === 'executing' ||
        taskRow.status === 'planning' ||
        taskRow.status === 'awaiting_user' ||
        taskRow.status === 'pending'
      ) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `cannot delete task in status=${taskRow.status}; pause or cancel first`,
        });
      }
      // task_steps has onDelete:cascade via FK; task_events has no FK
      // (append-only audit log) so we clean it up manually in one tx
      // to keep the orphan event rows from piling up.
      await ctx.db.transaction(async (tx) => {
        await tx.delete(taskEvents).where(eq(taskEvents.taskId, taskRow.id));
        await tx.delete(tasksTable).where(eq(tasksTable.id, taskRow.id));
      });
      return { ok: true as const, taskId: input.taskId };
    }),

  /**
   * Rename a task (sets the display `title` column). Pass an empty
   * string to clear the override — the UI will then fall back to the
   * auto-summary of `intent`. 255-char cap mirrors the column.
   */
  rename: protectedProcedure
    .input(
      z.object({
        taskId: z.string().min(1),
        title: z.string().max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      // Verify ownership before the UPDATE so we return a proper
      // NOT_FOUND (vs. silently succeeding on 0 affected rows) and
      // don't leak unrelated task existence via error messages.
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(
          and(eq(tasksTable.externalId, input.taskId), eq(tasksTable.userId, userRow.id)),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      const trimmed = input.title.trim();
      const nextTitle = trimmed.length === 0 ? null : trimmed;
      await ctx.db
        .update(tasksTable)
        .set({ title: nextTitle })
        .where(eq(tasksTable.id, taskRow.id));
      return { ok: true as const, taskId: input.taskId, title: nextTitle };
    }),

  /**
   * P1.1 self-heal metrics — aggregate over the caller's task_steps
   * rows. `healStats` powers the W3 dogfood decision "is self-heal
   * worth keeping / tuning / expanding to 2 retries?" by measuring:
   *   - attempts: how often a step triggered a heal call
   *   - successes: of those, how many were followed by an ok retry
   *   - successRate: successes / attempts
   *   - avgElapsedMs: average wall-clock per heal call
   *   - totalInputTokens / totalOutputTokens: Anthropic token spend
   *
   * Scoped strictly to the caller so one account's rates don't
   * average-out into another's. Empty result (no heals ever) returns
   * zeros — not an error.
   */
  healStats: protectedProcedure
    .input(
      z
        .object({
          /** ISO timestamp; inclusive lower bound on step created_at. */
          since: z.string().datetime().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }

      const sinceCond = input.since
        ? sqlFilter`AND ts.created_at >= ${new Date(input.since)}`
        : sqlEmpty;

      // A single aggregation against task_steps JOIN tasks; cheaper
      // than pulling all rows and folding in JS, and the query is
      // simple enough to SQL-native.
      const result = (await ctx.db.execute(sqlFilter`
        SELECT
          COALESCE(SUM(CASE WHEN ts.heal_attempts > 0 THEN 1 ELSE 0 END), 0)  AS attempts,
          COALESCE(SUM(CASE WHEN ts.heal_succeeded > 0 THEN 1 ELSE 0 END), 0) AS successes,
          COALESCE(AVG(NULLIF(ts.heal_elapsed_ms, 0)), 0)                    AS avgElapsedMs,
          COALESCE(SUM(COALESCE(ts.heal_input_tokens, 0)), 0)                AS totalInputTokens,
          COALESCE(SUM(COALESCE(ts.heal_output_tokens, 0)), 0)               AS totalOutputTokens
        FROM task_steps ts
        JOIN tasks t ON ts.task_id = t.id
        WHERE t.user_id = ${userRow.id}
        ${sinceCond}
      `)) as unknown as [Array<Record<string, unknown>>] | Array<Record<string, unknown>>;

      // mysql2 returns `[rows, fields]`; drizzle's mysql2 wrapper
      // sometimes unwraps to `rows`. Handle both.
      const rows: Array<Record<string, unknown>> = Array.isArray(result[0])
        ? (result[0] as Array<Record<string, unknown>>)
        : (result as unknown as Array<Record<string, unknown>>);
      const row = rows[0] ?? {};
      const attempts = toNumber(row.attempts);
      const successes = toNumber(row.successes);
      const avgElapsedMs = toNumber(row.avgElapsedMs);
      const totalInputTokens = toNumber(row.totalInputTokens);
      const totalOutputTokens = toNumber(row.totalOutputTokens);
      return {
        attempts,
        successes,
        successRate: attempts > 0 ? successes / attempts : 0,
        avgElapsedMs,
        totalInputTokens,
        totalOutputTokens,
      };
    }),

  /**
   * Phase 16 — toggle the task's starred ("收藏") flag. Sets
   * starredAt to now() when starring; clears it when unstarring so
   * the sidebar can sort the 收藏 group by most-recently-pinned.
   * Idempotent: starring an already-starred task no-ops gracefully.
   */
  star: protectedProcedure
    .input(z.object({ taskId: z.string().min(1), starred: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(
          and(eq(tasksTable.externalId, input.taskId), eq(tasksTable.userId, userRow.id)),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      await ctx.db
        .update(tasksTable)
        .set({
          starred: input.starred,
          starredAt: input.starred ? new Date() : null,
        })
        .where(eq(tasksTable.id, taskRow.id));
      return { ok: true as const, taskId: input.taskId, starred: input.starred };
    }),

  /**
   * Phase 16 — assign / unassign a task to a project. Pass
   * projectId = null to remove the task from its current project
   * (returns it to the default 所有任务 list).
   */
  moveToProject: protectedProcedure
    .input(
      z.object({
        taskId: z.string().min(1),
        projectId: z.string().min(1).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(
          and(eq(tasksTable.externalId, input.taskId), eq(tasksTable.userId, userRow.id)),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      let projectInternalId: number | null = null;
      if (input.projectId) {
        const [projRow] = await ctx.db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.externalId, input.projectId),
              eq(projects.userId, userRow.id),
            ),
          )
          .limit(1);
        if (!projRow) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `project ${input.projectId} not found`,
          });
        }
        projectInternalId = projRow.id;
      }
      await ctx.db
        .update(tasksTable)
        .set({ projectId: projectInternalId })
        .where(eq(tasksTable.id, taskRow.id));
      return {
        ok: true as const,
        taskId: input.taskId,
        projectId: input.projectId,
      };
    }),
});

import { sql as sqlFilter } from 'drizzle-orm';
const sqlEmpty = sqlFilter``;

/**
 * Truncate helper shared between supercar broadcast hooks — keeps WS
 * frames and step summaries bounded so a rogue thinking block can't
 * wedge a socket write.
 */
function truncateString(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Strip `[STEP N done]` / `[STEP N running]` / `[STEP N pending]` plan-
 * tracker markers from a free-text action summary. The supercar
 * agent leaks these into its `textPreamble` mid-thought; the SPA's
 * step-card view shows them verbatim, which looks like internal
 * debug output to a user. Removing them at the broadcast/insert
 * boundary keeps the tracker available to the model (it sees the
 * raw output) while sparing the user the noise.
 *
 * Conservative regex: only matches `[STEP <digit(s)> <words>]` —
 * won't eat user-typed bracket content.
 */
function stripPlanTrackerMarkers(s: string): string {
  return s.replace(/\[STEP\s+\d+[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * R7 — strip the heavy `finalScreenshot` base64 from a result JSON
 * blob. Used by tasks.list so the sidebar doesn't ship 8MB+ of
 * screenshots no UI surface uses. tasks.detail keeps the field —
 * that's where the BrowserPanel reads it from.
 */
function stripFinalScreenshot(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result)) return result;
  const r = result as Record<string, unknown>;
  if (!('finalScreenshot' in r)) return r;
  const { finalScreenshot: _omitted, ...rest } = r;
  void _omitted;
  return rest;
}

/**
 * Per-user BrowserPool eligibility. Phase 14 audit follow-up:
 * the canary allow-list (MULTI_USER_USERS env) was retired so every
 * authenticated user gets a pool slot. Reasoning:
 *
 *   - The legacy fallback (vision-loop SW transport) needs a Chrome
 *     extension that web users don't have, so anyone NOT on the
 *     allow-list silently lands in a path that times out at tick 0
 *     and fails their first task. That defeats the China-edge entry
 *     point's product premise.
 *   - Capacity is now enforced by MAX_BROWSER_INSTANCES + the per-plan
 *     concurrency limit + the GC's 30s idle timeout, NOT by user
 *     identity. Pool-full is a per-task signal, not a per-user signal.
 *
 * The function is kept (rather than inlined to `true`) so callers
 * stay readable AND so future "blacklist abusive userIds" logic has
 * an obvious place to land. `_userId` is unused today.
 *
 * Callers still must gate on `ctx.browserPool != null` because the
 * pool is only constructed when MULTI_USER=true at boot.
 */
function shouldUseBrowserPool(_userId: string): boolean {
  return true;
}

/**
 * F1 — classify a `tasks.reply` body so the handler picks the right
 * resume path:
 *   manual_data     — user pasted metrics, table-shaped data, or said
 *                     "数据如下" / "我直接给你数据". Supercar should
 *                     hand off to generate; trying to keep driving the
 *                     browser is wasted work and often loops on a
 *                     login page the user has explicitly opted out of.
 *   login_completed — user finished a manual login / captcha so
 *                     supercar should keep driving the browser. Today
 *                     this returns the same code path as `default`,
 *                     but the explicit bucket lets us tune the prompt
 *                     or telemetry separately later.
 *   default         — anything else; let supercar continue.
 *
 * Conservative: false-positives abort a working browser session, so
 * we only flag manual_data when the message has structural signals
 * (≥ 3 numerical figures, OR `key: value` lines, OR an explicit
 * "数据如下" / "I'll provide data" phrase). Casual replies stay default.
 */
export function classifyReplyIntent(
  message: string,
): 'manual_data' | 'login_completed' | 'still_awaiting' | 'default' {
  const trimmed = message.trim();
  if (!trimmed) return 'default';
  const lower = trimmed.toLowerCase();

  // Fix 2 — still-awaiting tells. User is mid-login / mid-captcha and
  // typing "等一下 / 稍等 / wait" to ask the system to keep waiting.
  // Match BEFORE login_completed because "还没登录" has both signals
  // and "still" should win (not "logged in"). Capped at 50 chars to
  // dodge long substantive replies that happen to contain "稍等".
  if (trimmed.length <= 50) {
    const STILL_AWAITING_PHRASES: readonly RegExp[] = [
      /还没(?:登录|登陆|好|完|完成|搞定|弄好|操作完|输入完)/u,
      /还在(?:登录|登陆|操作|输入|扫码|忙)/u,
      /我还在/u,
      /等一?下|稍等|等等|再等(?:等|会儿|一下)?|马上(?:好|完成|就好)/u,
      /没好|继续等(?:待|一下|等)?/u,
      /(?:别|不要|先别)(?:动|继续|执行)/u,
      /\bnot\s+yet\b|\bwait(?:ing)?\b|\bhold\s+on\b|\bone\s+sec(?:ond)?\b/i,
      /\bgive\s+me\s+a\s+(?:sec|moment|minute)\b/i,
      /\b(?:still|just)\s+(?:working|loading|signing|logging)\b/i,
    ];
    if (STILL_AWAITING_PHRASES.some((re) => re.test(trimmed))) {
      return 'still_awaiting';
    }
  }

  // Strong manual-data tells. The phrase patterns are a high-precision
  // signal — users typing "数据如下" or "I'll give you the numbers"
  // almost never mean "keep driving the browser".
  const MANUAL_DATA_PHRASES: readonly RegExp[] = [
    /数据如下|以下是数据|这些(?:是|就是)数据|我(?:直接|手动)?(?:给|提供|发)(?:你)?数据/u,
    /用我(?:上传|提供|发)的(?:数据|表格|文件|附件)/u,
    /(?:不(?:用|要)|跳过|别)(?:登录|登陆)|(?:不要|别)(?:打开|访问)(?:网站|页面|后台)/u,
    /\bhere(?:'s|\s+is)\s+the\s+(?:data|numbers|metrics)/i,
    /\bi(?:'ll)?\s+(?:provide|give|paste)\s+(?:the\s+)?(?:data|numbers)/i,
  ];
  if (MANUAL_DATA_PHRASES.some((re) => re.test(trimmed))) return 'manual_data';

  // Login-completed tells. Conservative — the message has to be short
  // and unambiguously about login state, not a long answer that
  // happens to mention "登录".
  if (trimmed.length <= 30) {
    const LOGIN_DONE_PHRASES: readonly RegExp[] = [
      /(?:扫(?:码)?(?:好|完|完了|完成))|登(?:录|陆)(?:好|完|成功|完成|进去|进了)/u,
      /(?:已|我已经?)(?:登录|登陆)/u,
      /\b(?:logged\s+in|signed\s+in|login\s+(?:done|complete))\b/i,
    ];
    if (LOGIN_DONE_PHRASES.some((re) => re.test(lower))) {
      return 'login_completed';
    }
  }

  // Structural manual-data signal: ≥ 3 distinct numeric figures (with
  // unit / separator hints to dodge the "1, 2, 3 step list" false-fire),
  // OR multiple `key: value` lines.
  const NUMERIC_WITH_HINT = /(?:¥|\$|€|£|RMB|usd)\s*[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s*(?:%|元|万|亿|人民币)|[\d,]+(?:\.\d+)?(?=\s*(?:GMV|UV|ROI|GPM|UV价值|订单|转化|消耗|分|%))/giu;
  const numericHits = trimmed.match(NUMERIC_WITH_HINT);
  if (numericHits && numericHits.length >= 3) return 'manual_data';

  const KV_LINE = /^[一-龥A-Za-z0-9 \t（）()\-_/]+\s*[：:][^\n]+$/u;
  const kvLines = trimmed
    .split('\n')
    .filter((l) => KV_LINE.test(l.trim())).length;
  if (kvLines >= 2) return 'manual_data';

  return 'default';
}

/**
 * Persist a supercar run's terminal state via the same
 * `persistVisionOutcome` the legacy vision-loop uses. Maps the
 * supercar-specific statuses back to the tasks.status enum.
 */
async function persistSupercarOutcome(
  repo: TaskRepository,
  taskId: string,
  outcome: SupercarOutcome,
  finalState: { finalScreenshot?: string; finalUrl?: string } = {},
  metadata?: Record<string, unknown>,
): Promise<{ persisted: boolean }> {
  // Codex P3 follow-up — forward persistVisionOutcome's `{persisted}`
  // so the caller can short-circuit terminal broadcasts / memory /
  // suggestions when the state-machine guard refused the write (row
  // still in awaiting_user). See task-repository.ts atomic guard for
  // the rationale.
  try {
    if (outcome.status === 'completed') {
      return await repo.persistVisionOutcome(taskId, {
        status: 'completed',
        summary: outcome.summary ?? '',
        tickCount: outcome.iterations,
        ...(finalState.finalScreenshot ? { finalScreenshot: finalState.finalScreenshot } : {}),
        ...(finalState.finalUrl ? { finalUrl: finalState.finalUrl } : {}),
        ...(metadata ? { metadata } : {}),
      });
    } else if (outcome.status === 'awaiting_user') {
      // Shouldn't land here in the happy path — the loop returns a
      // terminal status after the reply, not awaiting_user. Persist
      // as paused so the UI still renders sensibly if it did.
      // Phase 1 follow-up — include finalUrl + finalScreenshot so
      // the BrowserPanel has a frame to render instead of blank.
      return await repo.persistVisionOutcome(taskId, {
        status: 'paused',
        reason: outcome.question ?? 'awaiting user reply',
        tickCount: outcome.iterations,
        ...(finalState.finalScreenshot ? { finalScreenshot: finalState.finalScreenshot } : {}),
        ...(finalState.finalUrl ? { finalUrl: finalState.finalUrl } : {}),
        ...(metadata ? { metadata } : {}),
      });
    } else if (outcome.status === 'cancelled') {
      // Phase 1 follow-up — capture terminal frame on cancel too.
      // Users sometimes cancel mid-task and want to see the last
      // visible state.
      return await repo.persistVisionOutcome(taskId, {
        status: 'cancelled',
        tickCount: outcome.iterations,
        ...(finalState.finalScreenshot ? { finalScreenshot: finalState.finalScreenshot } : {}),
        ...(finalState.finalUrl ? { finalUrl: finalState.finalUrl } : {}),
        ...(metadata ? { metadata } : {}),
      });
    } else if (outcome.status === 'timeout') {
      return await repo.persistVisionOutcome(taskId, {
        status: 'failed',
        reason: outcome.reason ?? 'supercar: task timeout',
        tickCount: outcome.iterations,
        ...(finalState.finalScreenshot ? { finalScreenshot: finalState.finalScreenshot } : {}),
        ...(finalState.finalUrl ? { finalUrl: finalState.finalUrl } : {}),
        ...(metadata ? { metadata } : {}),
      });
    } else {
      // 'failed'
      return await repo.persistVisionOutcome(taskId, {
        status: 'failed',
        reason: outcome.reason ?? 'supercar: task failed',
        tickCount: outcome.iterations,
        ...(finalState.finalScreenshot ? { finalScreenshot: finalState.finalScreenshot } : {}),
        ...(finalState.finalUrl ? { finalUrl: finalState.finalUrl } : {}),
        ...(metadata ? { metadata } : {}),
      });
    }
  } catch (err) {
    // Best-effort — persistence failure is logged by the caller's .then().
    // Rethrow so the caller's logger catches it.
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * P1 — converge `tasks.plan_status` after a successful terminal write
 * for paths whose runner does not emit per-step `[STEP N done]`
 * markers (today: the supercar→generate handoff). Reads the row's
 * current `planStatus`, rolls every pending / running step to `done`
 * (leaves done/failed alone), writes back, and broadcasts the new
 * snapshot so the PlanCard catches up. Best-effort: a DB error is
 * logged, never thrown — the user already saw the terminal frame.
 */
async function convergePlanStatusOnSuccess(
  ctx: { db: import('../../db/client.js').DB; logger: import('pino').Logger },
  taskExternalId: string,
  userExternalId: string,
): Promise<void> {
  try {
    const row = await ctx.db
      .select({ planStatus: tasksTable.planStatus })
      .from(tasksTable)
      .where(eq(tasksTable.externalId, taskExternalId))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (!row) return;
    const raw = row.planStatus;
    if (!Array.isArray(raw) || raw.length === 0) return;
    type PlanRow = {
      idx: number;
      status: 'pending' | 'running' | 'done' | 'failed';
      note?: string;
    };
    const steps = raw as PlanRow[];
    let mutated = false;
    const converged: PlanRow[] = steps.map((s) => {
      if (s.status === 'pending' || s.status === 'running') {
        mutated = true;
        return { ...s, status: 'done' };
      }
      return { ...s };
    });
    if (!mutated) return;
    await ctx.db
      .update(tasksTable)
      .set({ planStatus: converged as unknown })
      .where(eq(tasksTable.externalId, taskExternalId));
    try {
      broadcastToUser(userExternalId, {
        type: 'server.task.plan_step',
        taskId: taskExternalId,
        planStatus: converged,
      });
    } catch (err) {
      ctx.logger.warn(
        { err, taskId: taskExternalId },
        'plan-step convergence broadcast failed',
      );
    }
  } catch (err) {
    ctx.logger.warn(
      { err, taskId: taskExternalId },
      'plan-step convergence persist failed',
    );
  }
}

/**
 * R7 — capture the per-task Brave's last visible state right before
 * `pool.release(taskId)` tears it down. The SPA's BrowserPanel uses
 * the result so a refresh-after-completion shows the user "this is
 * what HOLA DAY was looking at when it finished" instead of a blank
 * panel that retries the screencast WS forever.
 *
 * Best-effort: any executor / Playwright failure (already-closed
 * tab, navigation in flight, viewport gone) returns an empty object
 * and the persisted result simply omits the screenshot. The caller
 * doesn't need to differentiate.
 */
async function captureFinalState(
  executor: PlaywrightExecutor | null,
  logger: import('pino').Logger,
  taskId: string,
): Promise<{ finalScreenshot?: string; finalUrl?: string }> {
  if (!executor) return {};
  try {
    const page = await executor.getPage();
    const shot = await executor.screenshot(
      page as unknown as Parameters<PlaywrightExecutor['screenshot']>[0],
      { timeoutMs: 5_000 },
    );
    if (shot.error || !shot.base64) return {};
    let finalUrl: string | undefined;
    try {
      finalUrl = (page as unknown as { url: () => string }).url();
    } catch {
      finalUrl = undefined;
    }
    return {
      finalScreenshot: shot.base64,
      ...(finalUrl ? { finalUrl } : {}),
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), taskId },
      'captureFinalState: screenshot capture failed (non-fatal)',
    );
    return {};
  }
}

/**
 * Translate a supercar outcome to the `server.task.terminal` frame the
 * web workbench + extension already understand. `timeout` collapses to
 * `failed` over the wire so the schema doesn't need to widen.
 */
function buildTaskTerminalMessage(
  taskId: string,
  outcome: SupercarOutcome,
): import('@holaday/shared-types').ServerMessage {
  if (outcome.status === 'completed') {
    return {
      type: 'server.task.terminal',
      taskId,
      status: 'completed',
      ...(outcome.summary ? { summary: outcome.summary } : {}),
    };
  }
  if (outcome.status === 'cancelled') {
    return { type: 'server.task.terminal', taskId, status: 'cancelled' };
  }
  if (outcome.status === 'awaiting_user') {
    return {
      type: 'server.task.terminal',
      taskId,
      status: 'paused',
      ...(outcome.question ? { reason: outcome.question } : {}),
    };
  }
  // failed / timeout — translate the internal reason into a
  // user-facing Chinese explanation + one actionable suggestion.
  const friendly = friendlyFailureReason(outcome.status, outcome.reason);
  return {
    type: 'server.task.terminal',
    taskId,
    status: 'failed',
    reason: friendly,
  };
}

/**
 * Translate internal supercar reasons to user-facing Chinese text.
 *
 * Goal is to give the user two things every time:
 *   1. What went wrong, in plain Chinese (not "task timeout (600s) elapsed").
 *   2. One actionable suggestion (重试 / 手动登录 / 充值 / 简化任务).
 *
 * We pattern-match on the raw reason string rather than adding a
 * typed enum to SupercarOutcome — the loop emits reasons from many
 * code paths (Anthropic errors, URL resolver, playwright throws)
 * and a regex map is robust to new message shapes without a
 * coordinated schema bump. Unknown reasons fall through to a
 * generic but still friendly template so the user never sees raw
 * English stack trace bullets.
 */
/**
 * Run the supercar loop with one automatic retry on flaky failures.
 *
 * Retryable: the first run returned failed/timeout with iterations
 * < 3 and a reason that looks like AI-service-hiccup or transient
 * browser flake (overloaded, 429, 529, timeout, ECONNRESET, no
 * browser context). A 2nd attempt gets a fresh agent-loop state +
 * re-spawned page, so the odds of recovering are real.
 *
 * Non-retryable: > 2 iterations (agent did some work, probably
 * hit a real wall), login/captcha/credit/api-key failures,
 * cancelled, awaiting_user, completed. Those get returned as-is.
 *
 * We emit a lightweight `server.supercar.retrying` frame on the
 * WS so the UI can surface "正在重试…" without waiting for the
 * second attempt's first tick. Unknown to the client → ignored,
 * which is fine.
 */
async function runSupercarWithRetry(
  args: Parameters<typeof runSupercarTask>[0],
  meta: { userId: string; taskId: string; logger: import('pino').Logger },
): Promise<Awaited<ReturnType<typeof runSupercarTask>>> {
  const first = await runSupercarTask(args);
  if (!shouldAutoRetry(first)) return first;
  meta.logger.info(
    { taskId: meta.taskId, iterations: first.iterations, reason: first.reason },
    'supercar: auto-retrying once after flaky failure',
  );
  try {
    broadcastToUser(meta.userId, {
      type: 'server.task.progress',
      taskId: meta.taskId,
      message: '正在重试…',
    });
  } catch {
    /* broadcast best-effort */
  }
  const second = await runSupercarTask(args);
  meta.logger.info(
    {
      taskId: meta.taskId,
      firstStatus: first.status,
      secondStatus: second.status,
      secondIterations: second.iterations,
    },
    'supercar: retry completed',
  );
  return second;
}

function shouldAutoRetry(outcome: SupercarOutcome): boolean {
  if (outcome.status !== 'failed' && outcome.status !== 'timeout') return false;
  if (outcome.iterations >= 3) return false;
  const r = (outcome.reason ?? '').toLowerCase();
  if (/timeout|elapsed|超时/.test(r)) return true;
  if (/429|rate ?limit|too many requests/.test(r)) return true;
  if (/529|overloaded|overload/.test(r)) return true;
  if (/econn|fetch failed|network/.test(r)) return true;
  if (/no browser context|connectovercdp/.test(r)) return true;
  return false;
}

function friendlyFailureReason(
  status: SupercarOutcome['status'],
  raw: string | undefined,
): string {
  const r = (raw ?? '').toLowerCase();
  if (status === 'timeout' || /timeout|elapsed|time ?out|超时/.test(r)) {
    return '任务超时。可能原因：目标网站响应缓慢或被反爬拦截。建议：重试，或把任务描述简化后再试。';
  }
  if (/429|rate ?limit|too many requests/.test(r)) {
    return 'AI 服务当前繁忙（限速），请稍后再试。';
  }
  if (/529|overloaded|overload/.test(r)) {
    return 'AI 服务暂时过载，请几秒后重试。';
  }
  if (/credit|balance|insufficient|payment required|402/.test(r)) {
    return 'API 额度不足。请联系管理员续费或等下一计费周期。';
  }
  if (/401|unauthorized|invalid api key|authentication/.test(r)) {
    return 'AI 服务认证失败，请联系管理员检查 API key。';
  }
  if (/captcha|recaptcha|人机验证|滑块|verify/.test(r)) {
    return '遇到验证码。建议：在右侧 Panel 中手动完成验证，登录态会保存，下次无需重复。';
  }
  if (/login|signin|sign ?in|passport|oauth|需要登录|登录墙/.test(r)) {
    return '该网站需要登录才能继续。建议：在右侧 Panel 中手动登录一次，登录态会保存，然后重试任务。';
  }
  if (/missing anthropic_api_key/.test(r)) {
    return 'AI 服务未配置。请联系管理员检查部署。';
  }
  if (/no browser|no playwright|connectovercdp/.test(r)) {
    return '浏览器暂时不可用，请稍后重试。';
  }
  if (/network|econn|fetch failed|dns/.test(r)) {
    return '网络错误。请检查连接后重试。';
  }
  if (raw && raw.trim().length > 0) {
    return `任务执行失败：${raw.trim()}。建议：简化任务描述后重试。`;
  }
  return '任务执行失败。建议：简化任务描述后重试。';
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'bigint') return Number(v);
  return 0;
}

function normalizeOutput(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

async function loadTaskState(repo: TaskRepository, taskExternalId: string, userExternalId: string) {
  const all = await repo.rehydrateInFlight();
  const hit = all.find(
    (r) => r.state.taskId === taskExternalId && r.userExternalId === userExternalId,
  );
  if (!hit) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `task ${taskExternalId} not in-flight`,
    });
  }
  return hit.state;
}

/**
 * Active skills the user can route to.
 *
 * Phase 0 behaviour: we ALWAYS return every active Skill regardless of
 * the task's occupation. The reason: Skill selection happens inside
 * Opus (given the catalogue + the intent, the commander picks). The
 * orchestrator layer doesn't do keyword/intent matching here — and
 * pre-filtering by occupation was actively harmful (the popup's old
 * hardcoded `occupation: 'finance-research'` meant douyin Skills were
 * never in catalogue, so a "帮我看抖音后台" intent fell through to
 * xueqiu's allowedOrigins and the real douyin URL got ORIGIN_BLOCKED).
 *
 * Cost: catalogue is ~5-10 rows, few hundred tokens, Opus handles it.
 * Boundary is preserved because `unionAllowedOrigins` unions ALL
 * Skills' allowedOrigins — anything outside that union is still
 * blocked by the driver.
 *
 * `occupation` is kept on the signature for now as a Phase 1 knob
 * (we may want to *prefer* a Skill matching the user's occupation
 * tag when ranking / prompting Opus), but it no longer filters the
 * SQL query.
 */
async function loadSkillCatalogue(
  db: import('../../db/client.js').DB,
  _occupation: string | null,
): Promise<SkillCatalogueEntry[]> {
  const rows = await db
    .select({
      slug: skills.slug,
      description: skills.description,
      occupationTag: skills.occupationTag,
      manifest: skills.manifest,
    })
    .from(skills)
    .where(eq(skills.status, 'active'));

  return rows
    .filter((r): r is typeof r & { description: string } => Boolean(r.description))
    .map((r) => ({
      slug: r.slug,
      description: r.description,
      occupationTag: r.occupationTag,
      allowedOrigins: extractAllowedOrigins(r.manifest),
    }));
}

/**
 * Pull `allowedOrigins` out of a `skills.manifest` JSON column. The manifest
 * is the parsed SKILL.md front-matter; we only trust string entries. Returns
 * an empty array when the column is missing, malformed, or the key isn't
 * present — the caller unions across the whole catalogue so one misshaped
 * manifest doesn't widen the allowlist.
 */
function extractAllowedOrigins(manifest: unknown): readonly string[] {
  if (!manifest || typeof manifest !== 'object') return [];
  // MariaDB returns JSON columns as strings on some driver/config combos.
  const parsed =
    typeof manifest === 'string'
      ? (() => {
          try {
            return JSON.parse(manifest);
          } catch {
            return null;
          }
        })()
      : manifest;
  if (!parsed || typeof parsed !== 'object') return [];
  const entries = (parsed as { allowedOrigins?: unknown }).allowedOrigins;
  if (!Array.isArray(entries)) return [];
  return entries.filter((e): e is string => typeof e === 'string' && e.length > 0);
}

/**
 * Pick catalogue entries whose `allowedOrigins` covers ≥ 1 goto URL in
 * the plan — i.e. the Skills the plan will actually visit. A Skill is
 * "used" if any of its allowedOrigins entries matches any goto URL by
 * the same rules the driver will apply at dispatch time.
 *
 * Why bother: the catalogue is the full menu of Skills (all active) so
 * Opus can route, but the origin allowlist the driver enforces should
 * correspond to what the plan is actually doing. A plan that doesn't
 * touch any catalogued Skill is a free-form browse — `allowedOrigins`
 * comes back `[]`, and the driver treats empty as unrestricted.
 *
 * Reuses the driver's own `isOriginAllowed` to avoid rule-matching
 * drift between orchestrator and driver.
 */
function pickSkillsUsedByPlan(
  plan: PlannedStep[],
  catalogue: SkillCatalogueEntry[],
): SkillCatalogueEntry[] {
  const gotoUrls = plan
    .filter((s) => s.kind === 'goto')
    .map((s) => {
      const url = (s.payload as { url?: unknown } | undefined)?.url;
      return typeof url === 'string' ? url : null;
    })
    .filter((u): u is string => u !== null);
  if (gotoUrls.length === 0) return [];
  return catalogue.filter((entry) => {
    const origins = entry.allowedOrigins ?? [];
    if (origins.length === 0) return false;
    return gotoUrls.some((url) => urlMatchesAnyOrigin(url, origins));
  });
}

/**
 * Does `url` satisfy any of the `origins` rules? Mirrors the semantics
 * of `packages/browser-driver/src/origin-guard.ts::isOriginAllowed` —
 * the canonical enforcer lives in the driver; this is a read-only
 * pre-check on the orchestrator side for deciding which Skills to
 * union. Keep the rules identical so a URL that passes here passes
 * there too.
 */
function urlMatchesAnyOrigin(url: string, origins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.host.toLowerCase();
  const bareHost = parsed.hostname.toLowerCase();
  for (const rule of origins) {
    const r = rule.toLowerCase();
    if (r.startsWith('*.')) {
      const suffix = r.slice(2);
      if (bareHost === suffix) return true;
      if (bareHost.endsWith(`.${suffix}`)) return true;
    } else if (r === host || r === bareHost) {
      return true;
    }
  }
  return false;
}

/**
 * Union `allowedOrigins` across a list of Skills (typically the subset
 * the plan is using, picked by `pickSkillsUsedByPlan`). Empty result
 * means "no Skill used or none declared an origin allowlist" — the
 * driver treats empty as unrestricted. Deduped; order-preserving.
 */
function unionAllowedOrigins(catalogue: SkillCatalogueEntry[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of catalogue) {
    for (const origin of entry.allowedOrigins ?? []) {
      if (seen.has(origin)) continue;
      seen.add(origin);
      out.push(origin);
    }
  }
  return out;
}
