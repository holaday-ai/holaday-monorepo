import { egressBlockLearner } from '../../browser-pool/egress-learning.js';
import {
  browserProfileStore,
  restoreBrowserProfile,
  saveBrowserProfile,
} from '../../browser-profiles/profile-store.js';
import { browserCapabilities } from '../../config/browser-capabilities.js';
import { logger } from '../../config/logger.js';
import { reviewListAnswer } from '../../execution/answer-verifier.js';
import { browserOutputGuidance } from '../../execution/execution-contract.js';
import { getContract } from '../../execution/execution-pipeline.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
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
import { installDomainEgress } from './domain-egress.js';
import {
  type UnifiedToolResult,
  createPlaywrightUnifiedExecutor,
} from './playwright-unified-executor.js';
import { createUnifiedActionGate } from './unified-action-gate.js';
import { NOT_STARTED, runUnifiedBrowserLoop } from './unified-browser-loop.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

/** Ledger entries are capped per task (MAX_ENTRIES_PER_TASK); links take at most this many. */
const MAX_GROUNDED_LINKS = 600;
/** Same takeover window as the legacy loop: a parked task waits this long for the user. */
const HANDOFF_WAIT_MS = 30 * 60_000;
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

function describe(action: UnifiedBrowserAction, label: string | null): string {
  switch (action.tool) {
    case 'navigate':
      return `打开 ${action.url}`;
    case 'click':
      return `点击 ${label ?? action.ref}`;
    case 'type':
      return `在 ${label ?? action.ref} 输入`;
    case 'select':
      return `在 ${label ?? action.ref} 选择「${action.value}」`;
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
  let activeRemaining = opts.timeoutMs;
  let activeSince = Date.now();
  let timeout = activeRemaining ? setTimeout(() => controller.abort(), activeRemaining) : undefined;
  const suspendTimeout = () => {
    if (timeout) clearTimeout(timeout);
    if (activeRemaining !== undefined)
      activeRemaining = Math.max(1, activeRemaining - (Date.now() - activeSince));
  };
  const resumeTimeout = () => {
    activeSince = Date.now();
    if (activeRemaining !== undefined)
      timeout = setTimeout(() => controller.abort(), activeRemaining);
  };
  let binding: { control: BrowserControl; finish: () => void } | undefined;
  let control = opts.browserControl;
  let handoffFailure: string | undefined;
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
  // FIX-BATCH-A — the contract the verifier will enforce is also the model's
  // output requirement, and the loop gets one remediation turn when a
  // completed list answer misses per-item sources or key fields.
  const contract = getContract(opts.taskId);
  const guidance = browserOutputGuidance(contract);
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
          ok: actionKind === 'browser_local_wall',
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
      replay?.resume();
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
        if (!state.error) return { kind: 'stop', outcome: { status: 'cancelled', steps: 0 } };
        const blocker = await tools.blocker().catch(() => null);
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
    const targetPage = changedTab
      ? tools.page
      : (tools.observation?.resolve(action).page ?? tools.page);
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
    const outcome = await runUnifiedBrowserLoop({
      ...(control
        ? {
            // A search wall the fallback can answer is not the user's job.
            captchaHandoffWanted: () => !opts.searchWallReplaceable?.(page.url()),
            captchaHandoff: async (_message: string) => {
              suspendTimeout();
              await replay?.pause();
              const result = await captchaHandoffs.wait({
                taskId: opts.taskId,
                userId: opts.userExternalId ?? '',
                control: control!,
                hasWall: async () => {
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
                signal: controller.signal,
                timeoutMs: opts.captchaWaitMs,
                pollMs: opts.captchaPollMs,
              });
              if (result !== 'resumed' && result !== 'alternate') {
                handoffFailure =
                  result === 'timeout'
                    ? '等待用户完成验证码已超时，任务未完成。'
                    : '用户已放弃验证，任务未完成。';
                await opts.onCaptchaHandoffEnd?.(false);
              }
              lastSnapshot = '';
              if (result === 'alternate') captchaAlternate = true;
              if (result === 'resumed' || result === 'alternate') replay?.resume();
              resumeTimeout();
              return result === 'alternate' ? 'alternate' : result === 'resumed';
            },
          }
        : {}),
      observationV2: capabilities.observationV2,
      requireBrowserEvidence: true,
      supportedTools: tools.supportedTools,
      probeBlocker: async () => {
        const blocker = await tools.blocker();
        if (blocker && 'evidence' in blocker) {
          const continued = 'disposition' in blocker && blocker.disposition === 'continue';
          if (!continued && blocker.reason === 'captcha') learnBlock?.(tools.page.url(), 'captcha');
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
      playbackReceipt: () => tools.playbackReceipt(),
      checkInterruption: async () => {
        const interruption =
          tools.observation?.interruption() ?? egress.interruption() ?? undefined;
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
      intent: guidance ? `${opts.intent}\n\n【结果要求】\n${guidance}` : opts.intent,
      ...(contract && guidance
        ? { reviewFinish: (summary: string) => reviewListAnswer(contract, summary) }
        : {}),
      adapter,
      ...(opts.unifiedWebSearch ? { webSearch: opts.unifiedWebSearch } : {}),
      ...(opts.unifiedWebSearchAfterWall
        ? { webSearchAfterWall: opts.unifiedWebSearchAfterWall }
        : {}),
      ...(opts.unifiedReadPage ? { readPage: opts.unifiedReadPage } : {}),
      maxSteps: opts.maxIterations ?? 40,
      signal: controller.signal,
      async execute(action) {
        const id = `action-${++replayActionId}`;
        const targetPage = tools.page;
        await replay?.capture(targetPage, id, 'before');
        const result = await tools.execute(action);
        page = tools.page;
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
          question: outcome.message,
          iterations: outcome.steps,
          toolsUsed: [...toolsUsed],
        };
      case 'cancelled': {
        const timedOut =
          controller.signal.aborted && Boolean(opts.timeoutMs) && !(await opts.isTaskCancelled?.());
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
                ...(handoffFailure
                  ? { failureSource: 'tool' as const }
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
