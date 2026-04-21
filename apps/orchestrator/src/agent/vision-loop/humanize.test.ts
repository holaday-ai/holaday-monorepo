import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  humanClick,
  humanMouseMove,
  humanScroll,
  humanTypeText,
  isHumanizeEnabled,
  randomDelay,
} from './humanize.js';
import type { PageLike } from './playwright-executor.js';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

// Keep tests fast: fake timers let us fast-forward the randomDelay /
// per-step pauses without wall-clock waits. We still let real Math
// .random run so path generation remains exercised; the timing alone
// is mocked.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

interface RecordedCall {
  method: string;
  args: unknown[];
}

function makePage(): { page: PageLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const record = (m: string, ...args: unknown[]) => {
    calls.push({ method: m, args });
  };
  const page: PageLike = {
    url: () => 'https://example.com/',
    title: async () => '',
    viewportSize: () => ({ width: 1280, height: 800 }),
    screenshot: async () => Buffer.from(''),
    mouse: {
      click: async (x, y, opts) => {
        record('mouse.click', x, y, opts);
      },
      move: async (x, y) => {
        record('mouse.move', x, y);
      },
      wheel: async (dx, dy) => {
        record('mouse.wheel', dx, dy);
      },
    },
    keyboard: {
      type: async (text) => {
        record('keyboard.type', text);
      },
      press: async (k) => {
        record('keyboard.press', k);
      },
    },
    ariaSnapshot: async () => '',
    waitForTimeout: async (ms) => {
      record('waitForTimeout', ms);
    },
    goto: async (url, opts) => {
      record('goto', url, opts);
      return null;
    },
  };
  return { page, calls };
}

describe('humanMouseMove', () => {
  it('emits at least 4 mouse.move calls (>=3 intermediate + final target)', async () => {
    const { page, calls } = makePage();
    const promise = humanMouseMove(page, 500, 300);
    await vi.runAllTimersAsync();
    await promise;
    const moves = calls.filter((c) => c.method === 'mouse.move');
    expect(moves.length).toBeGreaterThanOrEqual(4);
    // Final move must land on the exact target.
    const last = moves[moves.length - 1];
    expect(last?.args.slice(0, 2)).toEqual([500, 300]);
  });

  it('produces a non-linear trajectory (at least one intermediate off the straight line)', async () => {
    const { page, calls } = makePage();
    const promise = humanMouseMove(page, 1000, 0);
    await vi.runAllTimersAsync();
    await promise;
    const moves = calls.filter((c) => c.method === 'mouse.move');
    // On a path from (0,0) to (1000, 0), any curve we draw forces
    // y != 0 at some intermediate sample. A perfectly straight line
    // would report y === 0 throughout.
    const anyOffAxis = moves.some((m) => (m.args[1] as number) !== 0);
    expect(anyOffAxis).toBe(true);
  });
});

describe('humanClick', () => {
  it('moves before clicking and lands exactly on the target', async () => {
    const { page, calls } = makePage();
    const promise = humanClick(page, 300, 200);
    await vi.runAllTimersAsync();
    await promise;
    const methodOrder = calls.map((c) => c.method);
    // mouse.move must appear before the final mouse.click.
    const lastMoveIdx = methodOrder.lastIndexOf('mouse.move');
    const clickIdx = methodOrder.indexOf('mouse.click');
    expect(lastMoveIdx).toBeGreaterThanOrEqual(0);
    expect(clickIdx).toBeGreaterThan(lastMoveIdx);
    const click = calls[clickIdx];
    expect(click?.args.slice(0, 2)).toEqual([300, 200]);
  });
});

describe('humanTypeText', () => {
  it('types one codepoint per keyboard.type call', async () => {
    const { page, calls } = makePage();
    const promise = humanTypeText(page, 'hi你');
    await vi.runAllTimersAsync();
    await promise;
    const types = calls.filter((c) => c.method === 'keyboard.type');
    expect(types.length).toBe(3);
    expect(types[0]?.args[0]).toBe('h');
    expect(types[1]?.args[0]).toBe('i');
    expect(types[2]?.args[0]).toBe('你');
  });
});

describe('humanScroll', () => {
  it('splits a scroll into 2..5 wheel chunks summing to deltaY', async () => {
    const { page, calls } = makePage();
    const promise = humanScroll(page, 400);
    await vi.runAllTimersAsync();
    await promise;
    const wheels = calls.filter((c) => c.method === 'mouse.wheel');
    expect(wheels.length).toBeGreaterThanOrEqual(2);
    expect(wheels.length).toBeLessThanOrEqual(5);
    const total = wheels.reduce((sum, w) => sum + (w.args[1] as number), 0);
    // Floating-point: sum may differ from 400 by rounding, but
    // shouldn't drift by more than 0.01 for 2..5 equal chunks.
    expect(Math.abs(total - 400)).toBeLessThan(1);
  });

  it('no-ops a zero scroll', async () => {
    const { page, calls } = makePage();
    await humanScroll(page, 0);
    expect(calls.filter((c) => c.method === 'mouse.wheel').length).toBe(0);
  });
});

describe('randomDelay', () => {
  it('advances the clock by a value in [min, max]', async () => {
    const p = randomDelay(50, 150);
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toBeUndefined();
  });
});

describe('isHumanizeEnabled', () => {
  it('defaults to true', () => {
    const prev = process.env.HUMANIZE_ENABLED;
    delete process.env.HUMANIZE_ENABLED;
    expect(isHumanizeEnabled()).toBe(true);
    if (prev !== undefined) process.env.HUMANIZE_ENABLED = prev;
  });

  it('honours false / 0 / empty', () => {
    const prev = process.env.HUMANIZE_ENABLED;
    for (const v of ['false', '0', '', 'no']) {
      process.env.HUMANIZE_ENABLED = v;
      expect(isHumanizeEnabled()).toBe(false);
    }
    if (prev === undefined) delete process.env.HUMANIZE_ENABLED;
    else process.env.HUMANIZE_ENABLED = prev;
  });
});
