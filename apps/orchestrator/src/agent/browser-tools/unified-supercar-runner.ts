import type { Page } from 'playwright';
import { egressBlockLearner } from '../../browser-pool/egress-learning.js';
import {
  browserProfileStore,
  restoreBrowserProfile,
  saveBrowserProfile,
} from '../../browser-profiles/profile-store.js';
import { browserCapabilities } from '../../config/browser-capabilities.js';
import { logger } from '../../config/logger.js';
import { listPartialNote, reviewListAnswer } from '../../execution/answer-verifier.js';
import { browserOutputGuidance } from '../../execution/execution-contract.js';
import { getContract } from '../../execution/execution-pipeline.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { cleanElementName } from '../internal-refs.js';
import type {
  RunSupercarOptions,
  SupercarAwaitingKind,
  SupercarOutcome,
} from '../supercar/agent-loop.js';
import type { BrowserControl } from '../supercar/browser-control.js';
import { inspectChallenge } from '../supercar/captcha-challenge.js';
import { captchaHandoffs } from '../supercar/captcha-handoff.js';
import { recordedBrowserAdapter } from '../supercar/recorded-browser-adapter.js';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import { persistBrowserDownload } from './browser-download.js';
import { browserReplayStore } from './browser-replay-service.js';
import { BrowserReplayRecorder } from './browser-replay.js';
import { browserToolError } from './browser-tool-error.js';
import { ensureExecutionViewport } from './browser-viewport.js';
import { UNPLACED_POST_MESSAGE } from './cloud-observation.js';
import { installDomainEgress } from './domain-egress.js';
import {
  type PausedAction,
  effectPauseQuestion,
  refName,
  refRole,
  siteCalled,
} from './effect-pause-copy.js';
import { CAPTCHA_SCREENSHOT_STYLE, captchaHandoffEvidence } from './full-page-read.js';
import {
  type UnifiedToolResult,
  createPlaywrightUnifiedExecutor,
} from './playwright-unified-executor.js';
import { readOnlyEffectMayPass } from './read-only-effect-policy.js';
import { siteEntryHint } from './site-entry-hints.js';
import { createUnifiedActionGate } from './unified-action-gate.js';
import {
  NOT_STARTED,
  isEnglishIntent,
  isReadOnlyIntent,
  runUnifiedBrowserLoop,
} from './unified-browser-loop.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

/** Ledger entries are capped per task (MAX_ENTRIES_PER_TASK); links take at most this many. */
const MAX_GROUNDED_LINKS = 600;
/** Same takeover window as the legacy loop: a parked task waits this long for the user. */
const HANDOFF_WAIT_MS = 30 * 60_000;
/** Well under the pool's idle reclaim (BROWSER_IDLE_TIMEOUT_MS, default 5 minutes). */
const BROWSER_KEEP_ALIVE_MS = 30_000;
const CANCEL_POLL_MS = 2_000;

interface ParkedTask {
  resolve: (reply: string | null) => void;
  abort: () => void;
  intent: string;
}
const parked = new Map<string, ParkedTask>();
const running = new Map<string, AbortController>();

/** Resume a unified task parked on a human handoff. False when none is parked. */
export function unifiedSupercarReply(taskId: string, message: string): boolean {
  const task = parked.get(taskId);
  if (!task) return false;
  parked.delete(taskId);
  task.resolve(message);
  return true;
}

export function hasParkedUnifiedTask(taskId: string): boolean {
  return parked.has(taskId);
}

export function unifiedParkedIntent(taskId: string): string | null {
  return parked.get(taskId)?.intent ?? null;
}

/** Abort a running or parked unified task. False when it is not ours. */
export function unifiedSupercarAbort(taskId: string): boolean {
  const controller = running.get(taskId);
  const task = parked.get(taskId);
  if (!controller && !task) return false;
  parked.delete(taskId);
  task?.resolve(null);
  controller?.abort();
  return true;
}

/** Unified handoff reasons → the legacy awaiting kinds the UI already renders. */
function awaitingKindFor(reason: string): SupercarAwaitingKind {
  if (reason === 'login') return 'login';
  if (reason === 'captcha') return 'captcha';
  if (reason === 'permission' || reason === 'payment') return 'permission';
  return 'clarification';
}

function siteDomain(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** Visible label of a ref in the latest snapshot text, for capture/progress copy. */
function labelForRef(snapshotText: string, ref: string): string | null {
  const line = snapshotText.split('\n').find((candidate) => candidate.includes(`[ref=${ref}]`));
  const match = line?.match(/-\s+([a-z]+)(?:\s+"([^"]*)")?/);
  if (!match) return null;
  return match[2] ? `${match[1]} "${match[2]}"` : (match[1] ?? null);
}

async function safeTitle(page: { title(): Promise<string> }): Promise<string> {
  try {
    return await Promise.race([
      page.title(),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 1500)),
    ]);
  } catch {
    return '';
  }
}

/** FIX-61B P1-6: the tools that read the page for the assistant. */
const READ_TOOLS = new Set(['snapshot', 'read_page', 'extract', 'get_page_text', 'read_section']);

