import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as registrations from './browser-first-cutover-registrations.mjs';
import { captureLegacyRegistrations } from './browser-first-cutover-runtime.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const binding = {
  attempt: '11111111-1111-4111-8111-111111111111',
  inventoryDigest: 'a'.repeat(64),
};
const archive = '/var/lib/holaday-deploy/maintenance';
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-registry-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(`${root}${archive}`, { recursive: true, mode: 0o700 });
  await fs.mkdir(`${root}/root/.pm2`, { recursive: true, mode: 0o700 });
  await fs.writeFile(`${root}/root/.pm2/dump.pm2`, '[]', { mode: 0o600 });
  let now = 1000;
  const config = {
    name: 'holaday-files-cron',
    status: 'stopped',
    cron_restart: '0 * * * *',
    secret: 'never-output',
  };
  const manager = {
    kind: 'pm2',
    pid: 50,
    start: '200',
    exe: '/usr/bin/node',
    argvDigest: 'b'.repeat(64),
    pm2Home: '/root/.pm2',
    version: '6.0.14',
    pmId: 5,
    name: config.name,
    configDigest: sha(JSON.stringify(config)),
    killTimeoutMs: 1600,
    killSignal: 'SIGINT',
    watch: false,
    cron: '0 * * * *',
    memoryRestart: 0,
    status: 'stopped',
    rootPid: 0,
  };
  const inventory = {
    ...binding,
    host: 'vultr',
    bootId: 'd'.repeat(32),
    observedAtMs: now,
    processes: [],
    managers: [manager],
    ports: [4001, 4002],
    listeners: [],
    unknownLaunchers: [],
  };
  const rows = [
    { pm_id: 5, name: config.name, pid: 0, pm2_env: config },
    { pm_id: 6, name: 'unrelated', pid: 888, pm2_env: { name: 'unrelated', status: 'online' } },
  ];
  const events = [];
  const commands = [];
  const normalizeStat = (s) => Object.assign(s, { uid: 0 });
  const disk = {
    ...fs,
    lstat: async (p) => normalizeStat(await fs.lstat(root + p)),
    realpath: async (p) => (await fs.realpath(root + p)).slice(root.length),
    mkdir: (p, o) => fs.mkdir(root + p, o),
    open: async (p, ...args) => {
      const h = await fs.open(root + p, ...args);
      const stat = h.stat.bind(h);
      h.stat = async () => normalizeStat(await stat());
      return h;
    },
  };
  const io = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    assertOwnership: async () => structuredClone(binding),
    readInventory: async () => structuredClone({ ...inventory, observedAtMs: now }),
    verifyFence: async () => ({
      ...binding,
      observedAtMs: now,
      stage: 'orders',
      unsettledWork: 0,
      externalWork: 0,
      activeRequests: 0,
      unknownWriters: 0,
      producersRunning: inventory.processes.length,
      runningProducers: structuredClone(inventory.processes),
    }),
    persist: async (e) => {
      events.push(structuredClone(e));
    },
  };
  const system = {
    fs: disk,
    platform: 'linux',
    uid: 0,
    exec: async (file, argv, options) => {
      assert.equal(file, '/usr/bin/node');
      assert.equal(argv[0], '/usr/lib/node_modules/pm2/bin/pm2');
      assert.equal(options.env.PM2_HOME, '/root/.pm2');
      if (argv[1] === 'jlist') return JSON.stringify(rows);
      commands.push(argv);
      assert.deepEqual(argv, ['/usr/lib/node_modules/pm2/bin/pm2', 'delete', '5']);
      assert.equal(events.at(-1).phase, 'registration-delete-intent');
      rows.splice(0, 1);
      inventory.managers = [];
      return '';
    },
  };
  const captured = await captureLegacyRegistrations(
    { inventory, approvedTargets: [], approvedRegistrations: inventory.managers },
    io,
  );
  return {
    root,
    io,
    system,
    events,
    commands,
    rows,
    inventory,
    captured,
    input: { captured, binding, maintenanceEndsAtMs: 20000 },
  };
}

test('exact stopped cron registration is archived privately and removed without global PM2 operations', async (t) => {
  const f = await fixture(t);
  assert.equal(typeof registrations.removeLegacyRegistrations, 'function');
  const result = await registrations.removeLegacyRegistrations(f.input, f.io, f.system);
  assert.deepEqual(result.removed, [{ pmId: 5, name: 'holaday-files-cron' }]);
  assert.deepEqual(
    f.rows.map((r) => [r.name, r.pid]),
    [['unrelated', 888]],
  );
  const path = `${f.root}${archive}/registrations-${binding.attempt}/original.json`;
  assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await fs.readFile(path))[0].config.secret, 'never-output');
  assert.equal(JSON.stringify([...f.events, result]).includes('never-output'), false);
  assert.deepEqual(
    f.events.map((e) => e.phase),
    [
      'registration-backup-intent',
      'registration-backed-up',
      'registration-delete-intent',
      'registration-deleted',
    ],
  );
  assert.equal(f.commands.length, 1);
  await assert.rejects(
    registrations.removeLegacyRegistrations(f.input, f.io, f.system),
    /CUTOVER_/,
  );
  assert.equal(f.commands.length, 1);
});

