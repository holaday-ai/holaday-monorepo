/**
 * Supercar agent loop.
 *
 * Drives Anthropic's official `computer_20251124` + `web_search_20260209`
 * tools on Claude Sonnet 4.6 (default — overridable via SUPERCAR_MODEL)
 * through the same PlaywrightExecutor the legacy vision-loop already
 * uses. No hand-rolled tool schema, no custom agent scaffold: the
 * model decides when to take a screenshot, when to click, when to run
 * a web_search, and when to stop.
 *
 * Why a fresh module instead of patching vision-loop: the two stacks
 * have different tool shapes (coordinate vs. a11y refs), different
 * commander contracts, and different prompt-cache invariants. Living
 * side-by-side lets `AGENT_MODE=legacy` stay the escape hatch while
 * we dogfood supercar.
 *
 * Surface: `runSupercarTask(options)` returns a RunOutcome that mirrors
 * the legacy `VisionLoopRunner.run()` shape so `tasks.ts` can persist
 * the result via the same `TaskRepository.persistVisionOutcome`
 * without a second persistence path. Per-iteration side effects
 * (broadcasts, task_steps rows) flow through the callback bundle —
 * same pattern as `startVisionLoopTask`.
 *
 * User-reply flow: when Claude emits a text-only response that looks
 * like a question (endswith '？' / '?', no tool_use), the loop parks
 * on a `pendingReply` promise and fires `onAwaitingUser`. The caller
 * drives `supercarReply(taskId, text)` from a tRPC mutation; that
 * resolves the promise and the loop resumes by appending a `user`
 * turn with the reply text. No browser state is touched across that
 * pause — the PlaywrightExecutor's pinned page stays where it was.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import {
  type AntiBotSignal,
  describeSignal,
  detectAntiBot,
} from '../vision-loop/anti-bot-detector.js';
import type { PageLike, PlaywrightExecutor } from '../vision-loop/playwright-executor.js';
import { logger } from '../../config/logger.js';
import type { DomainName } from '../vision-loop/domain/classifier.js';
import type { ApifyAdapter } from './adapters/apify.js';
import type { BraveSearchAdapter } from './adapters/brave-search.js';
import type { ZapierAdapter } from './adapters/zapier.js';
import {
  classifyRole,
  getTaskBudget,
  selectModelAndEffort,
  type Effort,
} from './prompt-layers.js';
import { buildSupercarSystemPrompt } from './system-prompt.js';
import { env as appEnv } from '../../config/env.js';

/**
 * Anti-crawl stuck detection thresholds.
 *
 * When the same page screenshot repeats across N consecutive computer
 * actions, the site is probably blocking us. But "probably" is doing
 * a lot of work here — the model genuinely needs a few turns to load
 * a site, scroll, observe, then act. If we bail too early we get the
 * anti-pattern the Phase 5 benchmark caught: every stuck hit degrades
 * to web_search and the agent never actually drives the browser.
 *
 * Raised from (3 / 5) to (6 / 12) so the model gets:
 *   - 6 quiet turns before it's warned with mobile-site + retry hints
 *   - another 6 turns after the warning to try alternate tactics
 *   - only then does the hard "stop browsing, wrap up" nudge land
 *
 * Goal: the browser path gets a real chance to succeed before we
 * concede to search. The matching prompt push on the model side
 * ("try m.xxx.com, reset with about:blank, swap alternate hostname
 * before giving up") lives in system-prompt.ts.
 *
 * Exact MD5 hash comparison — JPEG compression is deterministic for
 * identical input, and cursor-move-only diffs produce different bytes
 * (which we want: cursor motion IS progress).
 */
const STUCK_WARN_THRESHOLD = 6;
const STUCK_EXIT_THRESHOLD = 12;

export type SupercarStatus = 'completed' | 'failed' | 'awaiting_user' | 'timeout' | 'cancelled';

/**
 * Shape the loop hands back to `tasks.ts`. Compatible with the legacy
 * vision-loop outcome enough that `TaskRepository.persistVisionOutcome`
 * can accept it after a thin adapter (see `toLegacyOutcome` below).
 */
export interface SupercarOutcome {
  status: SupercarStatus;
  /** Populated on status=completed — the model's final markdown report. */
  summary?: string;
  /** Populated on awaiting_user — the question the model asked the user. */
  question?: string;
  /** Populated on failed / timeout — short Chinese reason for the UI. */
  reason?: string;
  /** How many API round-trips we made (1 iteration = 1 messages.create call). */
  iterations: number;
  /** Which tools the model actually used over the run. Useful for audit + metrics. */
  toolsUsed: string[];
}

export interface SupercarTickEvent {
  iteration: number;
  /**
   * All tool names the model invoked in THIS iteration. Typically 0 or
   * 1 entries — Claude emits one `tool_use` per response, but parallel
   * tool calls are possible when `disable_parallel_tool_use` is unset.
   */
  toolsInTurn: string[];
  /** Model's short text preamble this turn, if any — used for step cards. */
  textPreamble: string;
  /** Latency of the API call itself (ms). */
  apiLatencyMs: number;
}

export interface SupercarAwaitingUserEvent {
  question: string;
  /** When this question was asked. */
  at: Date;
}

export interface SupercarWebSearchEvent {
  iteration: number;
  query: string;
}

export interface SupercarScreencastEvent {
  iteration: number;
  /** Base64 JPEG, no data: prefix — matches the legacy screencast shape. */
  imageBase64: string;
  url: string;
  viewportWidth: number;
  viewportHeight: number;
}

export interface SupercarAntiBotEvent {
  iteration: number;
  signal: AntiBotSignal;
  /**
   * Milliseconds the UI should show the "please solve this captcha"
   * prompt before we abandon the wait. The agent doesn't actually
   * pause on this (it keeps trying alternate tactics); this is how
   * long the UI's captcha banner stays visible by default.
   */
  waitTimeoutMs: number;
}

export interface SupercarAntiBotResolvedEvent {
  iteration: number;
  /** Why the banner cleared: 'auto' = next screenshot had no anti-bot markers. */
  reason: 'auto';
}

export interface RunSupercarOptions {
  /** External task id (task_…). Correlates hooks and WS frames. */
  taskId: string;
  /** Free-form user intent — the first user message. */
  intent: string;
  /**
   * Connected Playwright executor. Nullable to support the
   * Brave-only fast lane: simple-search tasks short-circuit at line
   * 299 without ever touching a browser, so we accept the call even
   * when the headless singleton is dead. The model loop below the
   * Brave block guards against null and fails the task with a clear
   * reason rather than crashing on `executor.observe()`.
   */
  executor: PlaywrightExecutor | null;
  /** API key; defaults to `ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Override the default model (`claude-sonnet-4-6`). */
  model?: string;
  /** Cap on messages.create calls per run. Default 50. */
  maxIterations?: number;
  /** Whole-task wall clock (ms). Default 600_000 (10 min). */
  timeoutMs?: number;
  /**
   * Classifier output — passed to the system-prompt composer so the
   * domain YAML fragment lands at the end of the cached prefix.
   */
  domain?: DomainName | null;

  // --- callbacks, all optional, all best-effort ---
  onTick?: (ev: SupercarTickEvent) => void | Promise<void>;
  onScreencast?: (ev: SupercarScreencastEvent) => void | Promise<void>;
  onWebSearch?: (ev: SupercarWebSearchEvent) => void | Promise<void>;
  onAwaitingUser?: (ev: SupercarAwaitingUserEvent) => void | Promise<void>;
  onThinking?: (summary: string) => void | Promise<void>;
  /**
   * Fired when detectAntiBot flags a fresh HIGH-confidence signal on
   * the page text (captcha / cloudflare / block). Called once per
   * detection — not per turn the banner remains visible. Caller
   * typically broadcasts `server.vision.captcha_detected`.
   */
  onAntiBotSignal?: (ev: SupercarAntiBotEvent) => void | Promise<void>;
  /**
   * Fired when a previously-flagged anti-bot banner clears on the
   * next screenshot. Caller typically broadcasts
   * `server.vision.captcha_resolved`.
   */
  onAntiBotResolved?: (ev: SupercarAntiBotResolvedEvent) => void | Promise<void>;

