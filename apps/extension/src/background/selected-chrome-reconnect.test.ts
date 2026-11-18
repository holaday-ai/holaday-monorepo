import { USER_BROWSER_PROTOCOL } from '@holaday/shared-types';
import { afterEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ driver: {} as Record<string, unknown> }));
vi.mock('@holaday/browser-driver/crx', () => ({
  PlaywrightCrxAdapter: class {
    constructor() {
      Object.assign(this, native.driver);
    }
  },
}));
vi.mock('../shared/config.js', () => ({
  ORCHESTRATOR_WS: 'wss://local.test/ws',
  ORCHESTRATOR_WS_ENDPOINTS: ['wss://local.test/ws'],
  getOrchestratorWsHealthUrl: () => null,
}));

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('refuses an admitted bound action after natural same-bearer reconnect before welcome', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 1;
    listeners = new Map<string, Array<(event: unknown) => void>>();
    constructor() {
      sockets.push(this);
    }
    addEventListener(name: string, listener: (event: unknown) => void) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
    }
    dispatch(name: string, event: unknown) {
      for (const listener of this.listeners.get(name) ?? []) listener(event);
    }
    send() {}
    close() {
      this.readyState = 3;
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  const url = 'https://work.example/task';
  vi.stubGlobal('chrome', {
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    runtime: { getManifest: () => ({ version: 'test' }), onSuspend: { addListener() {} } },
    tabs: {
      query: async () => [{ id: 42, url, title: 'Draft', active: false }],
      get: async () => ({ id: 42, url }),
    },
    scripting: {
      executeScript: async () => [{ result: { url, title: 'Draft', bodyText: 'Draft' } }],
    },
  });
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let effects = 0;
  native.driver = {
    attachExistingTab: async () => ({ status: 'ok', data: { tabId: 42 } }),
    describeTarget: async () => ({ status: 'error' }),
    observeCurrentPage: async () => ({
      status: 'ok',
      data: {
        tabId: 42,
        origin: 'https://work.example',
        title: 'Draft',
        bodyText: 'Draft',
        ariaSnapshot: '',
        truncated: false,
        observationRevision: 1,
      },
    }),
    execute: async () => ({ status: 'ok' }),
    executeBound: async (_action: unknown, _binding: unknown, allowed: () => boolean) => {
      entered();
      await blocked;
      if (!allowed()) return { status: 'error', error: { code: 'session_unavailable' } };
      effects++;
      return { status: 'ok' };
    },
    dispose: async () => {},
  };
  const ws = await import('./ws-client.js');
  const { createSelectedChromeBridge } = await import('./selected-chrome-bridge.js');
  const { listReadableTabs } = await import('./selected-tab-read.js');
  ws.connect('same-bearer');
  sockets[0]!.dispatch('message', {
    data: JSON.stringify({
      type: 'server.welcome',
      clientId: 'client-a',
      userId: 'user-a',
      heartbeatMs: 30_000,
    }),
  });
  const tab = (await listReadableTabs()).tabs[0]!;
  const bridge = createSelectedChromeBridge();
  const opened = await bridge.open(
    'task-a',
    {
      tabId: tab.tabId,
      selectionId: tab.selectionId,
      expectedUrl: tab.url,
    },
    {
      protocol: { ...USER_BROWSER_PROTOCOL, capabilities: [...USER_BROWSER_PROTOCOL.capabilities] },
      grantedOrigins: ['https://work.example'],
    },
  );
  if (!opened.ok) throw new Error(JSON.stringify(opened));
  const pending = bridge.execute(
    'task-a',
    opened.sessionId,
    { kind: 'key', payload: { key: 'Enter' } },
    { token: crypto.randomUUID(), observationRevision: 1 },
  );
  await started;
  try {
    sockets[0]!.readyState = 3;
    sockets[0]!.dispatch('close', { code: 1006, reason: 'network loss' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);
    expect(ws.getCurrentWsToken()).toBe('same-bearer');
    release();
    const result = await pending;
    expect(effects).toBe(0);
    expect(result).toMatchObject({ ok: false, actionOutcome: 'not_applied' });
  } finally {
    release();
    await bridge.stopTask('task-a');
    ws.disconnect();
  }
});
