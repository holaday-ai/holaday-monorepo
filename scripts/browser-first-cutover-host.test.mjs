import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readFirstCutoverApproval } from './browser-first-cutover-host.mjs';

const root = '/var/lib/holaday-deploy/maintenance';
const path = `${root}/first-cutover-approved.json`;
const approved = {
  schemaVersion: 1,
  kind: 'first-cutover',
  attempt: '12345678-1234-4234-8234-123456789abc',
  branch: 'codex/browser-release-candidate-20260925',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
  legacyDigest: 'e'.repeat(64),
  maintenanceEndsAtMs: 2000,
  reconcileByMs: 3000,
  operatorRef: 'qa-operator',
};
async function fixture(t, record = approved) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-approved-input-')));
  await fs.chmod(directory, 0o700);
  const file = join(directory, 'first-cutover-approved.json');
  const bytes = `${JSON.stringify(record)}\n`;
  await fs.writeFile(file, bytes, { mode: 0o600 });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const map = (p) => {
    assert.ok(p === root || p === path, `unexpected read ${p}`);
    return p === root ? directory : file;
  };
  // Real files exercise inode, mode, hardlink, symlink and read-race behavior.
  // Only the root UID is synthetic on macOS; no production paths are opened.
  const rootStat = (s) => Object.assign(s, { uid: 0 });
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    lstat: async (p) => rootStat(await fs.lstat(map(p))),
    realpath: async (p) => ((await fs.realpath(map(p))) === map(p) ? p : 'not-canonical'),
    open: async (p, flags) => {
      const handle = await fs.open(map(p), flags);
      return {
        stat: async () => rootStat(await handle.stat()),
        readFile: () => handle.readFile(),
        close: () => handle.close(),
      };
    },
  };
  return { io, file, directory, bytes };
}
test('reads only the protected first-cutover manifest and returns its exact content binding', async (t) => {
  const f = await fixture(t);
  const result = await readFirstCutoverApproval({ attempt: approved.attempt }, f.io);
  assert.deepEqual(result, {
    ...approved,
    approvalDigest: createHash('sha256').update(f.bytes).digest('hex'),
  });
});
test('no CLI-selected path, foreign attempt or non-root/non-Linux reader can authorize cutover', async (t) => {
  const f = await fixture(t);
  for (const [options, io] of [
    [{ attempt: approved.attempt, path: '/tmp/approved.json' }, f.io],
    [{ attempt: '22345678-1234-4234-8234-123456789abc' }, f.io],
    [{ attempt: approved.attempt }, { ...f.io, platform: 'darwin' }],
    [{ attempt: approved.attempt }, { ...f.io, uid: 998 }],
  ])
    await assert.rejects(readFirstCutoverApproval(options, io), /CUTOVER_APPROVAL_UNPROVEN/);
});
for (const kind of [
  'symlink',
  'hardlink',
  'writable',
  'public-directory',
  'wrong-owner',
  'replacement',
  'clock-rollback',
  'expired',
  'oversize',
]) {
  test(`approval rejects ${kind} rather than accepting unchecked bytes`, async (t) => {
    const f = await fixture(t);
    if (kind === 'symlink') {
      await fs.rename(f.file, `${f.file}.real`);
      await fs.symlink(`${f.file}.real`, f.file);
    }
    if (kind === 'hardlink') await fs.link(f.file, `${f.file}.link`);
    if (kind === 'writable') await fs.chmod(f.file, 0o660);
    if (kind === 'public-directory') await fs.chmod(f.directory, 0o755);
    if (kind === 'wrong-owner') {
      const stat = f.io.lstat;
      f.io.lstat = async (p) => Object.assign(await stat(p), { uid: 998 });
    }
    if (kind === 'replacement') {
      const open = f.io.open;
      f.io.open = async (...args) => {
        const handle = await open(...args);
        const read = handle.readFile;
        handle.readFile = async () => {
          const bytes = await read();
          await fs.rename(f.file, `${f.file}.old`);
          await fs.writeFile(f.file, bytes, { mode: 0o600 });
          return bytes;
        };
        return handle;
      };
    }
    if (kind === 'clock-rollback') {
      let now = 1000;
      f.io.now = () => --now;
    }
    if (kind === 'expired') f.io.now = () => 2000;
    if (kind === 'oversize') await fs.writeFile(f.file, 'x'.repeat(65537));
    await assert.rejects(
      readFirstCutoverApproval({ attempt: approved.attempt }, f.io),
      /CUTOVER_APPROVAL_UNPROVEN/,
    );
  });
}
test('malformed or extra approval fields cannot silently widen the operation', async (t) => {
  for (const change of [
    { kind: 'normal-release' },
    { candidate: 'HEAD' },
    { branch: '--all' },
    { inventoryDigest: null },
    { legacyDigest: 'unknown' },
    { reconcileByMs: 1999 },
    { operatorRef: '' },
    { skipPayments: true },
  ]) {
    const f = await fixture(t, { ...approved, ...change });
    await assert.rejects(
      readFirstCutoverApproval({ attempt: approved.attempt }, f.io),
      /CUTOVER_APPROVAL_UNPROVEN/,
    );
  }
});
