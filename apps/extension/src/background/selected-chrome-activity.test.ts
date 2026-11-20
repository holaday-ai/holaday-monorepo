import type { DriverResult } from '@holaday/browser-driver';
import { USER_BROWSER_PROTOCOL } from '@holaday/shared-types';
import { expect, it, vi } from 'vitest';
import { SelectedChromeSession } from './selected-chrome-session.js';

async function fixture(enabled = true) {
  let owner = 'owner';
  let activity = {
    tabId: 42,
    stamp: 'a'.repeat(64),
    keys: 0,
    pointers: 0,
    composing: false,
    interrupted: false,
  };
  const driver = {
    attachExistingTab: async () => ({ status: 'ok' as const, data: { tabId: 42 } }),
    observeCurrentPage: vi.fn(
      async (): Promise<DriverResult> => ({
        status: 'ok' as const,
        data: { tabId: 42, activity: { ...activity } },
      }),
    ),
    describeTarget: vi.fn(),
    executeBound: vi.fn(),
    readActivity: vi.fn(async () => ({ status: 'ok' as const, data: { ...activity } })),
    execute: vi.fn(async () => ({ status: 'ok' as const })),
    dispose: vi.fn(async () => {}),
  };
  const session = new SelectedChromeSession({ makeDriver: () => driver, owner: () => owner });
  const opened = await session.open({
    taskId: 'task',
    tabId: 42,
    validate: async () => {},
    grantedOrigins: ['https://work.example'],
    protocol: {
      ...USER_BROWSER_PROTOCOL,
      capabilities: [
        ...USER_BROWSER_PROTOCOL.capabilities,
        ...(enabled ? ['human_activity_v1'] : []),
      ],
    },
  });
  if (!opened.ok) throw new Error(opened.error);
  return {
    session,
    sid: opened.sessionId,
    driver,
    set: (next: Partial<typeof activity>) => {
      activity = { ...activity, ...next };
    },
    changeOwner: () => {
      owner = 'other';
    },
  };
}
it.each([{ keys: 1 }, { pointers: 1 }, { composing: true }, { interrupted: true }])(
  'rejects even navigation before native input %j has finished',
  async (held) => {
    const h = await fixture();
    h.set(held);
    expect(await h.session.activity('task', h.sid)).toMatchObject({ ok: true, activity: held });
    expect(
      await h.session.execute('task', h.sid, {
        kind: 'goto',
        payload: { url: 'https://work.example/next' },
      }),
    ).toMatchObject({ ok: false, error: 'human_input_active', actionOutcome: 'not_applied' });
    expect(h.driver.execute).not.toHaveBeenCalled();
  },
);
it('requires a new observation after a completed edit; then proceeds without quarantine', async () => {
  const h = await fixture();
  h.set({ stamp: 'b'.repeat(64) });
  const action = { kind: 'goto' as const, payload: { url: 'https://work.example/next' } };
  expect(await h.session.execute('task', h.sid, action)).toMatchObject({
    ok: false,
    error: 'stale_observation',
    actionOutcome: 'not_applied',
  });
  expect(await h.session.observe('task', h.sid)).toMatchObject({ ok: true });
  expect(await h.session.execute('task', h.sid, action)).toMatchObject({ ok: true });
  expect(h.driver.execute).toHaveBeenCalledOnce();
});

it('does not call a failed pre-action metadata read an unknown business effect', async () => {
  const h = await fixture();
  h.driver.readActivity.mockRejectedValueOnce(new Error('reader disconnected'));
  const action = { kind: 'goto' as const, payload: { url: 'https://work.example/next' } };
  expect(await h.session.execute('task', h.sid, action)).toMatchObject({
    ok: false,
    error: 'activity_unavailable',
    actionOutcome: 'not_applied',
  });
  expect(h.driver.execute).not.toHaveBeenCalled();
  expect(await h.session.observe('task', h.sid)).toMatchObject({ ok: true });
  expect(await h.session.execute('task', h.sid, action)).toMatchObject({ ok: true });
});

it('rereads once after an applied action changes during capture, without replaying the action', async () => {
  const h = await fixture();
  h.driver.observeCurrentPage.mockResolvedValueOnce({
    status: 'error',
    error: { code: 'EXTRACT_FAILED', message: 'stale_observation' },
  });
  expect(
    await h.session.execute('task', h.sid, {
      kind: 'goto',
      payload: { url: 'https://work.example/next' },
    }),
  ).toMatchObject({ ok: true, actionOutcome: 'applied' });
  expect(h.driver.execute).toHaveBeenCalledOnce();
  expect(h.driver.observeCurrentPage).toHaveBeenCalledTimes(3);
});
it('does not read activity for another owner, session, task, tab or disabled mode', async () => {
  const h = await fixture();
  expect(await h.session.activity('other', h.sid)).toMatchObject({ ok: false });
  expect(await h.session.activity('task', 'other')).toMatchObject({ ok: false });
  h.set({ tabId: 99 });
  expect(await h.session.activity('task', h.sid)).toMatchObject({ ok: false });
  h.changeOwner();
  h.driver.readActivity.mockClear();
  expect(await h.session.activity('task', h.sid)).toMatchObject({ ok: false });
  expect(h.driver.readActivity).not.toHaveBeenCalled();
  const off = await fixture(false);
  expect(await off.session.activity('task', off.sid)).toMatchObject({
    ok: false,
    error: 'capability_missing',
  });
  expect(off.driver.readActivity).not.toHaveBeenCalled();
});