/** FIX-61B P1-6: the names (never the values) of the boxes the person typed into. */
export async function humanTypedFieldNames(page: Page): Promise<string[]> {
  return page
    .evaluate(() =>
      Array.from(document.querySelectorAll('[data-hd-human-typed]'))
        .map((el) => {
          const field = el as HTMLInputElement;
          const label = field.labels?.[0]?.textContent ?? '';
          return (
            field.getAttribute('aria-label') ||
            label ||
            field.getAttribute('placeholder') ||
            field.getAttribute('name') ||
            '输入框'
          )
            .replace(/\s+/g, ' ')
            .replace(/[:：]\s*$/, '')
            .trim()
            .slice(0, 30);
        })
        .slice(0, 5),
    )
    .catch(() => []);
}

function describe(action: UnifiedBrowserAction, label: string | null): string {
  switch (action.tool) {
    case 'navigate':
      return `打开 ${action.url}`;
    // FIX-61B P0-1: the step line is shown in 「查看过程」 — a nameless control is 「页面上的…」,
    // never its handle (「点击 e12」) or role word (「点击 generic」).
    case 'click':
      return `点击 ${cleanElementName(label) ?? '页面上的一个元素'}`;
    case 'type':
      return `在 ${cleanElementName(label) ?? '页面上的输入框'} 输入`;
    case 'select':
      return `在 ${cleanElementName(label) ?? '页面上的选择框'} 选择「${action.value}」`;
    default:
      return action.tool;
  }
}

/**
 * Batch 09 — the unified tool loop behind the production supercar entry
 * (`BROWSER_EXECUTOR=unified`). Shares the legacy loop's hooks: per-step ticks,
 * action capture, final evidence and human handoff (parked until the user
 * replies through `supercarReply`). Never throws.
 */
