import { type Browser, chromium } from 'playwright';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { platformFailureReason } from '../../quota/platform-failure-refunds.js';
import type { RunSupercarOptions } from '../supercar/agent-loop.js';
import { BrowserControl } from '../supercar/browser-control.js';
import { captchaHandoffs } from '../supercar/captcha-handoff.js';
import { runUnifiedSupercarTask } from './unified-supercar-runner.js';
const replay = vi.hoisted(() => ({ paused: false, captures: 0, pauses: 0, resumes: 0 }));
vi.mock('./browser-replay-service.js', () => ({ browserReplayStore: {} }));
vi.mock('./browser-replay.js', () => ({
  BrowserReplayRecorder: class {
    get isPaused() {
      return replay.paused;
    }
    authorize() {}
    async capture() {
      if (!replay.paused) replay.captures++;
    }
    async pause() {
      replay.paused = true;
      replay.pauses++;
    }
    resume() {
      replay.paused = false;
      replay.resumes++;
    }
    async dispose() {}
  },
}));
beforeEach(() => {
  Object.assign(replay, { paused: false, captures: 0, pauses: 0, resumes: 0 });
});
let browser: Browser | undefined;
afterEach(async () => {
  await browser?.close();
});
type Call = { name: string; input: Record<string, unknown> };
async function scenario(timeout = 3000, script?: Call[]) {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('https://www.google.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<h1>Verify you are human</h1><div class="g-recaptcha"></div><input aria-label="Private input"><button onclick="history.replaceState({},'', '/search?q=fixture');document.body.innerHTML='<h1>Public result</h1><p>Verified fixture content</p>'">Complete fixture</button>`,
    }),
  );
  await page.route('https://alt.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<h1>Alternate source</h1><p>Alternate public fact</p>',
    }),
  );
  const control = new BrowserControl();
  const calls: string[] = [];
  const events: unknown[] = [];
  let wait!: () => void;
  const waiting = new Promise<void>((r) => {
    wait = r;
  });
  const run = runUnifiedSupercarTask({
    taskId: 'captcha-fixture',
    userExternalId: 'fixture-user',
    intent: '打开网页读取内容',
    executor: { getPage: async () => page } as never,
    browserControl: control,
    browserCapabilities: {
      viewportV2: true,
      observationV2: true,
      replayV1: true,
      routingV2: false,
    },
    timeoutMs: 2000,
    captchaWaitMs: timeout,
    captchaPollMs: 15,
    onAwaitingUser: async (e) => {
      events.push(e);
      wait();
    },
    onCaptchaHandoffEnd: async () => true,
    messagesAdapter: {
      metadata: { provider: 'anthropic', model: 'fixture' },
      async create() {
        const scripted = script?.[Math.min(calls.length, script.length - 1)];
        const name =
          scripted?.name ??
          (calls.length === 0 ? 'navigate' : calls.length === 1 ? 'read_page' : 'finish');
        calls.push(name);
        return {
          id: String(calls.length),
          metadata: this.metadata,
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: String(calls.length),
              name,
              input: scripted
                ? scripted.input
                : name === 'navigate'
                  ? { url: 'https://www.google.com/sorry/index' }
                  : name === 'finish'
                    ? {
                        status: 'completed',
                        summary: 'Verified fixture content',
                        evidence: 'Verified fixture content',
                      }
                    : {},
            },
          ],
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
  } as RunSupercarOptions);
  return { page, control, calls, events, waiting, run };
}
it('retains one runner and excludes AI while user clears the wall, even beyond the execution budget', async () => {
  const f = await scenario();
  try {
    await Promise.race([
      f.waiting,
      new Promise((_, reject) => setTimeout(() => reject(Error('No handoff')), 3000)),
    ]);
    await expect.poll(() => f.control.snapshot().phase, { timeout: 1000 }).toBe('human');
    const count = f.calls.length;
    const captures = replay.captures;
    expect(replay.paused).toBe(true);
    await new Promise((r) => setTimeout(r, 2200));
    expect(f.calls).toHaveLength(count);
    expect(replay.captures).toBe(captures);
    await f.control.runHuman(f.control.snapshot().lease!, async () => {
      await f.page.getByRole('button', { name: 'Complete fixture' }).click();
    });
    const outcome = await f.run;
    expect(outcome.status).toBe('completed');
    expect(replay.resumes).toBe(1);
    expect(f.calls).toEqual(['navigate', 'read_page', 'finish']);
    expect(f.events).toEqual([
      expect.objectContaining({ awaitingKind: 'captcha', captchaHandoff: true }),
    ]);
  } finally {
    f.control.close();
    await f.run;
  }
}, 10000);
it('timeout exits truthfully and releases control instead of running more model calls', async () => {
  const f = await scenario(80);
  const outcome = await f.run;
  expect(outcome.status).toBe('failed');
  expect(outcome.status === 'failed' && outcome.reason).toContain('超时');
  expect(f.calls).toEqual(['navigate']);
  expect(f.control.snapshot().phase).toBe('closed');
  expect(replay.paused).toBe(true);
  expect(replay.resumes).toBe(0);
  expect(captchaHandoffs.active('captcha-fixture', 'fixture-user')).toBe(false);
}, 10000);

it('FIX-35 复审 #1: a handover the user left is the user’s wall — not refunded after a reroute', async () => {
  const f = await scenario(80);
  const outcome = await f.run;
  expect(outcome).toMatchObject({ status: 'failed', failureSource: 'user_wall' });
  // As persisted (tasks.ts: failureDetail.source = outcome.failureSource), handed over from generate.
  const persisted = {
    status: 'failed',
    errorCode: 'VISION_GAVE_UP',
    errorMessage: '',
    sourceContext: { reroutedFrom: 'generate' },
    result: {
      metadata: {
        failureDetail: { source: (outcome as { failureSource?: string }).failureSource },
      },
    },
  };
  expect(platformFailureReason(persisted)).toBeNull();
}, 10000);
it('an answer after 换个方式继续 says it does not come from the walled page', async () => {
  const f = await scenario(3000, [
    { name: 'navigate', input: { url: 'https://www.google.com/sorry/index' } },
    { name: 'navigate', input: { url: 'https://alt.example/fact' } },
    { name: 'read_page', input: {} },
    {
      name: 'finish',
      input: {
        status: 'completed',
        summary: 'Alternate public fact',
        evidence: 'Alternate public fact',
      },
    },
  ]);
  try {
    await f.waiting;
    await expect.poll(() => f.control.snapshot().phase, { timeout: 1000 }).toBe('human');
    for (let round = 0; round < 2; round++)
      expect(await captchaHandoffs.proceed('captcha-fixture', 'fixture-user', f.control)).toBe(
        false,
      );
    expect(captchaHandoffs.alternate('captcha-fixture', 'fixture-user', f.control)).toBe(true);
    const outcome = await f.run;
    expect(outcome.status).toBe('completed');
    expect(outcome.status === 'completed' && outcome.summary).toMatch(
      /^页面验证码未通过，已按你的选择改用其他方式继续/,
    );
  } finally {
    f.control.close();
    await f.run;
  }
}, 10000);
