import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { requestMaintenance } from './browser-maintenance-client.mjs';
const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
const snapshot = {
  identity,
  mode: 'closed',
  needsReconciliation: false,
  counts: {
    mode: 'closed',
    active: 0,
    roots: 0,
    children: 0,
    unknown: 0,
    idle: true,
    byKind: { request: 0, execution: 0, suggestions: 0, database: 0, model: 0, scheduler: 0 },
  },
};
async function fixture(t, handler) {
  const directory = fs.mkdtempSync('/tmp/hmclient-');
  const socketPath = join(directory, 'control.sock');
  const sockets = new Set();
  let connections = 0;
  const server = net.createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    handler(socket);
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true });
  });
  return { socketPath, connections: () => connections };
}
test('sends exactly the identity-bound command and returns a validated snapshot', async (t) => {
  let received;
  const f = await fixture(t, (socket) =>
    socket.on('data', (bytes) => {
      received = JSON.parse(bytes.toString());
      socket.end(`${JSON.stringify({ ok: true, snapshot })}\n`);
    }),
  );
  assert.deepEqual(
    await requestMaintenance({ socketPath: f.socketPath, identity, op: 'wait', timeoutMs: 200 }),
    snapshot,
  );
  assert.deepEqual(received, { protocol: 1, ...identity, op: 'wait', timeoutMs: 200 });
  assert.equal(f.connections(), 1);
});
test('times out without retrying open or writing state', async (t) => {
  const f = await fixture(t, () => {});
  await assert.rejects(
    requestMaintenance({ socketPath: f.socketPath, identity, op: 'open', timeoutMs: 30 }),
    /MAINTENANCE_CLIENT_TIMEOUT/,
  );
  assert.equal(f.connections(), 1);
});
test('reports closed but dirty preparation without treating it as a clean stop receipt', async (t) => {
  const preparing = { ...snapshot, needsReconciliation: true };
  const f = await fixture(t, (socket) =>
    socket.on('data', () => socket.end(`${JSON.stringify({ ok: true, snapshot: preparing })}\n`)),
  );
  assert.deepEqual(
    await requestMaintenance({ socketPath: f.socketPath, identity, op: 'status' }),
    preparing,
  );
});
for (const [name, reply] of [
  [
    'foreign identity',
    { ok: true, snapshot: { ...snapshot, identity: { ...identity, bootId: 'c'.repeat(32) } } },
  ],
  ['incomplete', { ok: true, snapshot: { mode: 'closed' } }],
  [
    'lying idle',
    { ok: true, snapshot: { ...snapshot, counts: { ...snapshot.counts, active: 1 } } },
  ],
  ['invalid mode', { ok: true, snapshot: { ...snapshot, mode: 'open' } }],
  ['sensitive error', { ok: false, code: '/private/secret=123' }],
])
  test(`rejects ${name} response`, async (t) => {
    const f = await fixture(t, (socket) =>
      socket.on('data', () => socket.end(`${JSON.stringify(reply)}\n`)),
    );
    await assert.rejects(
      requestMaintenance({ socketPath: f.socketPath, identity, op: 'status', timeoutMs: 200 }),
      /MAINTENANCE_CLIENT_PROTOCOL/,
    );
  });
test('surfaces only stable server error codes', async (t) => {
  const f = await fixture(t, (socket) =>
    socket.on('data', () => socket.end('{"ok":false,"code":"IDENTITY_MISMATCH"}\n')),
  );
  await assert.rejects(
    requestMaintenance({ socketPath: f.socketPath, identity, op: 'status', timeoutMs: 200 }),
    /MAINTENANCE_IDENTITY_MISMATCH/,
  );
});
test('rejects oversized and incomplete frames', async (t) => {
  const f = await fixture(t, (socket) => socket.on('data', () => socket.end('x'.repeat(4097))));
  await assert.rejects(
    requestMaintenance({ socketPath: f.socketPath, identity, op: 'status', timeoutMs: 200 }),
    /MAINTENANCE_CLIENT_PROTOCOL/,
  );
});
test('rejects invalid commands before opening a connection', async (t) => {
  const f = await fixture(t, () => {});
  for (const op of ['reset', ''])
    await assert.rejects(
      requestMaintenance({ socketPath: f.socketPath, identity, op, timeoutMs: 200 }),
      /MAINTENANCE_CLIENT_INPUT/,
    );
  for (const timeoutMs of [0, -1, 1.5, Number.POSITIVE_INFINITY, 600001])
    await assert.rejects(
      requestMaintenance({ socketPath: f.socketPath, identity, op: 'wait', timeoutMs }),
      /MAINTENANCE_CLIENT_INPUT/,
    );
  assert.equal(f.connections(), 0);
});
