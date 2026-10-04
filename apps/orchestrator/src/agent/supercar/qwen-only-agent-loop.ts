import type { RunSupercarOptions, SupercarOutcome } from './agent-loop.js';
import { runSupercarTask as runBrowserTask } from './agent-loop.js';

export type {
  RunSupercarOptions,
  SupercarActionCaptureEvent,
  SupercarAwaitingUserEvent,
  SupercarOutcome,
  SupercarScreencastEvent,
  SupercarStatus,
  SupercarTickEvent,
  SupercarWebSearchEvent,
} from './agent-loop.js';

import { env } from '../../config/env.js';
import {
  hasParkedUnifiedTask,
  runUnifiedSupercarTask,
  unifiedParkedIntent,
  unifiedSupercarAbort,
  unifiedSupercarReply,
} from '../browser-tools/unified-supercar-runner.js';
import {
  hasParkedSupercarHandle as hasParkedLegacyHandle,
  supercarAbort as legacyAbort,
  supercarHandleOriginalIntent as legacyOriginalIntent,
  supercarReply as legacyReply,
} from './agent-loop.js';

export { supercarHandoffToGenerate } from './agent-loop.js';

/** BROWSER_EXECUTOR: 'legacy' (default, coordinate protocol) | 'unified' (batch-04 tools). */
export function browserExecutorMode(): 'legacy' | 'unified' {
  return env.BROWSER_EXECUTOR === 'unified' ? 'unified' : 'legacy';
}

export function supercarReply(
  taskId: string,
  message: string,
  attachmentBlocks?: Parameters<typeof legacyReply>[2],
): boolean {
  return unifiedSupercarReply(taskId, message) || legacyReply(taskId, message, attachmentBlocks);
}

export function hasParkedSupercarHandle(taskId: string): boolean {
  return hasParkedUnifiedTask(taskId) || hasParkedLegacyHandle(taskId);
}

export function supercarHandleOriginalIntent(taskId: string): string | null {
  return unifiedParkedIntent(taskId) ?? legacyOriginalIntent(taskId);
}

export function supercarAbort(taskId: string): boolean {
  return unifiedSupercarAbort(taskId) || legacyAbort(taskId);
}

/**
 * Production may use the shared executor only with an admitted adapter. The
 * unified tool loop runs when BROWSER_EXECUTOR=unified and a Playwright
 * executor is available; otherwise the legacy coordinate loop runs.
 */
export async function runSupercarTask(opts: RunSupercarOptions): Promise<SupercarOutcome> {
  if (!opts.messagesAdapter)
    return {
      status: 'failed',
      reason: '浏览器能力正在迁移到千问，暂时不可用。',
      iterations: 0,
      toolsUsed: [],
    };
  if (browserExecutorMode() === 'unified' && opts.executor) return runUnifiedSupercarTask(opts);
  return runBrowserTask(opts);
}
