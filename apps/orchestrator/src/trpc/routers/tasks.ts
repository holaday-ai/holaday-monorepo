import Anthropic from '@anthropic-ai/sdk';
import {
  gateRoleForUser,
  newExternalId,
  type PlanId,
} from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { SkillCatalogueEntry } from '../../agent/planner.js';
import { injectResolvedUrl, resolveIntentUrl } from '../../agent/url-resolver.js';
import { env as appEnv } from '../../config/env.js';
import { buildBaiduSmokePlan } from '../../agent/smoke-plans.js';
import type { PlannedStep } from '../../agent/task-controller.js';
import { TaskController } from '../../agent/task-controller.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { describeSignal } from '../../agent/vision-loop/anti-bot-detector.js';
import { classify as classifyDomain } from '../../agent/vision-loop/domain/classifier.js';
import { visionLoopTaskQueue } from '../../agent/vision-loop/task-queue.js';
import { startVisionLoopTask } from '../../agent/vision-loop/task-runner.js';
import {
  classifyAsCrossPlatformAutomation,
  classifyAsSimpleSearch,
  runSupercarTask,
  supercarAbort,
  supercarReply,
  type SupercarOutcome,
} from '../../agent/supercar/index.js';
import {
  classifyRole,
  selectModelAndEffort,
} from '../../agent/supercar/prompt-layers.js';
import { generatePlan, shouldSkipPlan } from '../../agent/supercar/plan-service.js';
import { MemoryService } from '../../agent/supercar/memory-service.js';
import {
  StatsService,
  classifyTaskType,
  extractDomain,
} from '../../agent/supercar/stats-service.js';
import {
  formatForPrompt as formatPlaybooksForPrompt,
  matchPlaybooks,
} from '../../agent/supercar/playbook-service.js';
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

const taskController = new TaskController();

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
  '写代码', '写程序', '编程', '编写', '写一个', '写一段',
  '开发', '搭建', '搭一个', '建一个', '构建', '调试', '部署',
  '修复 bug', '修 bug', 'debug', '重构', '实现一个',
  'write code', 'build a', 'develop', 'deploy', 'compile', 'refactor',
];
const CODE_SUBJECTS = [
  '网站', '网页', '后台', '前端', '后端', '应用', '系统', '组件',
  '函数', '接口', 'api', 'sdk', '库', '插件', '小程序', '页面',
  '脚本', '程序', '代码', '小工具',
  'website', 'webapp', 'web app', 'app', 'component', 'function',
  'script', 'plugin', 'package', 'module', 'library',
];
function looksLikeCodeIntent(intent: string): boolean {
  const lower = intent.toLowerCase();
  const hasVerb = CODE_VERBS.some((v) => lower.includes(v));
  if (!hasVerb) return false;
  return CODE_SUBJECTS.some((s) => lower.includes(s));
}

