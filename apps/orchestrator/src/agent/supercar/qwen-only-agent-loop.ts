import type { ValidatedBrowserTaskFile } from '../browser-tools/browser-task-files.js';
import type { RunSupercarOptions, SupercarOutcome } from './agent-loop.js';
import { runSupercarTask as runBrowserTask } from './agent-loop.js';
export { validateExternalBrowserReply } from './agent-loop.js';

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
  isExplicitFileOnlyRequest,
  taskFileInputSupported,
} from '../browser-tools/task-file-contract.js';
import {
  hasParkedUnifiedTask,
  runUnifiedSupercarTask,
  unifiedParkedIntent,
  unifiedSupercarAbort,
  unifiedSupercarHandoffToGenerate,
  unifiedSupercarReply,
} from '../browser-tools/unified-supercar-runner.js';
import {
  hasParkedSupercarHandle as hasParkedLegacyHandle,
  supercarAbort as legacyAbort,
  supercarHandoffToGenerate as legacyHandoff,
  supercarHandleOriginalIntent as legacyOriginalIntent,
  supercarReply as legacyReply,
} from './agent-loop.js';

export function supercarHandoffToGenerate(
  taskId: string,
  message: string,
  attachments?: Readonly<NonNullable<RunSupercarOptions['attachments']>>,
  files?: readonly ValidatedBrowserTaskFile[],
): boolean {
  return (
    unifiedSupercarHandoffToGenerate(taskId, message, attachments, files) ||
    legacyHandoff(taskId, message, attachments, files)
  );
}

/** BROWSER_EXECUTOR: 'unified' (default, batch-04 tools) | 'legacy' (coordinate protocol, rollback). */
export function browserExecutorMode(): 'legacy' | 'unified' {
  return env.BROWSER_EXECUTOR === 'unified' ? 'unified' : 'legacy';
}

export function supercarReply(
  taskId: string,
  message: string,
  attachmentBlocks?: Readonly<NonNullable<RunSupercarOptions['attachments']>>,
  files?: readonly ValidatedBrowserTaskFile[],
): boolean {
  return (
    unifiedSupercarReply(taskId, message, attachmentBlocks, files) ||
    legacyReply(taskId, message, attachmentBlocks, files)
  );
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
  if (
    (browserExecutorMode() === 'unified' || opts.messagesAdapter.browserBrain) &&
    (opts.executor ||
      (env.BROWSER_TASK_FILES_V1 &&
        opts.browserTaskFiles &&
        isExplicitFileOnlyRequest(opts.userRequest ?? opts.intent) &&
        opts.browserTaskFiles.references().every(taskFileInputSupported)))
  )
    return runUnifiedSupercarTask(opts);
  if (opts.messagesAdapter.browserBrain)
    return {
      status: 'failed',
      reason: '角色模型需要统一浏览器执行器。',
      iterations: 0,
      toolsUsed: [],
    };
  return runBrowserTask(opts);
}
