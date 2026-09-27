import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { describeCutoverSite } from './browser-first-cutover-fence.mjs';
import * as host from './browser-first-cutover-host.mjs';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';

const archive = '/var/lib/holaday-deploy/maintenance';
const attempt = '12345678-1234-4234-8234-123456789abc';
const identity = { candidate: 'a'.repeat(40), bootId: 'f'.repeat(32) };

// Real files, links, fence store and release journal. Mac metadata is mapped to
// root; nginx/network are synthetic here, exercised physically in the Linux fixture.
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'cutover-ingress-host-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const path of [archive, '/etc/nginx/sites-enabled', '/etc/nginx/sites-available'])
    await fs.mkdir(root + path, { recursive: true, mode: path === archive ? 0o700 : 0o755 });
  const source = '/etc/nginx/sites-available/holaday';
  const enabled = '/etc/nginx/sites-enabled/holaday';
  const bytes = await fs.readFile(
    new URL('./fixtures/cutover-nginx/holaday.conf', import.meta.url),
    'utf8',
  );
  await fs.writeFile(root + source, bytes, { mode: 0o644 });
  await fs.symlink('../sites-available/holaday', root + enabled);
  const file = {
    ...describeCutoverSite(bytes, 'vultr-20260926'),
    path: source,
    enabledPath: enabled,
    sourcePath: source,
    sourceUid: 0,
    sourceGid: 0,
    sourceMode: 0o644,
    links: [{ path: enabled, target: '../sites-available/holaday' }],
  };
  const manifest = { synthetic: 'ingress-lifecycle-only' };
  const binding = {
    attempt,
    candidate: identity.candidate,
    configDigest: 'b'.repeat(64),
    migrationDigest: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    inventoryDigest: 'd'.repeat(64),
  };
  const journal = await acquireReleaseJournal(root + archive, {
    ...binding,
    kind: 'first-cutover',
    legacyDigest: 'e'.repeat(64),
  });
  t.after(() => journal.close());
  await journal.bindManifest(manifest);
  const stat = (s) => Object.assign(s, { uid: 0, gid: 0 });
  const disk = {
    lstat: async (p) => stat(await fs.lstat(root + p)),
    realpath: async (p) => (await fs.realpath(root + p)).slice(root.length),
    readlink: async (p) => (await fs.readlink(root + p)).replace(root, ''),
    mkdir: (p, options) => fs.mkdir(root + p, options),
    rename: (a, b) => fs.rename(root + a, root + b),
    symlink: (a, b) => fs.symlink(a.startsWith('/') ? root + a : a, root + b),
    open: async (p, flags, mode) => {
      const h = await fs.open(root + p, flags, mode);
      const original = h.stat.bind(h);
      h.stat = async () => stat(await original());
      return h;
    },
  };
  const approval = { inventoryDigest: binding.inventoryDigest, unknownIngress: [], files: [file] };
  const counts = { existingSockets: 0, internalWriters: 0, producersRunning: 0 };
  const effects = [];
  let time = 1000;
  const io = {
    fs: disk,
    platform: 'linux',
    uid: 0,
    now: () => time,
    journal,
    readApprovedIngress: async () => structuredClone(approval),
    observeWriters: async () => ({
      ...counts,
      inventoryDigest: binding.inventoryDigest,
      observedAtMs: time,
    }),
    verifyOpenedIdentity: async () => ({
      identity,
      mode: 'serving',
      idle: false,
      needsReconciliation: true,
    }),
    testNginx: async () => effects.push('test'),
    reloadNginx: async () => effects.push('reload'),
    probeIngress: async (_approved, stage) => ({
      ...(await io.observeWriters()),
      probes: file.locations
        .filter((r) => r.kind !== 'health')
        .map((r) => ({
          ...r,
          path: file.path,
          status: stage === 'all-writers' || r.kind === 'business' ? 503 : 401,
          noStore: true,
        })),
    }),
  };
  const phases = [
    'prepared',
    'orders_fenced',
    'legacy_settled',
    'producers_stopped',
    'all_fenced',
    'stopped',
    'backup_verified',
    'migration_started',
    'candidate_started',
    'verified',
  ];
  let at = -1;
  const advance = async (phase) => {
    while (phases[at] !== phase) {
      at++;
      assert(at < phases.length);
      await journal.persist(phases[at], {
        candidate: identity.candidate,
        ...(at >= 9 ? { identity } : {}),
      });
      if (phases[at] === 'backup_verified')
        await journal.bindBackupReceipt({
          ...binding,
          restoredAtMs: time,
          backupDigest: '1'.repeat(64),
          databaseIdentityDigest: '2'.repeat(64),
          isolatedTargetDigest: '3'.repeat(64),
          encryptionProfileDigest: '4'.repeat(64),
          comparisonDigest: '5'.repeat(64),
          schemaDigest: '6'.repeat(64),
          businessDigest: '7'.repeat(64),
        });
      if (phases[at] === 'migration_started') await journal.bindBootstrapSeed('8'.repeat(32));
    }
  };
  return {
    io,
    root,
    enabled,
    source,
    bytes,
    binding,
    approval,
    effects,
    counts,
    advance,
    setTime: (value) => {
      time = value;
    },
    start: () =>
      host.createFirstCutoverIngressLifecycle({ binding, maintenanceEndsAtMs: 5000 }, io),
  };
}

