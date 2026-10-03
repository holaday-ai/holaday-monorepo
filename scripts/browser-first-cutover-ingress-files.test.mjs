import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  applyCutoverFence,
  describeCutoverSite,
  restoreCutoverIngress,
} from './browser-first-cutover-fence.mjs';
import { createCutoverIngressFiles } from './browser-first-cutover-ingress-files.mjs';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const binding = {
  attempt: '11111111-1111-4111-8111-111111111111',
  inventoryDigest: 'a'.repeat(64),
};
const archive = '/var/lib/holaday-deploy/maintenance';
const generatedRoot = '/etc/nginx/holaday-maintenance';

async function fixture(t, linked = true) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'cutover-ingress-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const path = (p) => {
    assert(p.startsWith('/'));
    return root + p;
  };
  const name = linked ? 'hd-app.orangebench.tech' : 'holaday';
  const logical = `/etc/nginx/sites-available/${name}`;
  const enabled = `/etc/nginx/sites-enabled/${name}`;
  const source = linked
    ? '/opt/holaday-edge/releases/20260905035410-30748/ops/aliyun-edge/nginx-hd-app.conf'
    : logical;
  for (const p of [
    '/etc/nginx/sites-enabled',
    '/etc/nginx/sites-available',
    archive,
    source.slice(0, source.lastIndexOf('/')),
  ])
    await fs.mkdir(path(p), { recursive: true, mode: p === archive ? 0o700 : 0o755 });
  const bytes = await fs.readFile(
    new URL(`./fixtures/cutover-nginx/${name}.conf`, import.meta.url),
    'utf8',
  );
  await fs.writeFile(path(source), bytes, { mode: 0o644 });
  if (linked) await fs.symlink(path(source), path(logical));
  await fs.symlink(`../sites-available/${name}`, path(enabled));
  const stat = (p, s) =>
    Object.assign(s, {
      uid: p === source && linked ? 501 : 0,
      gid: p === source && linked ? 50 : 0,
    });
  const disk = {
    lstat: async (p) => stat(p, await fs.lstat(path(p))),
    realpath: async (p) => (await fs.realpath(path(p))).slice(root.length),
    readlink: async (p) => {
      const value = await fs.readlink(path(p));
      return value.startsWith(root) ? value.slice(root.length) : value;
    },
    mkdir: (p, o) => fs.mkdir(path(p), o),
    rename: async (a, b) => {
      const before = await fs.lstat(path(a));
      await fs.rename(path(a), path(b));
      const after = await fs.lstat(path(b));
      if (process.env.CUTOVER_TEST_DIAGNOSTIC)
        console.error(
          'rename metadata',
          Object.fromEntries(
            ['ino', 'dev', 'mode', 'size', 'mtimeMs', 'ctimeMs'].map((k) => [
              k,
              [before[k], after[k]],
            ]),
          ),
        );
    },
    symlink: (a, b) => fs.symlink(a.startsWith('/') ? path(a) : a, path(b)),
    open: async (p, flags, mode) => {
      const h = await fs.open(path(p), flags, mode);
      const original = h.stat.bind(h);
      h.stat = async () => stat(p, await original());
      return h;
    },
  };
  const file = {
    ...describeCutoverSite(bytes, linked ? 'aliyun-app-20260926' : 'vultr-20260926'),
    path: logical,
    enabledPath: enabled,
    sourcePath: source,
    sourceUid: linked ? 501 : 0,
    sourceGid: linked ? 50 : 0,
    sourceMode: 0o644,
    links: [
      { path: enabled, target: `../sites-available/${name}` },
      ...(linked ? [{ path: logical, target: source }] : []),
    ],
  };
  let receipt;
  let now = 1000;
  const dependencies = {
    fs: disk,
    platform: 'linux',
    uid: 0,
    now: () => now,
    assertJournalOwnership: async () => ({ ...binding }),
    readFenceReceipt: async () => receipt,
  };
  const input = { binding, files: [file], maintenanceEndsAtMs: 5000 };
  const start = async () => {
    const operations = await createCutoverIngressFiles(input, dependencies);
    return {
      ...operations,
      ...dependencies,
      readApprovedIngress: async () => ({ ...binding, unknownIngress: [], files: [file] }),
      persistFenceReceipt: async (r) => {
        receipt = structuredClone(r);
      },
      testNginx: async () => {},
      reloadNginx: async () => {},
      verifyOpenedIdentity: async (identity) => ({ identity, mode: 'serving' }),
      probeIngress: async () => ({
        ...binding,
        observedAtMs: now,
        existingSockets: 0,
        internalWriters: 0,
        producersRunning: 0,
        probes: file.locations
          .filter((r) => r.kind !== 'health')
          .map((r) => ({
            ...r,
            path: logical,
            noStore: true,
            status: r.kind === 'business' || receipt.stage === 'all-writers' ? 503 : 401,
          })),
      }),
    };
  };
  return {
    path,
    bytes,
    file,
    disk,
    dependencies,
    input,
    start,
    source,
    logical,
    enabled,
    receipt: () => receipt,
    setNow: (v) => {
      now = v;
    },
  };
}
const apply = (io, stage = 'orders') => applyCutoverFence({ ...binding, stage }, io);
const restore = (io) =>
  restoreCutoverIngress(
    { ...binding, identity: { candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) } },
    io,
  );

