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
});