test('owned journal drives real fence files through both stages and same-instance restoration', async (t) => {
  const f = await fixture(t);
  const ingress = await f.start();
  assert.equal(await ingress.readFenceReceipt(), undefined);
  assert.equal(await fs.readlink(f.root + f.enabled), '../sites-available/holaday');
  await f.advance('orders_fenced');
  const orders = await ingress.fenceOrders();
  assert.equal(orders.stage, 'orders');
  assert.match(await fs.readFile(f.root + f.enabled, 'utf8'), /return 503/);
  await f.advance('all_fenced');
  assert.equal((await ingress.fenceAll()).stage, 'all-writers');
  assert.equal((await ingress.verifyFence()).existingSockets, 0);
  await f.advance('verified');
  await ingress.restoreIngress(identity);
  assert.equal((await ingress.readFenceReceipt()).phase, 'restored');
  assert.equal(await fs.readlink(f.root + f.enabled), '../sites-available/holaday');
  assert.equal(await fs.readFile(f.root + f.source, 'utf8'), f.bytes);
  assert.deepEqual(f.effects, ['test', 'reload', 'test', 'reload', 'test', 'reload']);
});

test('absence of the persisted orders intent refuses before backup, file replacement or reload', async (t) => {
  const f = await fixture(t);
  const ingress = await f.start();
  await assert.rejects(ingress.fenceOrders(), /CUTOVER_INGRESS_LIFECYCLE_UNPROVEN/);
  assert.equal(await fs.readlink(f.root + f.enabled), '../sites-available/holaday');
  await assert.rejects(fs.access(`${f.root}${archive}/ingress-${attempt}`), { code: 'ENOENT' });
  assert.deepEqual(f.effects, []);
});

test('changed protected ingress approval refuses without touching original files', async (t) => {
  const f = await fixture(t);
  const ingress = await f.start();
  await f.advance('orders_fenced');
  f.approval.unknownIngress.push('new-vhost');
  await assert.rejects(ingress.fenceOrders(), /CUTOVER_INGRESS_LIFECYCLE_UNPROVEN/);
  assert.equal(await fs.readlink(f.root + f.enabled), '../sites-available/holaday');
  assert.deepEqual(f.effects, []);
});

test('lost reload acknowledgement is not replayed and installing evidence remains on disk', async (t) => {
  const f = await fixture(t);
  f.io.reloadNginx = async () => {
    f.effects.push('reload');
    throw new Error('secret command output');
  };
  const ingress = await f.start();
  await f.advance('orders_fenced');
  await assert.rejects(ingress.fenceOrders(), /CUTOVER_INGRESS_LIFECYCLE_UNPROVEN/);
  await assert.rejects(ingress.fenceOrders(), /CUTOVER_INGRESS_LIFECYCLE_UNPROVEN/);
  const receipt = JSON.parse(
    await fs.readFile(`${f.root}${archive}/${attempt}.ingress.json`, 'utf8'),
  );
  assert.equal(receipt.phase, 'installing');
  assert.deepEqual(f.effects, ['test', 'reload']);
});

