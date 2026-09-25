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

export {
  supercarReply,
  hasParkedSupercarHandle,
  supercarHandoffToGenerate,
  supercarHandleOriginalIntent,
  supercarAbort,
} from './agent-loop.js';

/** Production may use the shared executor only with an admitted Qwen adapter. */
export async function runSupercarTask(opts: RunSupercarOptions): Promise<SupercarOutcome> {
  if (opts.messagesAdapter?.metadata.provider === 'alibaba-model-studio')
    return runBrowserTask(opts);
  return {
    status: 'failed',
    reason: '浏览器能力正在迁移到千问，暂时不可用。',
    iterations: 0,
    toolsUsed: [],
  };
}
