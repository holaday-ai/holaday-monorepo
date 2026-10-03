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

/** Production uses the shared executor with the adapter the model catalog resolved. */
export async function runSupercarTask(opts: RunSupercarOptions): Promise<SupercarOutcome> {
  // Any catalog brain resolved through the model runtime (千问 / Claude / GPT)
  // runs the shared executor; only an absent adapter is refused.
  if (opts.messagesAdapter) return runBrowserTask(opts);
  return {
    status: 'failed',
    reason: '浏览器能力正在迁移到千问，暂时不可用。',
    iterations: 0,
    toolsUsed: [],
  };
}
