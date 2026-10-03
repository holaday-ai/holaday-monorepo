import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DrainStateStore } from './drain-state-store.js';
import { ExecutionDrain } from './execution-drain.js';

const roots: string[] = [];
const stores: DrainStateStore[] = [];
const identity = { epoch: 'a'.repeat(16), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };
function fixture(overrides = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'holaday-drain-state-')));
  roots.push(dir);
  writeFileSync(
    join(dir, 'state.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      ...identity,
      bootId: 'd'.repeat(32),
      sequence: 1,
      mode: 'closed',
      dirty: false,
      ...overrides,
    })}\n`,
    { mode: 0o600 },
  );
  return dir;
}
function acquire(dir = fixture(), drain = new ExecutionDrain()) {
  const store = new DrainStateStore(dir, identity, drain);
  stores.push(store);
  return { dir, drain, store };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.abandon();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true });
});

it('persists a dirty closed state until the real accepted operation finishes', () => {
  const drain = new ExecutionDrain();
  const { store } = acquire(fixture(), drain);
  store.prepareOpen();
  drain.open();
  store.markDirty();
  const owner = drain.admit('request');
  drain.close();
  store.checkpoint();
  expect(store.read().dirty).toBe(true);
  drain.finish(owner);
  store.checkpoint();
  expect(store.read().dirty).toBe(false);
  expect(store.release()).toBe(true);
});

it.each([{ mode: 'open' }, { dirty: true }, { mode: 'blocked' }])(
  'rejects unclosed previous boot %j',
  (state) => {
    const dir = fixture(state);
    const before = readFileSync(join(dir, 'state.json'), 'utf8');
    const drain = new ExecutionDrain();
    expect(() => acquire(dir, drain)).toThrow('DRAIN_STATE_RECOVERY_REQUIRED');
    expect(drain.snapshot().mode).toBe('blocked');
    expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(before);
  },
);

it('does not invent bootstrap evidence when there is no state file', () => {
  const dir = fixture();
  unlinkSync(join(dir, 'state.json'));
  const drain = new ExecutionDrain();
  expect(() => acquire(dir, drain)).toThrow('DRAIN_STATE_UNAVAILABLE');
  expect(existsSync(join(dir, 'state.json'))).toBe(false);
  expect(drain.snapshot().mode).toBe('blocked');
});

it.each([
  { schemaVersion: 2 },
  { sequence: -1 },
  { sequence: 1.5 },
  { bootId: 'wrong' },
  { candidate: 'wrong' },
  { dirty: 'false' },
  { extra: true },
])('rejects malformed state %j without normalizing it', (state) => {
  const drain = new ExecutionDrain();
  expect(() => acquire(fixture(state), drain)).toThrow('DRAIN_STATE_UNAVAILABLE');
  expect(drain.snapshot().mode).toBe('blocked');
});

it.each(['{', ' '.repeat(2049), '{"schemaVersion":1,"schemaVersion":1}'])(
  'rejects corrupt, excessive or ambiguous state bytes',
  (bytes) => {
    const dir = fixture();
    writeFileSync(join(dir, 'state.json'), bytes);
    expect(() => acquire(dir)).toThrow('DRAIN_STATE_UNAVAILABLE');
  },
);

it('rejects same-boot restart rather than reusing an old control identity', () => {
  expect(() => acquire(fixture({ bootId: identity.bootId }))).toThrow(
    'DRAIN_STATE_RECOVERY_REQUIRED',
  );
});

it('holds exactly one writer across competing instances', () => {
  const { dir, store } = acquire();
  const before = readFileSync(join(dir, 'state.json'), 'utf8');
  const other = new ExecutionDrain();
  expect(() => new DrainStateStore(dir, { ...identity, bootId: 'e'.repeat(32) }, other)).toThrow(
    'DRAIN_STATE_LOCKED',
  );
  expect(other.snapshot().mode).toBe('blocked');
  expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(before);
  expect(store.read().bootId).toBe(identity.bootId);
  expect(statSync(join(dir, 'writer.lock')).mode & 0o777).toBe(0o600);
  expect(store.release()).toBe(true);
  expect(store.release()).toBe(false);
  expect(existsSync(join(dir, 'writer.lock'))).toBe(false);
});

it('does not steal a leftover lock even if it describes an unavailable process', () => {
  const dir = fixture();
  writeFileSync(join(dir, 'writer.lock'), 'synthetic stale writer', { mode: 0o600 });
  expect(() => acquire(dir)).toThrow('DRAIN_STATE_LOCKED');
  expect(readFileSync(join(dir, 'writer.lock'), 'utf8')).toBe('synthetic stale writer');
});

it.each([0o644, 0o666, 0o400])('requires exact private state mode %s', (mode) => {
  const dir = fixture();
  chmodSync(join(dir, 'state.json'), mode);
  expect(() => acquire(dir)).toThrow('DRAIN_STATE_UNAVAILABLE');
});

it('rejects a writable-by-others directory before creating a writer lock', () => {
  const dir = fixture();
  chmodSync(dir, 0o777);
  expect(() => acquire(dir)).toThrow('DRAIN_STATE_UNAVAILABLE');
  expect(existsSync(join(dir, 'writer.lock'))).toBe(false);
});

it('does not follow a state symlink or change its target', () => {
  const dir = fixture();
  const outside = fixture();
  const target = join(outside, 'state.json');
  const before = readFileSync(target, 'utf8');
  unlinkSync(join(dir, 'state.json'));
  symlinkSync(target, join(dir, 'state.json'));
  expect(() => acquire(dir)).toThrow('DRAIN_STATE_UNAVAILABLE');
  expect(readFileSync(target, 'utf8')).toBe(before);
});

it('rejects multiply linked state files', () => {
  const dir = fixture();
  linkSync(join(dir, 'state.json'), join(dir, 'alias.json'));
  expect(() => acquire(dir)).toThrow('DRAIN_STATE_UNAVAILABLE');
});

it('rejects directory aliases rather than accepting a symlink-controlled root', () => {
  const dir = fixture();
  const parent = fixture();
  const alias = join(parent, 'alias');
  symlinkSync(dir, alias);
  expect(() => acquire(alias)).toThrow('DRAIN_STATE_UNAVAILABLE');
});

it('blocks on state drift without overwriting external changes', () => {
  const { dir, store, drain } = acquire();
  const modified = `${JSON.stringify({ ...store.read(), dirty: true })}\n`;
  writeFileSync(join(dir, 'state.json'), modified);
  expect(() => store.checkpoint()).toThrow('DRAIN_STATE_UNAVAILABLE');
  expect(drain.snapshot().mode).toBe('blocked');
  expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(modified);
  expect(() => store.read()).toThrow('DRAIN_STATE_UNAVAILABLE');
});

it('does not remove a replacement writer lock during cleanup', () => {
  const { dir, store, drain } = acquire();
  renameSync(join(dir, 'writer.lock'), join(dir, 'old.lock'));
  writeFileSync(join(dir, 'writer.lock'), 'replacement', { mode: 0o600 });
  expect(() => store.release()).toThrow('DRAIN_STATE_UNAVAILABLE');
  expect(drain.snapshot().mode).toBe('blocked');
  store.abandon();
  expect(readFileSync(join(dir, 'writer.lock'), 'utf8')).toBe('replacement');
});

it('rejects a replaced root and leaves its replacement untouched', () => {
  const { dir, store, drain } = acquire();
  const moved = `${dir}-moved`;
  roots.push(moved);
  renameSync(dir, moved);
  mkdirSync(dir, { mode: 0o700 });
  expect(() => store.markDirty()).toThrow('DRAIN_STATE_UNAVAILABLE');
  expect(drain.snapshot().mode).toBe('blocked');
  expect(existsSync(join(dir, 'state.json'))).toBe(false);
});

it('does not unlock unless both live ownership and persisted closed state are clean', () => {
  const { store, drain, dir } = acquire();
  store.prepareOpen();
  drain.open();
  store.markDirty();
  const owner = drain.admit('database');
  const ticket = drain.markUnknown(owner);
  drain.close();
  drain.finish(owner);
  store.checkpoint();
  expect(() => store.release()).toThrow('DRAIN_STATE_BUSY');
  drain.reconcile(ticket);
  expect(() => store.release()).toThrow('DRAIN_STATE_BUSY');
  store.checkpoint();
  expect(store.release()).toBe(true);
  expect(existsSync(join(dir, 'writer.lock'))).toBe(false);
});

it('cannot open while live work remains or opening is already prepared', () => {
  const { store, drain } = acquire();
  store.prepareOpen();
  expect(() => store.prepareOpen()).toThrow('DRAIN_STATE_BUSY');
  drain.open();
  store.markDirty();
  drain.admit('request');
  drain.close();
  store.checkpoint();
  expect(() => store.prepareOpen()).toThrow('DRAIN_STATE_BUSY');
});

it('abandonment blocks the old instance and prevents a fresh boot from treating it as clean', () => {
  const { dir, store, drain } = acquire();
  store.abandon();
  expect(drain.snapshot().mode).toBe('blocked');
  expect(existsSync(join(dir, 'writer.lock'))).toBe(true);
  expect(() => store.prepareOpen()).toThrow('DRAIN_STATE_UNAVAILABLE');
  expect(
    () => new DrainStateStore(dir, { ...identity, bootId: 'e'.repeat(32) }, new ExecutionDrain()),
  ).toThrow('DRAIN_STATE_LOCKED');
});

it('writes monotonically increasing immutable snapshots and survives a clean boot handoff', () => {
  const { store, drain, dir } = acquire();
  const first = store.read();
  expect(Object.isFrozen(first)).toBe(true);
  expect(first.sequence).toBe(2);
  store.prepareOpen();
  drain.open();
  store.markDirty();
  expect(store.read().sequence).toBe(4);
  drain.close();
  store.checkpoint();
  expect(store.read()).toMatchObject({ sequence: 5, mode: 'closed', dirty: false });
  expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))).toEqual(store.read());
  store.release();
  const next = new DrainStateStore(
    dir,
    { ...identity, bootId: 'e'.repeat(32) },
    new ExecutionDrain(),
  );
  stores.push(next);
  expect(next.read()).toMatchObject({ sequence: 6, mode: 'closed', dirty: false });
  expect(first.sequence).toBe(2);
});

it('retires the old in-memory admission gate after releasing its durable writer', () => {
  const { store, drain } = acquire();
  store.release();
  expect(() => drain.open()).toThrow('EXECUTION_DRAIN_BLOCKED');
});

it('fails closed before returning an opening receipt if atomic replacement fails', () => {
  const { store, drain, dir } = acquire();
  const before = readFileSync(join(dir, 'state.json'), 'utf8');
  vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
    throw new Error('injected rename failure');
  });
  expect(() => store.prepareOpen()).toThrow('DRAIN_STATE_UNAVAILABLE');
  expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(before);
  expect(drain.snapshot().mode).toBe('blocked');
  expect(existsSync(join(dir, 'writer.lock'))).toBe(true);
  expect(() => store.checkpoint()).toThrow('DRAIN_STATE_UNAVAILABLE');
});

it('keeps the writer fence if directory durability fails after replacing the state', () => {
  const { store, drain, dir } = acquire();
  const sync = fs.fsyncSync;
  vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
    if (fs.fstatSync(fd).isDirectory()) throw new Error('injected directory sync failure');
    sync(fd);
  });
  expect(() => store.prepareOpen()).toThrow('DRAIN_STATE_UNAVAILABLE');
  expect(drain.snapshot().mode).toBe('blocked');
  expect(existsSync(join(dir, 'writer.lock'))).toBe(true);
  expect(() => store.read()).toThrow('DRAIN_STATE_UNAVAILABLE');
});

it('does not overflow the persisted sequence into an imprecise counter', () => {
  const drain = new ExecutionDrain();
  expect(() => acquire(fixture({ sequence: Number.MAX_SAFE_INTEGER }), drain)).toThrow(
    'DRAIN_STATE_UNAVAILABLE',
  );
  expect(drain.snapshot().mode).toBe('blocked');
});

it.each(['write', 'sync'])('rejects opening when the temporary file %s fails', (phase) => {
  const { store, drain, dir } = acquire();
  const before = readFileSync(join(dir, 'state.json'), 'utf8');
  if (phase === 'write') {
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('injected file write failure');
    });
  } else {
    vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
      throw new Error('injected file sync failure');
    });
  }
  expect(() => store.prepareOpen()).toThrow('DRAIN_STATE_UNAVAILABLE');
  expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(before);
  expect(existsSync(join(dir, 'writer.lock'))).toBe(true);
  expect(() => drain.open()).toThrow('EXECUTION_DRAIN_BLOCKED');
  expect(() => store.read()).toThrow('DRAIN_STATE_UNAVAILABLE');
});

it('never acknowledges release or reopens the old gate when post-unlink sync fails', () => {
  const { store, drain, dir } = acquire();
  const before = readFileSync(join(dir, 'state.json'), 'utf8');
  vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
    throw new Error('injected release sync failure');
  });
  expect(() => store.release()).toThrow('DRAIN_STATE_UNAVAILABLE');
  expect(existsSync(join(dir, 'writer.lock'))).toBe(false);
  expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(before);
  expect(() => drain.open()).toThrow('EXECUTION_DRAIN_BLOCKED');
  expect(() => store.release()).toThrow('DRAIN_STATE_UNAVAILABLE');
});

it('a genuinely killed writer leaves a lock that the next process cannot steal', () => {
  const dir = fixture();
  const script = `import {ExecutionDrain} from './src/execution/execution-drain.ts';
    import {DrainStateStore} from './src/execution/drain-state-store.ts';
    new DrainStateStore(${JSON.stringify(dir)}, ${JSON.stringify(identity)}, new ExecutionDrain());
    process.kill(process.pid, 'SIGKILL');`;
  let killed = false;
  try {
    execFileSync(
      process.execPath,
      ['--max-old-space-size=128', '--import', 'tsx', '--input-type=module', '-e', script],
      { cwd: process.cwd(), timeout: 5000, stdio: 'pipe', env: { PATH: process.env.PATH } },
    );
  } catch (error) {
    killed = (error as { signal?: string }).signal === 'SIGKILL';
  }
  expect(killed).toBe(true);
  expect(existsSync(join(dir, 'writer.lock'))).toBe(true);
  expect(
    () => new DrainStateStore(dir, { ...identity, bootId: 'e'.repeat(32) }, new ExecutionDrain()),
  ).toThrow('DRAIN_STATE_LOCKED');
});
