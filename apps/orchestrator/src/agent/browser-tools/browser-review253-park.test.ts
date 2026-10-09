import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { BrowserReplayRecorder } from './browser-replay.js';
import {
  hasParkedUnifiedTask,
  runUnifiedSupercarTask,
  unifiedSupercarReply,
} from './unified-supercar-runner.js';

it('production cloud runner suspends sampling during request_human', async () => {
  const browser = await chromium.launch({ headless: true });
  const previous = env.BROWSER_REPLAY_V1;
  env.BROWSER_REPLAY_V1 = true;
  const taskId = 'test-pr253-park';
  let samplesDuringPark = 0;
  const capture = vi
    .spyOn(BrowserReplayRecorder.prototype, 'capture')
    .mockImplementation(async (_page, _id, phase) => {
      if (phase === 'sample' && hasParkedUnifiedTask(taskId)) samplesDuringPark++;
    });
  let replyTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const page = await browser.newPage();
    await page.setContent('<h1>Public</h1>');
    let turn = 0;
    const adapter = {
      create: async () => ({
        content: [
          {
            type: 'tool_use',
            id: String(++turn),
            name: turn === 1 ? 'request_human' : 'finish',
            input:
              turn === 1
                ? { reason: 'login', message: '请接管' }
                : { status: 'failed', summary: 'fixture finished' },
          },
        ],
      }),
    } as unknown as MessagesAdapter;
    await runUnifiedSupercarTask({
      taskId,
      userExternalId: 'synthetic-owner',
      intent: 'fixture',
      executor: { getPage: async () => page } as never,
      messagesAdapter: adapter,
      maxIterations: 2,
      onAwaitingUser: () => {
        replyTimer = setTimeout(() => unifiedSupercarReply(taskId, 'ready'), 2300);
      },
    });
    expect(samplesDuringPark).toBe(0);
  } finally {
    if (replyTimer) clearTimeout(replyTimer);
    capture.mockRestore();
    env.BROWSER_REPLAY_V1 = previous;
    await browser.close();
  }
});
