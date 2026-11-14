import { afterEach, expect, it, vi } from 'vitest';
import { BrowserControl, HUMAN_IDLE_MS } from './browser-control.js';
import { CaptchaHandoffs } from './captcha-handoff.js';
afterEach(() => vi.useRealTimers());
async function fixture(options: { control?: BrowserControl; registry?: CaptchaHandoffs } = {}) {
  vi.useFakeTimers();
  const registry = options.registry ?? new CaptchaHandoffs();
  const control = options.control ?? new BrowserControl(() => Date.now());
  let wall = true;
  const hasWall = vi.fn(async () => wall);
  const waiting = vi.fn(async () => {});
  const resumed = vi.fn(async () => true);
  const activity = vi.fn();
  const result = registry.wait({
    taskId: 't',
    userId: 'u',
    control,
    hasWall,
    onWaiting: waiting,
    onResumed: resumed,
    timeoutMs: 60_000,
    pollMs: 50,
    onActivity: activity,
  });
  let done = false;
  void result.then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  return {
    activity,
    registry,
    control,
    result,
    hasWall,
    waiting,
    resumed,
    done: () => done,
    clear: () => {
      wall = false;
    },
    raise: () => {
      wall = true;
    },
  };
}
it('REBUILD-4: the wait takes no lease; the person may use the page and the assistant is not paused', async () => {
  const f = await fixture();
  expect(f.waiting).toHaveBeenCalledOnce();
  expect(f.control.snapshot()).toEqual({ phase: 'agent', lease: null, error: null });
  expect(f.control.canAgentAct()).toBe(true);
  expect(await f.control.runHuman(async () => 'clicked', 'mouseDown')).toBe('clicked');
  f.registry.cancel('t', 'u', f.control);
  await f.result;
});
it('wall cleared with no input from the person → cleared (the page cleared it, not the user)', async () => {
  const f = await fixture();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.resumed).not.toHaveBeenCalled();
  f.clear();
  await vi.advanceTimersByTimeAsync(50);
  // FIX-53 #1: the person sent nothing, so the wall cleared itself — not 「用户已完成验证」.
  expect(await f.result).toBe('cleared');
  expect(f.resumed).toHaveBeenCalledOnce();
  expect(f.activity).toHaveBeenCalledWith(expect.objectContaining({ inputs: 0, confirmed: false }));
});
it('wall cleared by the person → waits for them to be still, re-checks, then resumed', async () => {
  const f = await fixture();
  await f.control.runHuman(async () => {}, 'mouseDown');
  await f.control.runHuman(async () => {}, 'insertText');
  f.clear();
  await vi.advanceTimersByTimeAsync(50);
  // The wall is gone but the person typed just now: the assistant waits 2 s for them.
  expect(f.done()).toBe(false);
  expect(f.resumed).not.toHaveBeenCalled();
  const checksBefore = f.hasWall.mock.calls.length;
  await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS);
  expect(await f.result).toBe('resumed');
  expect(f.hasWall.mock.calls.length).toBeGreaterThan(checksBefore);
  expect(f.resumed).toHaveBeenCalledOnce();
  const logged = f.activity.mock.calls[0]![0];
  expect(logged).toMatchObject({ inputs: 2, confirmed: false, count: 2 });
  expect(logged.firstAt).toBeTypeOf('number');
});
it('a wall that reappears after the yield keeps the wait open', async () => {
  const f = await fixture();
  await f.control.runHuman(async () => {}, 'keyDown');
  f.clear();
  await vi.advanceTimersByTimeAsync(50);
  expect(f.done()).toBe(false);
  // The page put the wall back while the assistant waited for the person to be still.
  f.raise();
  await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS + 500);
  expect(f.done()).toBe(false);
  expect(f.resumed).not.toHaveBeenCalled();
  f.clear();
  await vi.advanceTimersByTimeAsync(50);
  expect(await f.result).toBe('resumed');
  expect(f.resumed).toHaveBeenCalledOnce();
});
it('a wait that times out still logs what the person did and closes the control', async () => {
  const f = await fixture();
  await f.control.runHuman(async () => {}, 'keyDown');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await f.result).toBe('timeout');
  expect(f.control.snapshot().phase).toBe('closed');
  expect(f.resumed).not.toHaveBeenCalled();
  expect(f.activity).toHaveBeenCalledWith(expect.objectContaining({ inputs: 1 }));
});
it('我已完成 checks the wall and the owner', async () => {
  const f = await fixture();
  expect(await f.registry.proceed('t', 'other', f.control)).toBe(false);
  expect(await f.registry.proceed('t', 'u', new BrowserControl())).toBe(false);
  expect(await f.registry.proceed('t', 'u', f.control)).toBe(false);
  f.clear();
  expect(await f.registry.proceed('t', 'u', f.control)).toBe(true);
  expect(await f.result).toBe('resumed');
  expect(f.activity).toHaveBeenCalledWith(expect.objectContaining({ inputs: 0, confirmed: true }));
});
it('cancel closes the control without claiming completion', async () => {
  const f = await fixture();
  expect(f.registry.cancel('t', 'other', f.control)).toBe(false);
  expect(f.registry.cancel('t', 'u', f.control)).toBe(true);
  expect(await f.result).toBe('cancelled');
  expect(f.control.snapshot().phase).toBe('closed');
  expect(f.control.canAgentAct()).toBe(false);
  expect(f.resumed).not.toHaveBeenCalled();
  expect(f.registry.active('t', 'u')).toBe(false);
});
it('an aborted signal cancels and closes the control', async () => {
  vi.useFakeTimers();
  const registry = new CaptchaHandoffs();
  const control = new BrowserControl(() => Date.now());
  const abort = new AbortController();
  const result = registry.wait({
    taskId: 't',
    userId: 'u',
    control,
    hasWall: async () => true,
    onWaiting: async () => {},
    onResumed: async () => true,
    signal: abort.signal,
    pollMs: 50,
  });
  await vi.advanceTimersByTimeAsync(100);
  abort.abort();
  expect(await result).toBe('cancelled');
  expect(control.snapshot().phase).toBe('closed');
});
it('换个方式继续 only after two failed 我已完成 rounds', async () => {
  const f = await fixture();
  expect(f.registry.alternate('t', 'u', f.control)).toBe(false);
  expect(await f.registry.proceed('t', 'u', f.control)).toBe(false);
  expect(f.registry.status('t', 'u', f.control)).toMatchObject({
    failedRounds: 1,
    alternateAvailable: false,
  });
  expect(f.registry.alternate('t', 'u', f.control)).toBe(false);
  expect(await f.registry.proceed('t', 'u', f.control)).toBe(false);
  expect(f.registry.status('t', 'u', f.control)).toMatchObject({
    failedRounds: 2,
    alternateAvailable: true,
  });
  expect(f.registry.alternate('t', 'u', f.control)).toBe(true);
  expect(await f.result).toBe('alternate');
  expect(f.resumed).toHaveBeenCalledOnce();
});
// REBUILD-4 (found while rewriting these tests, fixed in wait()): a control that closes on its own
// during the wait (input outcome unknown, observation failure) ends it as 'error' at the next poll.
it('FIX-35 复审 #2: the control channel closing on its own is an error, not the user giving up', async () => {
  const f = await fixture();
  f.control.close('observation_failed');
  f.clear();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.done()).toBe(true);
  expect(await f.result).toBe('error');
  expect(f.resumed).not.toHaveBeenCalled();
});
it('FIX-52 #8: the page going away ends the wait as an error', async () => {
  vi.useFakeTimers();
  const registry = new CaptchaHandoffs();
  const control = new BrowserControl(() => Date.now());
  let gone = false;
  const result = registry.wait({
    taskId: 't',
    userId: 'u',
    control,
    hasWall: async () => true,
    onWaiting: async () => {},
    onResumed: async () => true,
    pageGone: () => gone,
    pollMs: 50,
  });
  await vi.advanceTimersByTimeAsync(100);
  gone = true;
  await vi.advanceTimersByTimeAsync(50);
  expect(await result).toBe('error');
  expect(control.snapshot().phase).toBe('closed');
});
it('a failed resume persistence is an error', async () => {
  const f = await fixture();
  f.resumed.mockResolvedValue(false);
  f.clear();
  await vi.advanceTimersByTimeAsync(100);
  expect(await f.result).toBe('error');
});
it('waits for accepted human input to settle before resuming', async () => {
  const f = await fixture();
  let finish!: () => void;
  const input = f.control.runHuman(
    async () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  await vi.advanceTimersByTimeAsync(0);
  f.clear();
  await f.registry.proceed('t', 'u', f.control);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(f.resumed).not.toHaveBeenCalled();
  finish();
  await input;
  await vi.advanceTimersByTimeAsync(0);
  expect(await f.result).toBe('resumed');
});
// REBUILD-4 (fixed in wait()): a cancel that lands while onResumed() is persisting wins.
it('cancellation wins a race with resume persistence', async () => {
  const f = await fixture();
  f.resumed.mockImplementation(async () => {
    f.registry.cancel('t', 'u', f.control);
    return true;
  });
  f.clear();
  await vi.advanceTimersByTimeAsync(50);
  expect(await f.result).toBe('cancelled');
  expect(f.control.snapshot().phase).toBe('closed');
});
it('FIX-53 #1 (协调方): moving, scrolling and key/button releases are not the person acting', async () => {
  const f = await fixture();
  for (const kind of ['mouseMove', 'scroll', 'mouseUp', 'keyUp'] as const)
    await f.control.runHuman(async () => {}, kind);
  await f.control.runHuman(async () => {});
  f.clear();
  // A scroll still makes the person busy: the assistant waits for them before going on.
  await vi.advanceTimersByTimeAsync(50 + HUMAN_IDLE_MS);
  expect(await f.result).toBe('cleared');
  expect(f.activity).toHaveBeenCalledWith(
    expect.objectContaining({ inputs: 0, count: 0, firstAt: null, lastAt: null }),
  );
});
it('FIX-53 #1 (协调方): first and last are of this wait, not of the session', async () => {
  vi.useFakeTimers();
  const control = new BrowserControl(() => Date.now());
  const registry = new CaptchaHandoffs();
  const run = async (act: boolean) => {
    let wall = true;
    const activity = vi.fn();
    const result = registry.wait({
      taskId: 't',
      userId: 'u',
      control,
      hasWall: async () => wall,
      onWaiting: async () => {},
      onResumed: async () => true,
      onActivity: activity,
      timeoutMs: 60_000,
      pollMs: 50,
    });
    await vi.advanceTimersByTimeAsync(10);
    if (act) await control.runHuman(async () => {}, 'navigate');
    await vi.advanceTimersByTimeAsync(100);
    wall = false;
    await vi.advanceTimersByTimeAsync(50 + HUMAN_IDLE_MS);
    return { result: await result, logged: activity.mock.calls[0]![0] };
  };
  const first = await run(true);
  expect(first.result).toBe('resumed');
  await vi.advanceTimersByTimeAsync(5_000);
  const second = await run(false);
  expect(second.result).toBe('cleared');
  expect(second.logged).toMatchObject({ inputs: 0, firstAt: null, lastAt: null });
  expect(first.logged.firstAt).toBeTypeOf('number');
});
