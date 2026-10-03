import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runInNewContext } from 'node:vm';
import { readCutoverHostSnapshot } from './browser-cutover-evidence.mjs';
import * as host from './browser-first-cutover-host.mjs';
import * as ingress from './browser-first-cutover-ingress-session.mjs';
import {
  classifyFirstCutoverHost,
  firstCutoverSourceBindings,
} from './browser-first-cutover-inventory.mjs';

// Scope comes from the already-approved closure, independently listed here.
const modules = [
  'browser-backup-age.mjs',
  'browser-cutover-evidence.mjs',
  'browser-first-cutover-backup.mjs',
  'browser-first-cutover-fence.mjs',
  'browser-first-cutover-gateway-session.mjs',
  'browser-first-cutover-host.mjs',
  'browser-first-cutover-ingress-diagnostics.mjs',
  'browser-first-cutover-ingress-files.mjs',
  'browser-first-cutover-ingress-session.mjs',
  'browser-first-cutover-inventory.mjs',
  'browser-first-cutover-mysql.mjs',
  'browser-first-cutover-nginx.mjs',
  'browser-first-cutover-payments.mjs',
  'browser-first-cutover-browser-probe.mjs',
  'browser-first-cutover-native-preflight.mjs',
  'browser-first-cutover-native-preflight.py',
  'browser-first-cutover-production-facts.mjs',
  'browser-first-cutover-recovery-session.mjs',
  'browser-first-cutover-registrations.mjs',
  'browser-first-cutover-runtime.mjs',
  'browser-first-cutover-site.mjs',
  'browser-first-cutover-startup.mjs',
  'browser-first-cutover-transition.mjs',
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

test('the protected coordinator bundle loads its real module closure without the checkout', async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'holaday-coordinator-closure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of modules) await fs.copyFile(new URL(name, import.meta.url), join(root, name));
  const probe = join(root, 'closure-import-probe.mjs');
  await fs.writeFile(probe, 'await import(process.argv[2]);\n', { mode: 0o600 });
  for (const entry of ['host', 'site', 'transition']) {
    const result = spawnSync(
      process.execPath,
      [probe, join(root, `browser-first-cutover-${entry}.mjs`)],
      { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(result.status, 0, result.stderr);
  }
});

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
    assert.match(result.stderr, /CUTOVER_COORDINATOR_(USAGE|UNPROVEN)/);
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
  'missing-site',
  'missing-diagnostics',
  'changed-diagnostics',
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
    if (fault === 'missing-site')
      await fs.unlink(f.local(`${f.folder}/browser-first-cutover-site.mjs`));
    if (fault === 'missing-diagnostics')
      await fs.unlink(f.local(`${f.folder}/browser-first-cutover-ingress-diagnostics.mjs`));
    if (fault === 'changed-diagnostics')
      await fs.writeFile(
        f.local(`${f.folder}/browser-first-cutover-ingress-diagnostics.mjs`),
        'altered diagnostic helper',
      );
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

for (const mode of ['check', 'execute', 'diagnose-prepare']) {
  test(`coordinator ${mode} binds the exact kernel mode and rejects every other mode`, async (t) => {
    const f = await fixture(t);
    const command = (m) =>
      Buffer.from(`/opt/node22/bin/node\0${f.entry}\0--${m}\0${binding.attempt}\0`);
    await fs.writeFile(f.local('/proc/910/cmdline'), command(mode));
    const reader = await host.createFirstCutoverCoordinatorIdentity(
      { attempt: binding.attempt, mode },
      f.io,
    );
    assert.equal((await reader.readExecutionIdentity()).role, 'coordinator');
    for (const wrong of ['check', 'execute', 'diagnose-prepare'].filter((m) => m !== mode)) {
      await fs.writeFile(f.local('/proc/910/cmdline'), command(wrong));
      await assert.rejects(
        host.createFirstCutoverCoordinatorIdentity({ attempt: binding.attempt, mode }, f.io),
        /CUTOVER_COORDINATOR_UNPROVEN/,
      );
    }
    reader.close();
  });
}

async function collectCoordinatorFixture(f) {
  const ids = [800, 910, 920];
  await fs.writeFile(
    f.local('/proc/910/stat'),
    `910 (node) S 901 ${Array(17).fill('0').join(' ')} 100 0\n`,
  );
  await fs.writeFile(f.local('/proc/910/status'), 'Uid:\t0\t0\t0\t0\nPPid:\t901\n');
  for (const pid of [800, 920]) {
    await fs.mkdir(f.local(`/proc/${pid}`));
    const parent = pid === 800 ? 1 : 910;
    await fs.writeFile(
      f.local(`/proc/${pid}/stat`),
      `${pid} (node) S ${parent} ${Array(17).fill('0').join(' ')} ${pid} 0\n`,
    );
    await fs.writeFile(f.local(`/proc/${pid}/status`), `Uid:\t0\t0\t0\t0\nPPid:\t${parent}\n`);
    await fs.writeFile(
      f.local(`/proc/${pid}/cmdline`),
      `/opt/node22/bin/node\0fixture-${pid}.mjs\0`,
    );
    await fs.writeFile(f.local(`/proc/${pid}/cgroup`), '0::/qa\n');
  }
  return () =>
    readCutoverHostSnapshot({
      platform: 'linux',
      uid: 0,
      now: () => 1000,
      hostname: () => 'qa-vultr',
      readdir: async () => ids.map(String),
      readFile: f.io.fs.readFile,
      readlink: f.io.fs.readlink,
      pm2RuntimeSnapshot: async () => ({
        pid: 800,
        version: '6.0.14',
        killSignal: 'SIGINT',
        killTimeoutMs: 1600,
        sourceDigest: 'a'.repeat(64),
      }),
      startupSnapshot: async () => ({
        observedAtMs: 1000,
        files: [],
        directories: [],
        pm2Unit: {},
      }),
      nginxSnapshot: async () => ({ observedAtMs: 1000, dump: '', files: [] }),
      exec: async (command) => (command === 'pm2' ? '[]' : ''),
    });
}

for (const changed of [false, true]) {
  test(`actual collector and coordinator identity preserve argv binding (changed=${changed})`, async (t) => {
    const f = await fixture(t);
    const collect = await collectCoordinatorFixture(f);
    const reader = await host.createFirstCutoverCoordinatorIdentity(
      { attempt: binding.attempt, mode: 'check' },
      f.io,
    );
    t.after(() => reader.close());
    const receipt = await reader.readExecutionIdentity();
    if (changed)
      await fs.writeFile(
        f.local('/proc/910/cmdline'),
        `/opt/node22/bin/node\0${f.entry}\0--execute\0${binding.attempt}\0`,
      );
    const snapshot = await collect();
    snapshot.observer = snapshot.processes.find((p) => p.pid === 920);
    const input = {
      snapshot,
      host: 'vultr',
      ports: [4001, 4002],
      inventoryDigest: binding.inventoryDigest,
      review: {
        processes: [],
        registrations: [],
        sources: firstCutoverSourceBindings(snapshot).map((row) => ({
          ...row,
          reason: 'isolated collector fixture',
        })),
      },
      execution: [receipt],
    };
    if (changed) {
      assert.throws(
        () => classifyFirstCutoverHost(input, { now: () => 1000 }),
        /CUTOVER_INVENTORY_UNPROVEN/,
      );
      await assert.rejects(reader.readExecutionIdentity(), /CUTOVER_COORDINATOR_UNPROVEN/);
    } else {
      const actual = classifyFirstCutoverHost(input, { now: () => 1000 });
      assert.deepEqual(actual.unknownLaunchers, []);
      assert.deepEqual(
        actual.executionProcesses.map((p) => p.pid),
        [910],
      );
    }
  });
}

// Execute the actual exported identity functions with isolated OS dependencies.
// Only import.meta.url is fixed to the real module URL; guards/body are unchanged.
for (const role of ['ingress', 'gateway', 'ingress-ssh', 'gateway-ssh']) {
  for (const changed of [false, true]) {
    test(`actual collector and ${role} identity preserve argv binding (changed=${changed})`, async (t) => {
      const f = await fixture(t);
      await collectCoordinatorFixture(f);
      const transport = role.endsWith('-ssh');
      const exe = transport ? '/usr/bin/ssh' : '/usr/bin/node';
      const args = transport
        ? ['-T', 'root@example.invalid', 'holaday-cutover-v1 fixed-command']
        : [
            fileURLToPath(new URL(`browser-first-cutover-${role}-session.mjs`, import.meta.url)),
            binding.attempt,
          ];
      const command = `${[exe, ...args].join('\0')}\0`;
      await fs.writeFile(f.local('/proc/910/cmdline'), command);
      const disk = {
        ...f.io.fs,
        readlink: async (p) => (p === '/proc/910/exe' ? exe : f.io.fs.readlink(p)),
      };
      const context = {
        fs: disk,
        process: { platform: 'linux', getuid: () => 0, pid: transport ? 901 : 910 },
        Buffer,
        URL,
        structuredClone,
        createHash,
        fileURLToPath,
        isDeepStrictEqual,
        uuid: (value) => value === binding.attempt,
        fail: () => {
          throw Error('CUTOVER_INGRESS_SESSION_UNPROVEN');
        },
        assertFirstCutoverSessionIdentity: (value, role) =>
          ingress.assertFirstCutoverSessionIdentity(structuredClone(value), role),
      };
      let read;
      if (transport) {
        const child = new EventEmitter();
        Object.assign(child, {
          pid: 910,
          exitCode: null,
          signalCode: null,
          stdout: new PassThrough(),
          stdin: new PassThrough(),
          stderr: new PassThrough(),
        });
        t.after(() => {
          child.emit('close', 0, null);
          child.stdout.destroy();
          child.stdin.destroy();
          child.stderr.destroy();
        });
        context.spawn = () => child;
        const open = runInNewContext(`(${ingress.openFirstCutoverSsh.toString()})`, context);
        const connection = open(exe, args, {});
        read = connection.readIdentity;
      } else {
        const body = ingress.readFirstCutoverSessionIdentity
          .toString()
          .replaceAll(
            'import.meta.url',
            JSON.stringify(
              new URL('browser-first-cutover-ingress-session.mjs', import.meta.url).href,
            ),
          );
        const actual = runInNewContext(`(${body})`, context);
        read = () => actual({ role, attempt: binding.attempt });
      }
      const value = await read();
      const receipt = {
        host: transport ? 'vultr' : 'aliyun',
        role,
        binding,
        siteDigest: 'f'.repeat(64),
        bootId: value.bootId,
        process: value.process,
      };
      if (changed)
        await fs.writeFile(f.local('/proc/910/cmdline'), `${command}unexpected-argument\0`);
      const snapshot = await readCutoverHostSnapshot({
        platform: 'linux',
        uid: 0,
        now: () => 1000,
        hostname: () => 'qa-host',
        readdir: async () => ['800', '910', '920'],
        readFile: disk.readFile,
        readlink: disk.readlink,
        pm2RuntimeSnapshot: async () => ({
          pid: 800,
          version: '6.0.14',
          killSignal: 'SIGINT',
          killTimeoutMs: 1600,
          sourceDigest: 'a'.repeat(64),
        }),
        startupSnapshot: async () => ({
          observedAtMs: 1000,
          files: [],
          directories: [],
          pm2Unit: {},
        }),
        nginxSnapshot: async () => ({ observedAtMs: 1000, dump: '', files: [] }),
        exec: async (command) => (command === 'pm2' ? '[]' : ''),
      });
      snapshot.observer = snapshot.processes.find((p) => p.pid === 920);
      const input = {
        snapshot,
        host: receipt.host,
        ports: transport ? [4001, 4002] : [4010, 4011],
        inventoryDigest: binding.inventoryDigest,
        review: {
          processes: [],
          registrations: [],
          sources: firstCutoverSourceBindings(snapshot).map((row) => ({
            ...row,
            reason: 'isolated collector fixture',
          })),
        },
        execution: [receipt],
      };
      if (changed) {
        assert.throws(
          () => classifyFirstCutoverHost(input, { now: () => 1000 }),
          /CUTOVER_INVENTORY_UNPROVEN/,
        );
        await assert.rejects(read(), /CUTOVER_INGRESS_SESSION_UNPROVEN/);
      } else {
        const actual = classifyFirstCutoverHost(input, { now: () => 1000 });
        assert.deepEqual(actual.unknownLaunchers, []);
        assert.deepEqual(
          actual.executionProcesses.map((p) => p.pid),
          [910],
        );
      }
    });
  }
}
