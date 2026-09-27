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

test('local producer retirement connects saved files, owned host journal and exact live registration removal', async (t) => {
  for (const mode of [
    'success',
    'fresh-observation',
    'busy',
    'foreign-host',
    'wrong-phase',
    'unapproved-name',
    'lost-delete-ack',
  ])
    await t.test(mode, async (t) => {
      const f = await fixture(t);
      const raw = JSON.stringify(f.rows[0].pm2_env);
      const bytes = `[${raw},{"name":"unrelated","number":9007199254740993}]\n`;
      await fs.writeFile(`${f.root}/root/.pm2/dump.pm2`, bytes, { mode: 0o600 });
      f.system.fs.rename = (a, b) => fs.rename(f.root + a, f.root + b);
      f.system.hostname = () => (mode === 'foreign-host' ? 'other-machine' : 'vultr');
      const phase = mode === 'wrong-phase' ? 'legacy_settled' : 'producers_stopped';
      const journal = {
        assertOwnership: async () => ({ ...binding, candidate: 'b'.repeat(40) }),
        readFirstCutoverEffects: async () => ({
          ...binding,
          phase,
          startupEvents: f.events.filter((e) => e.phase.startsWith('startup-')),
          registrationEvents: f.events.filter((e) => e.phase.startsWith('registration-')),
        }),
        recordStartupEvent: f.io.persist,
        recordRegistrationEvent: f.io.persist,
      };
      const observer = {
        read: async () => ({
          inventoryDigest: binding.inventoryDigest,
          unknownLaunchers: [],
          hosts: [{ host: 'vultr', registered: await f.io.readInventory() }],
        }),
        readRegistrationProgress: async (host) => {
          assert.equal(host, 'vultr');
          if (mode === 'fresh-observation') await f.io.sleep(1);
          return { purpose: 'registration-progress', host, inventory: await f.io.readInventory() };
        },
      };
      const input = {
        binding,
        maintenanceEndsAtMs: 20000,
        files: [
          {
            path: '/root/.pm2/dump.pm2',
            digest: sha(bytes),
            remove: [
              {
                name: mode === 'unapproved-name' ? 'holaday-cn-payment' : 'holaday-files-cron',
                entryDigest: sha(raw),
              },
            ],
          },
          { path: '/root/.pm2/dump.pm2.bak', digest: null, remove: [] },
        ],
      };
      const io = {
        journal,
        observer,
        now: f.io.now,
        sleep: f.io.sleep,
        verifyFence: async () => ({
          ...(await f.io.verifyFence()),
          externalWork: mode === 'busy' ? 1 : 0,
        }),
      };
      if (mode === 'lost-delete-ack') {
        const exec = f.system.exec;
        f.system.exec = async (...args) => {
          const value = await exec(...args);
          if (args[1][1] === 'delete') throw new Error('lost acknowledgement');
          return value;
        };
      }
      assert.equal(typeof registrations.retireLocalFirstCutoverProducers, 'function');
      if (mode === 'success' || mode === 'fresh-observation') {
        const result = await registrations.retireLocalFirstCutoverProducers(input, io, f.system);
        assert.equal(result.phase, 'producers_stopped');
        assert.deepEqual(result.removed, [{ pmId: 5, name: 'holaday-files-cron' }]);
        assert.equal(
          await fs.readFile(`${f.root}/root/.pm2/dump.pm2`, 'utf8'),
          '[{"name":"unrelated","number":9007199254740993}]\n',
        );
        assert.equal(
          await fs.readFile(
            `${f.root}${archive}/startup-${binding.attempt}/dump.pm2.original`,
            'utf8',
          ),
          bytes,
        );
        assert.deepEqual(
          f.events.map((e) => [e.host, e.phase]),
          [
            ['vultr', 'startup-backup-intent'],
            ['vultr', 'startup-backed-up'],
            ['vultr', 'startup-file-intent'],
            ['vultr', 'startup-file-written'],
            ['vultr', 'registration-backup-intent'],
            ['vultr', 'registration-backed-up'],
            ['vultr', 'registration-delete-intent'],
            ['vultr', 'registration-deleted'],
          ],
        );
      } else {
        await assert.rejects(
          registrations.retireLocalFirstCutoverProducers(input, io, f.system),
          /CUTOVER_/,
        );
        if (mode !== 'lost-delete-ack') {
          assert.equal(await fs.readFile(`${f.root}/root/.pm2/dump.pm2`, 'utf8'), bytes);
          assert.equal(f.events.length, 0);
        } else assert.equal(f.events.at(-1).phase, 'registration-delete-intent');
      }
      const calls = f.commands.length;
      if (['success', 'fresh-observation', 'lost-delete-ack'].includes(mode))
        await assert.rejects(
          registrations.retireLocalFirstCutoverProducers(input, io, f.system),
          /CUTOVER_/,
        );
      assert.equal(f.commands.length, calls);
      assert.equal(
        calls,
        ['success', 'fresh-observation', 'lost-delete-ack'].includes(mode) ? 1 : 0,
      );
      assert.equal(f.rows.find((r) => r.name === 'unrelated').pid, 888);
    });
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

test('gateway startup preparation and final retirement use distinct real journal phases', async (t) => {
  for (const mode of [
    'success',
    'already-absent',
    'busy',
    'early-stop',
    'foreign-host',
    'startup-drift',
    'lost-ack',
  ])
    await t.test(mode, async (t) => {
      const f = await fixture(t);
      const config = { name: 'holaday-cn-payment', status: 'online', secret: 'never-output' };
      const manager = {
        ...f.inventory.managers[0],
        name: config.name,
        status: 'online',
        rootPid: 70,
        configDigest: sha(JSON.stringify(config)),
        cron: false,
      };
      const target = {
        host: 'aliyun',
        bootId: 'd'.repeat(32),
        pid: 70,
        ppid: 50,
        start: '700',
        uids: [0, 0, 0, 0],
        exe: '/usr/bin/node',
        cwd: '/opt/holaday-cn-payment/releases/123456789abc-20260927080000/apps/cn-payment',
        argvDigest: 'c'.repeat(64),
        role: 'gateway',
        managerIdentity: manager,
      };
      Object.assign(f.inventory, {
        host: 'aliyun',
        ports: [4010, 4011],
        managers: [manager],
        processes: [target],
        listeners: [{ port: 4010, pid: 70 }],
      });
      f.rows[0] = { pm_id: 5, name: config.name, pid: 70, pm2_env: config };
      f.system.hostname = () => (mode === 'foreign-host' ? 'vultr' : 'aliyun');
      f.system.fs.rename = (a, b) => fs.rename(f.root + a, f.root + b);
      const raw = JSON.stringify(config);
      const bytes =
        mode === 'already-absent' ? '[{"name":"unrelated"}]\n' : `[${raw},{"name":"unrelated"}]\n`;
      await fs.writeFile(`${f.root}/root/.pm2/dump.pm2`, bytes, { mode: 0o600 });
      let phase = 'producers_stopped';
      const journal = {
        assertOwnership: async () => ({ ...binding, candidate: 'b'.repeat(40) }),
        readFirstCutoverEffects: async () => ({
          ...binding,
          phase,
          startupEvents: f.events.filter((e) => e.phase.startsWith('startup-')),
          registrationEvents: f.events.filter((e) => e.phase.startsWith('registration-')),
          unmanagedEvents: [],
        }),
        recordStartupEvent: f.io.persist,
        recordRegistrationEvent: f.io.persist,
      };
      const observer = {
        read: async () => ({
          inventoryDigest: binding.inventoryDigest,
          unknownLaunchers: [],
          hosts: [
            {
              host: 'aliyun',
              registered: await f.io.readInventory(),
              unmanaged: {
                ...(await f.io.readInventory()),
                managers: [],
                processes: [],
                listeners: [],
              },
            },
          ],
        }),
        readRegistrationProgress: async (h) => {
          assert.equal(h, 'aliyun');
          return {
            purpose: 'registration-progress',
            host: h,
            inventory: await f.io.readInventory(),
          };
        },
      };
      const io = {
        journal,
        observer,
        now: f.io.now,
        sleep: f.io.sleep,
        verifyFence: async () => ({
          inventoryDigest: binding.inventoryDigest,
          stage: phase === 'producers_stopped' ? 'orders' : 'all-writers',
          observedAtMs: f.io.now(),
          unsettledWork: mode === 'busy' ? 1 : 0,
          externalWork: 0,
          activeRequests: 0,
          unknownWriters: 0,
          producersRunning: 0,
        }),
      };
      const input = {
        binding,
        maintenanceEndsAtMs: 20000,
        files: [
          {
            path: '/root/.pm2/dump.pm2',
            digest: sha(bytes),
            remove: mode === 'already-absent' ? [] : [{ name: config.name, entryDigest: sha(raw) }],
          },
          { path: '/root/.pm2/dump.pm2.bak', digest: null, remove: [] },
        ],
      };
      f.system.exec = async (file, argv) => {
        assert.equal(file, '/usr/bin/node');
        if (argv[1] === 'jlist') return JSON.stringify(f.rows);
        assert.equal(phase, 'stopped');
        assert.deepEqual(argv, ['/usr/lib/node_modules/pm2/bin/pm2', 'delete', '5']);
        assert.equal(f.events.at(-1).host, 'aliyun');
        assert.equal(f.events.at(-1).phase, 'registration-delete-intent');
        f.commands.push(argv);
        f.rows.shift();
        f.inventory.managers = [];
        f.inventory.processes = [];
        f.inventory.listeners = [];
        if (mode === 'lost-ack') throw new Error('lost acknowledgement');
        return '';
      };
      assert.equal(typeof registrations.prepareLocalFirstCutoverGateway, 'function');
      assert.equal(typeof registrations.retireLocalFirstCutoverGateways, 'function');
      // This first-cutover contract requires an actual reviewed startup change.
      // An already absent target must not be promoted to a completed first run.
      if (['already-absent', 'busy', 'foreign-host'].includes(mode)) {
        await assert.rejects(
          registrations.prepareLocalFirstCutoverGateway(input, io, f.system),
          /CUTOVER_/,
        );
        assert.equal(f.events.length, 0);
        assert.equal(await fs.readFile(`${f.root}/root/.pm2/dump.pm2`, 'utf8'), bytes);
        return;
      }
      await registrations.prepareLocalFirstCutoverGateway(input, io, f.system);
      assert.equal(f.commands.length, 0); // Preparing startup must not stop the callback gateway.
      assert.equal(f.rows[0].pid, 70);
      assert.equal(
        await fs.readFile(
          `${f.root}${archive}/startup-${binding.attempt}/dump.pm2.original`,
          'utf8',
        ),
        bytes,
      );
      if (mode !== 'early-stop') phase = 'stopped';
      if (mode === 'startup-drift') await fs.writeFile(`${f.root}/root/.pm2/dump.pm2`, bytes);
      const stopInput = { binding, maintenanceEndsAtMs: 20000 };
      if (mode === 'success') {
        const result = await registrations.retireLocalFirstCutoverGateways(stopInput, io, f.system);
        assert.equal(result.host, 'aliyun');
        assert.equal(result.phase, 'stopped');
        assert.deepEqual(result.survivors, []);
        assert.deepEqual(result.listeners, []);
        assert.equal(f.events.at(-1).phase, 'registration-deleted');
      } else
        await assert.rejects(
          registrations.retireLocalFirstCutoverGateways(stopInput, io, f.system),
          /CUTOVER_/,
        );
      assert.equal(f.commands.length, ['success', 'lost-ack'].includes(mode) ? 1 : 0);
      assert.equal(f.rows.find((r) => r.name === 'unrelated').pid, 888);
      if (['success', 'lost-ack'].includes(mode)) {
        await assert.rejects(
          registrations.retireLocalFirstCutoverGateways(stopInput, io, f.system),
          /CUTOVER_/,
        );
        assert.equal(f.commands.length, 1);
      }
    });
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
