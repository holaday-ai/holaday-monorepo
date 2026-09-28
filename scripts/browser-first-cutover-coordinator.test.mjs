import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as host from './browser-first-cutover-host.mjs';

// Scope comes from the already-approved closure, independently listed here.
const modules = [
  'browser-backup-age.mjs',
  'browser-cutover-evidence.mjs',
  'browser-first-cutover-backup.mjs',
  'browser-first-cutover-fence.mjs',
  'browser-first-cutover-host.mjs',
  'browser-first-cutover-ingress-files.mjs',
  'browser-first-cutover-ingress-session.mjs',
  'browser-first-cutover-inventory.mjs',
  'browser-first-cutover-mysql.mjs',
  'browser-first-cutover-nginx.mjs',
  'browser-first-cutover-runtime.mjs',
  'browser-first-cutover-startup.mjs',
  'browser-maintenance-host.mjs',
  'browser-maintenance-journal.mjs',
  'browser-maintenance-linux.mjs',
  'browser-maintenance-manifest.mjs',
  'browser-maintenance-policy.mjs',
  'browser-maintenance-release-tail.mjs',
  'browser-maintenance-runtime-system.mjs',
  'browser-maintenance-runtime.mjs',
  'browser-maintenance-transition.mjs',
  'browser-payment-port-fence.mjs',
];
const hash = (v) => createHash('sha256').update(v).digest('hex');
const binding = {
  attempt: '12345678-1234-4234-8234-123456789abc',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
};

for (const args of [
  [],
  ['--execute', binding.attempt],
  ['--check', binding.attempt, '--pid', '910'],
]) {
  test(`direct host entry refuses incomplete or unbound request ${args.join(' ')}`, () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./browser-first-cutover-host.mjs', import.meta.url)), ...args],
      { encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /CUTOVER_COORDINATOR_(USAGE|SITE_UNAVAILABLE)/);
  });
}

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-coordinator-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = `/var/lib/holaday-deploy/first-cutover/${binding.candidate}`;
  const entry = `${folder}/browser-first-cutover-host.mjs`;
  const local = (p) => root + p;
  await fs.mkdir(local(folder), { recursive: true, mode: 0o700 });
  const files = {};
  const source = new Map();
  const policy = await fs.readFile(
    new URL('../ops/aliyun-edge/holaday-payment-ingress.nft', import.meta.url),
  );
  const policyPath =
    '/var/lib/holaday-deploy/first-cutover/ops/aliyun-edge/holaday-payment-ingress.nft';
  await fs.mkdir(local('/var/lib/holaday-deploy/first-cutover/ops'), { mode: 0o700 });
  await fs.mkdir(local('/var/lib/holaday-deploy/first-cutover/ops/aliyun-edge'), { mode: 0o700 });
  await fs.writeFile(local(policyPath), policy, { mode: 0o600 });
  for (const name of modules) {
    const bytes = Buffer.from(`// synthetic approved ${name}\n`);
    source.set(name, bytes);
    await fs.writeFile(local(`${folder}/${name}`), bytes, { mode: 0o600 });
    files[name] = hash(bytes);
  }
  await fs.writeFile(
    local(`${folder}/bundle.json`),
    JSON.stringify({ schemaVersion: 1, candidate: binding.candidate, files }),
    { mode: 0o600 },
  );
  const bootId = '11111111-1111-4111-8111-111111111111';
  await fs.mkdir(local('/proc/910'), { recursive: true });
  await fs.mkdir(local('/proc/sys/kernel/random'), { recursive: true });
  await fs.writeFile(local('/proc/sys/kernel/random/boot_id'), `${bootId}\n`);
  await fs.writeFile(
    local('/proc/910/stat'),
    `910 (node) S 900 ${Array(17).fill('0').join(' ')} 100 0\n`,
  );
  await fs.writeFile(local('/proc/910/status'), 'Uid:\t0\t0\t0\t0\n');
  await fs.writeFile(
    local('/proc/910/cmdline'),
    Buffer.from(`/opt/node22/bin/node\0${entry}\0--check\0${binding.attempt}\0`),
  );
  await fs.writeFile(local('/proc/910/cgroup'), '0::/qa\n');
  const projectStat = (s) => Object.assign(s, { uid: 0 });
  const approval = { ...binding, branch: 'codex/qa', maintenanceEndsAtMs: 9000 };
  const clock = { value: 1000 };
  const events = { onRead: () => {} };
  const io = {
    platform: 'linux',
    uid: 0,
    pid: 910,
    entry,
    now: () => clock.value,
    readApproval: async () => {
      events.onRead();
      return structuredClone(approval);
    },
    fs: {
      lstat: async (p) => projectStat(await fs.lstat(local(p))),
      realpath: async (p) => (await fs.realpath(local(p))).slice(root.length),
      readdir: (p) => fs.readdir(local(p)),
      readFile: (p, ...args) => fs.readFile(local(p), ...args),
      readlink: async (p) => (p.endsWith('/exe') ? '/opt/node22/bin/node' : '/'),
      open: async (p, ...args) => {
        const h = await fs.open(local(p), ...args);
        return {
          stat: async () => projectStat(await h.stat()),
          readFile: () => h.readFile(),
          close: () => h.close(),
        };
      },
    },
    exec: async (file, args) => {
      assert.equal(file, 'git');
      assert.deepEqual(args.slice(0, 3), ['--no-replace-objects', '-C', '/opt/holaday-monorepo']);
      if (args[3] === 'merge-base') {
        assert.deepEqual(args.slice(4), [
          '--is-ancestor',
          binding.candidate,
          'refs/remotes/origin/codex/qa',
        ]);
        return '';
      }
      assert.equal(args[3], 'show');
      if (args[4] === `${binding.candidate}:ops/aliyun-edge/holaday-payment-ingress.nft`)
        return policy.toString();
      const name = args[4].slice(`${binding.candidate}:scripts/`.length);
      assert.equal(args[4], `${binding.candidate}:scripts/${name}`);
      assert(source.has(name));
      return source.get(name).toString();
    },
  };
  return { folder, entry, local, files, source, approval, io, bootId, policyPath, clock, events };
}

