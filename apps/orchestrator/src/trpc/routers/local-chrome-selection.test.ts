import { USER_BROWSER_PROTOCOL } from '@holaday/shared-types';
import { afterEach, expect, it, vi } from 'vitest';
import * as capabilities from '../../config/browser-capabilities.js';
import * as ws from '../../ws/server.js';
import type { Context } from '../context.js';
import { router } from '../trpc.js';
import * as selectionRoutes from './local-chrome-selection.js';
import { assertLocalChromeSelection, localChromeTabsProcedure } from './local-chrome-selection.js';
const selection = {
  extensionClientId: 'connection',
  tabId: 42,
  expectedUrl: 'https://work.example',
  selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
};
it('requires recovery capability and explicitly opts in only behind its rollout flag', async () => {
  vi.stubEnv('BROWSER_TASK_TABS_ENABLED', 'true');
  vi.stubEnv('BROWSER_LAUNCH_RECOVERY_ENABLED', 'true');
  vi.spyOn(capabilities, 'browserCapabilities').mockReturnValue({
    viewportV2: true,
    observationV2: true,
    replayV1: false,
    routingV2: true,
  });
  vi.spyOn(ws, 'getConnectedExtensionClientIds').mockReturnValue(['connection']);
  const send = vi.spyOn(ws, 'sendExtensionToolCall').mockResolvedValueOnce({
    ok: true,
    extensionClientId: 'connection',
    result: {
      userBrowserProtocol: {
        ...USER_BROWSER_PROTOCOL,
        capabilities: [...USER_BROWSER_PROTOCOL.capabilities, 'task_tab_start'],
      },
    },
  });
  const caller = router({ prepare: selectionRoutes.localChromeTaskTabProcedure }).createCaller({
    userId: 'alice',
  } as Context);
  const launchBrowserSessionId = '82cf0bca-b78c-4f12-af23-035421ab959c';
  const input = {
    selection: { ...selection, launchBrowserSessionId },
    preparationId: '61c56349-421b-4a44-b946-507476393185',
  };
  await expect(caller.prepare(input)).rejects.toThrow('更新');
  expect(send).toHaveBeenCalledTimes(1);
  send.mockResolvedValueOnce({
    ok: true,
    extensionClientId: 'connection',
    result: {
      launchBrowserSessionId,
      userBrowserProtocol: {
        ...USER_BROWSER_PROTOCOL,
        capabilities: [
          ...USER_BROWSER_PROTOCOL.capabilities,
          'task_tab_start',
          'task_tab_recovery_v1',
          'task_launch_recovery_v1',
        ],
      },
    },
  });
  send.mockResolvedValueOnce({
    ok: true,
    extensionClientId: 'connection',
    result: {
      taskTabCreated: true,
      tabId: 73,
      selectionId: '4488c303-9880-44d9-885e-51e13755933b',
      url: 'https://work.example',
      title: '',
    },
  });
  expect(await caller.prepare(input)).toMatchObject({ tabId: 73 });
  expect(send).toHaveBeenLastCalledWith(
    'alice',
    expect.objectContaining({ args: expect.objectContaining({ recoverable: true }) }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('keeps an unanswered discovery unavailable without asserting that a timeout proves an old version', async () => {
  vi.spyOn(ws, 'getConnectedExtensionClientIds').mockReturnValue(['connection']);
  vi.spyOn(ws, 'sendExtensionToolCall').mockResolvedValue({
    ok: false,
    error: { code: 'timeout', message: 'extension tool call timed out' },
  });
  const result = await router({ tabs: localChromeTabsProcedure })
    .createCaller({ userId: 'alice' } as Context)
    .tabs();
  expect(result).toEqual({
    tabs: [],
    connected: true,
    unavailable: true,
    needsUpdate: false,
    routingV2: false,
  });
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

it('prepares an inactive task tab only on the authenticated compatible connection', async () => {
  vi.stubEnv('BROWSER_TASK_TABS_ENABLED', 'true');
  vi.spyOn(capabilities, 'browserCapabilities').mockReturnValue({
    viewportV2: true,
    observationV2: true,
    replayV1: false,
    routingV2: true,
  });
  vi.stubEnv('USER_BROWSER_ROUTING_V2', 'true');
  vi.spyOn(ws, 'getConnectedExtensionClientIds').mockReturnValue(['connection']);
  const send = vi
    .spyOn(ws, 'sendExtensionToolCall')
    .mockResolvedValueOnce({
      ok: true,
      extensionClientId: 'connection',
      result: {
        userBrowserProtocol: {
          version: 2,
          capabilitiesVersion: 1,
          capabilities: [
            'real_target',
            'revision_binding',
            'exact_origin',
            'scroll',
            'select',
            'task_tabs',
            'task_tab_start',
          ],
        },
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      extensionClientId: 'connection',
      result: {
        taskTabCreated: true,
        tabId: 73,
        selectionId: '4488c303-9880-44d9-885e-51e13755933b',
        title: 'Task page',
        url: 'https://work.example',
      },
    });
  expect(selectionRoutes.localChromeTaskTabProcedure).toBeDefined();
  const caller = router({ prepare: selectionRoutes.localChromeTaskTabProcedure }).createCaller({
    userId: 'alice',
  } as Context);
  const result = await caller.prepare({
    selection,
    preparationId: '61c56349-421b-4a44-b946-507476393185',
  });
  expect(result).toEqual({
    extensionClientId: 'connection',
    tabId: 73,
    expectedUrl: 'https://work.example',
    selectionId: '4488c303-9880-44d9-885e-51e13755933b',
    title: 'Task page',
  });
  expect(send).toHaveBeenLastCalledWith(
    'alice',
    expect.objectContaining({
      kind: 'task_tab',
      extensionClientId: 'connection',
      args: {
        target: {
          tabId: selection.tabId,
          expectedUrl: selection.expectedUrl,
          selectionId: selection.selectionId,
        },
        preparationId: '61c56349-421b-4a44-b946-507476393185',
      },
    }),
  );
});

it('keeps background task-tab preparation dark before rollout without dispatching', async () => {
  vi.stubEnv('BROWSER_TASK_TABS_ENABLED', 'false');
  const send = vi.spyOn(ws, 'sendExtensionToolCall');
  expect(selectionRoutes.localChromeTaskTabProcedure).toBeDefined();
  const caller = router({ prepare: selectionRoutes.localChromeTaskTabProcedure }).createCaller({
    userId: 'alice',
  } as Context);
  await expect(
    caller.prepare({ selection, preparationId: '61c56349-421b-4a44-b946-507476393185' }),
  ).rejects.toThrow('未开放');
  expect(send).not.toHaveBeenCalled();
});

it.each([true, false])(
  'reports launcher availability without enumerating browser pages (%s)',
  async (enabled) => {
    vi.stubEnv('BROWSER_TASK_TABS_ENABLED', String(enabled));
    vi.spyOn(capabilities, 'browserCapabilities').mockReturnValue({
      viewportV2: true,
      observationV2: true,
      replayV1: false,
      routingV2: true,
    });
    const send = vi.spyOn(ws, 'sendExtensionToolCall');
    const connections = vi.spyOn(ws, 'getConnectedExtensionClientIds');
    const caller = router({
      options: selectionRoutes.localChromeLaunchOptionsProcedure,
    }).createCaller({ userId: 'alice' } as Context);
    expect(await caller.options()).toEqual({ backgroundTaskTabs: enabled });
    expect(send).not.toHaveBeenCalled();
    expect(connections).not.toHaveBeenCalled();
  },
);

it.each(['wrong-connection', 'source-tab', 'other-origin', 'missing-marker'])(
  'rejects an invalid background preparation receipt: %s',
  async (variant) => {
    vi.stubEnv('BROWSER_TASK_TABS_ENABLED', 'true');
    vi.spyOn(capabilities, 'browserCapabilities').mockReturnValue({
      viewportV2: true,
      observationV2: true,
      replayV1: false,
      routingV2: true,
    });
    vi.spyOn(ws, 'getConnectedExtensionClientIds').mockReturnValue(['connection']);
    vi.spyOn(ws, 'sendExtensionToolCall')
      .mockResolvedValueOnce({
        ok: true,
        extensionClientId: 'connection',
        result: {
          userBrowserProtocol: {
            version: 2,
            capabilitiesVersion: 1,
            capabilities: [
              'real_target',
              'revision_binding',
              'exact_origin',
              'scroll',
              'select',
              'task_tabs',
              'task_tab_start',
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        extensionClientId: variant === 'wrong-connection' ? 'other' : 'connection',
        result: {
          taskTabCreated: variant === 'missing-marker' ? undefined : true,
          tabId: variant === 'source-tab' ? 42 : 73,
          selectionId: '4488c303-9880-44d9-885e-51e13755933b',
          url: variant === 'other-origin' ? 'https://other.example' : 'https://work.example',
          title: 'Task',
        },
      });
    const caller = router({ prepare: selectionRoutes.localChromeTaskTabProcedure }).createCaller({
      userId: 'alice',
    } as Context);
    await expect(
      caller.prepare({ selection, preparationId: '61c56349-421b-4a44-b946-507476393185' }),
    ).rejects.toThrow('未扣除额度');
  },
);

function readinessFixture(capability = true) {
  vi.stubEnv('BROWSER_TASK_TABS_ENABLED', 'true');
  vi.stubEnv('BROWSER_LAUNCH_RECOVERY_ENABLED', 'false');
  vi.spyOn(capabilities, 'browserCapabilities').mockReturnValue({
    viewportV2: true,
    observationV2: true,
    replayV1: false,
    routingV2: true,
  });
  vi.spyOn(ws, 'getConnectedExtensionClientIds').mockReturnValue(['connection']);
  const handshake = {
    ok: true as const,
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
      userBrowserProtocol: {
        ...USER_BROWSER_PROTOCOL,
        capabilities: [
          ...USER_BROWSER_PROTOCOL.capabilities,
          'task_tab_start',
          ...(capability ? ['task_tab_readiness_v1'] : []),
        ],
      },
    },
  };
  const input = {
    selection,
    preparationId: '61c56349-421b-4a44-b946-507476393185',
    reportReadiness: true,
  };
  const loading = {
    taskTabStatus: 'loading',
    taskTabCreated: true,
    preparationId: input.preparationId,
    sourceTabId: 42,
    sourceOrigin: selection.expectedUrl,
    tabId: 73,
    selectedSessionVersion: 1,
  };
  const send = vi
    .spyOn(ws, 'sendExtensionToolCall')
    .mockResolvedValueOnce(handshake)
    .mockResolvedValueOnce({ ok: true, extensionClientId: 'connection', result: loading });
  const caller = router({
    prepare: selectionRoutes.localChromeTaskTabProcedure,
    tabs: localChromeTabsProcedure,
  }).createCaller({ userId: 'alice' } as Context);
  return { caller, send, input, loading, handshake };
}
it('returns a strictly bound acknowledged loading receipt without action authority', async () => {
  const h = readinessFixture();
  expect(await h.caller.prepare(h.input)).toEqual({
    preparationState: 'loading',
    taskTabCreated: true,
    extensionClientId: 'connection',
    preparationId: h.input.preparationId,
    sourceTabId: 42,
    sourceOrigin: selection.expectedUrl,
    tabId: 73,
  });
  expect(h.send).toHaveBeenLastCalledWith(
    'alice',
    expect.objectContaining({ args: expect.objectContaining({ reportReadiness: true }) }),
  );
});
it('returns unsupported without creating a page when the new readiness capability is absent', async () => {
  const h = readinessFixture(false);
  expect(await h.caller.prepare(h.input)).toEqual({ preparationState: 'unsupported' });
  expect(h.send).toHaveBeenCalledOnce();
});
it('advertises readiness only for the actual connected extension capability', async () => {
  const h = readinessFixture();
  h.send.mockReset().mockResolvedValue(h.handshake);
  expect((await h.caller.tabs()).tabs[0]).toHaveProperty('preparationReadiness', true);
});
it.each([
  { preparationId: '61c56349-421b-4a44-b946-507476393186' },
  { sourceTabId: 41 },
  { sourceOrigin: 'https://other.example' },
  { tabId: 42 },
  { taskTabCreated: false },
  { url: 'https://work.example/private' },
  { selectionId: selection.selectionId },
  { taskTabStatus: 'unexpected' },
  { launchBrowserSessionId: '82cf0bca-b78c-4f12-af23-035421ab959c' },
])('rejects a loading receipt with mismatched or ambiguous authority (%j)', async (change) => {
  const h = readinessFixture();
  h.send
    .mockReset()
    .mockResolvedValueOnce(h.handshake)
    .mockResolvedValueOnce({
      ok: true,
      extensionClientId: 'connection',
      result: { ...h.loading, ...change },
    });
  await expect(h.caller.prepare(h.input)).rejects.toThrow();
});
it('does not accept a loading receipt from another connection or a legacy caller', async () => {
  const h = readinessFixture();
  h.send
    .mockReset()
    .mockResolvedValueOnce(h.handshake)
    .mockResolvedValueOnce({ ok: true, extensionClientId: 'other', result: h.loading });
  await expect(h.caller.prepare(h.input)).rejects.toThrow();
  h.send
    .mockReset()
    .mockResolvedValueOnce(h.handshake)
    .mockResolvedValueOnce({ ok: true, extensionClientId: 'connection', result: h.loading });
  await expect(
    h.caller.prepare({ selection, preparationId: h.input.preparationId }),
  ).rejects.toThrow();
});