for (const linked of [true, false])
  test(`real files: ${linked ? 'UID501 linked release' : 'root source'} stays untouched through both stages and original link restoration`, async (t) => {
    const f = await fixture(t, linked);
    const before = await fs.lstat(f.path(f.source));
    const io = await f.start();
    await apply(io);
    const ordersLink = await f.disk.readlink(f.enabled);
    assert(ordersLink.startsWith(`${generatedRoot}/${binding.attempt}/`));
    assert.equal((await fs.stat(f.path(ordersLink))).mode & 0o777, 0o600);
    assert.equal(await fs.readFile(f.path(f.source), 'utf8'), f.bytes);
    assert.equal((await fs.lstat(f.path(f.source))).ino, before.ino);
    await apply(io, 'all-writers');
    assert.notEqual(await f.disk.readlink(f.enabled), ordersLink);
    await restore(io);
    assert.equal(
      await fs.readlink(f.path(f.enabled)),
      `../sites-available/${f.enabled.split('/').at(-1)}`,
    );
    assert.equal(await fs.readFile(f.path(f.source), 'utf8'), f.bytes);
    assert.equal((await fs.lstat(f.path(f.source))).ino, before.ino);
    const backup = `${archive}/ingress-${binding.attempt}/${f.enabled.split('/').at(-1)}.original`;
    assert.equal(await fs.readFile(f.path(backup), 'utf8'), f.bytes);
    assert.equal((await fs.stat(f.path(backup))).mode & 0o777, 0o600);
  });

test('missing source approval or changed link refuses without a staging directory', async (t) => {
  for (const mutation of [
    (f) => {
      f.file.sourceUid = 0;
    },
    (f) => {
      f.file.links[0].target = '/etc/nginx/sites-available/other';
    },
    (f) => {
      f.file.links.pop();
    },
    (f) => {
      f.file.enabledPath = '/etc/nginx/sites-enabled/unrelated';
    },
    (f) => {
      f.dependencies.uid = 501;
    },
    (f) => {
      f.setNow(5000);
    },
  ]) {
    const f = await fixture(t);
    mutation(f);
    await assert.rejects(f.start(), /CUTOVER_INGRESS_FILES_/);
    await assert.rejects(fs.access(f.path(generatedRoot)), { code: 'ENOENT' });
  }
});

test('source changes after backup or another owner retargets link: never overwrite their change', async (t) => {
  for (const changed of ['source', 'link']) {
    const f = await fixture(t);
    const io = await f.start();
    const backup = io.backupOriginal;
    io.backupOriginal = async (...args) => {
      const result = await backup(...args);
      if (changed === 'source') await fs.appendFile(f.path(f.source), '# changed\n');
      else {
        await fs.unlink(f.path(f.enabled));
        await fs.symlink('someone-elses-config', f.path(f.enabled));
      }
      return result;
    };
    await assert.rejects(apply(io), /CUTOVER_FENCE_/);
    assert.equal(
      await fs.readlink(f.path(f.enabled)),
      changed === 'source' ? '../sites-available/hd-app.orangebench.tech' : 'someone-elses-config',
    );
  }
});

test('generated config tampering and source drift prevent restoring an obsolete target', async (t) => {
  for (const target of ['generated', 'source']) {
    const f = await fixture(t);
    const io = await f.start();
    await apply(io);
    await apply(io, 'all-writers');
    const link = await f.disk.readlink(f.enabled);
    await fs.appendFile(f.path(target === 'source' ? f.source : link), '# drift\n');
    await assert.rejects(restore(io), /CUTOVER_FENCE_/);
    assert.equal(await f.disk.readlink(f.enabled), link);
  }
});

test('expired window or lost journal after staging cannot switch the enabled link', async (t) => {
  for (const failure of ['clock', 'journal', 'receipt']) {
    const f = await fixture(t);
    const io = await f.start();
    const persist = io.persistFenceReceipt;
    io.persistFenceReceipt = async (r) => {
      await persist(r);
      if (failure === 'clock') f.setNow(5000);
      if (failure === 'journal')
        f.dependencies.assertJournalOwnership = async () => ({
          ...binding,
          attempt: '22222222-2222-4222-8222-222222222222',
        });
      if (failure === 'receipt')
        f.dependencies.readFenceReceipt = async () => ({ ...r, phase: 'active' });
    };
    await assert.rejects(apply(io), /CUTOVER_FENCE_/);
    assert.equal(
      await fs.readlink(f.path(f.enabled)),
      '../sites-available/hd-app.orangebench.tech',
    );
  }
});

