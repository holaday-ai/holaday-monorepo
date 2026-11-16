import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserControl, HUMAN_IDLE_MS } from './browser-control.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});
afterEach(() => vi.useRealTimers());
const control = () => new BrowserControl(Date.now, { collaborationV2: true });

it.each([false, true])(
  'holds a pending picker without blocking human inputs (v2=%s)',
  async (collaborationV2) => {
    const c = new BrowserControl(Date.now, { collaborationV2 });
    const release = c.beginPendingInteraction();
    const observe = vi.fn(async () => {});
    const waiting = c.checkpoint(observe, { maxWaitMs: 10_000 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(observe).not.toHaveBeenCalled();
    expect(await c.runHuman(async () => 'human can cancel')).toBe('human can cancel');
    release();
    await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS);
    expect(await waiting).toMatchObject({ resumed: true });
    expect(observe).toHaveBeenCalledOnce();
    expect(await c.checkpoint(observe)).toMatchObject({ resumed: false });
  },
);

it.each([false, true])(
  'never resumes an unresolved picker at the bounded deadline (v2=%s)',
  async (collaborationV2) => {
    const c = new BrowserControl(Date.now, { collaborationV2 });
    const releaseFirst = c.beginPendingInteraction();
    const releaseSecond = c.beginPendingInteraction();
    releaseFirst();
    releaseFirst();
    const observe = vi.fn(async () => {});
    const waiting = c.checkpoint(observe, { maxWaitMs: 3_000 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await waiting).toMatchObject({ resumed: false, blocked: true });
    expect(observe).not.toHaveBeenCalled();
    releaseSecond();
    await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS);
    expect(await c.checkpoint(observe)).toMatchObject({ resumed: true });
  },
);

it.each([false, true])(
  'reobserves an already closed picker before reusing a model plan (v2=%s)',
  async (collaborationV2) => {
    const c = new BrowserControl(Date.now, { collaborationV2 });
    const release = c.beginPendingInteraction();
    release();
    await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS);
    expect(c.hasUnobservedHumanInput()).toBe(true);
    expect(await c.checkpoint(async () => {})).toMatchObject({ resumed: true });
  },
);

it.each([false, true])(
  'invalidates an observation when a picker opens during it (v2=%s)',
  async (collaborationV2) => {
    const c = new BrowserControl(Date.now, { collaborationV2 });
    c.beginPendingInteraction()();
    await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS);
    let release!: () => void;
    const observe = vi
      .fn(async () => {})
      .mockImplementationOnce(async () => {
        release = c.beginPendingInteraction();
      });
    const waiting = c.checkpoint(observe, { maxWaitMs: 10_000 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(observe).toHaveBeenCalledOnce();
    release();
    await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS);
    expect(await waiting).toMatchObject({ resumed: true });
    expect(observe).toHaveBeenCalledTimes(2);
  },
);

it.each([false, true])(
  'wakes a picker wait when its browser is closed (v2=%s)',
  async (collaborationV2) => {
    const c = new BrowserControl(Date.now, { collaborationV2 });
    const release = c.beginPendingInteraction();
    const observe = vi.fn(async () => {});
    const waiting = c.checkpoint(observe);
    await vi.advanceTimersByTimeAsync(0);
    c.close();
    release();
    expect(await waiting).toMatchObject({ resumed: false });
    expect(observe).not.toHaveBeenCalled();
    expect(() => c.beginPendingInteraction()).toThrow('browser_control_closed');
  },
);

it('invalidates a plan even when the person finished during model thinking and is now quiet', async () => {
  const c = control();
  c.noteHumanInput('insertText');
  await vi.advanceTimersByTimeAsync(3_000);
  const observe = vi.fn(async () => {});
  expect(await c.checkpoint(observe)).toEqual({ resumed: true, waitedMs: 0 });
  expect(observe).toHaveBeenCalledOnce();
  expect(await c.checkpoint(observe)).toEqual({ resumed: false, waitedMs: 0 });
});

it('waits for the quiet period after an accepted navigation actually settles', async () => {
  const c = control();
  let finish!: () => void;
  const input = c.runHuman(
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
    'navigate',
  );
  await vi.advanceTimersByTimeAsync(10_000);
  finish();
  await input;
  let resumed = false;
  const waiting = c.checkpoint(async () => {
    resumed = true;
  });
  await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS - 1);
  expect(resumed).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await waiting;
  expect(resumed).toBe(true);
});

it.each(['keys', 'pointers', 'composing'] as const)(
  'does not reclaim the browser while %s remains held',
  async (held) => {
    const c = control();
    const source = {};
    c.setHeldInput(source, {
      keys: held === 'keys' ? 1 : 0,
      pointers: held === 'pointers' ? 1 : 0,
      composing: held === 'composing',
    });
    let resumed = false;
    const waiting = c.checkpoint(async () => {
      resumed = true;
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resumed).toBe(false);
    c.setHeldInput(source, { keys: 0, pointers: 0, composing: false });
    await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS - 1);
    expect(resumed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(resumed).toBe(true);
  },
);

it('reports a bounded busy wait without observing or permitting the stale plan', async () => {
  const c = control();
  const observe = vi.fn(async () => {});
  c.setHeldInput({}, { keys: 0, pointers: 1, composing: false });
  const pending = c.checkpoint(observe, { maxWaitMs: 100 });
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ resumed: false, blocked: true, waitedMs: 100 });
  expect(observe).not.toHaveBeenCalled();
});

it('naturally waits and reobserves when an intervention arrives during observation', async () => {
  const c = control();
  c.noteHumanInput('insertText');
  await vi.advanceTimersByTimeAsync(3_000);
  const observe = vi
    .fn(async () => {})
    .mockImplementationOnce(async () => {
      c.noteHumanInput('scroll');
    });
  const pending = c.checkpoint(observe);
  await vi.advanceTimersByTimeAsync(0);
  expect(observe).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await pending).toMatchObject({ resumed: true });
  expect(observe).toHaveBeenCalledTimes(2);
  const retry = vi.fn(async () => {});
  expect(await c.checkpoint(retry)).toMatchObject({ resumed: false });
  expect(retry).not.toHaveBeenCalled();
});
