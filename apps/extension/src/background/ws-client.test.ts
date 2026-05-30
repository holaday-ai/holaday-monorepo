import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function installGlobals(): void {
  sockets.length = 0;
  vi.stubGlobal(
    'WebSocket',
    class extends FakeWebSocket {
      constructor(url: string, protocols: string[]) {
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
    },
  });
}

describe('ws-client send', () => {
  beforeEach(() => {
    vi.resetModules();
    installGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns false when no socket is connected', async () => {
    const { send } = await import('./ws-client.js');

    expect(send({ type: 'client.pong', at: Date.now() })).toBe(false);
  });

  it('returns false instead of throwing when the socket send races closed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { connect, send } = await import('./ws-client.js');
    connect('token');
    const [socket] = sockets;
    if (!socket) throw new Error('expected websocket');
    vi.spyOn(socket, 'send').mockImplementation(() => {
      throw new Error('socket closed during send');
    });

    expect(send({ type: 'client.pong', at: Date.now() })).toBe(false);
    expect(warn).toHaveBeenCalledWith('[holaday] ws send failed', expect.any(Error));
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
    expect(status.lastErrorAt).toEqual(expect.any(Number));
    expect(status.lastCloseReason).toBe('open timeout');
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
});
