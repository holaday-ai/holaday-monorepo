import { WS_SUBPROTOCOL } from '@holaday/shared-types';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createWsServer, getConnectedExtensionClientIds } from './server.js';

const servers: ReturnType<typeof createWsServer>[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const server of servers.splice(0)) await server.close();
});

it('retains an immediate extension hello while header authentication is pending', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const server = createWsServer(0, {
    authenticateToken: async (token) => {
      calls++;
      if (calls === 1) await gate;
      return token === 'qa-hello-user' ? token : null;
    },
  });
  servers.push(server);
  await server.ready;
  const address = server.wss.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`, [
    WS_SUBPROTOCOL,
    'jwt.qa-hello-user',
  ]);
  sockets.push(client);
  // Observe receipt at the native server boundary so auth cannot resolve until
  // the real hello frame has arrived. No arbitrary timing delay or fake socket.
  server.wss.once('connection', (socket) => socket.once('message', () => release()));
  client.once('open', () =>
    client.send(
      JSON.stringify({
        type: 'client.hello',
        token: 'qa-hello-user',
        extensionVersion: '0.0.2',
      }),
    ),
  );
  try {
    await vi.waitFor(() => expect(getConnectedExtensionClientIds('qa-hello-user')).toHaveLength(1));
    expect(calls).toBe(2);
  } finally {
    release();
  }
});