  // --- Phase 6-2: 5-lane router inputs ---
  /**
   * Optional headed executor (Lane 2). When provided, the loop swaps
   * the active executor over to this on high-confidence anti-bot
   * signals or when stuckCount crosses STUCK_WARN_THRESHOLD. At most
   * one swap per task; swapping back is not supported.
   */
  headedExecutor?: PlaywrightExecutor | null;
  /** Brave Search adapter (Lane 3). When provided AND the simple-search classifier matched, the loop short-circuits before the first API call. */
  braveAdapter?: BraveSearchAdapter | null;
  /** Zapier adapter (Lane 4). When provided AND the intent looks like a workflow trigger, the loop short-circuits. */
  zapierAdapter?: ZapierAdapter | null;
  /**
   * Apify adapter (Lane 5). When provided AND the intent has a
   * registered actor AND the browser gets stuck, the loop delegates
   * to the actor and folds the scraped items into the summary.
   */
  apifyAdapter?: ApifyAdapter | null;
  /** Simple-search classifier output. Drives the Brave short-circuit. */
  isSimpleSearch?: boolean;
  /** Cross-platform-automation classifier output. Drives the Zapier short-circuit. */
  isCrossPlatformAutomation?: boolean;
  /**
   * Optional Zapier webhook path (e.g. "/hooks/catch/12345/abc/"). Only
   * used when isCrossPlatformAutomation + zapierAdapter are both set.
   * Absent → Zapier lane is skipped even if classifier matched.
   */
  zapierWebhookPath?: string | null;
}

// ---------------------------------------------------------------------------
// In-memory handle table for the user-reply flow
// ---------------------------------------------------------------------------

interface RunHandle {
  /** Resolve the pending-reply promise with the user's text. */
  resolveReply: ((text: string) => void) | null;
  /** Flip to signal the loop that the client aborted the run. */
  abort: () => void;
}

const handles = new Map<string, RunHandle>();

/**
 * Resume a supercar run that's parked on `onAwaitingUser`. Returns
 * true if the task accepted the reply, false if the task isn't
 * currently waiting for one (unknown taskId, already moved on, etc.).
 *
 * Called from the `tasks.reply` tRPC mutation.
 */
export function supercarReply(taskId: string, message: string): boolean {
  const handle = handles.get(taskId);
  if (!handle || !handle.resolveReply) return false;
  const resolve = handle.resolveReply;
  handle.resolveReply = null;
  resolve(message);
  return true;
}

/**
 * Abort a running task. If the task is mid-API-call this will cause
 * the next loop iteration to bail; if it's parked on `onAwaitingUser`
 * the pending-reply promise rejects and the loop exits cancelled.
 */
