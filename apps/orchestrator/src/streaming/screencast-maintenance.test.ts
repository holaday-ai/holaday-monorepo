import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { pino } from 'pino';
import { OrdinaryMaintenance, type MaintenanceRecord } from '../execution/ordinary-maintenance.js';
import { createScreencastProxy } from './screencast-proxy.js';
import { createOwnedScreencastInputBridge } from './owned-screencast-input.js';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import type { BrowserPool } from '../browser-pool/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function maintenance() {
  const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
  let record: MaintenanceRecord = { identity, mode: 'closed', needsReconciliation: false };
  const m = new OrdinaryMaintenance({
    identity,
    journal: {
      read: () => record,
      persist: (next) => {
        record = { identity, ...next };
      },
    },
    checks: {
      verifyReady: async () => {},
      stopProducers: async () => {},
      verifyRetainedQueue: async () => {},
    },
  });
  await m.resumeServing();
  return m;
}
it('tracks pending upgrade auth and rechecks maintenance before choosing a browser', async () => {
  const m = await maintenance(),
    held = deferred(),
    entered = deferred();
  const peek = vi.fn(() => null);
  const proxy = createScreencastProxy({
    pool: { peek } as unknown as BrowserPool,
    executionDrain: m,
    logger: pino({ level: 'silent' }),
    authenticateToken: async () => {
      entered.resolve();
      await held.promise;
      return 'usr_synthetic';
    },
  });
  const server = createServer();
  server.on('upgrade', proxy.handleUpgrade);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test address');
  const socket = new WebSocket(
    'ws://127.0.0.1:' + address.port + '/screencast-ws/tsk_test?token=synthetic',
  );
  socket.on('error', () => {});
  const refused = new Promise<number>((resolve) =>
    socket.on('unexpected-response', (_req, res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }),
  );
  cleanup.push(async () => {
    held.resolve();
    socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await entered.promise;
  try {
    expect(m.snapshot().counts.active).toBeGreaterThan(0);
    await m.beginMaintenance();
  } finally {
    held.resolve();
  }
  expect(await refused).toBe(503);
  expect(peek).not.toHaveBeenCalled();
  await m.waitForIdle(1000);
});
it('keeps an already-dispatched input owned but refuses later input and queued viewport', async () => {
  const m = await maintenance(),
    held = deferred(),
    entered = deferred();
  const instance = {
    taskId: 'tsk_maintenance',
    userId: 'usr_synthetic',
    status: 'ready',
  } as BrowserInstance;
  const binding = browserControlSessions.start(instance);
  const bridge = createOwnedScreencastInputBridge({
    instance,
    peek: () => instance,
    executionDrain: m,
  });
  const handle = vi.fn(async () => {
    entered.resolve();
    await held.promise;
  });
  await bridge.attach({ handle });
  binding.control.requestHuman();
  const parked = binding.control.checkpoint(async () => {});
  const token = binding.control.snapshot().lease ?? '';
  const send = () =>
    bridge.receive(
      JSON.stringify({
        type: 'input',
        controlLease: token,
        payload: { type: 'insertText', text: 'synthetic' },
      }),
    );
  const input = send();
  await entered.promise;
  try {
    expect(m.snapshot().counts.active).toBeGreaterThan(0);
    await m.beginMaintenance();
    await expect(send()).rejects.toThrow();
    await bridge.receive(
      JSON.stringify({ type: 'input', payload: { type: 'viewport', width: 800, height: 600 } }),
    );
    expect(handle).toHaveBeenCalledOnce();
  } finally {
    held.resolve();
    await input;
    binding.control.returnToAgent(token);
    await parked;
    binding.finish();
  }
  await m.waitForIdle(1000);
  expect(handle).toHaveBeenCalledOnce();
});
