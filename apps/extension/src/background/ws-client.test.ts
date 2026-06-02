import { HEARTBEAT_INTERVAL_MS } from '@holaday/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configMock = vi.hoisted(() => ({
  wsHealthUrl: null as string | null,
}));

vi.mock('../shared/config.js', () => ({
  ORCHESTRATOR_WS: 'wss://primary.test/ws',
  ORCHESTRATOR_WS_ENDPOINTS: ['wss://primary.test/ws', 'wss://backup.test/ws'],
  get ORCHESTRATOR_WS_HEALTH_URL() {
    return configMock.wsHealthUrl;
  },
}));

type Listener = (event?: unknown) => void;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  listeners = new Map<string, Listener[]>();

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}

  addEventListener(type: string, listener: Listener): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }

  dispatch(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const sockets: FakeWebSocket[] = [];
let nextWebSocketConstructorError: Error | null = null;
let runtimeOnSuspendListener: (() => void) | null = null;

function installGlobals(): void {
  sockets.length = 0;
  nextWebSocketConstructorError = null;
  runtimeOnSuspendListener = null;
  vi.stubGlobal(
    'WebSocket',
    class extends FakeWebSocket {
      constructor(url: string, protocols: string[]) {
        if (nextWebSocketConstructorError) {
          const err = nextWebSocketConstructorError;
          nextWebSocketConstructorError = null;
          throw err;
        }
        super(url, protocols);
        sockets.push(this);
      }
    },
  );
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
    },
    runtime: {
      getManifest: vi.fn(() => ({ version: 'test-extension' })),
      onSuspend: {
        addListener: vi.fn((listener: () => void) => {
          runtimeOnSuspendListener = listener;
        }),
      },
    },
  });
}

