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
async function scenario(
  timeout = 3000,
  script?: Call[],
  extra: Partial<RunSupercarOptions> = {},
  /** Runs inside each model call (turn = 1-based), with the request the model sees. */
  onModelCall?: (turn: number, control: BrowserControl, request: unknown) => Promise<void>,
) {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('https://www.google.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<h1>Verify you are human</h1><div class="g-recaptcha"></div><input aria-label="Private input"><button onclick="history.replaceState({},'', '/search?q=fixture');document.body.innerHTML='<h1>Public result</h1><p>Verified fixture content</p>'">Complete fixture</button>`,
    }),
  );
  const requested: string[] = [];
  await page.route('https://alt.example/**', (route) => {
    requested.push(route.request().url());
    return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<h1>Alternate source</h1><p>Alternate public fact</p>',
    });
  });
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
    ...extra,
    messagesAdapter: {
      metadata: { provider: 'anthropic', model: 'fixture' },
      async create(request: unknown) {
        await onModelCall?.(calls.length + 1, control, request);
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
  return { page, control, calls, events, waiting, run, requested };
}
it('retains one runner and keeps AI waiting while the user clears the wall, even beyond the execution budget', async () => {
  // The wait outlasts the 2 s execution budget, the 2.2 s pause and the 2 s the assistant gives the
  // person to be still after their click (REBUILD-4).
  const f = await scenario(6000);
  try {
    await Promise.race([
      f.waiting,
      new Promise((_, reject) => setTimeout(() => reject(Error('No handoff')), 3000)),
    ]);
    await expect
      .poll(() => captchaHandoffs.active('captcha-fixture', 'fixture-user', f.control), {
        timeout: 1000,
      })
      .toBe(true);
    // REBUILD-4: no takeover — the control stays open; the assistant itself waits at the wall.
    expect(f.control.snapshot()).toEqual({ phase: 'agent', lease: null, error: null });
    const count = f.calls.length;
    const captures = replay.captures;
    expect(replay.paused).toBe(true);
    await new Promise((r) => setTimeout(r, 2200));
    expect(f.calls).toHaveLength(count);
    expect(replay.captures).toBe(captures);
    await f.control.runHuman(async () => {
      await f.page.getByRole('button', { name: 'Complete fixture' }).click();
    }, 'mouseDown');
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
it('FIX-38 #5: the captcha frame at handover is kept as evidence, once per page', async () => {
  const shots: Array<{ jpeg: Buffer; url: string; rule: string }> = [];
  const f = await scenario(80, undefined, {
    onCaptchaEvidence: async (shot) => {
      shots.push(shot);
    },
  });
  await f.run;
  expect(shots).toHaveLength(1);
  expect(shots[0]!.url).toBe('https://www.google.com/sorry/index');
  expect(shots[0]!.rule).toMatch(/^captcha:/);
  // A real JPEG of the page as the user was asked to solve it.
  expect(shots[0]!.jpeg.subarray(0, 2).toString('hex')).toBe('ffd8');
  expect(shots[0]!.jpeg.byteLength).toBeGreaterThan(1000);
}, 10000);

it('FIX-38 复审 #1: CAPTCHA_HANDOFF_EVIDENCE_ENABLED=false keeps no screenshot', async () => {
  const shots: unknown[] = [];
  process.env.CAPTCHA_HANDOFF_EVIDENCE_ENABLED = 'false';
  try {
    const f = await scenario(80, undefined, {
      onCaptchaEvidence: async (shot) => {
        shots.push(shot);
      },
    });
    await f.run;
    expect(f.events).toEqual([
      expect.objectContaining({ awaitingKind: 'captcha', captchaHandoff: true }),
    ]);
    expect(shots).toEqual([]);
  } finally {
    delete process.env.CAPTCHA_HANDOFF_EVIDENCE_ENABLED;
  }
}, 10000);

it('FIX-38 #5: a failing evidence hook never blocks the handover', async () => {
  const f = await scenario(80, undefined, {
    onCaptchaEvidence: async () => {
      throw new Error('storage down');
    },
  });
  const outcome = await f.run;
  expect(outcome.status).toBe('failed');
  expect(f.events).toEqual([
    expect.objectContaining({ awaitingKind: 'captcha', captchaHandoff: true }),
  ]);
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
    await expect
      .poll(() => captchaHandoffs.active('captcha-fixture', 'fixture-user', f.control), {
        timeout: 1000,
      })
      .toBe(true);
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

it('FIX-52 #8: the browser closing under the wait is no cleared wall: no resume, no raw reason', async () => {
  const ended: boolean[] = [];
  const s = await scenario(3000, undefined, {
    onCaptchaHandoffEnd: async (resumed: boolean) => {
      ended.push(resumed);
      return true;
    },
  });
  await s.waiting;
  await s.page.close();
  const out = await s.run;
  expect(ended).toEqual([false]);
  expect(out.status).toBe('failed');
  expect(JSON.stringify(out)).not.toContain('stale_context');
  expect((out as { reason?: string }).reason).toContain('云端浏览器已关闭');
  expect(s.calls.filter((name: string) => name === 'read_page')).toHaveLength(0);
});

it('FIX-52 #8: the browser is kept from idle reclaim for as long as the wait lasts', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const kept = vi.fn();
    const s = await scenario(3000, undefined, { onBrowserKeepAlive: kept });
    await s.waiting;
    vi.advanceTimersByTime(90_000);
    expect(kept.mock.calls.length).toBeGreaterThanOrEqual(3);
    captchaHandoffs.cancel('captcha-fixture', 'fixture-user', s.control);
    kept.mockClear();
    await s.run;
    vi.advanceTimersByTime(90_000);
    expect(kept).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('REBUILD-4: an input from the person within 2 s voids the planned action; the model gets a fresh observation', async () => {
  const requests: unknown[] = [];
  const f = await scenario(
    3000,
    [
      { name: 'navigate', input: { url: 'https://alt.example/fact' } },
      { name: 'navigate', input: { url: 'https://alt.example/stale-plan' } },
      { name: 'read_page', input: {} },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: 'Alternate public fact',
          evidence: 'Alternate public fact',
        },
      },
    ],
    { timeoutMs: 15_000 },
    async (turn, control, request) => {
      requests.push(request);
      // While the model plans its second step, the person clicks on the shared page.
      if (turn === 2) await control.runHuman(async () => {}, 'mouseDown');
    },
  );
  try {
    const outcome = await f.run;
    expect(outcome.status).toBe('completed');
    // The navigation planned before the person's click never ran.
    expect(f.requested).toEqual(['https://alt.example/fact']);
    const third = JSON.stringify(requests[2]);
    expect(third).toContain('用户刚在画面上操作过');
    expect(third).toContain('fresh_observation');
    expect(third).toContain('Alternate public fact');
    expect(f.control.snapshot()).toMatchObject({ lease: null });
  } finally {
    f.control.close();
    await f.run;
  }
}, 20000);
