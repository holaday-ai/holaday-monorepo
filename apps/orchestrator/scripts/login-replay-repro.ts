/** Local read-only release simulation: no auth, model, production or real API calls. */
import assert from 'node:assert/strict';
import { pino } from 'pino';
import { chromium } from 'playwright';
import { browserReplayStore } from '../src/agent/browser-tools/browser-replay-service.js';
import {
  runUnifiedSupercarTask,
  unifiedSupercarAbort,
} from '../src/agent/browser-tools/unified-supercar-runner.js';
import type { Context } from '../src/trpc/context.js';
import { browserReplayRouter } from '../src/trpc/routers/browser-replay.js';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.route('https://replay.test/**', (r) =>
  r.fulfill({
    contentType: 'text/html',
    body: '<title>Public page</title><main><h1>Public browser result</h1><p>Ready to read</p></main>',
  }),
);
const owner = 'replay-owner';
const taskId = 'replay-task';
let turn = 0;
const chain = {
  from: () => chain,
  innerJoin: () => chain,
  where: () => chain,
  limit: async () => [{ id: 1 }],
};
const caller = browserReplayRouter.createCaller({
  userId: owner,
  db: { select: () => chain },
  logger: pino({ level: 'silent' }),
} as unknown as Context);
try {
  const result = await runUnifiedSupercarTask({
    taskId,
    userExternalId: owner,
    intent: 'Open a public page',
    executor: { getPage: async () => page } as never,
    browserCapabilities: { viewportV2: true, observationV2: true, replayV1: true, routingV2: true },
    messagesAdapter: {
      metadata: { provider: 'anthropic', model: 'scripted' },
      async create() {
        turn++;
        return {
          id: String(turn),
          metadata: this.metadata,
          content: [
            {
              type: 'tool_use',
              id: String(turn),
              name: turn === 1 ? 'navigate' : 'finish',
              input:
                turn === 1
                  ? { url: 'https://replay.test/' }
                  : { status: 'failed', summary: 'Local reproduction finished' },
            },
          ],
          stopReason: 'tool_use',
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        };
      },
    },
  });
  assert.equal(result.status, 'failed');
  const replay = await caller.read({ taskId });
  assert(replay && replay.total >= 2, 'actual runner produced no readable replay frames');
  assert(
    replay.frames.some((f) => f.image),
    'public page replay has no image',
  );
  assert(replay.frames.some((f) => f.phase === 'after' && f.sourceURL === 'https://replay.test/'));
  // FIX-REPLAY-GAPS: the task's end records a final frame of the page.
  const last = replay.frames.at(-1);
  assert(last?.phase === 'final' && last.image, 'replay does not end on a final page frame');
  assert.equal(await browserReplayStore.read('different-owner', taskId), null);
  console.log(
    JSON.stringify({
      pass: true,
      total: replay.total,
      images: replay.frames.filter((f) => f.image).length,
      phases: replay.frames.map((f) => f.phase),
    }),
  );
} finally {
  unifiedSupercarAbort(taskId);
  await browserReplayStore.remove(owner, taskId).catch(() => {});
  await browser.close();
}
