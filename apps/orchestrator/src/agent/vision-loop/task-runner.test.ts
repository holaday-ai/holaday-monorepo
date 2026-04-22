import { beforeAll, describe, expect, it } from 'vitest';
import type { VisionLoopCommander } from './commander.js';
import type { PlaywrightExecutor } from './playwright-executor.js';
import { startVisionLoopTask } from './task-runner.js';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

/**
 * Unit tests for the task-runner's executor-selection branching.
 * We don't stand up a real Anthropic client or a real browser — the
 * commander returns a scripted action, the Playwright executor is a
 * fake that records calls.
 */

function scriptedCommander(action: {
  kind: 'click' | 'done' | 'give_up';
  [k: string]: unknown;
}): VisionLoopCommander {
  let idx = 0;
  return {
    async decideNextAction(ctx) {
      idx += 1;
      const final: VisionLoopCommander extends { decideNextAction: infer F }
        ? F extends (c: typeof ctx) => Promise<infer R>
          ? R
          : never
        : never = {
        action: idx === 1 ? (action as never) : { kind: 'done', summary: 'done' },
        image: {
          base64: 'AA==',
          originalWidth: ctx.observation.viewportWidth || 1,
          originalHeight: ctx.observation.viewportHeight || 1,
          resizedWidth: ctx.observation.viewportWidth || 1,
          resizedHeight: ctx.observation.viewportHeight || 1,
          scaleX: 1,
          scaleY: 1,
        },
        toolUseId: `tu_${idx}`,
        elapsedMs: 5,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };
      return final;
    },
  };
}

function fakeExecutor(opts: { failScreenshot?: boolean } = {}): {
  executor: PlaywrightExecutor;
  calls: string[];
} {
  const calls: string[] = [];
  const fakePage = {
    url: () => 'https://example.com/',
    title: async () => 'Example',
  };
  const fake = {
    getPage: async () => {
      calls.push('getPage');
      return fakePage;
    },
    screenshot: async () => {
      calls.push('screenshot');
      if (opts.failScreenshot) return { error: 'playwright-side fail' };
      return {
        base64: Buffer.from('pw').toString('base64'),
        viewportWidth: 1280,
        viewportHeight: 800,
      };
    },
    click: async () => {
      calls.push('click');
      return { ok: true, message: 'clicked' };
    },
    type: async () => ({ ok: true }),
    pressKey: async () => ({ ok: true }),
    scroll: async () => ({ ok: true }),
    wait: async () => ({ ok: true }),
  } as unknown as PlaywrightExecutor;
  return { executor: fake, calls };
}

describe('startVisionLoopTask — playwrightExecutor branch', () => {
  it('uses PlaywrightExecutor for observation + action when provided', async () => {
    const { executor, calls } = fakeExecutor();
    const commander = scriptedCommander({ kind: 'click', x: 100, y: 200 });

    const outcome = await startVisionLoopTask({
      taskId: 'tsk_pw_test',
      userId: 'usr_test',
      intent: 'click the button',
      commander,
      playwrightExecutor: executor,
      maxSteps: 3,
    });

    expect(outcome.status).toBe('completed');
    // First tick: getPage + screenshot (observation), then click, then
    // tick 2 observation again, then 'done' (terminal, no executor call).
    expect(calls).toContain('getPage');
    expect(calls).toContain('screenshot');
    expect(calls).toContain('click');
  });

  it('fails the loop when Playwright screenshot fails (no silent legacy fallback mid-task)', async () => {
    const { executor } = fakeExecutor({ failScreenshot: true });
    const commander = scriptedCommander({ kind: 'click', x: 1, y: 2 });

    const outcome = await startVisionLoopTask({
      taskId: 'tsk_pw_fail',
      userId: 'usr_test',
      intent: 'do stuff',
      commander,
      playwrightExecutor: executor,
      maxSteps: 2,
    });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.reason).toMatch(/playwright screenshot failed/);
    }
  });
});

