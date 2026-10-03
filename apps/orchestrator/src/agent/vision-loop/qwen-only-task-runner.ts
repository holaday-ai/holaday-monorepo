import { siteDomainOf } from '../../playbook/evolution/capture-recorder.js';
import type { CapturedToolCall } from '../../playbook/evolution/capture-recorder.js';
import {
  createTaskCaptureRecorder,
  tryPlaybookReuse,
} from '../../playbook/evolution/executor-hooks.js';
import type { BrowserSnapshot } from '../../playbook/replay/browser-tools.js';
import {
  parseUnifiedSnapshot,
  playbookToolsFromUnifiedExecutor,
} from '../browser-tools/playbook-tools-adapter.js';
import { createPlaywrightUnifiedExecutor } from '../browser-tools/playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from '../browser-tools/unified-browser-loop.js';
import type { UnifiedBrowserAction } from '../browser-tools/unified-tools.js';
import type { RunOutcome } from './runner.js';
import {
  type StartVisionLoopTaskOptions,
  startVisionLoopTask as startCommanderLoopTask,
} from './task-runner.js';

const CAPTURED_OPS = new Set<CapturedToolCall['op']>([
  'navigate',
  'click',
  'type',
  'select',
  'scroll',
  'back',
  'wait_for',
]);

/**
 * Browser task entry for the vision-loop lane. With a Playwright page and a
 * model-catalog adapter it runs the unified browser loop (same tools for every
 * brain), preceded by verified-path reuse and followed by action capture
 * (batch 06, flag-gated); otherwise it falls back to the commander loop.
 */
export async function startVisionLoopTask(opts: StartVisionLoopTaskOptions): Promise<RunOutcome> {
  if (!opts.playwrightExecutor || !opts.messagesAdapter) return startCommanderLoopTask(opts);
  let page: Awaited<ReturnType<NonNullable<typeof opts.playwrightExecutor>['getPage']>>;
  try {
    page = await opts.playwrightExecutor.getPage();
  } catch {
    return { status: 'failed', reason: '浏览器暂时不可用，请稍后重试。', history: [] };
  }
  const tools = createPlaywrightUnifiedExecutor(page);
  const evolution = opts.evolution;

  if (evolution) {
    const reuse = await tryPlaybookReuse({
      db: evolution.db,
      tools: playbookToolsFromUnifiedExecutor(page, tools.execute),
      intent: opts.intent,
      siteDomain: siteDomainOf(page.url()),
      taskId: evolution.taskDbId,
      adapter: evolution.generateAdapter,
      logger: evolution.logger,
    });
    if (reuse?.handled) {
      const extracted = await tools.execute({ tool: 'extract', instruction: opts.intent });
      const content = extracted.ok ? (JSON.parse(extracted.text).content as string) : '';
      return {
        status: 'completed',
        summary: `已按验证过的操作路径完成。\n\n${content.slice(0, 4_000)}`,
        history: [],
      };
    }
  }

  const recorder = evolution
    ? createTaskCaptureRecorder({
        db: evolution.db,
        taskId: evolution.taskDbId,
        executorSource: 'cloud',
        logger: evolution.logger,
      })
    : null;
  let lastSnapshot: BrowserSnapshot | undefined;
  const execute = async (action: UnifiedBrowserAction) => {
    const result = await tools.execute(action);
    if (!recorder || !result.ok) return result;
    if (action.tool === 'snapshot') {
      lastSnapshot = await parseUnifiedSnapshot(page, result.text).catch(() => undefined);
    } else if (CAPTURED_OPS.has(action.tool as CapturedToolCall['op'])) {
      await recorder.recordToolCall({
        op: action.tool as CapturedToolCall['op'],
        ...('ref' in action && action.ref ? { ref: action.ref } : {}),
        ...(lastSnapshot ? { snapshot: lastSnapshot } : {}),
        ...(action.tool === 'navigate' ? { url: action.url } : {}),
        ...(action.tool === 'type' ? { text: action.text, submit: action.submit === true } : {}),
        ...(action.tool === 'select' ? { value: action.value } : {}),
        pageUrl: page.url(),
      });
    }
    return result;
  };

  const outcome = await runUnifiedBrowserLoop({
    intent: opts.intent,
    adapter: opts.messagesAdapter,
    execute,
    ...(opts.webSearch ? { webSearch: opts.webSearch } : {}),
    maxSteps: opts.maxSteps ?? 40,
  });
  switch (outcome.status) {
    case 'completed':
      await recorder?.recordOutcome({ finalUrl: page.url(), evidenceTexts: [outcome.evidence] });
      return { status: 'completed', summary: outcome.summary, history: [] };
    case 'awaiting_user':
      return { status: 'paused', reason: outcome.message, history: [] };
    case 'cancelled':
      return { status: 'cancelled', history: [] };
    default:
      return { status: 'failed', reason: outcome.reason, history: [] };
  }
}
