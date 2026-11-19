import {
  BrowserTaskPreparationPendingError,
  pollBrowserTaskPreparation,
  resolveBrowserLaunchTarget,
  taskTabLoadingReceiptSchema,
} from '@holaday/shared-types';
import { expect, it, vi } from 'vitest';

const preparationId = '61c56349-421b-4a44-b946-507476393185';
const browserId = '82cf0bca-b78c-4f12-af23-035421ab959c';
const source = {
  extensionClientId: 'connection',
  tabId: 42,
  expectedUrl: 'https://work.example',
  selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
  launchBrowserSessionId: browserId,
  preparationReadiness: true,
};
const nativeLoading = {
  taskTabStatus: 'loading',
  taskTabCreated: true,
  preparationId,
  sourceTabId: 42,
  sourceOrigin: 'https://work.example',
  tabId: 73,
  launchBrowserSessionId: browserId,
};
const loading = {
  preparationState: 'loading',
  extensionClientId: 'connection',
  taskTabCreated: true,
  preparationId,
  sourceTabId: 42,
  sourceOrigin: 'https://work.example',
  tabId: 73,
  launchBrowserSessionId: browserId,
};
const ready = {
  extensionClientId: 'connection',
  tabId: 73,
  expectedUrl: 'https://work.example',
  selectionId: '4488c303-9880-44d9-885e-51e13755933b',
  launchBrowserSessionId: browserId,
};
function run(prepare: ReturnType<typeof vi.fn>, overrides: Record<string, unknown> = {}) {
  return pollBrowserTaskPreparation({
    source,
    preparationId,
    prepare,
    current: async () => {},
    wait: async () => {},
    ...overrides,
  });
}