test('PM2 axm_monitor telemetry changes do not impersonate launch configuration drift', async (t) => {
  const f = await fixture(t);
  const persist = f.io.persist;
  f.io.persist = async (e) => {
    await persist(e);
    if (e.phase === 'registration-backup-intent') {
      f.rows[0].pm2_env.axm_monitor = { heap: { value: 123 } };
      f.rows[1].pm2_env.axm_monitor = { heap: { value: 456 } };
    }
  };
  await registrations.removeLegacyRegistrations(f.input, f.io, f.system);
  assert.equal(f.commands.length, 1);
  assert.equal(f.rows[0].pid, 888);
});

test('empty fabricated capture cannot produce a successful empty retirement receipt', async (t) => {
  const f = await fixture(t);
  f.input.captured.managers = [];
  f.inventory.managers = [];
  f.rows.splice(0, 1);
  await assert.rejects(
    registrations.removeLegacyRegistrations(f.input, f.io, f.system),
    /CUTOVER_/,
  );
  assert.equal(f.commands.length, 0);
  assert.deepEqual(f.events, []);
});

test('preconditions fail before deletion for saved resurrection, config drift, lost ownership and busy work', async (t) => {
  for (const kind of ['saved', 'config', 'owner', 'busy', 'deadline', 'platform', 'unknown']) {
    const f = await fixture(t);
    if (kind === 'saved')
      await fs.writeFile(`${f.root}/root/.pm2/dump.pm2`, '[{"name":"holaday-files-cron"}]');
    if (kind === 'config') f.rows[0].pm2_env.secret = 'changed';
    if (kind === 'owner')
      f.io.assertOwnership = async () => ({ ...binding, inventoryDigest: 'f'.repeat(64) });
    if (kind === 'busy') {
      const base = f.io.verifyFence;
      f.io.verifyFence = async () => ({ ...(await base()), unsettledWork: 1 });
    }
    if (kind === 'deadline') f.input.maintenanceEndsAtMs = 1200;
    if (kind === 'platform') f.system.platform = 'darwin';
    if (kind === 'unknown') f.inventory.unknownLaunchers = ['unexpected'];
    await assert.rejects(
      registrations.removeLegacyRegistrations(f.input, f.io, f.system),
      /CUTOVER_/,
    );
    assert.equal(f.commands.length, 0, kind);
  }
});

test('journal failure, corrupt backup or a late changed registration never reaches delete', async (t) => {
  for (const kind of ['journal', 'backup', 'late']) {
    const f = await fixture(t);
    const persist = f.io.persist;
    f.io.persist = async (e) => {
      await persist(e);
      if (e.phase === 'registration-delete-intent') {
        if (kind === 'journal') throw new Error('sensitive journal failure');
        if (kind === 'backup')
          await fs.writeFile(
            `${f.root}${archive}/registrations-${binding.attempt}/original.json`,
            'damaged',
          );
        if (kind === 'late') f.inventory.managers[0].start = '999';
      }
    };
    await assert.rejects(
      registrations.removeLegacyRegistrations(f.input, f.io, f.system),
      /CUTOVER_/,
    );
    assert.equal(f.commands.length, 0, kind);
  }
});

test('command failure is uncertain and never retried; unrelated changes and respawn cannot pass', async (t) => {
  for (const kind of ['command', 'unrelated', 'respawn']) {
    const f = await fixture(t);
    const exec = f.system.exec;
    f.system.exec = async (...args) => {
      const out = await exec(...args);
      if (args[1][1] === 'delete') {
        if (kind === 'command') throw new Error('secret CLI output');
        if (kind === 'unrelated') f.rows[0].pid++;
        if (kind === 'respawn')
          f.rows.push({ pm_id: 8, name: 'holaday-files-cron', pid: 999, pm2_env: {} });
      }
      return out;
    };
    await assert.rejects(
      registrations.removeLegacyRegistrations(f.input, f.io, f.system),
      /CUTOVER_/,
    );
    assert.equal(f.commands.length, 1);
    assert.equal(
      f.events.some((e) => e.phase === 'registration-deleted'),
      false,
    );
  }
});
