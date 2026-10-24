import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { runUnifiedSupercarTask, unifiedSupercarReply } from './unified-supercar-runner.js';

/**
 * FIX-30 review blocker 2 — a single-page read gets 300 s, but the time the
 * user spends at a login wall (request_human) is not the run's time. Scaled
 * down: a 1.5 s budget, the user replies after 3.5 s, the run continues and
 * finishes; without the wait it would have timed out.
 */
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

function run(taskId: string, replyAfterMs: number | null) {
  return async () => {
    const page = await browser.newPage();
    await page.route('https://fixture.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>会员登录</h1><p>登录后查看</p>' }),
    );
    await page.goto('https://fixture.test/article');
    let parkedAt = 0;
    let turn = 0;
    let replyTimer: ReturnType<typeof setTimeout> | undefined;
    const adapter = {
      create: async () => {
        turn++;
        const parks = turn === 1 && replyAfterMs !== null;
        // Without a wait, a slow model spends the budget across a few turns.
        if (replyAfterMs === null) await new Promise((r) => setTimeout(r, 700));
        const done = replyAfterMs !== null ? turn > 1 : turn > 5;
        return {
          content: [
            {
              type: 'tool_use',
              id: String(turn),
              name: parks ? 'request_human' : done ? 'finish' : 'snapshot',
              input: parks
                ? { reason: 'login', message: '页面要求登录，请接管' }
                : done
                  ? { status: 'failed', summary: 'fixture finished after the user replied' }
                  : {},
            },
          ],
        };
      },
    } as unknown as MessagesAdapter;
    try {
      const started = Date.now();
      const outcome = await runUnifiedSupercarTask({
        taskId,
        userExternalId: 'synthetic-owner',
        intent: '请使用云端浏览器，打开 https://fixture.test/article 读标题',
        executor: { getPage: async () => page } as never,
        messagesAdapter: adapter,
        maxIterations: 8,
        timeoutMs: 1_500,
        onAwaitingUser: () => {
          parkedAt = Date.now();
          if (replyAfterMs !== null)
            replyTimer = setTimeout(() => unifiedSupercarReply(taskId, '已登录'), replyAfterMs);
        },
      });
      return { outcome, parked: parkedAt > 0, elapsedMs: Date.now() - started };
    } finally {
      if (replyTimer) clearTimeout(replyTimer);
      await page.close();
    }
  };
}

it('a user who takes longer than the budget at a login wall does not time the run out', async () => {
  const { outcome, parked, elapsedMs } = await run('test-fix30-park-timer', 3_500)();
  expect(parked).toBe(true);
  expect(elapsedMs).toBeGreaterThan(3_500);
  expect(outcome.status).not.toBe('timeout');
  expect('reason' in outcome ? outcome.reason : '').toBe('fixture finished after the user replied');
}, 30_000);

it('the budget still applies to the run itself', async () => {
  const { outcome } = await run('test-fix30-run-timer', null)();
  expect(outcome.status).toBe('timeout');
}, 30_000);
