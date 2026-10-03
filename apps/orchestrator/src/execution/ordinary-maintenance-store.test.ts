import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOrdinaryMaintenanceStore } from './ordinary-maintenance-store.js';
import { OrdinaryMaintenance } from './ordinary-maintenance.js';

const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
const directories: string[] = [];
const stores: ReturnType<typeof createOrdinaryMaintenanceStore>[] = [];
function fixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'hm-')));
  directories.push(directory);
  fs.chmodSync(directory, 0o700);
  fs.writeFileSync(
    join(directory, 'state.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      candidate: identity.candidate,
      bootId: '0'.repeat(32),
      mode: 'closed',
      needsReconciliation: false,
    })}\n`,
    { mode: 0o600 },
  );
  return directory;
}
function open(directory: string, bootId = identity.bootId) {
  const store = createOrdinaryMaintenanceStore(directory, { ...identity, bootId });
  stores.push(store);
  return store;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {}
  }
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true });
});

describe('ordinary maintenance durable ownership', () => {
  it('starts closed from an explicitly provisioned clean record and writes private bytes', () => {
    const directory = fixture();
    const store = open(directory);
    expect(store.read()).toEqual({ identity, mode: 'closed', needsReconciliation: false });
    store.persist({ mode: 'serving', needsReconciliation: true });
    expect(JSON.parse(fs.readFileSync(join(directory, 'state.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
      ...identity,
      mode: 'serving',
      needsReconciliation: true,
    });
    expect(fs.statSync(join(directory, 'state.json')).mode & 0o7777).toBe(0o600);
    expect(fs.statSync(join(directory, 'writer.lock')).mode & 0o7777).toBe(0o600);
  });
  it('retains dirty evidence across a retired writer and never inherits open permission', () => {
    const directory = fixture();
    const first = open(directory);
    first.persist({ mode: 'serving', needsReconciliation: true });
    first.close();
    const restarted = open(directory, 'c'.repeat(32));
    expect(restarted.read()).toEqual({
      identity: { ...identity, bootId: 'c'.repeat(32) },
      mode: 'blocked',
      needsReconciliation: true,
    });
    expect(() => first.persist({ mode: 'closed', needsReconciliation: false })).toThrow();
    expect(
      JSON.parse(fs.readFileSync(join(directory, 'state.json'), 'utf8')).needsReconciliation,
    ).toBe(true);
  });
  it('refuses a concurrent writer without altering the current record', () => {
    const directory = fixture();
    const first = open(directory);
    const bytes = fs.readFileSync(join(directory, 'state.json'), 'utf8');
    expect(() => open(directory, 'c'.repeat(32))).toThrow('MAINTENANCE_STATE_LOCKED');
    expect(fs.readFileSync(join(directory, 'state.json'), 'utf8')).toBe(bytes);
    expect(first.read().identity).toEqual(identity);
  });
  it.each(['missing', 'corrupt', 'extra', 'duplicate', 'permissive', 'symlink', 'hardlink'])(
    'refuses %s state instead of creating a clean record',
    (kind) => {
      const directory = fixture();
      const path = join(directory, 'state.json');
      if (kind === 'missing') fs.unlinkSync(path);
      if (kind === 'corrupt') fs.writeFileSync(path, '{');
      if (kind === 'extra' || kind === 'duplicate') {
        const bytes = fs.readFileSync(path, 'utf8');
        fs.writeFileSync(
          path,
          bytes.replace('{', kind === 'extra' ? '{"verified":true,' : '{"schemaVersion":1,'),
        );
      }
      if (kind === 'permissive') fs.chmodSync(path, 0o644);
      if (kind === 'symlink') {
        fs.renameSync(path, join(directory, 'target'));
        fs.symlinkSync('target', path);
      }
      if (kind === 'hardlink') fs.linkSync(path, join(directory, 'alias'));
      expect(() => open(directory)).toThrow('MAINTENANCE_STATE_UNAVAILABLE');
    },
  );
  it('rejects an insecure directory and a directory symlink', () => {
    const directory = fixture();
    fs.chmodSync(directory, 0o755);
    expect(() => open(directory)).toThrow();
    fs.chmodSync(directory, 0o700);
    const holder = fixture();
    fs.symlinkSync(directory, join(holder, 'link'));
    expect(() => open(join(holder, 'link'))).toThrow();
  });
  it('rejects reused boot identity and malformed candidate identity', () => {
    const directory = fixture();
    const first = open(directory);
    first.close();
    expect(() => open(directory)).toThrow();
    expect(() =>
      createOrdinaryMaintenanceStore(fixture(), { ...identity, candidate: 'main' }),
    ).toThrow();
  });
  it('latches replacement or read failures and never overwrites another owner', () => {
    const directory = fixture();
    const store = open(directory);
    const foreign = fs
      .readFileSync(join(directory, 'state.json'), 'utf8')
      .replace(identity.bootId, 'd'.repeat(32));
    fs.writeFileSync(join(directory, 'state.json'), foreign);
    expect(() => store.read()).toThrow();
    expect(() => store.persist({ mode: 'closed', needsReconciliation: false })).toThrow();
    expect(fs.readFileSync(join(directory, 'state.json'), 'utf8')).toBe(foreign);
  });
  it('keeps previous durable bytes and blocks admission after atomic rename fails', async () => {
    const directory = fixture();
    const store = open(directory);
    const coordinator = new OrdinaryMaintenance({
      identity,
      journal: store,
      checks: {
        verifyReady: async () => {},
        stopProducers: async () => {},
        verifyRetainedQueue: async () => {},
      },
    });
    const bytes = fs.readFileSync(join(directory, 'state.json'), 'utf8');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('disk fault');
    });
    await expect(coordinator.resumeServing()).rejects.toThrow();
    expect(coordinator.snapshot().mode).toBe('blocked');
    expect(fs.readFileSync(join(directory, 'state.json'), 'utf8')).toBe(bytes);
    expect(() => coordinator.runRoot(async () => {})).toThrow();
  });
  it('does not remove a substituted lock at shutdown', () => {
    const directory = fixture();
    const store = open(directory);
    fs.renameSync(join(directory, 'writer.lock'), join(directory, 'old.lock'));
    fs.writeFileSync(join(directory, 'writer.lock'), 'foreign', { mode: 0o600 });
    expect(() => store.close()).toThrow();
    expect(fs.readFileSync(join(directory, 'writer.lock'), 'utf8')).toBe('foreign');
  });
});
