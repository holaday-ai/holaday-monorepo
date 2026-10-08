import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type {
  RunSupercarOptions,
  SupercarAwaitingKind,
  SupercarOutcome,
} from '../supercar/agent-loop.js';
import { recordedBrowserAdapter } from '../supercar/recorded-browser-adapter.js';
import { createUnifiedActionGate } from './unified-action-gate.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

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
  const tools = createPlaywrightUnifiedExecutor(page);
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
  // Runtime safety boundary (tasks.create passes classifyRuntimeAction): the
  // same LIVE-VETO the legacy loop applies before each live write.
  const gateAction = opts.onBeforeAction
    ? createUnifiedActionGate({
        page,
        onBeforeAction: opts.onBeforeAction,
        labelForRef: (ref) => labelForRef(lastSnapshot, ref),
        park: parkForReply,
        aborted: () => controller.signal.aborted,
      })
    : null;

  try {
    const outcome = await runUnifiedBrowserLoop({
      intent: opts.intent,
      adapter,
      ...(opts.unifiedWebSearch ? { webSearch: opts.unifiedWebSearch } : {}),
      ...(opts.unifiedReadPage ? { readPage: opts.unifiedReadPage } : {}),
      maxSteps: opts.maxIterations ?? 40,
      signal: controller.signal,
      async execute(action) {
        const result = await tools.execute(action);
        iteration += 1;
        toolsUsed.add(action.tool);
        if (action.tool === 'snapshot' && result.ok) lastSnapshot = result.text;
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
      ...(gateAction ? { gateAction } : {}),
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
      case 'cancelled':
        return controller.signal.aborted && opts.timeoutMs && !(await opts.isTaskCancelled?.())
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
      default:
        return {
          status: 'failed',
          reason: outcome.reason,
          iterations: outcome.steps,
          toolsUsed: [...toolsUsed],
        };
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    clearInterval(cancelPoll);
    running.delete(opts.taskId);
    parked.delete(opts.taskId);
  }
}
