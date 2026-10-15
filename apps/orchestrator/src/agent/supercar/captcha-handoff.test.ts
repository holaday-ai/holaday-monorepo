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
  const result = registry.wait({
    taskId: 't',
    userId: 'u',
    control,
    hasWall: async () => wall,
    onWaiting: waiting,
    onResumed: resumed,
    timeoutMs: 1000,
    pollMs: 50,
  });
  await vi.advanceTimersByTimeAsync(0);
  return {
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
  expect(await f.result).toBe('resumed');
  expect(f.control.canAgentAct()).toBe(true);
  expect(f.resumed).toHaveBeenCalledOnce();
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
