import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as store from './browser-first-cutover-host.mjs';

const directory = '/var/lib/holaday-deploy/maintenance';
const binding = {
  attempt: '12345678-1234-4234-8234-123456789abc',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
};
const file = { path: '/etc/nginx/sites-available/holaday', digest: 'e'.repeat(64) };
const identity = { candidate: binding.candidate, bootId: 'f'.repeat(32) };
function receipt(stage, phase) {
  return {
    schemaVersion: 1,
    attempt: binding.attempt,
    inventoryDigest: binding.inventoryDigest,
    stage,
    phase,
    files: [
      {
        path: file.path,
        originalDigest: file.digest,
        backupDigest: file.digest,
        generatedDigest: (stage === 'orders' ? '1' : '2').repeat(64),
      },
    ],
    ...(['restoring', 'restored'].includes(phase) ? { identity } : {}),
  };
}
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-fence-store-')));
  await fs.chmod(root, 0o700);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const map = (p) => {
    assert.ok(p === directory || p.startsWith(`${directory}/`));
    return root + p.slice(directory.length);
  };
  const owned = (s) => Object.assign(s, { uid: 0 });
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    assertJournalOwnership: async () => ({ ...binding }),
    lstat: async (p) => owned(await fs.lstat(map(p))),
    realpath: async (p) => ((await fs.realpath(map(p))) === map(p) ? p : 'noncanonical'),
    rename: (from, to) => fs.rename(map(from), map(to)),
    open: async (p, ...args) => {
      const h = await fs.open(map(p), ...args);
      return {
        stat: async () => owned(await h.stat()),
        readFile: () => h.readFile(),
        writeFile: (bytes) => h.writeFile(bytes),
        sync: () => h.sync(),
        close: () => h.close(),
      };
    },
  };
  const input = { binding, files: [file], maintenanceEndsAtMs: 2000 };
  io.fs = { lstat: io.lstat, realpath: io.realpath, open: io.open, rename: io.rename };
  const create = () => store.createFirstCutoverFenceStore(input, io);
  return { root, input, io, create };
}
test('protected fence receipt records both stages and restoration durably', async (t) => {
  const f = await fixture(t);
  assert.equal(typeof store.createFirstCutoverFenceStore, 'function');
  const s = await f.create();
  assert.equal(await s.readFenceReceipt(), undefined);
  for (const [stage, phase] of [
    ['orders', 'installing'],
    ['orders', 'active'],
    ['all-writers', 'installing'],
    ['all-writers', 'active'],
    ['all-writers', 'restoring'],
    ['all-writers', 'restored'],
  ]) {
    const r = receipt(stage, phase);
    await s.persistFenceReceipt(r);
    assert.deepEqual(await s.readFenceReceipt(), r);
    const files = await fs.readdir(f.root);
    assert.equal(files.length, 1);
    const path = join(f.root, files[0]);
    assert.equal((await fs.stat(path)).mode & 0o7777, 0o600);
    assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), r);
  }
  await assert.rejects(f.create(), /CUTOVER_FENCE_RECORD_UNPROVEN/);
});
test('active without durable installing intent cannot create a receipt', async (t) => {
  const f = await fixture(t);
  const s = await f.create();
  await assert.rejects(
    s.persistFenceReceipt(receipt('orders', 'active')),
    /CUTOVER_FENCE_RECORD_UNPROVEN/,
  );
  assert.deepEqual(await fs.readdir(f.root), []);
});
test('binding, file scope, generated hashes and restoration identity cannot be substituted', async (t) => {
  const f = await fixture(t);
  const s = await f.create();
  await s.persistFenceReceipt(receipt('orders', 'installing'));
  const valid = receipt('orders', 'active');
  for (const change of [
    { attempt: '22345678-1234-4234-8234-123456789abc' },
    { inventoryDigest: '0'.repeat(64) },
    { files: [] },
    { files: [{ ...valid.files[0], generatedDigest: '3'.repeat(64) }] },
    { files: [{ ...valid.files[0], path: '/etc/nginx/sites-available/other' }] },
    { identity },
    { trusted: true },
  ])
    await assert.rejects(
      s.persistFenceReceipt({ ...valid, ...change }),
      /CUTOVER_FENCE_RECORD_UNPROVEN/,
    );
  assert.deepEqual(await s.readFenceReceipt(), receipt('orders', 'installing'));
  await s.persistFenceReceipt(valid);
  await s.persistFenceReceipt(receipt('all-writers', 'installing'));
  await s.persistFenceReceipt(receipt('all-writers', 'active'));
  const restore = receipt('all-writers', 'restoring');
  await assert.rejects(
    s.persistFenceReceipt({ ...restore, identity: { ...identity, candidate: '0'.repeat(40) } }),
    /CUTOVER_FENCE_RECORD_UNPROVEN/,
  );
  await s.persistFenceReceipt(restore);
  await assert.rejects(
    s.persistFenceReceipt({
      ...receipt('all-writers', 'restored'),
      identity: { ...identity, bootId: '0'.repeat(32) },
    }),
    /CUTOVER_FENCE_RECORD_UNPROVEN/,
  );
});
for (const mutation of ['replace', 'in-place', 'symlink', 'hardlink', 'permissions', 'missing']) {
  test(`receipt ${mutation} is not accepted as the store's last durable write`, async (t) => {
    const f = await fixture(t);
    const s = await f.create();
    const r = receipt('orders', 'installing');
    await s.persistFenceReceipt(r);
    const path = join(f.root, (await fs.readdir(f.root))[0]);
    if (mutation === 'replace') {
      await fs.rename(path, `${path}.old`);
      await fs.writeFile(path, JSON.stringify(r), { mode: 0o600 });
    }
    if (mutation === 'in-place')
      await fs.writeFile(path, JSON.stringify({ ...r, stage: 'all-writers' }));
    if (mutation === 'symlink') {
      await fs.rename(path, `${path}.old`);
      await fs.symlink(`${path}.old`, path);
    }
    if (mutation === 'hardlink') await fs.link(path, `${path}.link`);
    if (mutation === 'permissions') await fs.chmod(path, 0o644);
    if (mutation === 'missing') await fs.unlink(path);
    await assert.rejects(s.readFenceReceipt(), /CUTOVER_FENCE_RECORD_UNPROVEN/);
    await assert.rejects(
      s.persistFenceReceipt(receipt('orders', 'active')),
      /CUTOVER_FENCE_RECORD_UNPROVEN/,
    );
  });
}
test('lost lock or deadline passed during an awaited ownership check cannot publish', async (t) => {
  for (const mode of ['lock', 'deadline']) {
    const f = await fixture(t);
    const s = await f.create();
    if (mode === 'lock')
      f.io.assertJournalOwnership = async () => ({ ...binding, configDigest: '0'.repeat(64) });
    else
      f.io.assertJournalOwnership = async () => {
        f.io.now = () => 2000;
        return { ...binding };
      };
    await assert.rejects(
      s.persistFenceReceipt(receipt('orders', 'installing')),
      /CUTOVER_FENCE_RECORD_UNPROVEN/,
    );
    assert.deepEqual(await fs.readdir(f.root), []);
  }
});