describe('ws-client send', () => {
  beforeEach(() => {
    vi.resetModules();
    configMock.wsHealthUrl = null;
    installGlobals();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns false when no socket is connected', async () => {
    const { send } = await import('./ws-client.js');

    expect(send({ type: 'client.pong', at: Date.now() })).toBe(false);
  });

  it('returns false instead of throwing when the socket send races closed', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { connect, getWsConnectionStatus, send } = await import('./ws-client.js');
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');
    vi.spyOn(socket, 'send').mockImplementation(() => {
      throw new Error('socket closed during send');
    });

    expect(send({ type: 'client.pong', at: Date.now() })).toBe(false);
    expect(warn).toHaveBeenCalledWith('[holaday] ws send failed', expect.any(Error));
    await expect(getWsConnectionStatus()).resolves.toMatchObject({
      connected: false,
      reconnectAttempt: 1,
      lastCloseCode: 4000,
      lastCloseReason: 'send failed',
    });
    expect(socket.closeCalls).toEqual([{ code: 4000, reason: 'send failed' }]);

    await vi.advanceTimersByTimeAsync(1_250);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.url).toBe('wss://backup.test/ws');
  });

  it('serializes client messages when the socket is open', async () => {
    const { connect, send } = await import('./ws-client.js');
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');

    expect(send({ type: 'client.pong', at: 123 })).toBe(true);
    expect(socket.sent).toEqual([JSON.stringify({ type: 'client.pong', at: 123 })]);
  });

  it('exposes websocket reconnect status for popup diagnostics', async () => {
    vi.useFakeTimers();
    const { connect, getWsConnectionStatus } = await import('./ws-client.js');
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');

    socket.readyState = FakeWebSocket.CLOSED;
    socket.dispatch('close', { code: 1006, reason: '' });

    const status = await getWsConnectionStatus();
    expect(status.connected).toBe(false);
    expect(status.reconnectAttempt).toBe(1);
    expect(status.reconnectCapped).toBe(false);
    expect(status.lastCloseCode).toBe(1006);
    expect(status.lastCloseAt).toEqual(expect.any(Number));
    expect(status.nextRetryAt).toEqual(expect.any(Number));
  });

  it('closes a stuck opening websocket so reconnect status advances', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { connect, getWsConnectionStatus } = await import('./ws-client.js');
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');
    socket.readyState = FakeWebSocket.CONNECTING;

    vi.advanceTimersByTime(12_000);

    expect(socket.closeCalls).toEqual([{ code: 4000, reason: 'open timeout' }]);
    expect(warn).toHaveBeenCalledWith(
      '[holaday] ws open timed out after 12000ms; reconnecting',
    );
    const status = await getWsConnectionStatus();
    expect(status.connected).toBe(false);
    expect(status.readyState).toBeNull();
    expect(status.reconnectAttempt).toBe(1);
    expect(status.lastCloseCode).toBe(4000);
    expect(status.lastErrorAt).toEqual(expect.any(Number));
    expect(status.lastCloseReason).toBe('open timeout');
    expect(status.nextRetryAt).toEqual(expect.any(Number));

    vi.advanceTimersByTime(1_000);

    expect(sockets).toHaveLength(2);
  });

  it('cancels stale reconnect timers after a token swap opens a new socket', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { connect, reconnect } = await import('./ws-client.js');
    connect('old-token');
    const [oldSocket] = sockets;
    if (!oldSocket) throw new Error('expected websocket');

    oldSocket.readyState = FakeWebSocket.CLOSED;
    oldSocket.dispatch('close', { code: 1006, reason: '' });
    expect(sockets).toHaveLength(1);

    reconnect('new-token');
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1_000);

    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.protocols).toEqual(['holaday.v1', 'jwt.new-token']);
  });

  it('swaps sockets when connect receives a different token', async () => {
    const { connect } = await import('./ws-client.js');
    connect('old-token');
    const [oldSocket] = sockets;
    if (!oldSocket) throw new Error('expected websocket');

    connect('new-token');

    expect(oldSocket.closeCalls).toEqual([{ code: 1000, reason: 'token swap' }]);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.protocols).toEqual(['holaday.v1', 'jwt.new-token']);
  });

  it('keeps the current socket when reconnect repeats the same token', async () => {
    const { connect, reconnect } = await import('./ws-client.js');
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');
    socket.readyState = FakeWebSocket.CONNECTING;

    reconnect('token');

    expect(socket.closeCalls).toEqual([]);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.protocols).toEqual(['holaday.v1', 'jwt.token']);
  });

  it('rotates websocket endpoints after a network reconnect failure', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { connect } = await import('./ws-client.js');
    connect('token');
    const [primarySocket] = sockets;
    if (!primarySocket) throw new Error('expected websocket');

    expect(primarySocket.url).toBe('wss://primary.test/ws');
    primarySocket.readyState = FakeWebSocket.CLOSED;
    primarySocket.dispatch('close', { code: 1006, reason: '' });
    vi.advanceTimersByTime(1_000);

    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.url).toBe('wss://backup.test/ws');
  });

  it('reconnects instead of throwing when websocket construction fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    nextWebSocketConstructorError = new Error('constructor boom');
    const { connect, getWsConnectionStatus } = await import('./ws-client.js');

    expect(() => connect('token')).not.toThrow();
    expect(sockets).toHaveLength(0);
    await expect(getWsConnectionStatus()).resolves.toMatchObject({
      connected: false,
      readyState: null,
      reconnectAttempt: 1,
      lastCloseCode: null,
      lastCloseReason: 'open failed: constructor boom',
      nextRetryAt: expect.any(Number),
    });
    expect(warn).toHaveBeenCalledWith(
      '[holaday] ws open failed',
      expect.any(Error),
    );

    vi.advanceTimersByTime(1_000);

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe('wss://backup.test/ws');
  });

  it('preflights the websocket origin before constructing a websocket', async () => {
    configMock.wsHealthUrl = 'https://primary.test/api/healthz';
    const fetch = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetch);
    const { connect, getWsConnectionStatus } = await import('./ws-client.js');

    connect('token');

    expect(sockets).toHaveLength(0);
    await vi.waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    expect(fetch).toHaveBeenCalledWith('https://primary.test/api/healthz', {
      cache: 'no-store',
      credentials: 'omit',
    });
    await expect(getWsConnectionStatus()).resolves.toMatchObject({
      readyState: FakeWebSocket.OPEN,
    });
  });

  it('backs off without constructing a websocket when the origin is unhealthy', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    configMock.wsHealthUrl = 'https://primary.test/api/healthz';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response));
    const { connect, getWsConnectionStatus } = await import('./ws-client.js');

    connect('token');
    await vi.waitFor(async () => {
      await expect(getWsConnectionStatus()).resolves.toMatchObject({
        connected: false,
        readyState: null,
        reconnectAttempt: 1,
        lastCloseCode: null,
        lastCloseReason: 'health check failed',
        nextRetryAt: expect.any(Number),
      });
    });
    expect(sockets).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);

    await vi.waitFor(async () => {
      await expect(getWsConnectionStatus()).resolves.toMatchObject({
        reconnectAttempt: 2,
      });
    });
    expect(sockets).toHaveLength(0);
  });

  it('remembers the endpoint that successfully opened', async () => {
    const { connect } = await import('./ws-client.js');
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');

    socket.dispatch('open');

    await vi.waitFor(() => {
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        'holaday.ws.preferredEndpoint': 'wss://primary.test/ws',
      });
    });
  });

  it('forgets stale preferred endpoint values that are no longer configured', async () => {
    const get = chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    get.mockImplementation(async (key: string) => {
      if (key === 'holaday.ws.preferredEndpoint') {
        return { [key]: 'wss://hd-app.orangebench.tech/ws' };
      }
      return {};
    });

    await import('./ws-client.js');

    await vi.waitFor(() => {
      expect(chrome.storage.local.remove).toHaveBeenCalledWith(
        'holaday.ws.preferredEndpoint',
      );
    });
  });

  it('treats a stuck reconnect-cap storage read as not capped', async () => {
    vi.useFakeTimers();
    const get = chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    get.mockReturnValue(
      new Promise(() => undefined) as Promise<Record<string, unknown>>,
    );
    const { isReconnectCapped } = await import('./ws-client.js');

    const pending = isReconnectCapped();
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toBe(false);
  });

  it('reports capped only after the final scheduled retry fails', async () => {
    const get = chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    get.mockImplementation(async (key: string) => {
      if (key === 'holaday.ws.reconnectAttempts') {
        return { [key]: 3 };
      }
      return {};
    });
    const { isReconnectCapped } = await import('./ws-client.js');

    await expect(isReconnectCapped()).resolves.toBe(false);

    get.mockImplementation(async (key: string) => {
      if (key === 'holaday.ws.reconnectAttempts') {
        return { [key]: 4 };
      }
      return {};
    });

    await expect(isReconnectCapped()).resolves.toBe(true);
  });

  it('ignores stale reconnect hydration after a socket opens', async () => {
    let resolveReconnectRead:
      | ((value: Record<string, unknown>) => void)
      | undefined;
    const get = chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    get.mockImplementation((key: string) => {
      if (key === 'holaday.ws.reconnectAttempts') {
        return new Promise<Record<string, unknown>>((resolve) => {
          resolveReconnectRead = resolve;
        });
      }
      return Promise.resolve({});
    });

    const { connect, getWsConnectionStatus } = await import('./ws-client.js');
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');
    socket.dispatch('open');

    resolveReconnectRead?.({ 'holaday.ws.reconnectAttempts': 3 });
    await vi.waitFor(() => {
      expect(chrome.storage.local.remove).toHaveBeenCalledWith(
        'holaday.ws.reconnectAttempts',
      );
    });

    await expect(getWsConnectionStatus()).resolves.toMatchObject({
      connected: true,
      reconnectAttempt: 0,
    });
  });

  it('ignores late error events from a stale socket after token swap', async () => {
    const { connect, reconnect, getWsConnectionStatus } = await import('./ws-client.js');
    connect('old-token');
    const [oldSocket] = sockets;
    if (!oldSocket) throw new Error('expected websocket');

    reconnect('new-token');
    oldSocket.dispatch('error');

    await expect(getWsConnectionStatus()).resolves.toMatchObject({
      lastErrorAt: null,
    });
  });

  it('records a network error reason before the close event arrives', async () => {
    const { connect, getWsConnectionStatus } = await import('./ws-client.js');
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');

    socket.dispatch('error');

    await expect(getWsConnectionStatus()).resolves.toMatchObject({
      connected: true,
      lastErrorAt: expect.any(Number),
      lastCloseReason: 'network error',
    });
  });

  it('keeps the network error reason when close has no reason', async () => {
    vi.useFakeTimers();
    const { connect, getWsConnectionStatus } = await import('./ws-client.js');
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');

    socket.readyState = FakeWebSocket.CLOSED;
    socket.dispatch('error');
    socket.dispatch('close', { code: 1006, reason: '' });

    await expect(getWsConnectionStatus()).resolves.toMatchObject({
      connected: false,
      lastCloseCode: 1006,
      lastCloseReason: 'network error',
    });
  });

  it('clears the ping timer when disconnecting before a fast reconnect', async () => {
    vi.useFakeTimers();
    const { connect, disconnect } = await import('./ws-client.js');
    connect('old-token');
    const [oldSocket] = sockets;
    if (!oldSocket) throw new Error('expected websocket');
    oldSocket.dispatch('open');

    disconnect();
    connect('new-token');
    const newSocket = sockets[1];
    if (!newSocket) throw new Error('expected second websocket');
    newSocket.dispatch('open');

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

    expect(oldSocket.sent).toHaveLength(1); // only client.hello before disconnect
    expect(newSocket.sent).toHaveLength(2); // client.hello + one pong
  });

  it('closes the websocket cleanly when Chrome suspends the service worker', async () => {
    const { connect, getWsConnectionStatus, send } = await import('./ws-client.js');
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');

    runtimeOnSuspendListener?.();

    expect(socket.closeCalls).toEqual([{ code: 1000, reason: 'client requested disconnect' }]);
    expect(send({ type: 'client.pong', at: Date.now() })).toBe(false);
    await expect(getWsConnectionStatus()).resolves.toMatchObject({
      connected: false,
      readyState: null,
      reconnectAttempt: 0,
      nextRetryAt: null,
    });
  });

  it('does not throw when disconnect races an already-closing socket', async () => {
    const { connect, disconnect, send } = await import('./ws-client.js');
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');
    vi.spyOn(socket, 'close').mockImplementation(() => {
      throw new Error('already closing');
    });

    expect(() => disconnect()).not.toThrow();
    expect(send({ type: 'client.pong', at: 123 })).toBe(false);
  });

  it('keeps dispatching server messages when one listener throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { connect, onServerMessage } = await import('./ws-client.js');
    const received: string[] = [];
    onServerMessage(() => {
      throw new Error('listener exploded');
    });
    onServerMessage((msg) => {
      received.push(msg.type);
    });
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');

    socket.dispatch('message', {
      data: JSON.stringify({
        type: 'server.welcome',
        clientId: 'client-1',
        heartbeatMs: 30_000,
      }),
    });

    expect(received).toEqual(['server.welcome']);
    expect(warn).toHaveBeenCalledWith(
      '[holaday] server message listener failed',
      expect.any(Error),
    );
  });

  it('keeps dispatching unauthorized callbacks when one listener throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { connect, onUnauthorized } = await import('./ws-client.js');
    let cleanupCalls = 0;
    onUnauthorized(() => {
      throw new Error('auth cleanup exploded');
    });
    onUnauthorized(() => {
      cleanupCalls += 1;
    });
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');

    socket.dispatch('message', {
      data: JSON.stringify({
        type: 'server.error',
        code: 'UNAUTHORIZED',
        message: 'bad token',
      }),
    });

    expect(cleanupCalls).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      '[holaday] unauthorized listener failed',
      expect.any(Error),
    );
  });

  it('does not reconnect after an unauthorized frame followed by a generic close', async () => {
    vi.useFakeTimers();
    const { connect, onUnauthorized, getWsConnectionStatus } = await import('./ws-client.js');
    let cleanupCalls = 0;
    onUnauthorized(() => {
      cleanupCalls += 1;
    });
    connect('stale-token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');

    socket.dispatch('message', {
      data: JSON.stringify({
        type: 'server.error',
        code: 'UNAUTHORIZED',
        message: 'bad token',
      }),
    });
    socket.readyState = FakeWebSocket.CLOSED;
    socket.dispatch('close', { code: 1008, reason: 'policy violation' });

    expect(cleanupCalls).toBe(1);
    await expect(getWsConnectionStatus()).resolves.toMatchObject({
      connected: false,
      reconnectAttempt: 0,
      nextRetryAt: null,
      lastCloseCode: 1008,
    });
    vi.advanceTimersByTime(5_000);
    expect(sockets).toHaveLength(1);
  });
});
