import type { RunSupercarOptions, SupercarOutcome } from './agent-loop.js';

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

export function supercarReply(
  _taskId: string,
  _message: string,
  _attachmentBlocks?: ReadonlyArray<{ type: string }>,
): boolean {
  return false;
}

export function hasParkedSupercarHandle(_taskId: string): boolean {
  return false;
}

export function supercarHandoffToGenerate(_taskId: string, _message: string): boolean {
  return false;
}

export function supercarHandleOriginalIntent(_taskId: string): string | null {
  return null;
}

export function supercarAbort(_taskId: string): boolean {
  return false;
}

/** Production never imports or constructs the dormant Anthropic browser loop. */
export async function runSupercarTask(_opts: RunSupercarOptions): Promise<SupercarOutcome> {
  return {
    status: 'failed',
    reason: '浏览器能力正在迁移到千问，暂时不可用。',
    iterations: 0,
    toolsUsed: [],
  };
}