export function supercarAbort(taskId: string): boolean {
  const handle = handles.get(taskId);
  if (!handle) return false;
  handle.abort();
  return true;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const COMPUTER_USE_BETA = 'computer-use-2025-11-24';

export async function runSupercarTask(opts: RunSupercarOptions): Promise<SupercarOutcome> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      status: 'failed',
      reason: 'missing ANTHROPIC_API_KEY',
      iterations: 0,
      toolsUsed: [],
    };
  }

  // Phase 10 Tier 1 — visibility log up-front. Fires for EVERY supercar
  // entry, including ones that exit via the Brave / Zapier short-circuits
  // below before the model loop ever runs. Without it the routing
  // decision is invisible whenever Brave handles the task.
  const tier1Diag = appEnv.PHASE10_TIER1;
  if (tier1Diag) {
    const roleIdDiag = classifyRole(opts.intent);
    const routedDiag = selectModelAndEffort(opts.intent, roleIdDiag);
    logger.info(
      {
        taskId: opts.taskId,
        tier1: true,
        model: routedDiag.model,
        effort: routedDiag.effort,
        roleId: roleIdDiag,
        taskBudget: getTaskBudget(opts.intent, roleIdDiag),
      },
      'supercar: model + role routing',
    );
  }

  // ---------------------------------------------------------------
  // Phase 6-2: non-browser lane short-circuits (before any model call)
  // ---------------------------------------------------------------
  // Lane 3 — Brave. Pure info queries never need a browser; pipe the
  // SERP through a single Claude synthesis call and return a concise
  // answer. Round-2b change: we no longer dump 10 links as markdown —
  // BOSS flagged that output as "搜索结果堆给用户" noise. One small
  // Haiku-tier synthesis gives prose output with only the links it
  // actually cited, comparable to what the browser loop would emit.
  // Diagnostic: always log which decision we took here. When BOSS
  // sees a "simple search" task take the browser path, the first
  // question is "did classifyAsSimpleSearch fire?" and this log line
  // answers it without requiring a separate reproduction.
  logger.info(
    {
      taskId: opts.taskId,
      isSimpleSearch: Boolean(opts.isSimpleSearch),
      braveAdapterPresent: Boolean(opts.braveAdapter),
      intentPreview: opts.intent.slice(0, 80),
    },
    'supercar: routing decision',
  );
  if (opts.isSimpleSearch && opts.braveAdapter) {
    const r = await opts.braveAdapter.search(opts.intent, 10);
    if ('results' in r && r.results.length > 0) {
      logger.info(
        { taskId: opts.taskId, lane: 'brave', count: r.results.length },
        'supercar: short-circuit via Brave Search',
      );
      const synthesized = await synthesizeBraveResults({
        apiKey,
        intent: opts.intent,
        results: r.results,
        model: opts.model ?? process.env.SUPERCAR_MODEL ?? 'claude-sonnet-4-6',
        logger,
        taskId: opts.taskId,
      });
      return {
        status: 'completed',
        summary: synthesized,
        iterations: 1,
        toolsUsed: ['brave_search'],
      };
    }
    // Fall through to browser path on empty / error. Surface the
    // exact reason at warn level — BOSS needs this to tell "Brave
    // was rate-limited" apart from "classifier didn't match".
    logger.warn(
      {
        taskId: opts.taskId,
        err: 'error' in r ? r.error : null,
        resultCount: 'results' in r ? r.results.length : 0,
        intent: opts.intent,
      },
      'supercar: Brave returned no usable output — falling through to browser',
    );
  }

  // Lane 4 — Zapier. Only triggers when the caller supplied BOTH the
  // classifier match AND an explicit webhook path; we don't guess
  // routes. The hook returns a run id the user can track in Zapier.
  if (opts.isCrossPlatformAutomation && opts.zapierAdapter && opts.zapierWebhookPath) {
    const r = await opts.zapierAdapter.trigger(opts.zapierWebhookPath, {
      intent: opts.intent,
      task_id: opts.taskId,
    });
    if ('ok' in r) {
      logger.info(
        { taskId: opts.taskId, lane: 'zapier', runId: r.runId ?? null },
        'supercar: triggered Zap via webhook',
      );
      const lines = [
        `# 已触发 Zap 工作流`,
        '',
        `任务已通过 Zapier 触发，后台异步执行。`,
      ];
      if (r.runId) lines.push(`- Run ID: \`${r.runId}\``);
      if (r.statusUrl) lines.push(`- 查看进度：${r.statusUrl}`);
      return {
        status: 'completed',
        summary: lines.join('\n'),
        iterations: 0,
        toolsUsed: ['zapier'],
      };
    }
    logger.warn(
      { taskId: opts.taskId, err: r.error },
      'supercar: Zapier trigger failed — falling through to browser',
    );
  }

  // Past every non-browser short-circuit. Anything below this point
  // dispatches tool calls against `executor`, so a null one is fatal
  // — fail the task with a clear reason rather than crash on the
  // first `executor.observe()`. Reaching here with no executor means
  // a simple-search task arrived via the relaxed tasks.ts gate, the
  // Brave fast lane returned empty/error, and the legacy headless
  // singleton is also down — there is no browser to fall back to.
  if (!opts.executor) {
    logger.warn(
      { taskId: opts.taskId, isSimpleSearch: Boolean(opts.isSimpleSearch) },
      'supercar: no executor available after non-browser short-circuits — failing task',
    );
    return {
      status: 'failed',
      reason: 'browser unavailable (Brave/Chromium down) and Brave Search fallback returned no usable results',
      iterations: 0,
      toolsUsed: opts.isSimpleSearch ? ['brave_search'] : [],
    };
  }

  const client = new Anthropic({ apiKey });
  // Phase 10 Tier 1: route model + effort + task_budget per (intent, role).
  // When the env flag is off the legacy fixed-model path runs, identical to
  // pre-Tier-1 behaviour. `roleId` also drives which Role layer the prompt
  // composer injects below.
  const tier1 = appEnv.PHASE10_TIER1;
  const roleId = classifyRole(opts.intent);
  const routed = tier1
    ? selectModelAndEffort(opts.intent, roleId)
    : { model: opts.model ?? process.env.SUPERCAR_MODEL ?? 'claude-sonnet-4-6', effort: 'high' as Effort };
  const model = routed.model;
  const effort: Effort = routed.effort;
  const taskBudget = tier1 ? getTaskBudget(opts.intent, roleId) : null;
  // Opus 4.7 has a more expensive tokenizer (1-1.35× input bytes/token);
  // give it more output room. Sonnet keeps the prior 8K cap.
  const maxTokens = model === 'claude-opus-4-7' ? 8192 : 8192;
  // Note: the routing decision is logged earlier (right after the
  // ANTHROPIC_API_KEY check) under 'supercar: model + role routing'
  // so it's visible even when Brave / Zapier short-circuit before
  // the model loop runs. No need to log again here.
  const maxIterations =
    opts.maxIterations ?? Number.parseInt(process.env.SUPERCAR_MAX_ITERATIONS ?? '50', 10);
  const timeoutMs =
    opts.timeoutMs ?? Number.parseInt(process.env.SUPERCAR_TIMEOUT_MS ?? '600000', 10);
  const deadline = Date.now() + timeoutMs;

  // Browser executor is LET, not const — Phase 6-2 swaps it to the
  // headed lane on anti-bot strikes. Every subsequent screenshot /
  // click / type reads this var, so the swap is transparent to the
  // rest of the loop.
  let executor: PlaywrightExecutor = opts.executor;
  /** Fire at most once — multiple swaps mid-task cause page flicker. */
  let executorSwapped = false;
  async function swapToHeadedIfAvailable(reason: string): Promise<boolean> {
    if (executorSwapped) return false;
    if (!opts.headedExecutor) return false;
    executorSwapped = true;
    const priorUrl = page.url();
    logger.info(
      { taskId: opts.taskId, reason, priorUrl, lane: 'headed' },
      'supercar: swapping to headed executor',
    );
    executor = opts.headedExecutor;
    try {
      await executor.resetPageForTask();
      const hp = (await executor.getPage()) as unknown as PageLike;
      // Re-navigate to the prior URL so Claude sees the same
      // destination on the next tool_result. If the prior URL is
      // about:blank (we never navigated), skip — Claude will navigate
      // fresh on its next tool call.
      if (priorUrl && priorUrl !== 'about:blank') {
        await (hp as unknown as { goto: (u: string) => Promise<void> }).goto(priorUrl);
      }
    } catch (err) {
      logger.warn(
        { taskId: opts.taskId, err: err instanceof Error ? err.message : String(err) },
        'supercar: swap re-navigate failed — continuing',
      );
    }
    return true;
  }

  // Park the tab on a fresh about:blank so stale overlays from prior
  // tasks don't leak into the first screenshot.
  try {
    await executor.resetPageForTask();
  } catch (err) {
    logger.warn({ err, taskId: opts.taskId }, 'supercar: resetPageForTask failed — continuing');
  }

  let page = (await executor.getPage()) as unknown as PageLike;
  // Note: `page` is const-ish in spirit but the executor swap above
  // re-reads it via getPage() inside the helper, so downstream uses
  // can rely on always calling executor.getPage() to pick up the new
  // browser. The loop-body already does so on every iteration.

  // Initial observation — the model needs to see the current page to
  // ground its first action.
  const initialShot = await executor.screenshot(page);
  if (initialShot.error || !initialShot.base64) {
    return {
      status: 'failed',
      reason: `initial screenshot failed: ${initialShot.error ?? 'unknown'}`,
      iterations: 0,
      toolsUsed: [],
    };
  }
  const displayWidth = initialShot.viewportWidth ?? 1280;
  const displayHeight = initialShot.viewportHeight ?? 800;

  // Fire the first screencast so the UI gets a frame before Claude's
  // first response lands.
  await safeCall(opts.onScreencast, {
    iteration: 0,
    imageBase64: initialShot.base64,
    url: page.url(),
    viewportWidth: displayWidth,
    viewportHeight: displayHeight,
  });

  // Pass the raw intent to the prompt composer so the role-matcher can
  // pick a specialisation (小红书运营 / 法律检索 / PM / ...). The role
  // addon appends after the domain fragment, before the cache
  // breakpoint gets placed on the composed string.
  //
  // Phase 10 Tier 1: when enabled, swap the monolithic core prompt for
  // the lean Base + Role + Style layout. Layered prompts cache better
  // (Base is identical across all tasks) and are cheaper per request.
  const systemPrompt = buildSupercarSystemPrompt({
    domain: opts.domain ?? null,
    intent: opts.intent,
    layered: tier1,
  });

  type MsgParam = Anthropic.Beta.BetaMessageParam;
  type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

  const messages: MsgParam[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: opts.intent },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: initialShot.base64,
          },
        },
      ] as ContentBlockParam[],
    },
  ];

  const toolsUsed = new Set<string>();
  let iteration = 0;
  let cancelled = false;
  // MD5 of the most recent screenshot we showed Claude. Compared after
  // each computer action's fresh shot — identical bytes means the page
  // didn't react to the action (reset on every real change).
  let lastScreenshotHash: string | null = createHash('md5').update(initialShot.base64).digest('hex');
  // Monotonic count of consecutive no-change screenshots. Reset to 0 on
  // any hash change.
  let stuckCount = 0;
  // Once we cross STUCK_EXIT_THRESHOLD we inject a "stop browsing, wrap
  // up" user turn exactly once. This flag prevents re-injecting on every
  // subsequent iteration while Claude finalises.
  let stuckForceFinalised = false;
  // Tracks whether the LAST detected signal is still "in effect" — set
  // on first HIGH-confidence detection, cleared on a turn that has
  // none. Used to avoid re-firing onAntiBotSignal every single turn
  // while the captcha banner sits there, and to fire onAntiBotResolved
  // the moment the page has moved on.
  let activeAntiBotSignal: AntiBotSignal | null = null;
  /** One-shot guard for the Apify fallback path; runs at most once per task. */
  let apifyAttempted = false;
  // Captured from the first response that materialised a server-side
  // code_execution sandbox (Sonnet 4.6 + computer-use-2025-11-24 beta
  // auto-enables this). Re-passed on every subsequent messages.create
  // so the replayed server_tool_use + *_tool_result blocks stay valid.
  // See the block in the loop where we set it from response.container.
  let containerId: string | null = null;

  // Install the per-task handle so `supercarReply` / `supercarAbort`
  // can find us later.
  const handle: RunHandle = {
    resolveReply: null,
    abort: () => {
      cancelled = true;
      if (handle.resolveReply) {
        // If we're parked on awaiting_user, wake the promise with a
        // sentinel the loop will recognise as abort.
        const r = handle.resolveReply;
        handle.resolveReply = null;
        r('__SUPERCAR_ABORT__');
      }
    },
  };
  handles.set(opts.taskId, handle);

  try {
    while (iteration < maxIterations && Date.now() < deadline && !cancelled) {
      iteration++;

      const apiStart = Date.now();
      let response: Anthropic.Beta.BetaMessage;
      // Phase 10 follow-up: bound each API call at 120s and retry
      // once on timeout. Without this, a stalled Anthropic backend
      // can leave the task in 'executing' indefinitely (the outer
      // SUPERCAR_TIMEOUT_MS deadline only fires between iterations,
      // never during an in-flight await).
      const API_TIMEOUT_MS = 120_000;
      try {
        // Phase 10 Tier 1 betas: server-side compaction + advisory
        // task budgets. Each is appended only when the master flag is
        // on; the legacy path stays on COMPUTER_USE_BETA alone.
        const betas: string[] = [COMPUTER_USE_BETA];
        if (tier1) {
          betas.push('compact-2026-01-12', 'task-budgets-2026-03-13');
        }

        // output_config carries effort + task_budget. Both are GA on
        // Opus-tier and Sonnet 4.6, and both no-op cleanly on the
        // legacy path because we just don't pass them.
        // `xhigh` is Opus-4.7-only — selectModelAndEffort guards that.
        const outputConfig: Record<string, unknown> | null = tier1
          ? {
              effort,
              ...(taskBudget !== null
                ? { task_budget: { type: 'tokens', total: taskBudget } }
                : {}),
            }
          : null;

        const buildApiCall = () => client.beta.messages.create({
          model,
          max_tokens: maxTokens,
          // Top-level cache_control auto-places the breakpoint on the
          // last cacheable block (system here). Saves us hand-rolling
          // breakpoint placement and matches Anthropic's recommended
          // shape — see shared/prompt-caching.md.
          cache_control: { type: 'ephemeral' },
          system: [
            {
              type: 'text',
              text: systemPrompt,
            },
          ],
          messages,
          tools: [
            {
              type: 'computer_20251124',
              name: 'computer',
              display_width_px: displayWidth,
              display_height_px: displayHeight,
              enable_zoom: true,
            },
            {
              type: 'web_search_20260209',
              name: 'web_search',
            },
            // Custom `navigate` tool. The sole way to change the page's
            // URL in this environment — `page.screenshot()` captures
            // only the viewport, not the Chrome UI chrome, so Claude
            // can't see (or click) the address bar. Without this,
            // every task starts on about:blank and stays there.
            //
            // Phase 1-6 "browser" wins were all Claude silently routing
            // around this missing capability by spawning Python +
            // Playwright inside the server-side code_execution sandbox.
            // The computer tool itself never successfully drove a
            // page.goto. Adding this tool makes the browser path
            // actually work.
            {
              type: 'custom',
              name: 'navigate',
              description:
                '跳转浏览器标签到指定 URL。**本环境不显示地址栏，这是唯一的导航方式** —— 不要尝试用 key "ctrl+l" + type 的组合。返回跳转后的页面截图。',
              input_schema: {
                type: 'object',
                properties: {
                  url: {
                    type: 'string',
                    description: '完整 URL（包含 https://）。示例：https://m.jd.com/search?keyword=airpods',
                  },
                },
                required: ['url'],
              },
            },
          ] as Anthropic.Beta.BetaToolUnion[],
          betas,
          thinking: { type: 'adaptive' },
          // Phase 10 Tier 1: opt into server-side compaction so long
          // research tasks don't blow past the context window. The
          // API returns compaction blocks in `response.content`; we
          // already append the full content array (line 666 below)
          // so they round-trip back on the next turn automatically.
          ...(tier1
            ? {
                context_management: {
                  edits: [{ type: 'compact_20260112' as const }],
                },
              }
            : {}),
          ...(outputConfig ? { output_config: outputConfig } : {}),
          // Pin the same sandbox container across turns when the model
          // used code_execution on a prior turn; null on the first call.
          ...(containerId ? { container: containerId } : {}),
        });

        try {
          response = await callWithTimeout(buildApiCall(), API_TIMEOUT_MS, `iter ${iteration} api`);
        } catch (firstErr) {
          if (!(firstErr instanceof IterationTimeoutError)) throw firstErr;
          logger.warn(
            { taskId: opts.taskId, iteration, apiTimeoutMs: API_TIMEOUT_MS },
            'supercar: api call timed out, retrying once',
          );
          // Reissue the same args. Anthropic API is stateless from our
          // side; a retry restarts the model from scratch with the
          // identical messages history.
          response = await callWithTimeout(buildApiCall(), API_TIMEOUT_MS, `iter ${iteration} api retry`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isTimeout = err instanceof IterationTimeoutError;
        logger.error(
          { taskId: opts.taskId, iteration, err: message, isTimeout },
          isTimeout
            ? 'supercar: api call timed out twice — failing task'
            : 'supercar: messages.create threw',
        );
        return {
          status: 'failed',
          reason: isTimeout
            ? `iteration ${iteration}: API call timed out twice (${API_TIMEOUT_MS}ms each)`
            : `Anthropic API error: ${message}`,
          iterations: iteration,
          toolsUsed: Array.from(toolsUsed),
        };
      }
      const apiLatencyMs = Date.now() - apiStart;

      // Phase 10 Tier 1 verification: log per-call usage so we can
      // confirm the prompt cache + compaction features are actually
      // firing (cache_read_input_tokens > 0 on the second turn of the
      // same task = caching works; cache_creation_input_tokens > 0 on
      // the first turn = breakpoint placed correctly).
      const toolUseCount = response.content.filter((b) => b.type === 'tool_use').length;
      const textBlockCount = response.content.filter((b) => b.type === 'text').length;
      logger.info(
        {
          taskId: opts.taskId,
          iteration,
          model,
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          cacheReadInputTokens: response.usage?.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: response.usage?.cache_creation_input_tokens ?? 0,
          apiLatencyMs,
          // stop_reason + block counts let us tell at a glance why the
          // loop will exit / continue. Critical for diagnosing the
          // 'model wrote a complete answer but loop hung' class of bug.
          stopReason: response.stop_reason,
          toolUseCount,
          textBlockCount,
        },
        'supercar: api usage',
      );

      // Append the full assistant content — NEVER just the text, and
      // NEVER a filtered subset. The Anthropic API validates thinking-
      // block signatures against the exact content structure of the
      // original turn; dropping even one sibling block breaks the
      // signature and the next call 400s with "thinking blocks cannot
      // be modified".
      messages.push({ role: 'assistant', content: response.content });

      // Bug: Sonnet 4.6 under computer-use-2025-11-24 implicitly enables
      // server-side code_execution alongside web_search. The first call
      // creates a sandbox container; the response carries `container.id`.
      // Every follow-up messages.create that replays server_tool_use
      // blocks from a prior turn MUST also pass `container` pointing at
      // that id — otherwise the API rejects with 400 "container_id is
      // required when there are pending tool uses generated by code
      // execution with tools." Capture it here so the next iteration's
      // create call can re-pin it.
      if (response.container?.id) {
        containerId = response.container.id;
      }

      // Extract surface info from this turn.
      const toolsInTurn: string[] = [];
      let textPreamble = '';
      const toolUseBlocks: Anthropic.Beta.BetaToolUseBlock[] = [];
      for (const block of response.content) {
        if (block.type === 'thinking') {
          const thinking = (block as { thinking?: string }).thinking;
          if (thinking) await safeCall(opts.onThinking, thinking);
        } else if (block.type === 'text') {
          textPreamble += (textPreamble ? '\n' : '') + block.text;
        } else if (block.type === 'tool_use') {
          toolUseBlocks.push(block);
          toolsInTurn.push(block.name);
          toolsUsed.add(block.name);
        } else if (block.type === 'server_tool_use') {
          const serverUse = block as Anthropic.Beta.BetaServerToolUseBlock;
          toolsInTurn.push(serverUse.name);
          toolsUsed.add(serverUse.name);
          if (serverUse.name === 'web_search') {
            const query = (serverUse.input as { query?: string } | null)?.query ?? '';
            await safeCall(opts.onWebSearch, { iteration, query });
          }
        }
      }

      await safeCall(opts.onTick, {
        iteration,
        toolsInTurn,
        textPreamble,
        apiLatencyMs,
      });

      // If the model didn't invoke any client-side tool, the turn is
      // finished. Decide between completed / awaiting_user.
      if (toolUseBlocks.length === 0) {
        const finalText = textPreamble.trim();
        if (looksLikePendingQuestion(finalText)) {
          // Park on a user reply. `supercarReply` resolves the promise;
          // `supercarAbort` rejects with a sentinel we swap to
          // cancelled. Capped at AWAITING_USER_TIMEOUT_MS so a model
          // response that ends with a polite question (e.g. "需要补
          // 充哪部分？" after writing a complete PRD) doesn't park
          // the task in 'executing' forever — it's the actual bug
          // observed on tsk_SFsgUXHMrxgQSpJ5SXTqb.
          const AWAITING_USER_TIMEOUT_MS = 5 * 60 * 1000;
          await safeCall(opts.onAwaitingUser, { question: finalText, at: new Date() });
          let waitTimer: NodeJS.Timeout | null = null;
          const replyPromise = new Promise<string>((resolve) => {
            handle.resolveReply = resolve;
          });
          const timeoutPromise = new Promise<string>((resolve) => {
            waitTimer = setTimeout(
              () => resolve('__SUPERCAR_AWAITING_TIMEOUT__'),
              AWAITING_USER_TIMEOUT_MS,
            );
          });
          const replyOrAbort = await Promise.race([replyPromise, timeoutPromise]);
          if (waitTimer) clearTimeout(waitTimer);
          handle.resolveReply = null;
          if (replyOrAbort === '__SUPERCAR_ABORT__' || cancelled) {
            return {
              status: 'cancelled',
              iterations: iteration,
              toolsUsed: Array.from(toolsUsed),
            };
          }
          if (replyOrAbort === '__SUPERCAR_AWAITING_TIMEOUT__') {
            // No user reply within the cap. The model already produced
            // a complete answer (the trailing question is courteous,
            // not load-bearing). Surface what we have and let the user
            // submit a follow-up if they really want to extend it.
            logger.info(
              {
                taskId: opts.taskId,
                iteration,
                awaitingMs: AWAITING_USER_TIMEOUT_MS,
                finalTextLen: finalText.length,
              },
              'supercar: awaiting-user timed out — completing with available text',
            );
            return {
              status: 'completed',
              summary: finalText,
              iterations: iteration,
              toolsUsed: Array.from(toolsUsed),
            };
          }
          if (Date.now() >= deadline) {
            return {
              status: 'timeout',
              reason: 'task timeout elapsed while waiting for user reply',
              iterations: iteration,
              toolsUsed: Array.from(toolsUsed),
            };
          }
          messages.push({ role: 'user', content: replyOrAbort });
          continue;
        }
        return {
          status: 'completed',
          summary: finalText,
          iterations: iteration,
          toolsUsed: Array.from(toolsUsed),
        };
      }

      // Execute every client-side tool call from this turn. web_search
      // is server-side so it never appears in `tool_use`.
      const toolResults: ContentBlockParam[] = [];
      // Track whether ANY computer action in this turn produced a new
      // screenshot. We only update stuckCount once per turn (not once
      // per action), so Claude doesn't get penalised for emitting
      // multiple parallel tool_uses that all observe the same frame.
      let turnChangedScreenshot = false;
      for (const toolUse of toolUseBlocks) {
        // -------- Custom `navigate` tool --------
        if (toolUse.name === 'navigate') {
          const navInput = (toolUse.input as { url?: string } | null) ?? {};
          const targetUrl = typeof navInput.url === 'string' ? navInput.url.trim() : '';
          if (!targetUrl) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [{ type: 'text', text: 'navigate tool_use missing required `url` parameter' }],
              is_error: true,
            });
            continue;
          }
          // Basic URL shape guard. We don't want to route chrome://
          // or file:// here; those require separate plumbing.
          if (!/^https?:\/\//i.test(targetUrl)) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                {
                  type: 'text',
                  text: `navigate: URL must start with http:// or https:// (got ${targetUrl.slice(0, 80)})`,
                },
              ],
              is_error: true,
            });
            continue;
          }
          const navPage = (await executor.getPage()) as unknown as PageLike & {
            goto: (
              url: string,
              opts?: { waitUntil?: string; timeout?: number },
            ) => Promise<unknown>;
          };
          try {
            await navPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          } catch (err) {
            // goto can fail on net::ERR_* but the page might still
            // have partial content — take a screenshot anyway so
            // Claude sees what's there.
            logger.info(
              {
                taskId: opts.taskId,
                iteration,
                url: targetUrl,
                err: err instanceof Error ? err.message : String(err),
              },
              'supercar: navigate goto errored (continuing to screenshot)',
            );
          }
          const navShot = await executor.screenshot(navPage);
          if (navShot.error || !navShot.base64) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                { type: 'text', text: `navigate to ${targetUrl}: screenshot failed: ${navShot.error ?? '?'}` },
              ],
              is_error: true,
            });
            continue;
          }
          const navHash = createHash('md5').update(navShot.base64).digest('hex');
          if (lastScreenshotHash !== navHash) {
            turnChangedScreenshot = true;
            lastScreenshotHash = navHash;
          }
          const navUrl = navPage.url();
          await safeCall(opts.onScreencast, {
            iteration,
            imageBase64: navShot.base64,
            url: navUrl,
            viewportWidth: navShot.viewportWidth ?? displayWidth,
            viewportHeight: navShot.viewportHeight ?? displayHeight,
          });
          logger.info(
            { taskId: opts.taskId, iteration, requested: targetUrl, landed: navUrl },
            'supercar: navigate completed',
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              { type: 'text', text: `已导航到 ${navUrl}` },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: navShot.base64,
                },
              },
            ],
          });
          continue;
        }

        if (toolUse.name !== 'computer') {
          // Unknown custom tool — tell the model we can't run it so it
          // can back off instead of looping forever.
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              { type: 'text', text: `Unknown tool: ${toolUse.name}` },
            ],
            is_error: true,
          });
          continue;
        }

        // Execute the computer use action and return a fresh screenshot.
        const execResult = await executeComputerAction(executor, toolUse.input as ComputerActionInput);
        const freshPage = (await executor.getPage()) as unknown as PageLike;
        const shot = await executor.screenshot(freshPage);
        if (shot.error || !shot.base64) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              { type: 'text', text: `screenshot after ${execResult.summary} failed: ${shot.error ?? '?'}` },
            ],
            is_error: true,
          });
          continue;
        }

        // Hash this frame; if it differs from the last we showed Claude
        // the page moved, and we're not stuck. Only flag the turn if at
        // least ONE action moved the page.
        const shotHash = createHash('md5').update(shot.base64).digest('hex');
        if (lastScreenshotHash !== shotHash) {
          turnChangedScreenshot = true;
          lastScreenshotHash = shotHash;
        }

        await safeCall(opts.onScreencast, {
          iteration,
          imageBase64: shot.base64,
          url: freshPage.url(),
          viewportWidth: shot.viewportWidth ?? displayWidth,
          viewportHeight: shot.viewportHeight ?? displayHeight,
        });

        // Anthropic requires that a tool_result marked is_error:true
        // contains ONLY text blocks — an image + is_error combo 400s
        // with "all content must be type `text` if `is_error` is true".
        // So split the shape: on failure we send a text description,
        // on success we send the fresh screenshot.
        if (execResult.ok) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: shot.base64,
                },
              },
            ],
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              {
                type: 'text',
                text: `computer action failed: ${execResult.summary}`,
              },
            ],
            is_error: true,
          });
        }
      }

      // Update stuck counter — one increment per turn, not per action.
      // Only increment if the turn had at least one computer tool_use
      // AND none of those actions moved the page.
      const hadComputerAction = toolUseBlocks.some((b) => b.name === 'computer');
      if (hadComputerAction && !turnChangedScreenshot) {
        stuckCount++;
      } else if (hadComputerAction && turnChangedScreenshot) {
        stuckCount = 0;
      }

      // Lane 5 — Apify fallback the moment we've hit the stuck bar AND
      // the intent's site has a registered scraper actor. Runs once
      // per task; on success we fold the dataset into the summary and
      // exit before spending more API turns on a browser that clearly
      // isn't cooperating.
      if (
        !apifyAttempted &&
        stuckCount >= 3 &&
        opts.apifyAdapter
      ) {
        const match = opts.apifyAdapter.findActorForIntent(opts.intent);
        if (match) {
          apifyAttempted = true;
          logger.info(
            { taskId: opts.taskId, actor: match.actorId, stuckCount },
            'supercar: delegating to Apify actor',
          );
          const input = match.buildInput(opts.intent);
          const r = await opts.apifyAdapter.run(match.actorId, input);
          if ('items' in r && r.items.length > 0) {
            const itemsPreview = r.items
              .slice(0, 10)
              .map((it, i) => `${i + 1}. \`\`\`json\n${JSON.stringify(it, null, 2).slice(0, 400)}\n\`\`\``)
              .join('\n\n');
            return {
              status: 'completed',
              summary:
                `# ${match.hostLabel} — 通过 Apify Actor 获取（浏览器路径被反爬拦截）\n\n` +
                `Actor: \`${match.actorId}\`\n结果数：${r.items.length}（展示前 10 条）\n\n${itemsPreview}`,
              iterations: iteration,
              toolsUsed: [...toolsUsed, 'apify'],
            };
          }
          // Apify failed — log and keep going in the browser.
          logger.warn(
            { taskId: opts.taskId, err: 'error' in r ? r.error : 'empty' },
            'supercar: Apify actor returned no usable data — falling back to browser',
          );
        }
      }

      // Lane 2 escalation on pure stuck (no explicit anti-bot signal).
      // Triggers at the warn threshold so the headed browser gets a
      // chance before we inject the "try mobile sites" hint text.
      if (!executorSwapped && stuckCount >= STUCK_WARN_THRESHOLD) {
        await swapToHeadedIfAvailable(`stuck:${stuckCount}`);
      }

      // Anti-bot pattern scan. Runs on the freshest page text we can
      // get — fails open (no page text = no detection) so transient
      // evaluate errors don't break the loop. One scan per turn, not
      // per tool_use, so parallel tool_uses don't fire redundant
      // detections.
      let antiBotHintText: string | null = null;
      if (hadComputerAction && toolUseBlocks.length > 0) {
        const snapshotText = await readPageText(executor);
        const signal = snapshotText ? detectAntiBot({ snapshotText }) : null;
        if (signal && signal.confidence === 'high') {
          // Fire onAntiBotSignal at most once per distinct signal type;
          // don't spam the UI every turn while the banner sits there.
          if (!activeAntiBotSignal || activeAntiBotSignal.type !== signal.type) {
            activeAntiBotSignal = signal;
            logger.info(
              { taskId: opts.taskId, iteration, type: signal.type, rawMatch: signal.rawMatch },
              'supercar: anti-bot signal detected',
            );
            await safeCall(opts.onAntiBotSignal, {
              iteration,
              signal,
              waitTimeoutMs: 60_000,
            });
          }
          antiBotHintText =
            `🤖 检测到 **${describeSignal(signal)}**（匹配关键词："${signal.rawMatch.slice(0, 40)}"）。\n\n` +
            `这不是普通的页面未响应——是网站的反爬 / 人机验证机制。处理方式：\n` +
            `- 如果是**滑动验证 / 拖动滑块**：用户可以在右侧 panel 交互模式下手动完成，然后告诉你继续\n` +
            `- 如果是 **Cloudflare 质询页**：等 5 秒让它自动放行，或切 m.xxx.com 移动版绕开\n` +
            `- 如果是**明确的 403 / 访问被拒**：换站点（见移动版备选表）\n` +
            `- 不要继续点击同一元素——先换路径`;

          // Lane 2 escalation: swap the active executor to the headed
          // browser. Real GPU + real fingerprint defeats most of the
          // cheap "serve blank HTML to headless UAs" blocks even
          // without the model changing tactics. One-shot — the flag
          // prevents re-swapping on subsequent detections.
          const swapped = await swapToHeadedIfAvailable(`antibot:${signal.type}`);
          if (swapped) {
            antiBotHintText +=
              `\n\n🔄 系统已自动切换到 **headed 浏览器**（Lane 2，真实渲染指纹）。` +
              `下一个 computer action 会在新浏览器里执行，之前的页面状态已重放到当前 URL。`;
          }
        } else if (activeAntiBotSignal && !signal) {
          // Banner cleared on this turn — notify UI.
          logger.info(
            { taskId: opts.taskId, iteration, prev: activeAntiBotSignal.type },
            'supercar: anti-bot signal cleared',
          );
          await safeCall(opts.onAntiBotResolved, { iteration, reason: 'auto' });
          activeAntiBotSignal = null;
        }
      }

      // Both stuck advisories go in the same user message as the
      // tool_results. Mixing text + tool_result blocks in one user turn
      // is legal per the Anthropic schema — tool_result blocks just
      // need to come before any free-form text.
      const nudgeContent: ContentBlockParam[] = [];
      if (antiBotHintText) {
        nudgeContent.push({ type: 'text', text: antiBotHintText });
      }
      if (stuckCount >= STUCK_EXIT_THRESHOLD && !stuckForceFinalised) {
        stuckForceFinalised = true;
        logger.warn(
          { taskId: opts.taskId, iteration, stuckCount },
          'supercar: stuck past exit threshold — forcing task finalisation',
        );
        nudgeContent.push({
          type: 'text',
          text:
            `⚠️ 系统检测：页面已连续 ${stuckCount} 次无响应（hash 未变），判定为反爬拦截。\n\n` +
            `请立即停止 computer 工具操作，按以下顺序处理：\n` +
            `1. 如果你已经获取到足够信息，直接汇总输出（markdown 格式）\n` +
            `2. 如果信息不足，改用 web_search 工具搜索同一问题\n` +
            `3. 在最终输出中明确告知用户：目标网站暂时无法访问，已通过其他途径获取信息\n\n` +
            `绝对不要再对当前网站使用 computer 工具。`,
        });
      } else if (stuckCount >= STUCK_WARN_THRESHOLD) {
        logger.info(
          { taskId: opts.taskId, iteration, stuckCount },
          'supercar: stuck warning — nudging Claude to try alternate browser tactics',
        );
        // The warn nudge is browser-first. We explicitly do NOT mention
        // web_search here — the benchmark showed Claude treats any
        // search mention as a green light to abandon the browser path.
        // Mobile sites first, then alternate hostnames, then reset;
        // web_search appears only in the hard exit nudge above.
        nudgeContent.push({
          type: 'text',
          text:
            `⚠️ 提示：页面截图已连续 ${stuckCount} 次未变化，当前操作可能未生效。\n\n` +
            `先尝试以下浏览器内的方案，不要直接放弃 computer 工具：\n` +
            `1. **等一下**：wait 3-5 秒后再点击，某些站点首次加载慢\n` +
            `2. **让用户帮忙**：如果看起来像验证码/滑块，输出"检测到验证码，请在右侧 panel 手动完成"并停住\n` +
            `3. **换路径**：同站点的 /explore /hot /discover 分类页通常不需要登录\n` +
            `4. **换备选站点**：携程→飞猪/去哪儿、京东→拼多多、Boss直聘→拉勾\n` +
            `5. **重置页面**：先 navigate 到 about:blank，再重新访问目标\n` +
            `6. **最后选项**：切移动版 m.xxx.com（m.jd.com / m.ctrip.com / m.zhipin.com）`,
        });
      }

      messages.push({
        role: 'user',
        content: nudgeContent.length > 0 ? [...toolResults, ...nudgeContent] : toolResults,
      });
    }

    if (cancelled) {
      return {
        status: 'cancelled',
        iterations: iteration,
        toolsUsed: Array.from(toolsUsed),
      };
    }
    if (Date.now() >= deadline) {
      return {
        status: 'timeout',
        reason: `task timeout (${Math.round(timeoutMs / 1000)}s) elapsed`,
        iterations: iteration,
        toolsUsed: Array.from(toolsUsed),
      };
    }
    return {
      status: 'failed',
      reason: `exhausted maxIterations=${maxIterations} without completion`,
      iterations: iteration,
      toolsUsed: Array.from(toolsUsed),
    };
  } finally {
    handles.delete(opts.taskId);
  }
}

