import { EventEmitter, once } from 'node:events';
import { type IncomingMessage, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { BrowserPool } from '../browser-pool/browser-pool.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { createVncProxy } from '../browser-pool/vnc-proxy.js';
import { createScreencastProxy } from '../streaming/screencast-proxy.js';

const logger = pino({ level: 'silent' });
const REVALIDATION_INTERVAL_MS = 25;

describe('browser proxy established-session revocation', () => {
  it('keeps an established screencast open when the short-lived handshake token expires but the user session remains valid', async () => {
    const instance = fakeScreencastInstance();
    const authenticateToken = vi
      .fn<(token: string) => Promise<string | null>>()
      .mockResolvedValue(instance.userId);
    const revalidateSession = vi.fn(async () => true);
    const proxy = createScreencastProxy({
      pool: fakePool(instance),
      logger,
      authenticateToken,
      revalidateSession,
      sessionRevalidationIntervalMs: REVALIDATION_INTERVAL_MS,
    });
    const server = await serveProxy(proxy.handleUpgrade);
    const client = new WebSocket(
      `ws://127.0.0.1:${portOf(server)}/screencast-ws/${instance.taskId}?token=stream-token`,
    );

    try {
      await waitForOpen(client);
      await delay(REVALIDATION_INTERVAL_MS * 2);
      expect(client.readyState).toBe(WebSocket.OPEN);
      expect(authenticateToken).toHaveBeenCalledTimes(1);
      expect(revalidateSession).toHaveBeenCalledWith({
        userId: instance.userId,
        authVersion: 0,
      });
    } finally {
      await terminateClient(client);
      await closeServer(server);
    }
  });

  it('closes an established VNC connection when its session is revoked', async () => {
    const upstream = new WebSocketServer({ port: 0 });
    await once(upstream, 'listening');
    const upstreamAddress = upstream.address() as AddressInfo;
    const instance = fakeInstance({ wsPort: upstreamAddress.port });
    const authenticateToken = vi
      .fn<(token: string) => Promise<string | null>>()
      .mockResolvedValueOnce(instance.userId)
      .mockResolvedValue(null);
    const proxy = createVncProxy({
      pool: fakePool(instance),
      logger,
      authenticateToken,
      sessionRevalidationIntervalMs: REVALIDATION_INTERVAL_MS,
    });
    const server = await serveProxy(proxy.handleUpgrade);
    const client = new WebSocket(
      `ws://127.0.0.1:${portOf(server)}/vnc-ws/${instance.taskId}?token=stream-token`,
      ['binary'],
    );
    const closed = waitForClose(client);

    try {
      await waitForOpen(client);
      await expect(closed).resolves.toEqual({ code: 4401, reason: 'session revoked' });
      expect(authenticateToken).toHaveBeenCalledTimes(2);
      expect(authenticateToken).toHaveBeenNthCalledWith(1, 'stream-token');
      expect(authenticateToken).toHaveBeenNthCalledWith(2, 'stream-token');

      const callsAfterClose = authenticateToken.mock.calls.length;
      await delay(REVALIDATION_INTERVAL_MS * 2);
      expect(authenticateToken).toHaveBeenCalledTimes(callsAfterClose);
    } finally {
      await terminateClient(client);
      await closeServer(server);
      await closeWebSocketServer(upstream);
    }
  });

  it('closes an established screencast connection when its session is revoked', async () => {
    const instance = fakeScreencastInstance();
    const authenticateToken = vi
      .fn<(token: string) => Promise<string | null>>()
      .mockResolvedValueOnce(instance.userId)
      .mockResolvedValue(null);
    const proxy = createScreencastProxy({
      pool: fakePool(instance),
      logger,
      authenticateToken,
      sessionRevalidationIntervalMs: REVALIDATION_INTERVAL_MS,
    });
    const server = await serveProxy(proxy.handleUpgrade);
    const client = new WebSocket(
      `ws://127.0.0.1:${portOf(server)}/screencast-ws/${instance.taskId}?token=stream-token`,
    );
    const closed = waitForClose(client);

    try {
      await waitForOpen(client);
      await expect(closed).resolves.toEqual({ code: 4401, reason: 'session revoked' });
      expect(authenticateToken).toHaveBeenCalledTimes(2);
      expect(authenticateToken).toHaveBeenNthCalledWith(1, 'stream-token');
      expect(authenticateToken).toHaveBeenNthCalledWith(2, 'stream-token');

      const callsAfterClose = authenticateToken.mock.calls.length;
      await delay(REVALIDATION_INTERVAL_MS * 2);
      expect(authenticateToken).toHaveBeenCalledTimes(callsAfterClose);
    } finally {
      await terminateClient(client);
      await closeServer(server);
    }
  });
});

function fakeInstance(overrides: Partial<BrowserInstance> = {}): BrowserInstance {
  return {
    taskId: 'tsk_browser_proxy_revalidation',
    userId: 'usr_browser_proxy_revalidation',
    userDataDir: '/tmp/browser-proxy-revalidation',
    executor: {} as BrowserInstance['executor'],
    xvfbPid: 0,
    bravePid: 0,
    x11vncPid: 0,
    websockifyPid: 0,
    lastActiveAt: Date.now(),
    createdAt: Date.now(),
    status: 'ready',
    index: 0,
    display: 100,
    cdpPort: 9_300,
    vncPort: 5_900,
    wsPort: 6_900,
    ...overrides,
  };
}

function fakeScreencastInstance(): BrowserInstance {
  const cdp = Object.assign(new EventEmitter(), {
    send: vi.fn(async () => ({})),
    detach: vi.fn(async () => undefined),
  });
  const page = {
    context: () => ({ newCDPSession: vi.fn(async () => cdp) }),
    url: () => 'about:blank',
  };
  return fakeInstance({
    executor: {
      getPage: vi.fn(async () => page),
    } as unknown as BrowserInstance['executor'],
  });
}

function fakePool(instance: BrowserInstance): BrowserPool {
  return {
    peek: vi.fn((taskId: string) => (taskId === instance.taskId ? instance : null)),
    peekActiveForUser: vi.fn((userId: string) => (userId === instance.userId ? instance : null)),
    touch: vi.fn(),
  } as unknown as BrowserPool;
}

async function serveProxy(
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
): Promise<Server> {
  const server = createServer();
  server.on('upgrade', handleUpgrade);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

function portOf(server: Server): number {
  return (server.address() as AddressInfo).port;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('websocket open timeout')), 1_000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('session revocation timeout')), 1_000);
    socket.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function terminateClient(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = once(socket, 'close');
  socket.terminate();
  await closed;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
