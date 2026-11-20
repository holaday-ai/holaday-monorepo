import { USER_BROWSER_PROTOCOL } from '@holaday/shared-types';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExtensionToolCallOutcome } from '../../ws/server.js';
import { BrowserControl } from './browser-control.js';
import { SelectedChromeClient } from './selected-chrome-client.js';

afterEach(() => vi.useRealTimers());
const sid = 'e2215e8d-7b6c-4711-ab15-460f51e558a4';
const target = { tabId: 42, expectedUrl: 'https://work.example', selectionId: sid };
function fixture(enabled = true) {
  const control = new BrowserControl(Date.now, { collaborationV2: enabled });
  let activity = {
    tabId: 42,
    stamp: 'a'.repeat(64),
    keys: 0,
    pointers: 0,
    composing: false,
    interrupted: false,
  };
  const commands: string[] = [];
  const send = vi.fn(
    async (
      _: string,
      input: { args?: { session?: { op: string } } },
    ): Promise<ExtensionToolCallOutcome> => {
      const op = input.args?.session?.op ?? '';
      commands.push(op);
      return {
        ok: true as const,
        result:
          op === 'activity'
            ? { ok: true, sessionId: sid, activity: { ...activity } }
            : op === 'close'
              ? { ok: true, closed: true }
              : {
                  ok: true,
                  sessionId: sid,
                  protocol: {
                    ...USER_BROWSER_PROTOCOL,
                    capabilities: [...USER_BROWSER_PROTOCOL.capabilities, 'human_activity_v1'],
                  },
                  observation: {
                    tabId: 42,
                    origin: 'https://work.example',
                    title: '',
                    bodyText: '',
                    ariaSnapshot: '',
                    truncated: false,
                    observationRevision: 1,
                    activity: { ...activity },
                  },
                  ...(op === 'act' ? { actionOutcome: 'applied' } : {}),
                },
      };
    },
  );
  const client = new SelectedChromeClient({
    userId: 'owner',
    taskId: 'task',
    extensionClientId: 'extension',
    control,
    routingV2: true,
    collaborationV2: enabled,
    send,
  });
  return {
    control,
    client,
    commands,
    send,
    set: (next: Partial<typeof activity>) => {
      activity = { ...activity, ...next };
    },
  };
}
it('waits for native held input beyond the idle window, then rereads without replaying an action', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const h = fixture();
  expect(await h.client.open(target)).toMatchObject({ ok: true });
  h.set({ stamp: 'b'.repeat(64), keys: 1 });
  let settled = false;
  const waiting = h.client.checkpoint({ maxWaitMs: 10_000 }).then((r) => {
    settled = true;
    return r;
  });
  await vi.advanceTimersByTimeAsync(3_000);
  expect(settled).toBe(false);
  expect(h.commands.filter((op) => op === 'observe')).toHaveLength(0);
  h.set({ stamp: 'c'.repeat(64), keys: 0 });
  await vi.advanceTimersByTimeAsync(2_200);
  expect(await waiting).toMatchObject({ resumed: true });
  expect(h.commands.filter((op) => op === 'observe')).toHaveLength(1);
  expect(h.commands).not.toContain('act');
  expect(await h.client.checkpoint()).toMatchObject({ resumed: false });
});
it('does not miss a completed native edit during model thinking or mistake a fresh own-action observation for one', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const h = fixture();
  await h.client.open(target);
  h.set({ stamp: 'b'.repeat(64) });
  const waiting = h.client.checkpoint();
  await vi.advanceTimersByTimeAsync(2_200);
  expect(await waiting).toMatchObject({ resumed: true });
  h.set({ stamp: 'c'.repeat(64) });
  await h.client.observe();
  expect(await h.client.checkpoint()).toMatchObject({ resumed: false });
});
it.each([{ tabId: 99 }, { stamp: 'private-text' }, { interrupted: true }])(
  'blocks an invalid or interrupted native activity receipt %j',
  async (next) => {
    const h = fixture();
    await h.client.open(target);
    h.set(next);
    expect(await h.client.checkpoint({ maxWaitMs: 100 })).toMatchObject({ blocked: true });
    expect(h.commands).not.toContain('act');
  },
);
it('keeps native polling dark when collaboration is disabled', async () => {
  const h = fixture(false);
  await h.client.open(target);
  expect(await h.client.checkpoint()).toMatchObject({ resumed: false });
  expect(h.commands).not.toContain('activity');
});

it('naturally retries a strict observation invalidated by new input, without closing the controller', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const h = fixture();
  await h.client.open(target);
  const original = h.send.getMockImplementation();
  if (!original) throw new Error('missing fixture transport');
  let first = true;
  h.send.mockImplementation(async (user, input) => {
    const result = await original(user, input);
    if (input.args?.session?.op === 'observe' && first) {
      first = false;
      h.set({ stamp: 'c'.repeat(64) });
      return { ok: false, result: { ok: false, error: 'observation_failed' } };
    }
    return result;
  });
  h.set({ stamp: 'b'.repeat(64) });
  const waiting = h.client.checkpoint();
  await vi.advanceTimersByTimeAsync(4_500);
  expect(await waiting).toMatchObject({ resumed: true });
  expect(h.commands.filter((op) => op === 'observe')).toHaveLength(2);
  expect(h.control.canAgentAct()).toBe(true);
});

it('requires an upgraded capability receipt and rejects a different session or a lost read', async () => {
  const h = fixture();
  h.send.mockResolvedValueOnce({
    ok: true,
    result: {
      ok: true,
      sessionId: sid,
      observation: {
        tabId: 42,
        origin: 'https://work.example',
        title: '',
        bodyText: '',
        ariaSnapshot: '',
        truncated: false,
        observationRevision: 1,
      },
      protocol: USER_BROWSER_PROTOCOL,
    },
  });
  expect(await h.client.open(target)).toMatchObject({ ok: false, error: 'capability_missing' });
  expect(h.commands).not.toContain('act');
  for (const result of [
    {
      ok: true,
      result: {
        ok: true,
        sessionId: 'c4860f52-6b76-4d18-a6ba-04165322af7d',
        activity: {
          tabId: 42,
          stamp: 'a'.repeat(64),
          keys: 0,
          pointers: 0,
          composing: false,
          interrupted: false,
        },
      },
    },
    { ok: false },
  ]) {
    const live = fixture();
    await live.client.open(target);
    live.send.mockResolvedValueOnce(result);
    expect(await live.client.checkpoint()).toMatchObject({ blocked: true });
    expect(live.commands).not.toContain('act');
    expect(live.control.snapshot().error).not.toBe('input_outcome_unknown');
  }
});