// ---------------------------------------------------------------------------
// Computer use dispatch
// ---------------------------------------------------------------------------

interface ComputerActionInput {
  action: string;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
  key?: string;
  duration?: number;
  scroll_direction?: 'up' | 'down' | 'left' | 'right';
  scroll_amount?: number;
  region?: [number, number, number, number];
}

interface ActionResult {
  ok: boolean;
  summary: string;
}

/**
 * Map Anthropic's `computer_20251124` action schema to the
 * PlaywrightExecutor methods the legacy vision-loop already uses.
 *
 * Differences from the skill-plan sketch:
 *   - Scroll uses `scroll_direction` + `scroll_amount` (per the official
 *     schema — the sketch in the brief used `direction`/`amount`).
 *   - `wait` duration is in SECONDS (again per the schema, sketch used ms).
 *   - Modifier keys on click/scroll come through `input.text` (e.g.
 *     "shift"), handled by combining into Playwright's `key+click`.
 *   - `key` / `hold_key` actions receive the key string in `input.text`
 *     per the Anthropic schema, with a `key` fallback just in case.
 */
async function executeComputerAction(
  executor: PlaywrightExecutor,
  input: ComputerActionInput,
): Promise<ActionResult> {
  const page = (await executor.getPage()) as unknown as PageLike;
  const action = input.action;

  try {
    switch (action) {
      case 'screenshot':
        // No-op — caller grabs a fresh screenshot after every action.
        return { ok: true, summary: 'screenshot' };

      case 'left_click':
      case 'right_click':
      case 'middle_click': {
        if (!input.coordinate) return { ok: false, summary: `${action} without coordinate` };
        const button: 'left' | 'right' | 'middle' =
          action === 'left_click' ? 'left' : action === 'right_click' ? 'right' : 'middle';
        const [x, y] = input.coordinate;
        // Modifier-key click (`text` carries "shift" / "ctrl" / "alt" /
        // "super"). Route through page.keyboard.down + click + up so we
        // don't need a new executor method.
        if (input.text) {
          const mod = normaliseModifier(input.text);
          const anyPage = page as unknown as { keyboard: { down: (k: string) => Promise<void>; up: (k: string) => Promise<void> }; mouse: typeof page.mouse };
          await anyPage.keyboard.down(mod);
          try {
            await anyPage.mouse.click(x, y, { button });
          } finally {
            await anyPage.keyboard.up(mod);
          }
          return { ok: true, summary: `${action}(${x},${y}) +${mod}` };
        }
        const r = await executor.click(page, x, y, button);
        return { ok: r.ok, summary: r.message ?? `${action}(${x},${y})` };
      }

      case 'double_click': {
        if (!input.coordinate) return { ok: false, summary: 'double_click without coordinate' };
        const [x, y] = input.coordinate;
        const r1 = await executor.click(page, x, y, 'left');
        if (!r1.ok) return { ok: false, summary: r1.message ?? 'double_click failed' };
        const r2 = await executor.click(page, x, y, 'left');
        return { ok: r2.ok, summary: `double_click(${x},${y})` };
      }

      case 'triple_click': {
        if (!input.coordinate) return { ok: false, summary: 'triple_click without coordinate' };
        const [x, y] = input.coordinate;
        for (let i = 0; i < 3; i++) {
          const r = await executor.click(page, x, y, 'left');
          if (!r.ok) return { ok: false, summary: r.message ?? 'triple_click failed' };
        }
        return { ok: true, summary: `triple_click(${x},${y})` };
      }

      case 'type': {
        const text = input.text ?? '';
        const r = await executor.type(page, text);
        return { ok: r.ok, summary: r.message ?? `type(${text.length}c)` };
      }

      case 'key': {
        // Anthropic schema puts the key string in `text` for the `key`
        // action. Older examples used `key`; tolerate both.
        const key = input.text ?? input.key ?? '';
        if (!key) return { ok: false, summary: 'key without text' };
        const r = await executor.pressKey(page, key);
        return { ok: r.ok, summary: r.message ?? `key(${key})` };
      }

      case 'hold_key': {
        const key = input.text ?? input.key ?? '';
        const durSec = input.duration ?? 1;
        if (!key) return { ok: false, summary: 'hold_key without text' };
        const anyPage = page as unknown as {
          keyboard: { down: (k: string) => Promise<void>; up: (k: string) => Promise<void> };
        };
        await anyPage.keyboard.down(key);
        await page.waitForTimeout(Math.min(10_000, Math.round(durSec * 1000)));
        await anyPage.keyboard.up(key);
        return { ok: true, summary: `hold_key(${key}, ${durSec}s)` };
      }

      case 'mouse_move': {
        if (!input.coordinate) return { ok: false, summary: 'mouse_move without coordinate' };
        await page.mouse.move(input.coordinate[0], input.coordinate[1]);
        return { ok: true, summary: `mouse_move(${input.coordinate[0]},${input.coordinate[1]})` };
      }

      case 'left_mouse_down':
      case 'left_mouse_up': {
        const anyPage = page as unknown as {
          mouse: { down: () => Promise<void>; up: () => Promise<void>; move: (x: number, y: number) => Promise<void> };
        };
        if (input.coordinate) await anyPage.mouse.move(input.coordinate[0], input.coordinate[1]);
        if (action === 'left_mouse_down') await anyPage.mouse.down();
        else await anyPage.mouse.up();
        return { ok: true, summary: action };
      }

      case 'left_click_drag': {
        if (!input.start_coordinate || !input.coordinate) {
          return { ok: false, summary: 'left_click_drag without start + end coordinates' };
        }
        const anyPage = page as unknown as {
          mouse: { down: () => Promise<void>; up: () => Promise<void>; move: (x: number, y: number) => Promise<void> };
        };
        await anyPage.mouse.move(input.start_coordinate[0], input.start_coordinate[1]);
        await anyPage.mouse.down();
        await anyPage.mouse.move(input.coordinate[0], input.coordinate[1]);
        await anyPage.mouse.up();
        return { ok: true, summary: `drag ${input.start_coordinate.join(',')}→${input.coordinate.join(',')}` };
      }

      case 'scroll': {
        const direction = input.scroll_direction ?? 'down';
        const amount = Math.max(1, Math.min(20, input.scroll_amount ?? 3));
        const pxPerUnit = 100;
        let dx = 0;
        let dy = 0;
        if (direction === 'down') dy = amount * pxPerUnit;
        else if (direction === 'up') dy = -amount * pxPerUnit;
        else if (direction === 'right') dx = amount * pxPerUnit;
        else dx = -amount * pxPerUnit;
        if (input.coordinate) await page.mouse.move(input.coordinate[0], input.coordinate[1]);
        // Modifier via `text` (e.g. shift+scroll = horizontal on some sites).
        const mod = input.text ? normaliseModifier(input.text) : null;
        const anyPage = page as unknown as { keyboard: { down: (k: string) => Promise<void>; up: (k: string) => Promise<void> } };
        if (mod) await anyPage.keyboard.down(mod);
        try {
          const r = await executor.scroll(page, dy + dx);
          return { ok: r.ok, summary: `scroll(${direction}, ${amount}${mod ? ` +${mod}` : ''})` };
        } finally {
          if (mod) await anyPage.keyboard.up(mod);
        }
      }

      case 'wait': {
        // Anthropic schema uses SECONDS; clamp 0..10.
        const ms = Math.round(Math.max(0, Math.min(10, input.duration ?? 1)) * 1000);
        const r = await executor.wait(page, ms);
        return { ok: r.ok, summary: r.message ?? `wait(${ms}ms)` };
      }

      case 'zoom':
        // Zoom is an observation-side operation; the commander asks the
        // executor to re-send a scaled region of the screenshot.
        // PlaywrightExecutor doesn't have a zoom method yet; acknowledge
        // as a no-op so the model doesn't hammer it. A future tier can
        // re-sharp to the requested region for higher resolution.
        return { ok: true, summary: 'zoom (noop)' };

      default:
        return { ok: false, summary: `unknown action: ${action}` };
    }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return { ok: false, summary: `${action} threw: ${m.slice(0, 200)}` };
  }
}

