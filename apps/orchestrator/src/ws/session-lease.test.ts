import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WS_SUBPROTOCOL } from '@holaday/shared-types';
import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createWsServer } from './server.js';

it.each(['header', 'hello'] as const)(
  'closes a %s-authenticated WS despite a hung database check',
  async (method) => {
    let release!: (userId: string | null) => void;
    const authenticateToken = vi
      .fn<(token: string) => Promise<string | null>>()
      .mockResolvedValueOnce('usr_lease')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
    const server = createWsServer(0, { authenticateToken, sessionRevalidationIntervalMs: 25 });
    await server.ready;
    const port = (server.wss.address() as AddressInfo).port;
    const client = new WebSocket(
      `ws://127.0.0.1:${port}`,
      method === 'header' ? [WS_SUBPROTOCOL, 'jwt.lease-test'] : [WS_SUBPROTOCOL],
    );
    const closed = once(client, 'close');
    const started = Date.now();
    try {
      await once(client, 'open');
      if (method === 'hello')
        client.send(
          JSON.stringify({
            type: 'client.hello',
            token: 'lease-test',
            extensionVersion: 'web-workbench',
          }),
        );
      const [code, reason] = await closed;
      expect(code).toBe(4401);
      expect(reason.toString()).toBe('session revoked');
      expect(Date.now() - started).toBeLessThan(60_000);
      expect(authenticateToken).toHaveBeenCalledTimes(2);
    } finally {
      // Release the real owned query before drain, rather than pretending a timeout
      // cancelled the database operation itself.
      release?.('usr_lease');
      client.terminate();
      await server.close();
    }
  },
  6_000,
);
it('keeps a WS open across successful authorization renewals', async () => {
  const authenticateToken = vi.fn(async () => 'usr_lease');
  const server = createWsServer(0, { authenticateToken, sessionRevalidationIntervalMs: 25 });
  await server.ready;
  const client = new WebSocket(`ws://127.0.0.1:${(server.wss.address() as AddressInfo).port}`, [
    WS_SUBPROTOCOL,
    'jwt.lease-test',
  ]);
  try {
    await once(client, 'open');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(authenticateToken.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(client.readyState).toBe(WebSocket.OPEN);
  } finally {
    client.terminate();
    await server.close();
  }
});
