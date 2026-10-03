import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { pino } from 'pino';
import { expect, it, vi } from 'vitest';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserPool } from './browser-pool.js';
import { createVncProxy } from './vnc-proxy.js';

it('rejects a controlled browser before the real VNC proxy can upgrade or forward input', async () => {
  const instance = { taskId: 'tsk_controlled', userId: 'usr_owner', status: 'ready', executor: {} };
  const binding = browserControlSessions.start(instance);
  const socket = { write: vi.fn(), destroy: vi.fn() };
  const pool = { peek: () => instance } as unknown as BrowserPool;
  const proxy = createVncProxy({
    pool,
    logger: pino({ level: 'silent' }),
    authenticateToken: async () => 'usr_owner',
  });
  proxy.handleUpgrade(
    { url: '/vnc-ws/tsk_controlled?token=test', headers: {} } as IncomingMessage,
    socket as unknown as Duplex,
    Buffer.alloc(0),
  );
  await vi.waitFor(() => expect(socket.destroy).toHaveBeenCalledOnce());
  expect(socket.write).toHaveBeenCalledWith(
    expect.stringContaining('409 controlled browser requires CDP'),
  );
  binding.finish();
});