it('accepts only a created-page loading receipt without a ready selection or raw URL', () => {
  expect(taskTabLoadingReceiptSchema.safeParse(nativeLoading).success).toBe(true);
  for (const change of [
    { tabId: 42 },
    { taskTabCreated: false },
    { sourceOrigin: 'https://work.example/path?secret=opaque' },
    { selectionId: ready.selectionId },
    { url: 'https://work.example/private' },
  ])
    expect(taskTabLoadingReceiptSchema.safeParse({ ...nativeLoading, ...change }).success).toBe(
      false,
    );
  expect(
    taskTabLoadingReceiptSchema.safeParse({ ...nativeLoading, sourceOrigin: 'not a URL' }).success,
  ).toBe(false);
});
it('returns a ready target and strips UI-only fields before task creation', async () => {
  const prepare = vi.fn(async () => ({ ...ready, preparationReadiness: true }));
  const wait = vi.fn(async () => {});
  expect(await run(prepare, { wait })).toEqual(ready);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalledWith(source, preparationId);
  expect(wait).not.toHaveBeenCalled();
});
it('checks at most three times under the original target and preparation id', async () => {
  const prepare = vi
    .fn()
    .mockResolvedValueOnce(loading)
    .mockResolvedValueOnce(loading)
    .mockResolvedValueOnce(ready);
  const wait = vi.fn(async () => {});
  const onLoading = vi.fn();
  expect(await run(prepare, { wait, onLoading })).toEqual(ready);
  expect(prepare).toHaveBeenCalledTimes(3);
  for (const call of prepare.mock.calls) expect(call).toEqual([source, preparationId]);
  expect(wait.mock.calls).toEqual([[1000], [1000]]);
  expect(onLoading).toHaveBeenCalledTimes(2);
});
it('preserves a pending preparation after the fixed check limit', async () => {
  const prepare = vi.fn(async () => loading);
  const wait = vi.fn(async () => {});
  await expect(run(prepare, { wait })).rejects.toBeInstanceOf(BrowserTaskPreparationPendingError);
  expect(prepare).toHaveBeenCalledTimes(3);
  expect(wait).toHaveBeenCalledTimes(2);
});
it('never retries an unknown or rejected preparation request', async () => {
  const original = new Error('unknown preparation');
  const prepare = vi.fn(async () => {
    throw original;
  });
  const wait = vi.fn(async () => {});
  await expect(run(prepare, { wait })).rejects.toBe(original);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(wait).not.toHaveBeenCalled();
});
it.each([
  { preparationId: '61c56349-421b-4a44-b946-507476393186' },
  { sourceTabId: 43 },
  { sourceOrigin: 'https://other.example' },
  { extensionClientId: 'other-connection' },
  { launchBrowserSessionId: '82cf0bca-b78c-4f12-af23-035421ab959d' },
  { launchBrowserSessionId: undefined },
  { tabId: 42 },
])('refuses a loading receipt bound to a different source (%j)', async (change) => {
  const prepare = vi.fn(async () => ({ ...loading, ...change }));
  const wait = vi.fn(async () => {});
  await expect(run(prepare, { wait })).rejects.toThrow();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(wait).not.toHaveBeenCalled();
});
it('does not return a ready target after the account changes during its request', async () => {
  let currentAccount = true;
  const prepare = vi.fn(async () => {
    currentAccount = false;
    return ready;
  });
  await expect(
    run(prepare, {
      current: async () => {
        if (!currentAccount) throw new Error('account changed');
      },
    }),
  ).rejects.toThrow('account changed');
  expect(prepare).toHaveBeenCalledTimes(1);
});
it('does not issue another check after the account changes while waiting', async () => {
  let currentAccount = true;
  const prepare = vi.fn(async () => loading);
  await expect(
    run(prepare, {
      current: async () => {
        if (!currentAccount) throw new Error('account changed');
      },
      wait: async () => {
        currentAccount = false;
      },
    }),
  ).rejects.toThrow('account changed');
  expect(prepare).toHaveBeenCalledTimes(1);
});
it('reports an unsupported capability without retrying or returning a page handle', async () => {
  const prepare = vi.fn(async () => ({ preparationState: 'unsupported' }));
  const wait = vi.fn(async () => {});
  await expect(run(prepare, { wait })).rejects.toThrow('更新');
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(wait).not.toHaveBeenCalled();
});
it('retains the original source snapshot while a caller object changes', async () => {
  const mutable = { ...source };
  const prepare = vi
    .fn()
    .mockImplementationOnce(async () => {
      mutable.tabId = 99;
      return loading;
    })
    .mockResolvedValueOnce(ready);
  expect(await run(prepare, { source: mutable })).toEqual(ready);
  expect(prepare.mock.calls[1]).toEqual([source, preparationId]);
});
it.each([
  { extensionClientId: 'other-connection' },
  { expectedUrl: 'https://other.example' },
  { launchBrowserSessionId: '82cf0bca-b78c-4f12-af23-035421ab959d' },
  { preparationState: 'loading' },
  { preparationState: 'unknown' },
])('refuses a mismatched or ambiguous ready target (%j)', async (change) => {
  const prepare = vi.fn(async () => ({ ...ready, ...change }));
  await expect(run(prepare)).rejects.toThrow();
  expect(prepare).toHaveBeenCalledTimes(1);
});
it('does not silently bind a legacy source to an unexpected browser session', async () => {
  const { launchBrowserSessionId: _session, ...legacySource } = source;
  const prepare = vi.fn(async () => loading);
  await expect(run(prepare, { source: legacySource })).rejects.toThrow();
  expect(prepare).toHaveBeenCalledTimes(1);
});

it('restores readiness only from the original browser session connection', () => {
  const saved = {
    browserSessionId: browserId,
    tabId: 42,
    origin: source.expectedUrl,
    selectionId: source.selectionId,
    mode: 'independent' as const,
  };
  const connected = { ...source, extensionClientId: 'reconnected', launchRecoveryReady: true };
  expect(resolveBrowserLaunchTarget(saved, [connected])).toEqual({
    ...source,
    extensionClientId: 'reconnected',
  });
  expect(
    resolveBrowserLaunchTarget(saved, [
      { ...connected, preparationReadiness: undefined },
      { ...connected, extensionClientId: 'unrelated', launchBrowserSessionId: preparationId },
    ]),
  ).not.toHaveProperty('preparationReadiness');
  expect(() =>
    resolveBrowserLaunchTarget(saved, [
      connected,
      { ...connected, extensionClientId: 'ambiguous' },
    ]),
  ).toThrow();
});