test('open callback cannot substitute another boot for journal identity', async (t) => {
  const f = await fixture(t);
  const ingress = await f.start();
  await f.advance('orders_fenced');
  await ingress.fenceOrders();
  await f.advance('all_fenced');
  await ingress.fenceAll();
  await f.advance('verified');
  await assert.rejects(
    ingress.restoreIngress({ ...identity, bootId: '0'.repeat(32) }),
    /CUTOVER_INGRESS_LIFECYCLE_UNPROVEN/,
  );
  assert.equal((await ingress.readFenceReceipt()).phase, 'active');
  assert.equal(f.effects.filter((v) => v === 'reload').length, 2);
});

test('phase drift during nginx testing refuses before reload and leaves installing receipt', async (t) => {
  const f = await fixture(t);
  f.io.testNginx = async () => {
    f.effects.push('test');
    await f.advance('legacy_settled');
  };
  const ingress = await f.start();
  await f.advance('orders_fenced');
  await assert.rejects(ingress.fenceOrders(), /CUTOVER_INGRESS_LIFECYCLE_UNPROVEN/);
  assert.deepEqual(f.effects, ['test']);
  assert.equal((await ingress.readFenceReceipt()).phase, 'installing');
});

test('reentrant mutation cannot cause a second reload while the first one is in flight', async (t) => {
  const f = await fixture(t);
  let begin;
  let finish;
  const started = new Promise((resolve) => {
    begin = resolve;
  });
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  f.io.reloadNginx = async () => {
    f.effects.push('reload');
    begin();
    await gate;
  };
  const ingress = await f.start();
  await f.advance('orders_fenced');
  const pending = ingress.fenceOrders();
  await started;
  try {
    await assert.rejects(ingress.fenceOrders(), /CUTOVER_INGRESS_LIFECYCLE_UNPROVEN/);
  } finally {
    finish();
  }
  await pending;
  assert.equal((await ingress.readFenceReceipt()).phase, 'active');
  assert.deepEqual(f.effects, ['test', 'reload']);
});

test('closed candidate status cannot restore ingress despite a matching verified journal boot', async (t) => {
  const f = await fixture(t);
  f.io.verifyOpenedIdentity = async () => ({
    identity,
    mode: 'closed',
    idle: true,
    needsReconciliation: false,
  });
  const ingress = await f.start();
  await f.advance('orders_fenced');
  await ingress.fenceOrders();
  await f.advance('all_fenced');
  await ingress.fenceAll();
  await f.advance('verified');
  await assert.rejects(ingress.restoreIngress(identity), /CUTOVER_INGRESS_LIFECYCLE_UNPROVEN/);
  assert.equal((await ingress.readFenceReceipt()).phase, 'active');
  assert.equal(f.effects.filter((v) => v === 'reload').length, 2);
});

test('all-writers evidence cannot silently zero an observed surviving writer', async (t) => {
  const f = await fixture(t);
  const ingress = await f.start();
  await f.advance('orders_fenced');
  await ingress.fenceOrders();
  await f.advance('all_fenced');
  f.counts.internalWriters = 1;
  await assert.rejects(ingress.fenceAll(), /CUTOVER_INGRESS_LIFECYCLE_UNPROVEN/);
  assert.equal((await ingress.readFenceReceipt()).stage, 'all-writers');
  assert.equal((await ingress.readFenceReceipt()).phase, 'active');
  await assert.rejects(ingress.verifyFence(), /CUTOVER_INGRESS_LIFECYCLE_UNPROVEN/);
});

test('deadline expiry and a missing actual writer reader cannot start a local lifecycle', async (t) => {
  const f = await fixture(t);
  f.setTime(5000);
  await assert.rejects(f.start(), /CUTOVER_INGRESS_LIFECYCLE_UNPROVEN/);
  f.setTime(1000);
  f.io.observeWriters = undefined;
  await assert.rejects(f.start(), /CUTOVER_INGRESS_LIFECYCLE_UNPROVEN/);
  assert.deepEqual(f.effects, []);
});
