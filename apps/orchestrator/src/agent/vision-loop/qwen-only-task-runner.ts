import { createPlaywrightUnifiedExecutor } from '../browser-tools/playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from '../browser-tools/unified-browser-loop.js';
import type { RunOutcome } from './runner.js';
import {
  type StartVisionLoopTaskOptions,
  startVisionLoopTask as startCommanderLoopTask,
} from './task-runner.js';

/**
 * Browser task entry for the vision-loop lane. With a Playwright page and a
 * model-catalog adapter it runs the unified browser loop (same tools for every
 * brain); otherwise it falls back to the original commander loop.
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
  const outcome = await runUnifiedBrowserLoop({
    intent: opts.intent,
    adapter: opts.messagesAdapter,
    execute: tools.execute,
    ...(opts.webSearch ? { webSearch: opts.webSearch } : {}),
    maxSteps: opts.maxSteps ?? 40,
  });
  switch (outcome.status) {
    case 'completed':
      return { status: 'completed', summary: outcome.summary, history: [] };
    case 'awaiting_user':
      return { status: 'paused', reason: outcome.message, history: [] };
    case 'cancelled':
      return { status: 'cancelled', history: [] };
    default:
      return { status: 'failed', reason: outcome.reason, history: [] };
  }
}