export async function runUnifiedSupercarTask(opts: RunSupercarOptions): Promise<SupercarOutcome> {
  if (!opts.executor || !opts.messagesAdapter) {
    return {
      status: 'failed',
      reason: '浏览器暂时不可用，请稍后重试。',
      failureSource: 'tool',
      iterations: 0,
      toolsUsed: [],
    };
  }
  // The session vault stopped this task's logged-in context (revoked or its
  // status could not be confirmed): nothing more runs; the task waits for the user.
  const sessionStopped = () => opts.executor?.sessionInterruption ?? null;
  const sessionStoppedQuestion = (reason: string) =>
    `站点登录授权已撤销或暂时无法确认（原因码 ${reason}），已停止并关闭该登录会话，未保存的会话变更已丢弃。请在“浏览器登录与数据”中确认授权状态后重新提交任务。`;
  const parkedForSession = (reason: string, iterations = 0): SupercarOutcome => ({
    status: 'awaiting_user',
    question: sessionStoppedQuestion(reason),
    iterations,
    toolsUsed: [],
  });
  const stoppedBefore = sessionStopped();
  if (stoppedBefore) return parkedForSession(stoppedBefore);
  let page: Awaited<ReturnType<NonNullable<RunSupercarOptions['executor']>['getPage']>>;
  try {
    page = await opts.executor.getPage();
  } catch {
    // A closed vault context fails getPage(): report why instead of a generic failure.
    const stopped = sessionStopped();
    if (stopped) return parkedForSession(stopped);
    return {
      status: 'failed',
      reason: '浏览器暂时不可用，请稍后重试。',
      failureSource: 'tool',
      iterations: 0,
      toolsUsed: [],
    };
  }
  const controller = new AbortController();
  const capabilities = opts.browserCapabilities ?? browserCapabilities(opts.userExternalId);
  await ensureExecutionViewport(page);
  const tools = createPlaywrightUnifiedExecutor(page, {
    ...(opts.onBrowserDownload
      ? { saveDownload: (download) => persistBrowserDownload(download, opts.onBrowserDownload!) }
      : {}),
    observationV2: capabilities.observationV2,
    taskIntent: opts.intent,
  });
  let egress: Awaited<ReturnType<typeof installDomainEgress>>;
  try {
    egress = await installDomainEgress(
      page,
      undefined,
      undefined,
      tools.ownsPage,
      controller.signal,
      `${opts.userExternalId ?? 'unknown'}:${opts.taskId}`,
      // One user keeps one pool IP across tasks (CAPTCHA-REDUCE-1).
      opts.userExternalId ?? `${opts.userExternalId ?? 'unknown'}:${opts.taskId}`,
    );
  } catch {
    tools.dispose();
    return {
      status: 'failed',
      reason: '域名代理配置或浏览器上下文不支持安全代理，请检查配置后重试。',
      failureSource: 'tool',
      iterations: 0,
      toolsUsed: [],
    };
  }
  // CAPTCHA-REDUCE-1: the same user's verification clearance carries over.
  // OPEN-ANY-SITE-1: a site refusing this egress (its page 403/429, or a
  // verification wall) goes through the user's endpoint from the next launch.
  const learnBlock = opts.learnEgressBlocks ? egressBlockLearner() : null;
  const onPageResponse = (response: import('playwright').Response) => {
    const status = response.status();
    if (
      (status === 403 || status === 429) &&
      response.request().isNavigationRequest() &&
      response.frame() === page.mainFrame()
    )
      learnBlock?.(response.url(), `http_${status}`);
  };
  if (learnBlock) page.on('response', onPageResponse);
  const profileStore = opts.persistentProfileUser ? browserProfileStore() : null;
  const profileSince = Date.now();
  if (profileStore && opts.persistentProfileUser)
    await restoreBrowserProfile(page.context(), profileStore, opts.persistentProfileUser);
  const replay =
    capabilities.replayV1 && opts.userExternalId
      ? new BrowserReplayRecorder(
          browserReplayStore,
          opts.userExternalId,
          opts.taskId,
          new Set(),
          {},
          async (code) =>
            recordDiagnostic('browser_replay', code, '回放录制失败，执行结果仍以步骤证据为准。'),
        )
      : null;
  let replayActionId = 0;
  let sampling = false;
  const replayTimer = replay
    ? setInterval(() => {
        if (sampling || replay.isPaused) return;
        sampling = true;
        void replay.capture(page, `sample-${replayActionId}`, 'sample').finally(() => {
          sampling = false;
        });
      }, 1000)
    : undefined;
  // Same llm_calls accounting as the legacy loop (cost, usage, per-task totals).
  const baseAdapter = opts.messagesAdapter;
  let modelTurn = 0;
  const adapter: MessagesAdapter = {
    metadata: baseAdapter.metadata,
    browserBrain: recordedBrowserAdapter(baseAdapter, {
      recorder: opts.recorder,
      userExternalId: opts.userExternalId,
      taskId: opts.taskId,
      iteration: 0,
      onRecordError: () => {},
    }).browserBrain,
    create(request, options) {
      modelTurn += 1;
      return recordedBrowserAdapter(baseAdapter, {
        recorder: opts.recorder,
        userExternalId: opts.userExternalId,
        taskId: opts.taskId,
        iteration: modelTurn,
        onRecordError: () => {},
      }).create(request, options);
    },
  };
  running.set(opts.taskId, controller);
  // FIX-30 (BENCH-1 c03: Bilibili ran 636 s): reading one page gets 300 s at most;
  // past that the run fails as a timeout, said as such.
  const budgetMs = readsOnePage(opts.intent)
    ? Math.min(opts.timeoutMs ?? READ_ONE_PAGE_TIMEOUT_MS, READ_ONE_PAGE_TIMEOUT_MS)
    : opts.timeoutMs;
  let activeRemaining = budgetMs;
  let activeSince = Date.now();
  let timeout = activeRemaining ? setTimeout(() => controller.abort(), activeRemaining) : undefined;
  // Waiting for the user never counts against the budget (captcha, login, a
  // confirmation — every awaiting_user wait). Nested waits suspend once.
  let suspended = 0;
  const suspendTimeout = () => {
    if (suspended++ > 0) return;
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    if (activeRemaining !== undefined)
      activeRemaining = Math.max(1, activeRemaining - (Date.now() - activeSince));
  };
  // FIX-61 DEPLOY-61 P1-3: wrap up once 80% of the active time (waits for the user excluded)
  // is used, so a long search ends as an honest partial answer, not a bare timeout.
  const wrapUp = () => {
    if (!budgetMs || activeRemaining === undefined) return false;
    const left = suspended > 0 ? activeRemaining : activeRemaining - (Date.now() - activeSince);
    return budgetMs - left >= budgetMs * WRAP_UP_AT;
  };
  const resumeTimeout = () => {
    if (suspended === 0 || --suspended > 0) return;
    activeSince = Date.now();
    if (activeRemaining !== undefined && !controller.signal.aborted)
      timeout = setTimeout(() => controller.abort(), activeRemaining);
  };
  let binding: { control: BrowserControl; finish: () => void } | undefined;
  let control = opts.browserControl;
  let handoffFailure: string | undefined;
  /** The handover ended because the control channel failed, not the user (FIX-35 复审 #2). */
  let handoffPlatform = false;
  /** The user chose 换个方式继续: the answer does not come from the walled page. */
  let captchaAlternate = false;
  const withAlternateNotice = (summary: string) =>
    captchaAlternate
      ? `页面验证码未通过，已按你的选择改用其他方式继续；以下结果不是来自被验证拦住的页面。\n\n${summary}`
      : summary;
  const cancelPoll = setInterval(() => {
    void Promise.resolve(opts.isTaskCancelled?.())
      .then((cancelled) => {
        if (cancelled) controller.abort();
      })
      .catch(() => {});
  }, CANCEL_POLL_MS);

  const toolsUsed = new Set<string>();
  let lastSnapshot = '';
  /** FIX-58 复审 #2 第 4 项: the last action on the page, for the pause wording. */
  let lastActed: PausedAction | null = null;
  /** FIX-61B 复审 #2: the last step that may act, judged by the read-only pass. */
  let lastStep: PausedAction | null = null;
  /** DEPLOY-58 第 0 步 2: what the last action set off, to tell a real submit. */
  let lastTriggers: ReadonlyArray<{ branch: string; url: string }> = [];
  /** FIX-61B P1-4: whether this pause passes for a read-only task; logged when it does. */
  const passReadOnlyEffect = async (
    interruption: { reason: string; message: string },
    triggers: ReadonlyArray<{ branch: string; url: string; bodyShape?: string; action?: string }>,
  ): Promise<boolean> => {
    // 复审 #1: what is pending now is judged too, in the same synchronous step as the clearing —
    // a write that arrived after the action's own snapshot is never cleared unjudged.
    const judged = [...triggers, ...(tools.observation?.pendingEffect()?.triggers ?? [])];
    const pass = readOnlyEffectMayPass({
      readOnly: isReadOnlyIntent(opts.intent),
      reason: interruption.reason,
      action: lastStep,
      triggers: judged,
    });
    if (!pass) return false;
    tools.observation?.acknowledgeEffect();
    logger.info(
      {
        taskId: opts.taskId,
        tool: lastStep?.tool,
        role: lastStep?.role ?? null,
        triggers: triggers.map((t) => t.branch),
      },
      'supercar: read-only background request passed',
    );
    await recordDiagnostic('browser_effect_passed', interruption.reason, interruption.message);
    return true;
  };
  // FIX-BATCH-A — the contract the verifier will enforce is also the model's
  // output requirement, and the loop gets one remediation turn when a
  // completed list answer misses per-item sources or key fields.
  const contract = getContract(opts.taskId);
  const guidance = browserOutputGuidance(contract);
  const siteHint = siteEntryHint(opts.intent);
  const groundedLinks = new Set<string>();
  /**
   * Links and pages the model actually saw ground its per-item citations in
   * the evidence ledger. Without them only the final URL was grounded, and
   * auto-fix rewrote every article link to the site root (acceptance A2).
   */
  const recordLinks = async (urls: readonly string[], detail: string) => {
    for (const url of urls) {
      if (groundedLinks.has(url) || groundedLinks.size >= MAX_GROUNDED_LINKS) continue;
      groundedLinks.add(url);
      await safe(() =>
        opts.onEvidence?.({
          fact: `page_link=${url}`,
          sourceType: 'browser_state',
          sourceDetail: detail,
          confidence: 'observed',
        }),
      );
    }
  };
  let actionIndex = 0;
  let iteration = 0;
  const safe = async (fn: (() => void | Promise<void>) | undefined) => {
    try {
      await fn?.();
    } catch {
      /* Hooks are best-effort, as in the legacy loop. */
    }
  };

  async function recordDiagnostic(
    actionKind: string,
    errorCode: string | undefined,
    message: string,
    blockerEvidence?: import('./browser-completion.js').BrowserBlockerEvidence,
    effect?: UnifiedToolResult['effect'],
  ) {
    iteration += 1;
    await safe(() =>
      opts.onTick?.({
        iteration,
        execution: {
          actionKind,
          actionSummary: message,
          ok: actionKind === 'browser_local_wall' || actionKind === 'browser_rescue',
          message,
          ...(errorCode ? { errorCode } : {}),
          ...(blockerEvidence ? { blockerEvidence } : {}),
          ...(effect ? { effect } : {}),
        },
        toolsInTurn: [],
        textPreamble: '',
        apiLatencyMs: 0,
      }),
    );
  }

  /** Parks until the user replies (supercarReply); null on timeout or abort. */
  const parkForReply = async (
    question: string,
    awaitingKind: SupercarAwaitingKind,
  ): Promise<string | null> => {
    // FIX-30 review: a login wall the user takes 5+ minutes on is not a timeout.
    suspendTimeout();
    // FIX-54 #8: nobody watching the panel, the pool's 5-minute idle reclaim closed the browser
    // under a wait that promises 30 minutes. The wait holds it, for the wait's own length.
    await safe(() => opts.onAwaitingReplyHold?.(HANDOFF_WAIT_MS));
    await replay?.pause();
    try {
      await safe(() =>
        opts.onAwaitingUser?.({
          question,
          at: new Date(),
          currentUrl: page.url(),
          awaitingKind,
        }),
      );
      if (controller.signal.aborted) return null;
      return await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          parked.delete(opts.taskId);
          resolve(null);
        }, HANDOFF_WAIT_MS);
        parked.set(opts.taskId, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          abort: () => resolve(null),
          intent: opts.intent,
        });
      });
    } finally {
      await safe(() => opts.onAwaitingReplyRelease?.());
      replay?.resume();
      resumeTimeout();
    }
  };
  // Runtime safety boundary: the same LIVE-VETO the legacy loop applies before
  // each live write. tasks.create passes classifyRuntimeAction; a caller that
  // passes nothing still gets it — the gate is never silently off.
  const baseGateAction = (targetPage: typeof page) =>
    createUnifiedActionGate({
      page: targetPage,
      locatorForAction: (action, ref) =>
        tools.observation?.locator(tools.observation.resolve(action).frame, ref) ??
        targetPage.locator(`aria-ref=${ref}`),
      frameForAction: (action) =>
        tools.observation?.resolve(action).frame ?? targetPage.mainFrame(),
      onBeforeAction: opts.onBeforeAction ?? classifyRuntimeAction,
      labelForRef: (ref) => labelForRef(lastSnapshot, ref),
      park: parkForReply,
      readOnly: isReadOnlyIntent(opts.intent),
      aborted: () => controller.signal.aborted,
      stillLive: async () =>
        !controller.signal.aborted &&
        !(await Promise.resolve(opts.isTaskCancelled?.()).catch(() => true)),
    });

  const gateAction: ReturnType<typeof createUnifiedActionGate> = async (action, phase) => {
    const stopped = sessionStopped();
    if (stopped)
      return {
        kind: 'stop',
        outcome: {
          status: 'awaiting_user',
          reason: stopped,
          message: sessionStoppedQuestion(stopped),
          steps: 0,
        },
      };

    if (phase === 'before' && control && !control.canAgentAct()) {
      await replay?.pause();
      const boundary = await control.checkpoint(async () => {
        lastSnapshot = '';
      });
      if (boundary.resumed) replay?.resume();
      if (boundary.resumed)
        return {
          kind: 'skip',
          message: '用户已交还控制权；从当前页面重新 snapshot，不重放旧动作。',
        };
      if (!control.canAgentAct()) {
        // FIX-29 (Deploy-29 fc-jd): a viewer connecting mid-run queued a resize; the
        // run then stopped as 「已取消」 on JD's login page, with no handover. A
        // control closed by a failure (not by the user) is said. It cannot be
        // handed to the user (review() refuses a control closed with an error,
        // PR #291 review): a wall in front of the page is named, with a rerun,
        // which pauses at the wall with a working control.
        const state = control.snapshot();
        logger.warn(
          { taskId: opts.taskId, phase: state.phase, error: state.error, url: page.url() },
          'supercar: browser control unavailable at an action boundary',
        );
        // The user's cancel comes first, also when an input was cut off by it (review 4).
        if (
          !state.error ||
          controller.signal.aborted ||
          (await Promise.resolve(opts.isTaskCancelled?.()).catch(() => false))
        )
          return { kind: 'stop', outcome: { status: 'cancelled', steps: 0 } };
        // The page may be mid-navigation: the wall probe gets 5 s (review).
        const blocker = await Promise.race([
          tools.blocker().catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);
        const walled = blocker && !('disposition' in blocker && blocker.disposition === 'continue');
        return {
          kind: 'stop',
          outcome: {
            status: 'failed',
            reason: walled
              ? `${blocker.message.replace(/；?当前任务尚未完成。?$/, '')}。但云端浏览器的画面同步中断，这次无法交给你接管；请重新执行任务，遇到这个页面时会暂停交给你处理。`
              : '云端浏览器的画面同步中断，任务没能继续执行；已打开的页面仍保留，请重新执行。',
            steps: 0,
          },
        };
      }
    }
    if (phase === 'before' && tools.observation) {
      try {
        await tools.observation.validate(action);
      } catch (error) {
        const failure = browserToolError(error);
        iteration += 1;
        toolsUsed.add(action.tool);
        await safe(() =>
          opts.onTick?.({
            iteration,
            execution: {
              actionKind: action.tool,
              actionSummary: describe(action, null),
              ok: false,
              message: failure.text,
              errorCode: failure.errorCode,
              errorMessage: failure.errorMessage,
            },
            toolsInTurn: [action.tool],
            textPreamble: '',
            apiLatencyMs: 0,
          }),
        );
        return {
          kind: 'skip' as const,
          message: `${failure.text} (${failure.errorCode}: ${failure.errorMessage})\nfresh_observation (未执行原动作):\n${(await tools.recoverObservation().catch(() => null))?.text ?? '无法重新观察当前页'}`,
        };
      }
    }
    const changedTab =
      ['new_tab', 'switch_tab', 'close_tab'].includes(action.tool) ||
      (phase === 'after' && action.tool === 'click' && action.newTab);
    // FIX-54 (local A/B B r2 new-amazon-sg): a tab or frame gone since the read threw out of the
    // gate and ended the task as 「runner threw: stale_context」. The gate looks at the current
    // page instead; the action itself then reports stale_context and the model reads again.
    const resolvedPage = () => {
      try {
        return tools.observation?.resolve(action).page;
      } catch {
        return undefined;
      }
    };
    const targetPage = changedTab ? tools.page : (resolvedPage() ?? tools.page);
    const result = await baseGateAction(targetPage)(action, phase);
    if (result.kind === 'proceed' && replay) {
      try {
        // Authorization comes from the host gate, never from page text.
        const url =
          action.tool === 'navigate' && phase === 'before' ? action.url : targetPage.url();
        if (/^https?:/.test(url)) replay.authorize(new URL(url).origin);
      } catch {}
    }
    return result;
  };
  try {
    binding = opts.browserControlFactory?.();
    control = binding?.control ?? control;
    // FIX-38 #5: the captcha as the user is asked to solve it, sensitive boxes masked — task
    // evidence for acceptance (a few per task, one per page).
    const captchaShots = new Set<string>();
    const captchaEvidence = async (rule: string) => {
      const url = tools.page.url();
      if (
        !opts.onCaptchaEvidence ||
        !captchaHandoffEvidence() ||
        captchaShots.has(url) ||
        captchaShots.size >= 3
      )
        return;
      captchaShots.add(url);
      await safe(async () => {
        const jpeg = await tools.page.screenshot({
          type: 'jpeg',
          quality: 70,
          timeout: 5_000,
          style: CAPTCHA_SCREENSHOT_STYLE,
        });
        await opts.onCaptchaEvidence?.({ jpeg, url, at: new Date(), rule });
      });
    };
    const outcome = await runUnifiedBrowserLoop({
      wrapUp,
      ...(control
        ? {
            // A search wall the fallback can answer is not the user's job.
            captchaHandoffWanted: () => !opts.searchWallReplaceable?.(page.url()),
            captchaHandoff: async (_message: string) => {
              suspendTimeout();
              // FIX-52 #8 (Deploy-52 wall-zhihu): nobody watching the panel, the pool's 5-minute idle
              // reclaim closed the browser under a wait that promises 10 minutes.
              const keepBrowser = setInterval(() => {
                void safe(() => opts.onBrowserKeepAlive?.());
              }, BROWSER_KEEP_ALIVE_MS);
              try {
                await replay?.pause();
                const result = await captchaHandoffs.wait({
                  taskId: opts.taskId,
                  userId: opts.userExternalId ?? '',
                  control: control!,
                  pageGone: () => (tools.observation?.page ?? page).isClosed(),
                  hasWall: async () => {
                    // A closed page shows no wall, and that does not mean the user cleared it.
                    if ((tools.observation?.page ?? page).isClosed())
                      throw new Error('stale_context');
                    const hit = await tools.blocker();
                    return (
                      hit?.reason === 'captcha' &&
                      !('disposition' in hit && hit.disposition === 'continue')
                    );
                  },
                  onWaiting: async () => {
                    await opts.onAwaitingUser?.({
                      question:
                        '网站要求人机验证，请在下方浏览器中完成验证。AI 已暂停，最多等待 10 分钟。',
                      at: new Date(),
                      currentUrl: page.url(),
                      awaitingKind: 'captcha',
                      captchaHandoff: true,
                    });
                  },
                  onResumed: async () => (await opts.onCaptchaHandoffEnd?.(true)) ?? true,
                  challenge: () => inspectChallenge(page),
                  // FIX-53 #1: what the person did during the wait is the evidence for
                  // 「用户已完成验证」; counts and times only, never the inputs.
                  onActivity: (activity) =>
                    logger.info(
                      {
                        taskId: opts.taskId,
                        inputs: activity.inputs,
                        confirmed: activity.confirmed,
                        firstInputAt: activity.firstAt && new Date(activity.firstAt).toISOString(),
                        lastInputAt: activity.lastAt && new Date(activity.lastAt).toISOString(),
                      },
                      'captcha wait user activity',
                    ),
                  signal: controller.signal,
                  timeoutMs: opts.captchaWaitMs,
                  pollMs: opts.captchaPollMs,
                });
                const goesOn = result === 'resumed' || result === 'cleared';
                if (!goesOn && result !== 'alternate') {
                  handoffFailure =
                    result === 'timeout'
                      ? '等待用户完成验证码已超时，任务未完成。'
                      : result === 'error'
                        ? (tools.observation?.page ?? page).isClosed()
                          ? '等待验证时云端浏览器已关闭，任务未完成，请重新执行。'
                          : '验证码接管通道异常关闭，任务未完成，请稍后重试。'
                        : '用户已放弃验证，任务未完成。';
                  handoffPlatform = result === 'error';
                  await opts.onCaptchaHandoffEnd?.(false);
                }
                lastSnapshot = '';
                if (result === 'alternate') captchaAlternate = true;
                if (goesOn || result === 'alternate') replay?.resume();
                return result === 'alternate' || result === 'cleared' ? result : goesOn;
              } finally {
                clearInterval(keepBrowser);
                // Same as parkForReply: the budget resumes whatever the handoff ended with.
                resumeTimeout();
              }
            },
          }
        : {}),
      observationV2: capabilities.observationV2,
      requireBrowserEvidence: true,
      supportedTools: tools.supportedTools,
      controlLabels: tools.controlLabels,
      probeBlocker: async () => {
        const blocker = await tools.blocker();
        if (blocker && 'evidence' in blocker) {
          const continued = 'disposition' in blocker && blocker.disposition === 'continue';
          if (!continued && blocker.reason === 'captcha') {
            learnBlock?.(tools.page.url(), 'captcha');
            await captchaEvidence(blocker.evidence.rule);
          }
          await recordDiagnostic(
            continued ? 'browser_local_wall' : 'browser_blocker',
            continued ? undefined : `browser_${blocker.reason}_wall`,
            blocker.message,
            blocker.evidence,
          );
          await safe(() =>
            opts.onEvidence?.({
              fact: JSON.stringify(blocker.evidence),
              sourceType: 'browser_state',
              sourceDetail: 'browser_blocker',
              confidence: 'observed',
            }),
          );
        }
        return blocker;
      },
      onCompletionRejected: (event) =>
        recordDiagnostic(
          'browser_finish_rejected',
          'completion_evidence_rejected',
          JSON.stringify(event),
        ),
      currentPageUrl: () => tools.page.url(),
      // FIX-57 #5: the rescue shows as one live status line (a diagnostic tick).
      rescue: opts.browserRescue ?? true,
      onRescue: (message) => recordDiagnostic('browser_rescue', undefined, message),
      playbackReceipt: () => tools.playbackReceipt(),
      checkInterruption: async () => {
        const observed = tools.observation?.interruption();
        if (
          observed &&
          (await passReadOnlyEffect(observed, tools.observation?.pendingEffect()?.triggers ?? []))
        )
          return egress.interruption() ?? undefined;
        const interruption = observed ?? egress.interruption() ?? undefined;
        if (interruption)
          await recordDiagnostic(
            'browser_effect',
            interruption.reason,
            interruption.message,
            undefined,
            tools.observation?.pendingEffect(),
          );
        return interruption;
      },
      userIntent: opts.intent,
      intent: [
        opts.intent,
        guidance ? `【结果要求】\n${guidance}` : '',
        siteHint ? `【站点提示】\n${siteHint}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      ...(opts.askedFieldJudge ? { fieldJudge: opts.askedFieldJudge } : {}),
      ...(contract && guidance
        ? {
            reviewFinish: (summary: string, pageText?: string) =>
              reviewListAnswer(contract, summary, pageText),
            partialNote: (summary: string, pageText?: string) =>
              listPartialNote(contract, summary, pageText),
          }
        : {}),
      adapter,
      ...(opts.unifiedWebSearch ? { webSearch: opts.unifiedWebSearch } : {}),
      ...(opts.unifiedWebSearchAfterWall
        ? { webSearchAfterWall: opts.unifiedWebSearchAfterWall }
        : {}),
      ...(opts.unifiedReadPage ? { readPage: opts.unifiedReadPage } : {}),
      ...(opts.unifiedLocalFixtures ? { localFixtures: true } : {}),
      maxSteps: opts.maxIterations ?? 40,
      signal: controller.signal,
      async execute(action) {
        const id = `action-${++replayActionId}`;
        const targetPage = tools.page;
        await replay?.capture(targetPage, id, 'before');
        // FIX-61B 复审 #2: the read-only pass judges the last step that may act (click_at, wait_for,
        // upload… never pass); lastActed keeps naming the last control acted on, for the pause copy
        // (「可能已经生成订单」 after 「立即预约」 then wait_for).
        if (!READ_TOOLS.has(action.tool))
          lastStep = {
            tool: action.tool,
            label: 'ref' in action && action.ref ? refName(lastSnapshot, action.ref) : null,
            submit: action.tool === 'type' && action.submit === true,
            role: 'ref' in action && action.ref ? refRole(lastSnapshot, action.ref) : null,
          };
        if (
          ['click', 'type', 'select', 'navigate', 'click_at', 'download', 'upload'].includes(
            action.tool,
          )
        )
          lastActed = {
            tool: action.tool,
            label: 'ref' in action && action.ref ? refName(lastSnapshot, action.ref) : null,
            value: action.tool === 'select' ? action.value : null,
            submit: action.tool === 'type' && action.submit === true,
            role: 'ref' in action && action.ref ? refRole(lastSnapshot, action.ref) : null,
          };
        const result = await tools.execute(action);
        page = tools.page;
        lastTriggers = result.effect?.triggers ?? [];
        // FIX-61B P1-4: a read-only task's background-request pause after an ordinary step is
        // logged and passed (read-only-effect-policy); anything that may change something asks.
        if (result.interruption && (await passReadOnlyEffect(result.interruption, lastTriggers))) {
          delete result.interruption;
          result.text = `${result.text}\n（页面在后台发了一个请求，判断为浏览产生的统计类请求，已记录并继续只读查看。）`;
        }
        // FIX-61B P1-6: a read of a page with boxes the person typed into says which (names only,
        // never the text): the assistant cannot see their contents and must not call them empty.
        if (result.ok && READ_TOOLS.has(action.tool)) {
          const typed = await humanTypedFieldNames(tools.page);
          if (typed.length)
            result.text = `${result.text}\n（页面上「${typed.join('」「')}」是用户自己填写的输入框，内容你看不到：被问到时回答「这是你自己填的内容，我看不到」，不要说为空或没有填写。）`;
        }

        if (result.ok) opts.executor?.selectTaskPage?.(page);
        await replay?.capture(
          page,
          id,
          result.ok && !result.interruption ? 'after' : 'failure',
          result.ok ? 'ok' : 'failed',
        );
        iteration += 1;
        toolsUsed.add(action.tool);
        if (action.tool === 'snapshot' && result.ok) lastSnapshot = result.text;
        if (
          result.ok &&
          (result.download || result.tabId || result.scroll || result.form || result.image)
        )
          await safe(() =>
            opts.onEvidence?.({
              fact: JSON.stringify({
                tool: action.tool,
                ...(result.download ? { download: result.download } : {}),
                ...(result.tabId ? { tabId: result.tabId } : {}),
                ...(result.scroll ? { scroll: result.scroll } : {}),
                ...(result.form ? { form: result.form } : {}),
                ...(result.image ? { screenshot: true } : {}),
              }),
              sourceType: 'browser_state',
              sourceDetail: 'browser_tool_receipt',
              confidence: 'observed',
            }),
          );
        if (result.ok && result.url) await recordLinks([result.url], 'unified page url');
        if (result.ok && result.links?.length)
          await recordLinks(result.links, `unified snapshot of ${result.url ?? page.url()}`);
        const label = 'ref' in action && action.ref ? labelForRef(lastSnapshot, action.ref) : null;
        await safe(() =>
          opts.onTick?.({
            iteration,
            execution: {
              actionKind: action.tool,
              actionSummary: describe(action, label),
              ok: result.ok,
              ...(result.effect ? { effect: result.effect } : {}),
              ...(action.tool === 'type' && result.form?.search ? { searchForm: true } : {}),
              ...(result.ok
                ? {}
                : {
                    message: result.text,
                    errorCode: result.errorCode,
                    errorMessage: result.errorMessage,
                  }),
            },
            toolsInTurn: [action.tool],
            textPreamble: '',
            apiLatencyMs: 0,
          }),
        );
        if (
          result.ok &&
          (action.tool === 'navigate' || action.tool === 'click' || action.tool === 'type')
        ) {
          actionIndex += 1;
          await safe(() =>
            opts.onAction?.({
              actionIndex,
              stepType: action.tool as 'navigate' | 'click' | 'type',
              siteDomain: siteDomain(page.url()),
              visibleText: label,
              targetSelector: label,
              coordinate: null,
              entryUrl: action.tool === 'navigate' ? action.url : page.url(),
              inputValue: action.tool === 'type' ? action.text : null,
              framePath: null,
            }),
          );
        }
        return result;
      },
      gateAction,
      requestHuman: async ({ reason, message }) =>
        (await parkForReply(message, awaitingKindFor(reason))) !== null,
    });
    const stoppedAtEnd = sessionStopped();
    if (stoppedAtEnd && outcome.status !== 'cancelled')
      return {
        status: 'awaiting_user',
        question: sessionStoppedQuestion(stoppedAtEnd),
        iterations: outcome.steps,
        toolsUsed: [...toolsUsed],
      };
    switch (outcome.status) {
      case 'completed':
        await safe(() =>
          opts.onEvidence?.({
            fact: outcome.evidence,
            sourceType: 'browser_state',
            sourceDetail: page.url(),
            confidence: 'observed',
          }),
        );
        return {
          status: 'completed',
          summary: withAlternateNotice(outcome.summary),
          iterations: outcome.steps,
          toolsUsed: [...toolsUsed],
          ...(outcome.partial ? { partial: outcome.partial } : {}),
        };
      case 'awaiting_user':
        return {
          status: 'awaiting_user',
          question:
            outcome.reason === 'unexpected_effect'
              ? effectPauseQuestion({
                  english: isEnglishIntent(opts.intent),
                  site: siteCalled(await safeTitle(page), page.url(), isEnglishIntent(opts.intent)),
                  pageTitle: await safeTitle(page),
                  action: lastActed,
                  readOnly: isReadOnlyIntent(opts.intent),
                  background: outcome.message === UNPLACED_POST_MESSAGE,
                  triggers: [
                    ...lastTriggers,
                    ...(tools.observation?.pendingEffect()?.triggers ?? []),
                  ],
                })
              : outcome.message,
          iterations: outcome.steps,
          toolsUsed: [...toolsUsed],
        };
      case 'cancelled': {
        const timedOut =
          controller.signal.aborted && Boolean(budgetMs) && !(await opts.isTaskCancelled?.());
        // Out of time during the remediation turn: deliver the held answer for
        // verification (it explains what is missing) instead of a bare timeout.
        if (timedOut && outcome.heldAnswer) {
          await safe(() =>
            opts.onEvidence?.({
              fact: outcome.heldAnswer?.evidence ?? '',
              sourceType: 'browser_state',
              sourceDetail: page.url(),
              confidence: 'observed',
            }),
          );
          return {
            status: 'completed',
            summary: withAlternateNotice(outcome.heldAnswer.summary),
            iterations: outcome.steps,
            toolsUsed: [...toolsUsed],
          };
        }
        return timedOut
          ? {
              status: 'timeout',
              reason: '任务超时，请把任务拆小一些再试。',
              iterations: outcome.steps,
              toolsUsed: [...toolsUsed],
            }
          : {
              status: 'cancelled',
              ...(outcome.reason ? { reason: outcome.reason } : {}),
              iterations: outcome.steps,
              toolsUsed: [...toolsUsed],
            };
      }
      default:
        return {
          status: 'failed',
          // LLM-RETRY-1: a model call that failed after its retries says so,
          // even before any page was opened. FAILURE-COPY-1: ending on the blank
          // start page is "not started", never a login question.
          ...(page.url() === 'about:blank' && !outcome.modelFailure
            ? { reason: NOT_STARTED, failureSource: 'not_started' as const }
            : {
                reason: handoffFailure ?? outcome.reason,
                // FIX-35 复审 #1: a verification handover the user timed out on or gave up is
                // the user's wall, not a platform failure (no refund after a reroute).
                ...(handoffFailure
                  ? { failureSource: handoffPlatform ? ('tool' as const) : ('user_wall' as const) }
                  : outcome.failureSource
                    ? { failureSource: outcome.failureSource }
                    : {}),
              }),
          iterations: outcome.steps,
          toolsUsed: [...toolsUsed],
        };
    }
  } finally {
    if (learnBlock) page.off('response', onPageResponse);
    control?.close();
    await control?.settled();
    binding?.finish();
    if (profileStore && opts.persistentProfileUser)
      await saveBrowserProfile(
        page.context(),
        profileStore,
        opts.persistentProfileUser,
        profileSince,
      );
    await egress.dispose();
    if (egress.metrics.proxyRequests || egress.metrics.blockedMedia)
      await safe(() =>
        opts.onEvidence?.({
          fact: JSON.stringify(egress.metrics),
          sourceType: 'browser_state',
          sourceDetail: 'domain_proxy_traffic',
          confidence: 'observed',
        }),
      );
    if (replayTimer) clearInterval(replayTimer);
    await replay?.dispose();
    await tools.releasePlayback();
    tools.dispose();
    if (timeout) clearTimeout(timeout);
    clearInterval(cancelPoll);
    running.delete(opts.taskId);
    parked.delete(opts.taskId);
  }
}

const READ_ONE_PAGE_TIMEOUT_MS = 300_000;
/** FIX-61 DEPLOY-61 P1-3: the share of the time limit after which the run wraps up. */
const WRAP_UP_AT = 0.8;
/** A read of one page: no form, file, search, scroll, tab or multi-item work. */
export function readsOnePage(intent: string): boolean {
  return (
    !/填|表单|勾选|下载|上传|搜索|搜一下|搜|滚动|新标签|标签页|分别|每个|逐个|对比|比较|前\s*\d+|翻页|登录|注册|预订|下单|购买|加购|\bfill\b|\bdownload\b|\bupload\b|\bsearch\b|\bscroll\b|\btabs?\b|\bcompare\b|\btop\s*\d+/i.test(
      intent,
    ) &&
    /https?:\/\/|www\.|打开|读|看(?:下|一下)?(?=这|该|页面|网页|标题)|告诉我|是谁|是什么|多少|\bopen\b|\bread\b|\bwhat\b/i.test(
      intent,
    )
  );
}
