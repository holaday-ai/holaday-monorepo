import { USER_BROWSER_PROTOCOL } from '@holaday/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { BrowserControl } from './browser-control.js';
import { SelectedChromeClient } from './selected-chrome-client.js';
const id = '00000000-0000-4000-8000-000000000001';
const observation = {
  tabId: 3,
  origin: 'https://fixture.test',
  title: 'Fixture',
  bodyText: 'Search',
  ariaSnapshot: 'button Search',
  truncated: false,
  observationRevision: 1,
  sourceURL: 'https://fixture.test',
  capturedAt: 1,
  frameId: 'main',
};
const target = {
  token: id,
  elementId: '22222222-2222-4222-8222-222222222222',
  objectDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  tabId: 3,
  frameId: 'main',
  origin: observation.origin,
  observationRevision: 1,
  capturedAt: 1,
  element: {
    role: 'button',
    visibleText: 'Search',
    ariaLabel: null,
    title: null,
    placeholder: null,
    name: null,
    inputType: null,
    tagName: 'button',
  },
  form: null,
};
const action = {
  kind: 'click' as const,
  selector: {
    description: 'hint',
    strategies: [{ kind: 'css' as const, value: '#go' }],
    scope: { timeoutMs: 2000 },
    selfHeal: false,
  },
};
function fixture(old = false) {
  const send = vi.fn(
    async (
      _user: string,
      input: Parameters<ConstructorParameters<typeof SelectedChromeClient>[0]['send']>[1],
    ) => {
      const command = input.args?.session;
      if (!command) throw new Error('missing session');
      return {
        ok: true,
        result:
          command.op === 'close'
            ? { ok: true, closed: true }
            : command.op === 'describe'
              ? { ok: true, sessionId: id, target }
              : {
                  ok: true,
                  sessionId: id,
                  observation,
                  ...(!old ? { protocol: USER_BROWSER_PROTOCOL } : {}),
                  ...(command.op === 'act' ? { actionOutcome: 'applied' as const } : {}),
                },
      };
    },
  );
  const control = new BrowserControl();
  const client = new SelectedChromeClient({
    userId: 'a',
    taskId: 'b',
    extensionClientId: 'c',
    routingV2: true,
    control,
    send,
  });
  return {
    client,
    send,
    control,
    open: () => client.open({ tabId: 3, expectedUrl: observation.origin, selectionId: id }),
  };
}
describe('selected Chrome v2 client', () => {
  it('old handshake returns explicit capability_missing and preserves cleanup identity', async () => {
    const h = fixture(true);
    expect(await h.open()).toMatchObject({ ok: false, error: 'capability_missing' });
    expect(await h.client.close()).toEqual({ ok: true, closed: true });
  });
  it('binds action to extension revision and consumes ticket once', async () => {
    const h = fixture();
    await h.open();
    expect(await h.client.execute(action, h.client.revision)).toMatchObject({
      error: 'target_binding_required',
    });
    expect(await h.client.describe(action, h.client.revision)).toMatchObject({ ok: true, target });
    expect(await h.client.execute(action, h.client.revision)).toMatchObject({
      ok: true,
      actionOutcome: 'applied',
    });
    const command = h.send.mock.calls.at(-1)?.[1].args?.session;
    if (command?.op !== 'act') throw new Error('missing act');
    expect(command.binding).toEqual({ token: id, observationRevision: 1 });
    expect(await h.client.execute(action, h.client.revision)).toMatchObject({
      error: 'target_binding_required',
    });
  });
  it('fresh observation revokes prepared targets and protects unrelated tabs', async () => {
    const h = fixture();
    await h.open();
    await h.client.describe(action, h.client.revision);
    await h.client.observe();
    expect(await h.client.execute(action, h.client.revision)).toMatchObject({
      error: 'target_binding_required',
    });
    const count = h.send.mock.calls.length;
    expect(await h.client.tabs({ operation: 'switch', tabId: 99 })).toMatchObject({
      error: 'task_tab_required',
    });
    expect(h.send).toHaveBeenCalledTimes(count);
    expect(await h.client.tabs({ operation: 'new', url: 'https://another.test' })).toMatchObject({
      error: 'origin_grant_required',
    });
  });
});
