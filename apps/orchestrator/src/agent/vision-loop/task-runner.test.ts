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