/**
 * Normalise Anthropic's modifier strings (shift / ctrl / alt / super)
 * to the capitalised form Playwright expects.
 */
function normaliseModifier(raw: string): string {
  const k = raw.trim().toLowerCase();
  if (k === 'shift') return 'Shift';
  if (k === 'ctrl' || k === 'control') return 'Control';
  if (k === 'alt' || k === 'option') return 'Alt';
  if (k === 'super' || k === 'meta' || k === 'cmd' || k === 'command') return 'Meta';
  // Unknown modifier — pass through unchanged and let Playwright reject it
  // so we notice in logs.
  return raw;
}

/**
 * Very conservative heuristic: flag a response as "awaiting user" only
 * when the last non-empty line ends in a question mark (zh / en).
 * Short responses that merely contain a '?' somewhere don't count —
 * summaries with rhetorical questions were false-positives in dogfood.
 */
function looksLikePendingQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  return last.endsWith('？') || last.endsWith('?');
}

/**
 * Sentinel error class so callers can distinguish a wall-clock
 * timeout from any other rejection — `instanceof` is more reliable
 * than string-matching the message and survives error wrapping.
 */
class IterationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IterationTimeoutError';
  }
}

/**
 * Race a promise against a wall-clock timer. Resolves with the
 * promise's value if it completes first; rejects with an
 * `IterationTimeoutError` after `ms` milliseconds. Always clears
 * the timer in `finally` so a long-running winning promise doesn't
 * leak a pending Node timer.
 */