export const tasksRouter = router({
  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    // O15 — code-task refusal lands BEFORE user lookup so even an
    // unauthenticated-token-in-fail-path doesn't get scaffolding.
    if (looksLikeCodeIntent(input.intent)) {
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
        | { summary?: string; reason?: string }
        | null;
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
    const effectiveIntent =
      planPreamble + (parentContextBlock ? parentContextBlock : '') + input.intent;

    // Phase 10 Tier 2 — quota + concurrency gate. Both block task
    // creation BEFORE the row is inserted, so the user gets a clean
    // error rather than a half-spawned task. Role classification is
    // also done here so we can record role_id + opus_used on the
    // task row at insert time (avoids a follow-up UPDATE).
    const planId: PlanId =
      userRow.plan === 'basic' || userRow.plan === 'pro' ? userRow.plan : 'free';
    const selectedRoles = (userRow.selectedRoles ?? []) as string[];

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
    const concurrentCount = await quotaService.getActiveTaskCount(userRow.id);
    if (concurrentCount >= getConcurrencyLimit(planId)) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: concurrencyExhaustedMessage(planId),
      });
    }
    // Follow-ups are free — they reuse the cost of the parent task. Skip
    // tryConsume entirely so a quota-exhausted user can still ask
    // "为什么失败" without paying again. opus_used flag stays false on
    // the DB row for the same reason (the follow-up doesn't count).
    let opusActuallyConsumed = false;
    if (!isFollowUp) {
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
    const braveAdapterReady = Boolean(ctx.executionRouter?.brave);
    /**
     * Brave-only fast lane: simple-search intents (price compare /
     * fact lookup / SERP-ish queries) short-circuit through Brave at
     * agent-loop.ts:299 BEFORE any browser tool call. So even when
     * the headless singleton is down (Brave crashed, dbus dead,
     * connect-on-boot failed), we can still serve these tasks via
     * Brave alone. The supercar gate below admits them on this
     * ticket; runSupercarTask's null-executor guard handles the
     * Brave-empty edge case.
     */
    const canShortCircuitBrave = isSimpleSearchIntent && braveAdapterReady;
    /**
     * Per-user pool fast lane: when the global headless singleton is
     * dead but this user has (or can spawn) their own pool slot, we
     * can still run supercar — the per-user Brave is functionally
     * equivalent to the singleton from runSupercarTask's view. Sync
     * `canAllocate` peek; the actual `allocate` happens inside the
     * branch and may fail under race (Brave crash mid-spawn). When
     * it does, primaryExecutor stays null and runSupercarTask's null
     * guard fails the task gracefully — the gate doesn't have to
     * second-guess. Without this third condition, every PRD / 笔记
     * / 分析 task fell through to vision-loop the moment the
     * singleton crashed, defeating Phase 8 + Phase 10 entirely.
     */
    const browserPoolEligible = Boolean(
      ctx.browserPool &&
        shouldUseBrowserPool(ctx.userId) &&
        ctx.browserPool.canAllocate(ctx.userId),
    );

    // Diagnostic (temporary, Round-4): log the supercar-gate inputs on
    // every tasks.create so BOSS can tell from pm2 logs exactly why a
    // task fell into the legacy branch. Happens BEFORE the gate so
    // the log always lands, regardless of which path is taken.
    ctx.logger.info(
      {
        gate: 'supercar-vs-legacy',
        AGENT_MODE: appEnv.AGENT_MODE,
        playwrightExecutorPresent: Boolean(ctx.playwrightExecutor),
        anthropicKeyPresent: Boolean(appEnv.ANTHROPIC_API_KEY),
        isSimpleSearchIntent,
        braveAdapterReady,
        canShortCircuitBrave,
        browserPoolEligible,
        willUseSupercar:
          appEnv.AGENT_MODE === 'supercar' &&
          Boolean(appEnv.ANTHROPIC_API_KEY) &&
          (Boolean(ctx.playwrightExecutor) || canShortCircuitBrave || browserPoolEligible),
      },
      'tasks.create: control-plane decision',
    );

    // Supercar path — Anthropic's official computer_20251124 +
    // web_search_20260209 tools driving Playwright directly, with
    // adaptive thinking + prompt caching. This is the default starting
    // with the superstar rewrite; flip AGENT_MODE=legacy to fall back
    // to the hand-rolled vision-loop.
    //
    // Browser requirement is conditional: simple-search tasks can
    // ride the Brave fast lane without one (canShortCircuitBrave),
    // so the legacy vision-loop fall-through is no longer triggered
    // every time the headless singleton dies — Brave handles the
    // common "对比京东淘宝" / "查 X 价格" intents standalone.
    if (
      appEnv.AGENT_MODE === 'supercar' &&
      appEnv.ANTHROPIC_API_KEY &&
      (ctx.playwrightExecutor || canShortCircuitBrave || browserPoolEligible)
    ) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);

      // Phase 13 Dim 1 — first-frame plan. Skipped for simple-search
      // (Brave fast-lane handles them), trivial intents, and any
      // intent shorter than 8 chars. Plan failures are non-fatal —
      // generatePlan returns { planText: null, planStatus: null }
      // and the loop continues without one. Run in parallel with
      // memory retrieval below to keep the tasks.create RTT close
      // to its pre-Phase-13 footprint.
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

      // Phase 8.2: when the caller is in MULTI_USER_USERS allow-list,
      // replace the shared headed singleton with their own pool slot.
      // The pool's executor is a freshly-connected PlaywrightExecutor
      // pointing at a dedicated Brave + Xvfb + VNC quartet — the rest
      // of the supercar loop sees a plain PlaywrightExecutor and
      // doesn't know the difference. If allocate throws (capacity
      // exceeded, spawn timeout) we surface a typed error so the UI
      // can show "browser-pool busy" rather than an opaque 500.
      let perUserExec = null;
      if (ctx.browserPool && shouldUseBrowserPool(ctx.userId)) {
        try {
          const instance = await ctx.browserPool.allocate(ctx.userId);
          perUserExec = instance.executor;
          ctx.logger.info(
            { taskId, userId: ctx.userId, cdpPort: instance.cdpPort, displayNum: instance.display },
            'pool: allocated browser for task',
          );
        } catch (err) {
          ctx.logger.error(
            { err: err instanceof Error ? err.message : String(err), userId: ctx.userId },
            'pool: allocate failed — falling back to shared headed singleton',
          );
          // Swallow + fall through: rather than hard-fail the task we
          // degrade to the shared Brave. User still gets a working
          // task; the alert-worthy event lands in logs.
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
          braveAdapter: ctx.executionRouter?.brave ?? null,
          zapierAdapter: ctx.executionRouter?.zapier ?? null,
          apifyAdapter: ctx.executionRouter?.apify ?? null,
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
              ctx.browserPool.touch(ctx.userId);
            }
            const actionKind = ev.toolsInTurn[0] ?? 'text';
            const actionSummary = ev.textPreamble
              ? truncateString(ev.textPreamble, 80)
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
                    output: { apiLatencyMs: ev.apiLatencyMs, tools: ev.toolsInTurn },
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
            // server-side and has no DOM to capture.
            try {
              broadcastToUser(userId, {
                type: 'server.supercar.web_search',
                taskId,
                iteration: ev.iteration,
                query: ev.query,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast web_search failed');
            }
          },
          onAwaitingUser(ev) {
            try {
              broadcastToUser(userId, {
                type: 'server.supercar.awaiting_user',
                taskId,
                question: ev.question,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast awaiting_user failed');
            }
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
      const runFn = () =>
        runSupercarWithRetry(supercarArgs, { userId, taskId, logger: ctx.logger })
          .then(async (outcome) => {
            ctx.logger.info(
              { taskId, status: outcome.status, iterations: outcome.iterations, toolsUsed: outcome.toolsUsed },
              'supercar: task terminated',
            );
            await persistSupercarOutcome(repo, taskId, outcome);
            try {
              broadcastToUser(userId, buildTaskTerminalMessage(taskId, outcome));
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast terminal failed');
            }
            // Phase 13 Dim 5 — memory extraction. Run only on
            // completed tasks to avoid storing tips from the
            // partial / failed state of the agent. Best-effort:
            // rejections log + continue (the user's task is done
            // regardless of memory outcome).
            if (outcome.status === 'completed' && outcome.summary && appEnv.ANTHROPIC_API_KEY) {
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
            }
          })
          .catch((err) => {
            ctx.logger.error({ err, taskId }, 'supercar: loop threw');
          });

      void visionLoopTaskQueue.enqueue(userId, runFn, (position) => {
        if (position > 1) {
          try {
            broadcastToUser(userId, {
              type: 'server.task.queued',
              taskId,
              position,
            });
          } catch (err) {
            ctx.logger.warn({ err, taskId }, 'supercar: broadcast queued failed');
          }
        }
      });

      return { taskId, status: 'executing' as const, steps: [] };
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
          .catch((err) => {
            ctx.logger.error({ err, taskId }, 'vision loop threw');
          });

      void visionLoopTaskQueue.enqueue(ctx.userId, runTaskFn, (position) => {
        if (position > 1) {
          ctx.logger.info(
            { taskId, userId: ctx.userId, queuePosition: position },
            'vision loop task queued behind earlier work',
          );
          // G6: surface the queue position to any connected web
          // workbench so the sidebar can show "排队中 · 第 N 位".
          // Best-effort — broadcastToUser is a noop if nobody's
          // listening, and a throw here must not block enqueue.
          try {
            broadcastToUser(ctx.userId, {
              type: 'server.task.queued',
              taskId,
              position,
            });
          } catch (err) {
            ctx.logger.warn({ err, taskId }, 'broadcast task.queued failed');
          }
        }
      });
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
      if (input.cursor) conds.push(lt(tasksTable.id, input.cursor));
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
          createdAt: tasksTable.createdAt,
          updatedAt: tasksTable.updatedAt,
          completedAt: tasksTable.completedAt,
        })
        .from(tasksTable)
        .where(and(...conds))
        .orderBy(desc(tasksTable.id))
        .limit(input.limit);

      return {
        tasks: rows.map((r) => ({
          taskId: r.externalId,
          intent: r.intent,
          title: r.title,
          status: r.status,
          pauseReason: r.pauseReason,
          errorCode: r.errorCode,
          errorMessage: r.errorMessage,
          result: normalizeOutput(r.result),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          completedAt: r.completedAt,
        })),
        nextCursor: rows.length === input.limit ? (rows[rows.length - 1]?.id ?? null) : null,
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

      return {
        taskId: taskRow.externalId,
        intent: taskRow.intent,
        title: taskRow.title,
        status: taskRow.status,
        pauseReason: taskRow.pauseReason,
        errorCode: taskRow.errorCode,
        errorMessage: taskRow.errorMessage,
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
    .input(z.object({ taskId: z.string().min(1), message: z.string().min(1).max(4_000) }))
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
      const delivered = supercarReply(input.taskId, input.message);
      return { ok: delivered };
    }),

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
    if (!ctx.browserPool) {
      return { status: 'unavailable' as const, reason: 'pool_disabled' };
    }
    try {
      const inst = await ctx.browserPool.allocate(ctx.userId);
      ctx.logger.info(
        { userId: ctx.userId, cdpPort: inst.cdpPort, status: inst.status },
        'tasks.wakeBrowser: instance ready',
      );
      return {
        status: 'ready' as const,
        cdpPort: inst.cdpPort,
        // The SPA's VNC URL builder pulls userId off auth.me — no
        // need to echo it back here. Returning cdpPort lets ops
        // dashboards correlate "wake" calls with pool slots.
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.warn(
        { userId: ctx.userId, err: msg },
        'tasks.wakeBrowser: allocate failed',
      );
      // PoolCapacityError surfaces the same way as a generic spawn
      // error to the SPA — the user's recourse is identical (wait,
      // try again later). Distinguishing them in the response would
      // just be more cases the SPA has to switch on.
      return { status: 'unavailable' as const, reason: msg.slice(0, 200) };
    }
  }),

  resetBrowser: protectedProcedure.mutation(async ({ ctx }) => {
    // Pool users reset their own Brave; everyone else resets the
    // shared headed singleton. peek() never allocates — we don't
    // want a fresh quartet just for a new-task nudge, and if the
    // user doesn't yet have one there's nothing to reset.
    const poolInstance =
      ctx.browserPool && shouldUseBrowserPool(ctx.userId)
        ? ctx.browserPool.peek(ctx.userId)
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const poolInstance =
        ctx.browserPool && shouldUseBrowserPool(ctx.userId)
          ? ctx.browserPool.peek(ctx.userId)
          : null;
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
 * Persist a supercar run's terminal state via the same
 * `persistVisionOutcome` the legacy vision-loop uses. Maps the
 * supercar-specific statuses back to the tasks.status enum.
 */
async function persistSupercarOutcome(
  repo: TaskRepository,
  taskId: string,
  outcome: SupercarOutcome,
): Promise<void> {
  try {
    if (outcome.status === 'completed') {
      await repo.persistVisionOutcome(taskId, {
        status: 'completed',
        summary: outcome.summary ?? '',
        tickCount: outcome.iterations,
      });
    } else if (outcome.status === 'awaiting_user') {
      // Shouldn't land here in the happy path — the loop returns a
      // terminal status after the reply, not awaiting_user. Persist as
      // paused so the UI still renders sensibly if it did.
      await repo.persistVisionOutcome(taskId, {
        status: 'paused',
        reason: outcome.question ?? 'awaiting user reply',
        tickCount: outcome.iterations,
      });
    } else if (outcome.status === 'cancelled') {
      await repo.persistVisionOutcome(taskId, {
        status: 'cancelled',
        tickCount: outcome.iterations,
      });
    } else if (outcome.status === 'timeout') {
      await repo.persistVisionOutcome(taskId, {
        status: 'failed',
        reason: outcome.reason ?? 'supercar: task timeout',
        tickCount: outcome.iterations,
      });
    } else {
      // 'failed'
      await repo.persistVisionOutcome(taskId, {
        status: 'failed',
        reason: outcome.reason ?? 'supercar: task failed',
        tickCount: outcome.iterations,
      });
    }
  } catch (err) {
    // Best-effort — persistence failure is logged by the caller's .then().
    // Rethrow so the caller's logger catches it.
    throw err instanceof Error ? err : new Error(String(err));
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
      type: 'server.task.info',
      taskId: meta.taskId,
      message: '正在重试…',
    } as never);
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
