import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { acceptViewerActivity, finishViewerActivity } from './viewer-activity.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});
afterEach(() => vi.useRealTimers());
function fixture(enabled = true) {
  const instance = {
    taskId: 'tsk_activity',
    userId: 'owner',
    status: 'ready',
    capabilities: {
      viewportV2: true,
      observationV2: true,
      routingV2: false,
      replayV1: false,
      ...(enabled ? { collaborationV2: true } : {}),
    },
  } as BrowserInstance;
  const binding = browserControlSessions.start(instance);
  const source = {};
  return { instance, binding, source, peek: () => instance };
}
const message = (overrides = {}) =>
  JSON.stringify({ type: 'activity', keys: 0, pointers: 1, composing: false, ...overrides });
it('keeps an owned drag busy after the idle timer, then reobserves after its real release', async () => {
  const h = fixture();
  expect(acceptViewerActivity(message(), h)).toBe(true);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(h.binding.control.humanBusy()).toBe(true);
  acceptViewerActivity(message({ pointers: 0 }), h);
  await vi.advanceTimersByTimeAsync(2_000);
  const observe = vi.fn(async () => {});
  expect(await h.binding.control.checkpoint(observe)).toMatchObject({ resumed: true });
  expect(observe).toHaveBeenCalledOnce();
  h.binding.finish();
});
it('never applies activity to a replacement browser or a disabled instance', () => {
  for (const enabled of [true, false]) {
    const h = fixture(enabled);
    acceptViewerActivity(message(), {
      ...h,
      peek: () => (enabled ? { ...h.instance } : h.instance),
    });
    expect(h.binding.control.humanBusy()).toBe(false);
    h.binding.finish();
  }
});
it.each([{ keys: -1 }, { pointers: 9 }, { composing: 'text' }, { text: 'private' }])(
  'rejects malformed or content-bearing metadata %j',
  (overrides) => {
    const h = fixture();
    acceptViewerActivity(message(overrides), h);
    expect(h.binding.control.humanBusy()).toBe(false);
    h.binding.finish();
  },
);
it('does not manufacture a release receipt when a held viewer disconnects', async () => {
  const h = fixture();
  acceptViewerActivity(message(), h);
  await finishViewerActivity({ ...h, stop: vi.fn(async () => false) });
  expect(h.binding.control.snapshot()).toMatchObject({
    phase: 'closed',
    error: 'input_outcome_unknown',
  });
  expect(h.binding.control.hasHeldInput(h.source)).toBe(true);
  const stopped = vi.fn(async () => true);
  await finishViewerActivity({ ...h, stop: stopped });
  expect(stopped).toHaveBeenCalledOnce();
  expect(h.binding.control.hasHeldInput(h.source)).toBe(false);
  h.binding.finish();
});
it('keeps an idle browser alive after its viewer leaves', async () => {
  const h = fixture();
  const stop = vi.fn(async () => true);
  await finishViewerActivity({ ...h, stop });
  expect(stop).not.toHaveBeenCalled();
  expect(h.binding.control.canAgentAct()).toBe(true);
  h.binding.finish();
});