async function callWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new IterationTimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Invoke a user callback without letting its failure kill the loop.
 * Swallows thrown errors after logging them.
 */
async function safeCall<T>(fn: ((ev: T) => void | Promise<void>) | undefined, ev: T): Promise<void> {
  if (!fn) return;
  try {
    await fn(ev);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'supercar: callback threw');
  }
}

/**
 * Grab the currently-visible text on the page for anti-bot scanning.
 * Capped at 4KB so a giant DOM doesn't make the regex scan dominate
 * per-turn latency — captcha / block copy lives near the top of the
 * page and is always short. Returns empty string (not null) on any
 * failure so the caller's `if (snapshotText)` branch fails open.
 */
async function readPageText(executor: PlaywrightExecutor): Promise<string> {
  try {
    const page = (await executor.getPage()) as unknown as {
      evaluate: <T>(fn: () => T) => Promise<T>;
    };
    const text = await Promise.race([
      page.evaluate<string>(() => {
        // innerText filters out <script> / <style> blocks and collapses
        // whitespace, which is exactly what we want the regex scanner
        // to see. Fallback to textContent for pages that aren't fully
        // hydrated yet (Cloudflare interstitial has the content in a
        // <noscript> sibling and textContent picks it up regardless).
        const body = (globalThis as { document?: { body?: unknown } }).document?.body as
          | { innerText?: string; textContent?: string }
          | undefined;
        if (!body) return '';
        return (body.innerText ?? body.textContent ?? '').slice(0, 4096);
      }),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 1500)),
    ]);
    return text ?? '';
  } catch {
    return '';
  }
}