test('coordinator identity belongs to the fixed approved entry and actual candidate tool bytes', async (t) => {
  const f = await fixture(t);
  assert.equal(typeof host.createFirstCutoverCoordinatorIdentity, 'function');
  const reader = await host.createFirstCutoverCoordinatorIdentity(
    { attempt: binding.attempt, mode: 'check' },
    f.io,
  );
  const receipt = await reader.readExecutionIdentity();
  assert.deepEqual(receipt.binding, binding);
  assert.equal(receipt.host, 'vultr');
  assert.equal(receipt.role, 'coordinator');
  assert.equal(receipt.process.pid, 910);
  assert.equal(receipt.process.start, '100');
  assert.equal(receipt.process.ppid, 900);
  assert.equal(receipt.process.exe, '/opt/node22/bin/node');
  assert.equal(receipt.bootId, f.bootId);
  assert.match(receipt.toolDigest, /^[a-f0-9]{64}$/);
  receipt.process.start = '999';
  assert.equal((await reader.readExecutionIdentity()).process.start, '100');
  reader.close();
  await assert.rejects(reader.readExecutionIdentity(), /UNPROVEN/);
});

for (const fault of [
  'candidate-bytes',
  'missing-module',
  'writable-file',
  'wrong-entry',
  'wrong-argv',
  'non-root',
  'expiry',
  'identity-drift',
  'missing-policy',
  'changed-policy',
  'extended-window',
  'clock-regression',
  'close-during-read',
]) {
  test(`coordinator rejects ${fault} without classifying a root process`, async (t) => {
    const f = await fixture(t);
    assert.equal(typeof host.createFirstCutoverCoordinatorIdentity, 'function');
    const reader = await host.createFirstCutoverCoordinatorIdentity(
      { attempt: binding.attempt, mode: 'check' },
      f.io,
    );
    const path = f.local(`${f.folder}/browser-first-cutover-host.mjs`);
    if (fault === 'candidate-bytes')
      f.source.set('browser-first-cutover-host.mjs', Buffer.from('different candidate code'));
    if (fault === 'missing-module') await fs.unlink(path);
    if (fault === 'writable-file') await fs.chmod(path, 0o644);
    if (fault === 'wrong-entry')
      await fs.writeFile(f.local('/proc/910/cmdline'), 'node\0arbitrary.mjs\0');
    if (fault === 'wrong-argv')
      await fs.writeFile(
        f.local('/proc/910/cmdline'),
        Buffer.from(`/opt/node22/bin/node\0${f.entry}\0--check\0another-attempt\0`),
      );
    if (fault === 'non-root')
      await fs.writeFile(f.local('/proc/910/status'), 'Uid:\t998\t998\t998\t998\n');
    if (fault === 'expiry') f.approval.maintenanceEndsAtMs = 999;
    if (fault === 'identity-drift')
      await fs.writeFile(f.local('/proc/910/cgroup'), '0::/changed\n');
    if (fault === 'missing-policy') await fs.unlink(f.local(f.policyPath));
    if (fault === 'changed-policy')
      await fs.writeFile(f.local(f.policyPath), 'not the approved policy');
    if (fault === 'extended-window') f.approval.maintenanceEndsAtMs = 12000;
    if (fault === 'clock-regression') f.clock.value = 999;
    if (fault === 'close-during-read') f.events.onRead = () => reader.close();
    await assert.rejects(reader.readExecutionIdentity(), /UNPROVEN/);
  });
}
