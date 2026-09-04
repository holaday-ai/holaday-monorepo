import type { RunOutcome } from './runner.js';
import type { StartVisionLoopTaskOptions } from './task-runner.js';

/** Production-safe boundary for the not-yet-migrated visual browser lane. */
export async function startVisionLoopTask(_opts: StartVisionLoopTaskOptions): Promise<RunOutcome> {
  return {
    status: 'failed',
    reason: '浏览器能力正在迁移到千问，暂时不可用。',
    history: [],
  };
}
