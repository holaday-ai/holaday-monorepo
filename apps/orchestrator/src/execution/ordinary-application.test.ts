import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createOrdinaryApplication } from './ordinary-application.js';

const directories: string[] = [];
const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
function fixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'hm-app-')));
  directories.push(directory);
  fs.chmodSync(directory, 0o700);
  fs.writeFileSync(
    join(directory, 'state.json'),
    `${JSON.stringify({ schemaVersion: 1, ...identity, bootId: '0'.repeat(32), mode: 'closed', needsReconciliation: false })}\n`,
    { mode: 0o600 },
  );
  const ready = vi.fn(async () => {});
  const app = createOrdinaryApplication({ directory, identity, verifyReady: ready });
  const hooks = {
    prepareServing: vi.fn(async () => {}),
    startProducers: vi.fn(),
    stopProducers: vi.fn(async () => {}),
    verifyRetainedQueue: vi.fn(async () => {}),
  };
  return { app, directory, ready, hooks };
}
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true });
});
it('cannot open before application binding, and invokes actual server readiness on every open', async () => {
  const f = fixture();
  await expect(f.app.coordinator.resumeServing()).rejects.toThrow(
    'MAINTENANCE_APPLICATION_UNBOUND',
  );
  expect(f.ready).not.toHaveBeenCalled();
  f.app.bind(f.hooks);
  await f.app.coordinator.resumeServing();
  expect(f.ready).toHaveBeenCalledWith(identity);
  expect(f.hooks.prepareServing).toHaveBeenCalledOnce();
  expect(f.hooks.startProducers).toHaveBeenCalledOnce();
  await f.app.closeControl();
  await f.app.coordinator.retire(async () => {});
  f.app.closeState();
  expect(fs.existsSync(join(f.directory, 'writer.lock'))).toBe(false);
});
it('refuses to retire durable ownership while admission or resources are not clean', async () => {
  const f = fixture();
  f.app.bind(f.hooks);
  await f.app.coordinator.resumeServing();
  expect(() => f.app.closeState()).toThrow();
  expect(fs.existsSync(join(f.directory, 'writer.lock'))).toBe(true);
  await f.app.closeControl();
  await f.app.coordinator.retire(async () => {});
  f.app.closeState();
});
it('never constructs a local control listener without the application hooks', async () => {
  const f = fixture();
  await expect(f.app.startControl()).rejects.toThrow('MAINTENANCE_APPLICATION_UNBOUND');
  expect(fs.existsSync(join(f.directory, 'control.sock'))).toBe(false);
  f.app.closeState();
});
it('binds once and closes its real control before retiring its durable writer', async () => {
  const f = fixture();
  f.app.bind(f.hooks);
  expect(() => f.app.bind(f.hooks)).toThrow();
  await f.app.startControl();
  expect(fs.existsSync(join(f.directory, 'control.sock'))).toBe(true);
  expect(() => f.app.closeState()).toThrow();
  await f.app.closeControl();
  await f.app.coordinator.retire(async () => {});
  f.app.closeState();
  expect(fs.existsSync(join(f.directory, 'control.sock'))).toBe(false);
});