/**
 * Feed Brave Search hits to Claude and return a tight prose answer.
 *
 * Round-2b output-quality fix. The prior behaviour dumped all 10
 * hits verbatim as a numbered list — readable for a developer, but
 * BOSS read it as "系统把搜索结果抛回来了". Claude synthesises:
 * a two-to-four-sentence answer in Chinese, with at most the two
 * or three citations it actually used rendered as
 * `[网站名](URL)` inline. Upstream cost is one Sonnet call of
 * ~600 input / 200 output tokens — the single call replaces
 * the 30+ browser iterations this shortcut was designed to skip,
 * so it's still net cheaper than the browser path.
 *
 * Fails soft: on Anthropic error we fall back to a compact
 * markdown list so the user always gets SOMETHING. The fallback
 * is shorter (top-5 hits, no snippets) than the old raw dump.
 */
/**
 * Strip HTML tags + decode the handful of entities Brave actually
 * emits in titles/snippets (`<strong>` for hit highlighting,
 * `&amp;` / `&quot;` etc.). Brave returns highlighted snippets as
 * raw HTML; if we feed those verbatim to Sonnet, the model sometimes
 * echoes the tags into its synthesis output and the user sees raw
 * `<strong>` text. Killing the tags at the input layer is the only
 * truly reliable fix — the system prompt's "禁止原样复制 snippet"
 * line was a soft rule the model occasionally broke.
 */
