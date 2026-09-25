import fs from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { startOrdinaryMaintenanceControl } from './ordinary-maintenance-control.js';
import { createOrdinaryMaintenanceStore } from './ordinary-maintenance-store.js';
import { type MaintenanceSnapshot, OrdinaryMaintenance } from './ordinary-maintenance.js';

const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
const cleanups: (() => Promise<void>)[] = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(verifyReady: () => Promise<void> = async () => {}) {
  const directory = fs.mkdtempSync('/tmp/hmc-');
  const root = fs.realpathSync(directory);
  fs.chmodSync(root, 0o700);
  fs.writeFileSync(
    join(root, 'state.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      candidate: identity.candidate,
      bootId: '0'.repeat(32),
      mode: 'closed',
      needsReconciliation: false,
    })}\n`,
    { mode: 0o600 },
  );
  const store = createOrdinaryMaintenanceStore(root, identity);
  const coordinator = new OrdinaryMaintenance({
    identity,
    journal: store,
    checks: { verifyReady, stopProducers: async () => {}, verifyRetainedQueue: async () => {} },
  });
  const control = await startOrdinaryMaintenanceControl({ directory: root, coordinator });
  cleanups.push(async () => {
    await control.close().catch(() => {});
    try {
      store.close();
    } catch {}
    fs.rmSync(directory, { recursive: true });
  });
  return { directory: root, coordinator, control, path: join(root, 'control.sock') };
}
function exchange(
  path: string,
  bytes: string,
  end = false,
): Promise<{ ok: boolean; code?: string; snapshot: MaintenanceSnapshot }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('test deadline'));
    }, 6500);
    let reply = '';
    socket.on('error', reject);
    socket.on('connect', () => {
      if (end) socket.end(bytes);
      else socket.write(bytes);
    });
    socket.on('data', (data) => {
      reply += data.toString();
    });
    socket.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(reply));
      } catch {
        reject(new Error('no reply'));
      }
    });
  });
}
function command(op: string, extra = {}) {
  return `${JSON.stringify({ protocol: 1, ...identity, op, ...extra })}\n`;
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('uses a private socket and completes open-close-wait without removing the state on shutdown', async () => {
  const f = await fixture();
  expect(fs.statSync(f.path).mode & 0o7777).toBe(0o600);
  expect((await exchange(f.path, command('open'))).snapshot.mode).toBe('serving');
  expect((await exchange(f.path, command('close'))).snapshot.mode).toBe('draining');
  expect((await exchange(f.path, command('wait', { timeoutMs: 1000 }))).snapshot.mode).toBe(
    'closed',
  );
  await f.control.close();
  expect(fs.existsSync(f.path)).toBe(false);
  expect(fs.existsSync(join(f.directory, 'state.json'))).toBe(true);
});
it.each([
  ['old boot', command('open', { bootId: 'c'.repeat(32) }), 'IDENTITY_MISMATCH'],
  ['wrong sha', command('open', { candidate: 'd'.repeat(40) }), 'IDENTITY_MISMATCH'],
  ['extra proof', command('open', { verified: true }), 'INVALID_COMMAND'],
  ['invalid wait', command('wait', { timeoutMs: 0 }), 'INVALID_COMMAND'],
  ['protocol', command('open', { protocol: 2 }), 'INVALID_COMMAND'],
  ['unknown op', command('reset'), 'INVALID_COMMAND'],
  ['truncated', '{', 'INVALID_COMMAND'],
  ['oversize', `${'x'.repeat(4096)}\n`, 'INVALID_COMMAND'],
  ['two frames', command('open') + command('open'), 'INVALID_COMMAND'],
])('rejects %s without admission or work count changes', async (_name, bytes, code) => {
  const f = await fixture();
  const before = f.coordinator.snapshot();
  expect(await exchange(f.path, bytes, true)).toEqual({ ok: false, code });
  expect(f.coordinator.snapshot()).toEqual(before);
});
it('bounds slow frame receipt independently of activity', async () => {
  const f = await fixture();
  expect(await exchange(f.path, '{')).toEqual({ ok: false, code: 'READ_TIMEOUT' });
  expect(f.coordinator.snapshot().mode).toBe('closed');
}, 8000);
it('close overtakes an in-progress readiness check', async () => {
  const entered = deferred();
  const ready = deferred();
  const f = await fixture(async () => {
    entered.resolve();
    await ready.promise;
  });
  const opening = exchange(f.path, command('open'));
  await entered.promise;
  const closing = await exchange(f.path, command('close'));
  expect(closing.snapshot.mode).toBe('draining');
  ready.resolve();
  expect(await opening).toEqual({ ok: false, code: 'COMMAND_REJECTED' });
  expect(f.coordinator.snapshot().mode).toBe('draining');
});
it('a disconnected open request cannot later admit work', async () => {
  const entered = deferred();
  const ready = deferred();
  const f = await fixture(async () => {
    entered.resolve();
    await ready.promise;
  });
  const socket = net.createConnection(f.path);
  socket.on('error', () => {});
  socket.on('connect', () => socket.write(command('open')));
  await entered.promise;
  socket.destroy();
  // Observe the server-side disconnect barrier, rather than only the client close.
  for (let n = 0; n < 100 && f.coordinator.snapshot().mode === 'closed'; n++)
    await new Promise((r) => setTimeout(r, 5));
  expect(f.coordinator.snapshot().mode).toBe('draining');
  ready.resolve();
  await exchange(f.path, command('status'));
  expect(f.coordinator.snapshot().mode).not.toBe('serving');
});
it('does not leak readiness errors to the client', async () => {
  const f = await fixture(async () => {
    throw new Error('/secret/token=123');
  });
  expect(await exchange(f.path, command('open'))).toEqual({ ok: false, code: 'COMMAND_REJECTED' });
});
it('refuses an existing socket path and leaves its bytes alone', async () => {
  const f = await fixture();
  await expect(
    startOrdinaryMaintenanceControl({ directory: f.directory, coordinator: f.coordinator }),
  ).rejects.toThrow();
  expect(fs.statSync(f.path).isSocket()).toBe(true);
});
