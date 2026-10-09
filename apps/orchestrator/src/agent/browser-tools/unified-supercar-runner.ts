import { env } from '../../config/env.js';
import { browserReplayStore } from './browser-replay-service.js';
import { BrowserReplayRecorder } from './browser-replay.js';
import { reviewListAnswer } from '../../execution/answer-verifier.js';
import { browserOutputGuidance } from '../../execution/execution-contract.js';
import { getContract } from '../../execution/execution-pipeline.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type {
  RunSupercarOptions,
  SupercarAwaitingKind,
  SupercarOutcome,
} from '../supercar/agent-loop.js';
import { recordedBrowserAdapter } from '../supercar/recorded-browser-adapter.js';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import { createUnifiedActionGate } from './unified-action-gate.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';
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
      iterations: 0,
      toolsUsed: [],
    };
  }
  let page: Awaited<ReturnType<NonNullable<RunSupercarOptions['executor']>['getPage']>>;
  try {
    page = await opts.executor.getPage();
  } catch {
    return {
      status: 'failed',
      reason: '浏览器暂时不可用，请稍后重试。',
      iterations: 0,
      toolsUsed: [],
    };
  }
  const tools = createPlaywrightUnifiedExecutor(page, {
    observationV2: env.BROWSER_OBSERVATION_V2,
  });
  const replay =
    env.BROWSER_REPLAY_V1 && opts.userExternalId
      ? new BrowserReplayRecorder(browserReplayStore, opts.userExternalId, opts.taskId, new Set())
      : null;
  let replayActionId = 0;
  let sampling = false;
  const replayTimer = replay
    ? setInterval(() => {
        if (sampling) return;
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
  const controller = new AbortController();
  running.set(opts.taskId, controller);
  const timeout = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;
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

  /** Parks until the user replies (supercarReply); null on timeout or abort. */
  const parkForReply = async (
    question: string,
    awaitingKind: SupercarAwaitingKind,
  ): Promise<string | null> => {
    await safe(() =>
      opts.onAwaitingUser?.({
        question,
        at: new Date(),
        currentUrl: page.url(),
        awaitingKind,
      }),
    );
    if (controller.signal.aborted) return null;
    return new Promise<string | null>((resolve) => {
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

  const gateAction = async (action: UnifiedBrowserAction, phase: 'before' | 'after') => {
    if (phase === 'before' && tools.observation) {
      try {
        await tools.observation.validate(action);
      } catch {
        return { kind: 'skip' as const, message: '页面或 ref 已失效，请重新 read_page。' };
      }
    }
    const targetPage = tools.observation?.resolve(action).page ?? page;
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
    const outcome = await runUnifiedBrowserLoop({
      observationV2: env.BROWSER_OBSERVATION_V2,
      checkInterruption: () => tools.observation?.interruption(),
      intent: guidance ? `${opts.intent}\n\n【结果要求】\n${guidance}` : opts.intent,
      ...(contract && guidance
        ? { reviewFinish: (summary: string) => reviewListAnswer(contract, summary) }
        : {}),
      adapter,
      ...(opts.unifiedWebSearch ? { webSearch: opts.unifiedWebSearch } : {}),
      ...(opts.unifiedReadPage ? { readPage: opts.unifiedReadPage } : {}),
      maxSteps: opts.maxIterations ?? 40,
      signal: controller.signal,
      async execute(action) {
        const id = `action-${++replayActionId}`;
        const targetPage = tools.observation?.page ?? page;
        await replay?.capture(targetPage, id, 'before');
        const result = await tools.execute(action);
        page = tools.observation?.page ?? page;
        await replay?.capture(
          page,
          id,
          result.ok && !result.interruption ? 'after' : 'failure',
          result.ok ? 'ok' : 'failed',
        );
        iteration += 1;
        toolsUsed.add(action.tool);
        if (action.tool === 'snapshot' && result.ok) lastSnapshot = result.text;
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
              ...(result.ok ? {} : { message: result.text }),
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
          summary: outcome.summary,
          iterations: outcome.steps,
          toolsUsed: [...toolsUsed],
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
            summary: outcome.heldAnswer.summary,
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
          reason: outcome.reason,
          iterations: outcome.steps,
          toolsUsed: [...toolsUsed],
        };
    }
  } finally {
    if (replayTimer) clearInterval(replayTimer);
    await replay?.dispose();
    tools.dispose();
    if (timeout) clearTimeout(timeout);
    clearInterval(cancelPoll);
    running.delete(opts.taskId);
    parked.delete(opts.taskId);
  }
}