function stripHtmlForBraveContext(s: string): string {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

async function synthesizeBraveResults(opts: {
  apiKey: string;
  intent: string;
  results: ReadonlyArray<{ title?: string; snippet?: string; url: string }>;
  model: string;
  logger: import('pino').Logger;
  taskId: string;
}): Promise<string> {
  const hits = opts.results.slice(0, 8);
  // Sanitise BEFORE building the context block so Sonnet never sees
  // raw HTML — eliminates the "<strong> echoes into the reply" class
  // of bug at the source.
  const context = hits
    .map((h, i) => {
      const title = stripHtmlForBraveContext(h.title || h.url);
      const snippet = stripHtmlForBraveContext(h.snippet || '') || '(no snippet)';
      return `[${i + 1}] ${title}\n${snippet}\nurl: ${h.url}`;
    })
    .join('\n\n');
  const system = `你是一个极简问答助手。用户问了一个信息类问题，我会把搜索引擎返回的前 8 条结果喂给你。回复风格必须严格按下面规则：

- 像聊天，不像报告。简短直接。**总字数 ≤ 100 字**（表格本身不算）。
- 单点事实（定义 / 新闻 / 一个数字）→ **一句话**直接回答。
- 对比 / 比价 / 排名 / 多来源 → 用 markdown 表格，**不超过 4 列**，表格后一句话结论，句号结束。
- 中文回答（用户用英文则英文）。
- **禁止**：
  - "购买建议" / "注意事项" / "温馨提示" / "数据来源" / 免责声明 / 风险提示
  - 加粗小标题（"## 结论"、"**建议**"）
  - emoji、开场铺垫（"根据以下信息…"）
  - bullet 列表超过 3 条
  - 原样复制 snippet、"搜索结果如下" 之类
  - 任何 HTML 标签（<strong>、<em>、<br> 等）—— 用 markdown 等价语法
  - 标题里写"搜索结果"、"Brave"、"来源" 这类元信息，用户不需要知道

示范：

| 平台 | 价格 | 国补后 |
|------|------|--------|
| 京东 | ¥10,999 | ¥8,944 |
| 天猫 | ¥10,999 | ¥8,999 |

京东便宜约 ¥55，教育优惠可到 ¥8,249。

— 只有表格 + 一行结论。没有其它段落。

信息不足就说"搜索结果里没提到 X"，一句话，不要编。`;
  const user = `用户问题：${opts.intent}

搜索结果：
${context}`;

  try {
    const client = new Anthropic({ apiKey: opts.apiKey });
    const resp = await client.messages.create({
      model: opts.model,
      // Headroom for a 4-row × 4-col compare table + one-line
      // conclusion in Chinese (~2 tokens per char). 300 was too tight
      // and occasionally truncated the conclusion mid-sentence; 1024
      // covers worst case while still gating prose pyramids via the
      // system prompt's "≤100 字" rule.
      max_tokens: 1024,
      // Cache the system prompt — every Brave-synthesis call is
      // identical, so the entire system block (~600 tokens) hits the
      // 5-min TTL cache after the first call. Saves ~60% of input
      // tokens on repeat queries.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
    const out = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join('\n\n')
      .trim();
    if (out) {
      opts.logger.info(
        {
          taskId: opts.taskId,
          inputTokens: resp.usage?.input_tokens ?? 0,
          outputTokens: resp.usage?.output_tokens ?? 0,
          cacheReadInputTokens: resp.usage?.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: resp.usage?.cache_creation_input_tokens ?? 0,
          stopReason: resp.stop_reason,
        },
        'brave-synthesis: api usage',
      );
      return out;
    }
    opts.logger.warn({ taskId: opts.taskId }, 'brave-synthesis: empty response, using fallback');
  } catch (err) {
    opts.logger.warn(
      { taskId: opts.taskId, err: err instanceof Error ? err.message : String(err) },
      'brave-synthesis: Anthropic call failed, using fallback',
    );
  }
  // Fallback when Sonnet synthesis fails or returns empty: clean
  // markdown-link list with HTML stripped. Intentionally NO mention
  // of "Brave" / "搜索结果" / source attribution — that's
  // implementation detail the user shouldn't see.
  return hits
    .slice(0, 5)
    .map((h, i) => {
      const title = stripHtmlForBraveContext(h.title || h.url);
      return `${i + 1}. [${title}](${h.url})`;
    })
    .join('\n');
}