test('no independent config write without a matching persisted fence intent', async (t) => {
  const f = await fixture(t);
  const io = await f.start();
  await assert.rejects(
    io.replaceConfig(f.logical, sha(f.bytes), 'arbitrary'),
    /CUTOVER_INGRESS_FILES_/,
  );
  assert.equal(await fs.readFile(f.path(f.source), 'utf8'), f.bytes);
});

test('staged content tampered before link switch is never installed', async (t) => {
  const f = await fixture(t);
  const io = await f.start();
  const symlink = f.disk.symlink;
  f.disk.symlink = async (target, path) => {
    await symlink(target, path);
    if (path.startsWith(generatedRoot)) await fs.appendFile(f.path(target), '# tampered\n');
  };
  await assert.rejects(apply(io), /CUTOVER_FENCE_/);
  assert.equal(await fs.readlink(f.path(f.enabled)), '../sites-available/hd-app.orangebench.tech');
});

test('unsafe directory, reused attempt and backup hardlinks cannot authorize installation', async (t) => {
  for (const fault of ['writable-parent', 'reused-attempt', 'backup-hardlink']) {
    const f = await fixture(t);
    if (fault === 'writable-parent') {
      await fs.chmod(f.path('/etc/nginx/sites-enabled'), 0o777);
      await assert.rejects(f.start(), /CUTOVER_INGRESS_FILES_/);
    } else {
      const io = await f.start();
      if (fault === 'reused-attempt')
        await fs.mkdir(f.path(`${generatedRoot}/${binding.attempt}`), {
          recursive: true,
          mode: 0o700,
        });
      else {
        const backup = io.backupOriginal;
        io.backupOriginal = async (...args) => {
          const result = await backup(...args);
          await fs.link(
            f.path(`${archive}/ingress-${binding.attempt}/hd-app.orangebench.tech.original`),
            f.path('/copy-of-backup'),
          );
          return result;
        };
      }
      await assert.rejects(apply(io), /CUTOVER_FENCE_/);
    }
    assert.equal(
      await fs.readlink(f.path(f.enabled)),
      '../sites-available/hd-app.orangebench.tech',
    );
  }
});

test('changed persisted intent during staging prevents switching the original link', async (t) => {
  const f = await fixture(t);
  const io = await f.start();
  const symlink = f.disk.symlink;
  f.disk.symlink = async (...args) => {
    await symlink(...args);
    f.dependencies.readFenceReceipt = async () => ({ ...f.receipt(), phase: 'active' });
  };
  await assert.rejects(apply(io), /CUTOVER_FENCE_/);
  assert.equal(await fs.readlink(f.path(f.enabled)), '../sites-available/hd-app.orangebench.tech');
});

test('durable backup inventory preserves the original link chain and refuses tampering', async (t) => {
  const f = await fixture(t);
  const io = await f.start();
  const backup = io.backupOriginal;
  const inventoryPath = `${archive}/ingress-${binding.attempt}/inventory.json`;
  io.backupOriginal = async (...args) => {
    const result = await backup(...args);
    const record = JSON.parse(await fs.readFile(f.path(inventoryPath), 'utf8'));
    assert.equal(record.attempt, binding.attempt);
    assert.equal(record.inventoryDigest, binding.inventoryDigest);
    assert.deepEqual(record.files[0].links, [
      {
        path: '/etc/nginx/sites-enabled/hd-app.orangebench.tech',
        target: '../sites-available/hd-app.orangebench.tech',
      },
      {
        path: '/etc/nginx/sites-available/hd-app.orangebench.tech',
        target: '/opt/holaday-edge/releases/20260905035410-30748/ops/aliyun-edge/nginx-hd-app.conf',
      },
    ]);
    assert.equal(record.files[0].sourceUid, 501);
    assert.equal((await fs.stat(f.path(inventoryPath))).mode & 0o777, 0o600);
    await fs.writeFile(f.path(inventoryPath), '{}\n');
    return result;
  };
  await assert.rejects(apply(io), /CUTOVER_FENCE_/);
  assert.equal(await fs.readFile(f.path(inventoryPath), 'utf8'), '{}\n');
  assert.equal(await fs.readlink(f.path(f.enabled)), '../sites-available/hd-app.orangebench.tech');
});

test('deadline crossed while final ownership check awaits cannot switch the link', async (t) => {
  const f = await fixture(t);
  const io = await f.start();
  const readlink = f.disk.readlink;
  let temporaryReads = 0;
  f.disk.readlink = async (path) => {
    const result = await readlink(path);
    if (path.startsWith(`${generatedRoot}/`) && path.includes('/link-') && ++temporaryReads === 2)
      f.dependencies.assertJournalOwnership = async () => {
        f.setNow(5000);
        return { ...binding };
      };
    return result;
  };
  await assert.rejects(apply(io), /CUTOVER_FENCE_/);
  assert.equal(await fs.readlink(f.path(f.enabled)), '../sites-available/hd-app.orangebench.tech');
});
