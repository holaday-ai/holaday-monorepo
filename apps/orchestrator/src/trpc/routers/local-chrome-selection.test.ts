import { afterEach, expect, it, vi } from 'vitest';
import * as ws from '../../ws/server.js';
import type { Context } from '../context.js';
import { router } from '../trpc.js';
import { assertLocalChromeSelection, localChromeTabsProcedure } from './local-chrome-selection.js';
const selection = {
  extensionClientId: 'connection',
  tabId: 42,
  expectedUrl: 'https://work.example',
  selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
};
afterEach(() => vi.restoreAllMocks());
it('keeps an unanswered discovery unavailable without asserting that a timeout proves an old version', async () => {
  vi.spyOn(ws, 'getConnectedExtensionClientIds').mockReturnValue(['connection']);
  vi.spyOn(ws, 'sendExtensionToolCall').mockResolvedValue({
    ok: false,
    error: { code: 'timeout', message: 'extension tool call timed out' },
  });
  const result = await router({ tabs: localChromeTabsProcedure })
    .createCaller({ userId: 'alice' } as Context)
    .tabs();
  expect(result).toEqual({ tabs: [], connected: true, unavailable: true, needsUpdate: false });
});
it('rejects a read-only old extension before task admission', async () => {
  vi.spyOn(ws, 'sendExtensionToolCall').mockResolvedValue({
    ok: true,
    extensionClientId: 'connection',
    result: { tabId: 42, finalUrl: selection.expectedUrl },
  });
  await expect(assertLocalChromeSelection('alice', selection)).rejects.toThrow('更新');
});
it('lists only this user connections and preserves explicit page identity', async () => {
  const discover = vi.spyOn(ws, 'getConnectedExtensionClientIds').mockReturnValue(['connection']);
  const send = vi.spyOn(ws, 'sendExtensionToolCall').mockResolvedValue({
    ok: true,
    extensionClientId: 'connection',
    result: {
      selectedSessionVersion: 1,
      tabs: [
        {
          tabId: 42,
          selectionId: selection.selectionId,
          title: 'Work',
          url: selection.expectedUrl,
        },
      ],
      truncated: false,
    },
  });
  const result = await router({ tabs: localChromeTabsProcedure })
    .createCaller({ userId: 'alice' } as Context)
    .tabs();
  expect(discover).toHaveBeenCalledWith('alice');
  expect(send).toHaveBeenCalledWith(
    'alice',
    expect.objectContaining({ extensionClientId: 'connection', kind: 'tabs' }),
  );
  expect(result.tabs).toEqual([{ ...selection, title: 'Work' }]);
});
it.each(['wrong-connection', 'wrong-tab', 'changed-page', 'offline'])(
  'rejects preflight %s before admitting a task',
  async (reason) => {
    vi.spyOn(ws, 'sendExtensionToolCall').mockResolvedValue({
      ok: reason !== 'offline',
      extensionClientId: reason === 'wrong-connection' ? 'other' : 'connection',
      result: {
        selectedSessionVersion: 1,
        tabId: reason === 'wrong-tab' ? 4 : 42,
        finalUrl: reason === 'changed-page' ? 'https://other.example' : selection.expectedUrl,
      },
    });
    await expect(assertLocalChromeSelection('alice', selection)).rejects.toThrow('未扣除额度');
  },
);
