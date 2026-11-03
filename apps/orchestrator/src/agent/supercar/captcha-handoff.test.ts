import { afterEach, expect, it, vi } from 'vitest';
import { BrowserControl } from './browser-control.js';
import { CaptchaHandoffs } from './captcha-handoff.js';
afterEach(() => vi.useRealTimers());
async function fixture() {
  vi.useFakeTimers();
  const registry = new CaptchaHandoffs();
  const control = new BrowserControl();
  let wall = true;
  const waiting = vi.fn(async () => {});
  const resumed = vi.fn(async () => true);
  const activity = vi.fn();
  const result = registry.wait({
    taskId: 't',
    userId: 'u',
    control,
    hasWall: async () => wall,
    onWaiting: waiting,
    onResumed: resumed,
    timeoutMs: 1000,
    pollMs: 50,
    onActivity: activity,
  });
  await vi.advanceTimersByTimeAsync(0);
  return {
    activity,
    registry,
    control,
    result,
    waiting,
    resumed,
    clear: () => {
      wall = false;
    },
  };
}
it('wall → human lease → clear wall → automatic resume; agent is excluded while waiting', async () => {
  const f = await fixture();
  expect(f.control.canAgentAct()).toBe(false);
  expect(f.control.snapshot().phase).toBe('human');
  expect(f.waiting).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.resumed).not.toHaveBeenCalled();
  f.clear();
  await vi.advanceTimersByTimeAsync(50);
  // FIX-53 #1: the person sent nothing, so the wall cleared itself — not 「用户已完成验证」.
  expect(await f.result).toBe('cleared');
  expect(f.control.canAgentAct()).toBe(true);
  expect(f.resumed).toHaveBeenCalledOnce();
  expect(f.activity).toHaveBeenCalledWith(expect.objectContaining({ inputs: 0, confirmed: false }));
});
it('FIX-53 #1: input from the person during the wait makes the automatic resume theirs', async () => {
  const f = await fixture();
  const lease = f.control.snapshot().lease!;
  await f.control.runHuman(lease, async () => {});
  await f.control.runHuman(lease, async () => {});
  f.clear();
  await vi.advanceTimersByTimeAsync(50);
  expect(await f.result).toBe('resumed');
  const logged = f.activity.mock.calls[0]![0];
  expect(logged).toMatchObject({ inputs: 2, confirmed: false, count: 2 });
  expect(logged.firstAt).toBeTypeOf('number');
});
it('FIX-53 #1: a wait that times out still logs what the person did', async () => {
  const f = await fixture();
  await f.control.runHuman(f.control.snapshot().lease!, async () => {});
  await vi.advanceTimersByTimeAsync(1000);
  expect(await f.result).toBe('timeout');
  expect(f.activity).toHaveBeenCalledWith(expect.objectContaining({ inputs: 1 }));
});
it('manual continue checks the wall and owner before handback', async () => {
  const f = await fixture();
  expect(await f.registry.proceed('t', 'other', f.control)).toBe(false);
  expect(await f.registry.proceed('t', 'u', f.control)).toBe(false);
  f.clear();
  expect(await f.registry.proceed('t', 'u', f.control)).toBe(true);
  expect(await f.result).toBe('resumed');
});
it('cancel and timeout close admission without claiming completion', async () => {
  const f = await fixture();
  expect(f.registry.cancel('t', 'other', f.control)).toBe(false);
  expect(f.registry.cancel('t', 'u', f.control)).toBe(true);
  expect(await f.result).toBe('cancelled');
  expect(f.control.canAgentAct()).toBe(false);
  const g = await fixture();
  await vi.advanceTimersByTimeAsync(1000);
  expect(await g.result).toBe('timeout');
  expect(g.control.snapshot().phase).toBe('closed');
  expect(g.resumed).not.toHaveBeenCalled();
});
it('FIX-35 复审 #2: the control channel closing on its own is an error, not the user giving up', async () => {
  const f = await fixture();
  f.control.close('observation_failed');
  await vi.advanceTimersByTimeAsync(50);
  expect(await f.result).toBe('error');
  // The user's cancel is still 'cancelled'.
  const g = await fixture();
  expect(g.registry.cancel('t', 'u', g.control)).toBe(true);
  expect(await g.result).toBe('cancelled');
});
it('keeps the user lease when the resume persistence fails', async () => {
  const f = await fixture();
  f.resumed.mockResolvedValue(false);
  f.clear();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.control.canAgentAct()).toBe(false);
  expect(f.control.snapshot().phase).toBe('human');
  f.registry.cancel('t', 'u', f.control);
  await f.result;
});
it('waits for accepted human input to settle before resuming or releasing', async () => {
  const f = await fixture();
  let finish!: () => void;
  const input = f.control.runHuman(
    f.control.snapshot().lease!,
    async () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  await vi.advanceTimersByTimeAsync(0);
  f.clear();
  await f.registry.proceed('t', 'u', f.control);
  expect(f.resumed).not.toHaveBeenCalled();
  finish();
  await input;
  expect(await f.result).toBe('resumed');
});

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