describe('startVisionLoopTask — Layer 4 captcha wait', () => {
  it('calls onCaptchaDetected then onCaptchaResolved(auto) when the snapshot clears', async () => {
    // Sequence of accessibility snapshots returned by the executor.
    // The loop runs in screenshot mode here (commander returns
    // click), but the afterTickHook polls via accessibilitySnapshot
    // regardless of mode.
    let snapshotCall = 0;
    const snapshots = [
      '- heading "Checking your browser" [ref=e1]', // first poll: still captcha
      '- heading "Welcome back"', // second poll: cleared
    ];

    const fakePage = { url: () => 'https://x.test/', title: async () => '' };
    const executor = {
      getPage: async () => fakePage,
      screenshot: async () => ({
        base64: 'AAA=',
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
      // The click fails with a captcha-signalling error, which the
      // detector should classify as high-confidence 'captcha'.
      click: async () => ({ ok: false, message: 'locator click: recaptcha challenge' }),
      type: async () => ({ ok: true }),
      pressKey: async () => ({ ok: true }),
      scroll: async () => ({ ok: true }),
      wait: async () => ({ ok: true }),
      accessibilitySnapshot: async () => {
        const idx = Math.min(snapshotCall, snapshots.length - 1);
        snapshotCall += 1;
        return {
          text: snapshots[idx]!,
          refs: [],
          url: 'https://x.test/',
          title: '',
        };
      },
      resetPageForTask: async () => {},
    } as unknown as PlaywrightExecutor;

    const commander = scriptedCommander({ kind: 'click', x: 1, y: 1 });

    // Shorten the poll cadence + wait timeout so the test completes
    // quickly.
    const prevTimeout = process.env.CAPTCHA_WAIT_TIMEOUT_MS;
    const prevPoll = process.env.CAPTCHA_POLL_INTERVAL_MS;
    process.env.CAPTCHA_WAIT_TIMEOUT_MS = '500';
    process.env.CAPTCHA_POLL_INTERVAL_MS = '50';

    const detections: unknown[] = [];
    const resolutions: unknown[] = [];
    const outcome = await startVisionLoopTask({
      taskId: 'tsk_captcha_auto',
      userId: 'usr_test',
      intent: 'thing',
      commander,
      playwrightExecutor: executor,
      maxSteps: 3,
      onCaptchaDetected: (info) => {
        detections.push(info);
      },
      onCaptchaResolved: (info) => {
        resolutions.push(info);
      },
    });

    if (prevTimeout === undefined) delete process.env.CAPTCHA_WAIT_TIMEOUT_MS;
    else process.env.CAPTCHA_WAIT_TIMEOUT_MS = prevTimeout;
    if (prevPoll === undefined) delete process.env.CAPTCHA_POLL_INTERVAL_MS;
    else process.env.CAPTCHA_POLL_INTERVAL_MS = prevPoll;

    expect(detections.length).toBeGreaterThanOrEqual(1);
    expect(resolutions.length).toBeGreaterThanOrEqual(1);
    // The first resolution fired should be 'auto' — the snapshot
    // went clean on the second poll.
    expect((resolutions[0] as { reason: string }).reason).toBe('auto');
    // Commander ran at least twice (tick 0 + tick 1 after wait
    // resolved), so the outcome is 'completed' via the scripted
    // done-action on tick 2.
    expect(outcome.status).toBe('completed');
  }, 10_000);

  it('resolves with reason=timeout when the captcha snapshot never clears in window', async () => {
    // Snapshot stays captcha-ish forever — we expect the wait loop to
    // time out rather than auto-resolve, and onCaptchaResolved must
    // fire with reason='timeout'.
    const fakePage = { url: () => 'https://x.test/', title: async () => '' };
    const executor = {
      getPage: async () => fakePage,
      screenshot: async () => ({
        base64: 'AAA=',
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
      click: async () => ({ ok: false, message: 'locator click: recaptcha challenge' }),
      type: async () => ({ ok: true }),
      pressKey: async () => ({ ok: true }),
      scroll: async () => ({ ok: true }),
      wait: async () => ({ ok: true }),
      accessibilitySnapshot: async () => ({
        text: '- heading "Checking your browser"',
        refs: [],
        url: 'https://x.test/',
        title: '',
      }),
      resetPageForTask: async () => {},
    } as unknown as PlaywrightExecutor;

    const prev = {
      timeout: process.env.CAPTCHA_WAIT_TIMEOUT_MS,
      poll: process.env.CAPTCHA_POLL_INTERVAL_MS,
    };
    process.env.CAPTCHA_WAIT_TIMEOUT_MS = '80';
    process.env.CAPTCHA_POLL_INTERVAL_MS = '15';

    const resolutions: { reason: string }[] = [];
    const commander = scriptedCommander({ kind: 'click', x: 1, y: 1 });
    await startVisionLoopTask({
      taskId: 'tsk_captcha_timeout',
      userId: 'usr_test',
      intent: 'thing',
      commander,
      playwrightExecutor: executor,
      maxSteps: 2,
      onCaptchaDetected: () => {},
      onCaptchaResolved: (info) => {
        resolutions.push(info);
      },
    });

    if (prev.timeout === undefined) delete process.env.CAPTCHA_WAIT_TIMEOUT_MS;
    else process.env.CAPTCHA_WAIT_TIMEOUT_MS = prev.timeout;
    if (prev.poll === undefined) delete process.env.CAPTCHA_POLL_INTERVAL_MS;
    else process.env.CAPTCHA_POLL_INTERVAL_MS = prev.poll;

    expect(resolutions.length).toBeGreaterThanOrEqual(1);
    expect(resolutions[0]?.reason).toBe('timeout');
  }, 10_000);
});

describe('startVisionLoopTask — wait_for_human action triggers Layer 4', () => {
  // Regression: commander in Bug 2 directly emits wait_for_human when
  // it spots a captcha wall. The runner must synthesise an anti-bot
  // signal from that action (even though no driver error / snapshot
  // match exists) so the existing Layer 4 wait loop runs.
  it('synthesises a captcha signal and fires onCaptchaDetected when the commander calls wait_for_human', async () => {
    const fakePage = { url: () => 'https://x.test/', title: async () => '' };
    const executor = {
      getPage: async () => fakePage,
      screenshot: async () => ({
        base64: 'AAA=',
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
      click: async () => ({ ok: true }),
      type: async () => ({ ok: true }),
      pressKey: async () => ({ ok: true }),
      scroll: async () => ({ ok: true }),
      wait: async () => ({ ok: true }),
      accessibilitySnapshot: async () => ({
        // Snapshot already clean → auto-resolves immediately.
        text: '- heading "Welcome"',
        refs: [],
        url: 'https://x.test/',
        title: '',
      }),
      resetPageForTask: async () => {},
    } as unknown as PlaywrightExecutor;

    // Script a single wait_for_human emission; follow-up tick calls done.
    let tickCount = 0;
    const commander: VisionLoopCommander = {
      async decideNextAction(ctx) {
        tickCount += 1;
        const vp = ctx.observation;
        return {
          action:
            tickCount === 1
              ? { kind: 'wait_for_human', reason: 'Cloudflare 验证' }
              : { kind: 'done', summary: 'ok' },
          image: {
            base64: 'AA==',
            originalWidth: vp.viewportWidth || 1,
            originalHeight: vp.viewportHeight || 1,
            resizedWidth: vp.viewportWidth || 1,
            resizedHeight: vp.viewportHeight || 1,
            scaleX: 1,
            scaleY: 1,
          },
          toolUseId: `tu_${tickCount}`,
          elapsedMs: 5,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        };
      },
    };

    const prev = {
      timeout: process.env.CAPTCHA_WAIT_TIMEOUT_MS,
      poll: process.env.CAPTCHA_POLL_INTERVAL_MS,
    };
    process.env.CAPTCHA_WAIT_TIMEOUT_MS = '300';
    process.env.CAPTCHA_POLL_INTERVAL_MS = '30';

    const detections: Array<{ message: string }> = [];
    const resolutions: Array<{ reason: string }> = [];
    await startVisionLoopTask({
      taskId: 'tsk_wfh',
      userId: 'usr_test',
      intent: 'browse a protected site',
      commander,
      playwrightExecutor: executor,
      maxSteps: 3,
      onCaptchaDetected: (info) => {
        detections.push(info);
      },
      onCaptchaResolved: (info) => {
        resolutions.push(info);
      },
    });

    if (prev.timeout === undefined) delete process.env.CAPTCHA_WAIT_TIMEOUT_MS;
    else process.env.CAPTCHA_WAIT_TIMEOUT_MS = prev.timeout;
    if (prev.poll === undefined) delete process.env.CAPTCHA_POLL_INTERVAL_MS;
    else process.env.CAPTCHA_POLL_INTERVAL_MS = prev.poll;

    expect(detections.length).toBeGreaterThanOrEqual(1);
    expect(detections[0]?.message).toMatch(/Cloudflare 验证/);
    // Snapshot was clean → auto-resolve.
    expect(resolutions[0]?.reason).toBe('auto');
  }, 10_000);
});

describe('startVisionLoopTask — DegradationChain on Layer 4 timeout', () => {
  // Regression: after the Bug 3 fix, a Layer 4 timeout walks the chain
  // one tier. The chain + onDegrade hook must fire exactly when the
  // captcha wait reaches `reason='timeout'` (not on auto-resolve).
  it('fires onDegrade when wait_for_human times out, with the first-tier strategy', async () => {
    const fakePage = { url: () => 'https://x.test/', title: async () => '' };
    const clearCookiesCalls: string[] = [];
    const executor = {
      getPage: async () => fakePage,
      screenshot: async () => ({
        base64: 'AAA=',
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
      click: async () => ({ ok: true }),
      type: async () => ({ ok: true }),
      pressKey: async () => ({ ok: true }),
      scroll: async () => ({ ok: true }),
      wait: async () => ({ ok: true }),
      accessibilitySnapshot: async () => ({
        text: '- heading "Just a moment..."',
        refs: [],
        url: 'https://x.test/',
        title: 'Just a moment',
      }),
      resetPageForTask: async () => {},
      navigate: async () => ({ ok: true }),
      browser: {
        contexts: () => [
          {
            clearCookies: async () => {
              clearCookiesCalls.push('c');
            },
            addInitScript: async () => {},
          },
        ],
      },
    } as unknown as PlaywrightExecutor;

    let tickCount = 0;
    const commander: VisionLoopCommander = {
      async decideNextAction(ctx) {
        tickCount += 1;
        const vp = ctx.observation;
        return {
          action:
            tickCount === 1
              ? { kind: 'wait_for_human', reason: 'Cloudflare' }
              : { kind: 'done', summary: 'ok' },
          image: {
            base64: 'AA==',
            originalWidth: vp.viewportWidth || 1,
            originalHeight: vp.viewportHeight || 1,
            resizedWidth: vp.viewportWidth || 1,
            resizedHeight: vp.viewportHeight || 1,
            scaleX: 1,
            scaleY: 1,
          },
          toolUseId: `tu_${tickCount}`,
          elapsedMs: 5,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        };
      },
    };

    const prev = {
      timeout: process.env.CAPTCHA_WAIT_TIMEOUT_MS,
      poll: process.env.CAPTCHA_POLL_INTERVAL_MS,
    };
    process.env.CAPTCHA_WAIT_TIMEOUT_MS = '80';
    process.env.CAPTCHA_POLL_INTERVAL_MS = '15';

    const degrades: Array<{ level: number; strategy: string }> = [];
    await startVisionLoopTask({
      taskId: 'tsk_deg',
      userId: 'usr_test',
      intent: 'browse a protected site',
      commander,
      playwrightExecutor: executor,
      maxSteps: 3,
      onCaptchaDetected: () => {},
      onCaptchaResolved: () => {},
      onDegrade: (info) => {
        degrades.push(info);
      },
    });

    if (prev.timeout === undefined) delete process.env.CAPTCHA_WAIT_TIMEOUT_MS;
    else process.env.CAPTCHA_WAIT_TIMEOUT_MS = prev.timeout;
    if (prev.poll === undefined) delete process.env.CAPTCHA_POLL_INTERVAL_MS;
    else process.env.CAPTCHA_POLL_INTERVAL_MS = prev.poll;

    // First degrade tier is profile_rotation; it should have called
    // clearCookies on our fake context.
    expect(degrades.length).toBeGreaterThanOrEqual(1);
    expect(degrades[0]?.strategy).toBe('profile_rotation');
    expect(clearCookiesCalls.length).toBeGreaterThanOrEqual(1);
  }, 15_000);
});

describe('startVisionLoopTask — Layer 5 threshold latch', () => {
  it('does not fire onExecutorFallback when strike count stays below the threshold', async () => {
    // Only one captcha-flavoured failure in the whole loop. Layer 5
    // needs 3 strikes to trip (strikeThreshold=3 in task-runner). The
    // fallback hook must NOT fire here.
    let clickCount = 0;
    const fakePage = { url: () => 'https://x.test/', title: async () => '' };
    const executor = {
      getPage: async () => fakePage,
      screenshot: async () => ({
        base64: 'AAA=',
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
      click: async () => {
        clickCount += 1;
        // Only tick 0 sees a captcha; tick 1 succeeds → we finish.
        if (clickCount === 1) {
          return { ok: false, message: 'locator click: recaptcha challenge' };
        }
        return { ok: true, message: 'clicked' };
      },
      type: async () => ({ ok: true }),
      pressKey: async () => ({ ok: true }),
      scroll: async () => ({ ok: true }),
      wait: async () => ({ ok: true }),
      accessibilitySnapshot: async () => ({
        text: '- heading "Welcome"',
        refs: [],
        url: 'https://x.test/',
        title: '',
      }),
      resetPageForTask: async () => {},
    } as unknown as PlaywrightExecutor;

    const prev = {
      timeout: process.env.CAPTCHA_WAIT_TIMEOUT_MS,
      poll: process.env.CAPTCHA_POLL_INTERVAL_MS,
    };
    process.env.CAPTCHA_WAIT_TIMEOUT_MS = '50';
    process.env.CAPTCHA_POLL_INTERVAL_MS = '10';

    const fallbackEvents: unknown[] = [];
    const commander = scriptedCommander({ kind: 'click', x: 1, y: 1 });
    await startVisionLoopTask({
      taskId: 'tsk_single_strike',
      userId: 'usr_test',
      intent: 'thing',
      commander,
      playwrightExecutor: executor,
      maxSteps: 3,
      onExecutorFallback: (info) => {
        fallbackEvents.push(info);
      },
    });

    if (prev.timeout === undefined) delete process.env.CAPTCHA_WAIT_TIMEOUT_MS;
    else process.env.CAPTCHA_WAIT_TIMEOUT_MS = prev.timeout;
    if (prev.poll === undefined) delete process.env.CAPTCHA_POLL_INTERVAL_MS;
    else process.env.CAPTCHA_POLL_INTERVAL_MS = prev.poll;

    expect(fallbackEvents).toHaveLength(0);
  }, 10_000);
});

describe('startVisionLoopTask — Layer 5 executor fallback', () => {
  it('fires onExecutorFallback with available=false when no extension client is connected', async () => {
    // Each click fails with a distinct captcha marker so the
    // detector scores each as a separate high-confidence strike.
    let clickIdx = 0;
    const captchaMessages = [
      'locator click: recaptcha challenge tick 0',
      'locator click: hcaptcha challenge tick 1',
      'locator click: cloudflare challenge tick 2',
    ];
    const fakePage = { url: () => 'https://x.test/', title: async () => '' };
    const executor = {
      getPage: async () => fakePage,
      screenshot: async () => ({
        base64: 'AAA=',
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
      click: async () => {
        const msg = captchaMessages[Math.min(clickIdx, captchaMessages.length - 1)]!;
        clickIdx += 1;
        return { ok: false, message: msg };
      },
      type: async () => ({ ok: true }),
      pressKey: async () => ({ ok: true }),
      scroll: async () => ({ ok: true }),
      wait: async () => ({ ok: true }),
      // No accessibilitySnapshot — a11y mode is off, so the Layer 4
      // wait loop will time out quickly (the shortened env knob
      // below).
      resetPageForTask: async () => {},
    } as unknown as PlaywrightExecutor;

    // Script the commander to issue click every tick until we hit
    // the fallback. Each tick the click fails → strike +1. On the
    // 3rd strike the fallback fires; we assert on the hook.
    let tickCount = 0;
    const commander: VisionLoopCommander = {
      async decideNextAction(ctx) {
        tickCount += 1;
        const { viewportWidth, viewportHeight } = ctx.observation;
        const isFinal = tickCount >= 5;
        return {
          action: isFinal
            ? { kind: 'done', summary: 'ending' }
            : { kind: 'click', x: 1, y: 1 },
          image: {
            base64: 'AA==',
            originalWidth: viewportWidth || 1,
            originalHeight: viewportHeight || 1,
            resizedWidth: viewportWidth || 1,
            resizedHeight: viewportHeight || 1,
            scaleX: 1,
            scaleY: 1,
          },
          toolUseId: `tu_${tickCount}`,
          elapsedMs: 5,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        };
      },
    };

    // Short env knobs so the Layer 4 wait doesn't eat the test
    // budget. userId is a throwaway that's guaranteed to have no
    // connected SW client in a unit test.
    const prev = {
      timeout: process.env.CAPTCHA_WAIT_TIMEOUT_MS,
      poll: process.env.CAPTCHA_POLL_INTERVAL_MS,
    };
    process.env.CAPTCHA_WAIT_TIMEOUT_MS = '50';
    process.env.CAPTCHA_POLL_INTERVAL_MS = '10';

    const fallbackEvents: unknown[] = [];
    const outcome = await startVisionLoopTask({
      taskId: 'tsk_fallback',
      userId: 'usr_never_connected_in_unit_test',
      intent: 'click buttons forever',
      commander,
      playwrightExecutor: executor,
      maxSteps: 6,
      onExecutorFallback: (info) => {
        fallbackEvents.push(info);
      },
    });

    if (prev.timeout === undefined) delete process.env.CAPTCHA_WAIT_TIMEOUT_MS;
    else process.env.CAPTCHA_WAIT_TIMEOUT_MS = prev.timeout;
    if (prev.poll === undefined) delete process.env.CAPTCHA_POLL_INTERVAL_MS;
    else process.env.CAPTCHA_POLL_INTERVAL_MS = prev.poll;

    // The hook should fire exactly once (not every tick past the
    // threshold — `fallbackTriggered` latches).
    expect(fallbackEvents).toHaveLength(1);
    const ev = fallbackEvents[0] as { reason: string; available: boolean };
    expect(ev.reason).toBe('anti-bot');
    // No extension client in a unit test → available=false.
    expect(ev.available).toBe(false);
    // The 3rd consecutive failed click also trips the runner's own
    // `MAX_SEQUENTIAL_DRIVER_FAILS=3` guard, so the outcome is
    // 'failed' with a driver-fail reason. That's fine — Layer 5's
    // job is to EMIT the fallback signal; the task still terminates
    // because the stand-in WS transport has no real SW to drive.
    expect(outcome.status).toBe('failed');
  }, 20_000);
});
