import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  captureLegacyRuntime,
  createLegacyRuntimeEffects,
  initializeFirstMaintenanceState,
  retireLegacyRuntime,
} from './browser-first-cutover-runtime.mjs';
import { retireMaintenanceRuntime } from './browser-maintenance-runtime.mjs';

const digest = 'a'.repeat(64);
const manager = {
  kind: 'pm2',
  pid: 50,
  start: '200',
  exe: '/opt/node22/bin/node',
  argvDigest: 'b'.repeat(64),
  pm2Home: '/root/.pm2',
  version: '6.0.14',
  pmId: 2,
  name: 'holaday-orchestrator',
  configDigest: 'c'.repeat(64),
  killTimeoutMs: 1600,
  killSignal: 'SIGINT',
  watch: false,
  cron: false,
  memoryRestart: 0,
};
const target = {
  host: 'vultr',
  bootId: 'd'.repeat(32),
  pid: 100,
  ppid: 50,
  start: '300',
  uids: [998, 998, 998, 998],
  exe: '/opt/node22/bin/node',
  cwd: '/opt/holaday-monorepo/apps/orchestrator',
  argvDigest: 'e'.repeat(64),
  role: 'main',
  managerIdentity: manager,
};
function fixture() {
  let now = 1000;
  const inventory = {
    inventoryDigest: digest,
    host: 'vultr',
    bootId: target.bootId,
    observedAtMs: now,
    processes: [structuredClone(target)],
    unknownLaunchers: [],
    managers: [{ ...manager, status: 'online', rootPid: 100 }],
    listeners: [{ port: 4001, pid: 100 }],
    ports: [4001, 4002],
  };
  const events = [];
  const io = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    readInventory: async () => structuredClone({ ...inventory, observedAtMs: now }),
    assertJournalOwnership: async () => ({ inventoryDigest: digest }),
    verifyFence: async () => ({
      inventoryDigest: digest,
      stage: 'all-writers',
      unsettledWork: 0,
      externalWork: 0,
      producersRunning: 0,
    }),
    pm2Stop: async (p) => {
      events.push(['pm2', p.pid, p.managerIdentity.pmId]);
      inventory.processes = [];
      inventory.listeners = [];
      inventory.managers[0].status = 'stopped';
      inventory.managers[0].rootPid = 0;
    },
    signalPinned: async (p) => {
      events.push(['pidfd', p.pid]);
      inventory.processes = [];
      inventory.listeners = [];
    },
  };
  return { inventory, io, events };
}
const capture = (f) =>
  captureLegacyRuntime(
    { inventory: structuredClone(f.inventory), approvedTargets: [structuredClone(target)] },
    f.io,
  );

test('PM2 capture accepts auto-restarting legacy app but records exact identity and stops only its id', async () => {
  const f = fixture();
  const captured = await capture(f);
  assert.equal(captured.targets[0].pid, 100);
  assert.equal(captured.inventoryDigest, digest);
  const stopped = await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pm2', 100, 2]]);
  assert.equal(stopped.inventoryDigest, digest);
  assert.equal(stopped.phase, 'stopped');
});

for (const [field, value] of [
  ['pid', 101],
  ['start', '301'],
  ['uids', [998, 0, 998, 998]],
  ['exe', '/tmp/node'],
  ['cwd', '/opt/other'],
  ['argvDigest', 'f'.repeat(64)],
  ['bootId', 'f'.repeat(32)],
  ['managerIdentity', { ...manager, pmId: 3 }],
]) {
  test(`changed ${field} refuses before any stop`, async () => {
    const f = fixture();
    const captured = await capture(f);
    f.inventory.processes[0][field] = value;
    await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
    assert.deepEqual(f.events, []);
  });
}

test('unknown process, orphan child or launcher cannot disappear from approval scope', async () => {
  for (const change of [
    (f) => f.inventory.processes.push({ ...target, pid: 101, ppid: 1 }),
    (f) => f.inventory.unknownLaunchers.push('unmapped-systemd'),
    (f) => {
      f.inventory.managers[0].cron = '* * * * *';
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(capture(f), /CUTOVER_/);
    assert.deepEqual(f.events, []);
  }
});

test('busy work, invalid fence or lost journal prevents stop', async () => {
  for (const bad of [
    { unsettledWork: 1 },
    { externalWork: 1 },
    { producersRunning: 1 },
    { stage: 'orders' },
    { inventoryDigest: '0'.repeat(64) },
  ]) {
    const f = fixture();
    const captured = await capture(f);
    const verify = f.io.verifyFence;
    f.io.verifyFence = async () => ({ ...(await verify()), ...bad });
    await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
    assert.deepEqual(f.events, []);
  }
  const f = fixture();
  const captured = await capture(f);
  f.io.assertJournalOwnership = async () => {
    throw new Error('lost-lock');
  };
  await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io));
  assert.deepEqual(f.events, []);
});

test('original survivor times out, and a respawn is never signalled a second time', async () => {
  for (const respawn of [false, true]) {
    const f = fixture();
    const captured = await capture(f);
    f.io.pm2Stop = async () => {
      f.events.push('stop');
      if (respawn) f.inventory.processes[0].start = '500';
    };
    await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
    assert.deepEqual(f.events, ['stop']);
  }
});

test('remaining port owner or manager still online prevents stopped receipt', async () => {
  for (const which of ['port', 'manager']) {
    const f = fixture();
    const captured = await capture(f);
    f.io.pm2Stop = async () => {
      f.inventory.processes = [];
      if (which === 'manager') f.inventory.listeners = [];
      else {
        f.inventory.managers[0].status = 'stopped';
        f.inventory.managers[0].rootPid = 0;
      }
    };
    await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
  }
});

test('unmanaged gateway uses pinned TERM, not PM2 or main identity', async () => {
  const f = fixture();
  const gateway = {
    ...target,
    ppid: 1,
    role: 'gateway',
    cwd: '/opt/holaday-cn-payment/releases/083a6232aca7-20260804125641',
    managerIdentity: { kind: 'unmanaged' },
  };
  f.inventory.processes = [gateway];
  f.inventory.managers = [];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [gateway] },
    f.io,
  );
  await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pidfd', 100]]);
});

test('first-cutover never relaxes normal runtime proof', async () => {
  await assert.rejects(
    retireMaintenanceRuntime({
      identity: { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) },
      main: {
        pid: 100,
        start: '123',
        uid: 998,
        command: 'main',
        autorestart: false,
        cwd: '/opt/holaday-monorepo/apps/orchestrator',
      },
      effects: {},
      deadlineMs: 1000,
    }),
    /MAINTENANCE_STOP_INPUT/,
  );
});

async function stateFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-first-state-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = '/var/lib/holaday';
  const path = (p) =>
    p === base || p.startsWith(`${base}/`)
      ? root + p.slice(base.length)
      : (() => {
          throw new Error('unexpected path');
        })();
  const changes = [];
  let seed;
  const io = {
    platform: 'linux',
    uid: 0,
    applicationGid: 998,
    now: () => 1000,
    assertJournalOwnership: async () => ({
      candidate: 'c'.repeat(40),
      attempt: '11111111-1111-4111-8111-111111111111',
      inventoryDigest: digest,
    }),
    assertStopped: async () => ({
      inventoryDigest: digest,
      observedAtMs: 1000,
      phase: 'stopped',
      survivors: [],
      listeners: [],
      unknownLaunchers: [],
    }),
    verifyFence: async () => ({
      inventoryDigest: digest,
      stage: 'all-writers',
      unsettledWork: 0,
      externalWork: 0,
      producersRunning: 0,
    }),
    recordBootstrap: async (value) => {
      seed = value;
      changes.push('journal');
    },
    fs: {
      ...fs,
      realpath: async (p) => (await fs.realpath(path(p))).replace(root, base),
      lstat: async (p) => Object.assign(await fs.lstat(path(p)), { uid: 998 }),
      mkdir: async (p, options) => {
        changes.push('mkdir');
        return fs.mkdir(path(p), options);
      },
      chown: async (p, uid, gid) => {
        changes.push(['chown', p, uid, gid]);
      },
      open: async (p, flags, mode) => {
        const handle = await fs.open(path(p), flags, mode);
        handle.chown = async (uid, gid) => {
          changes.push(['file-chown', uid, gid]);
        };
        return handle;
      },
    },
  };
  const input = {
    candidate: 'c'.repeat(40),
    attempt: '11111111-1111-4111-8111-111111111111',
    stoppedEvidence: { inventoryDigest: digest, observedAtMs: 1000, phase: 'stopped' },
  };
  return { io, input, root, changes, seed: () => seed };
}

test('first state is canonical closed state; seed is journaled before any filesystem creation', async (t) => {
  const f = await stateFixture(t);
  const result = await initializeFirstMaintenanceState(f.input, f.io);
  assert.match(result.bootstrapSeed, /^[a-f0-9]{32}$/);
  assert.equal(result.bootstrapSeed, f.seed());
  assert.deepEqual(f.changes.slice(0, 2), ['journal', 'mkdir']);
  const directory = join(f.root, 'ordinary-maintenance');
  assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(join(directory, 'state.json'))).mode & 0o777, 0o600);
  assert.equal(
    await fs.readFile(join(directory, 'state.json'), 'utf8'),
    `{"schemaVersion":1,"candidate":"${f.input.candidate}","bootId":"${result.bootstrapSeed}","mode":"closed","needsReconciliation":false}\n`,
  );
  assert(f.changes.some((x) => Array.isArray(x) && x[0] === 'file-chown' && x[1] === 998));
});

test('existing or half-written state directory is never overwritten', async (t) => {
  const f = await stateFixture(t);
  const directory = join(f.root, 'ordinary-maintenance');
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.writeFile(join(directory, 'writer.lock'), 'uncertain');
  await assert.rejects(initializeFirstMaintenanceState(f.input, f.io), /CUTOVER_STATE_/);
  assert.deepEqual(f.changes, []);
  assert.equal(await fs.readFile(join(directory, 'writer.lock'), 'utf8'), 'uncertain');
});

test('stale stop proof, resumed writer or foreign journal prevents state creation', async (t) => {
  for (const kind of ['stale', 'live', 'journal', 'fence']) {
    const f = await stateFixture(t);
    if (kind === 'stale') f.input.stoppedEvidence.observedAtMs = -100000;
    if (kind === 'live') f.io.assertStopped = async () => ({ survivors: [100] });
    if (kind === 'journal') f.io.assertJournalOwnership = async () => ({ attempt: 'foreign' });
    if (kind === 'fence') f.io.verifyFence = async () => ({ stage: 'orders' });
    await assert.rejects(initializeFirstMaintenanceState(f.input, f.io), /CUTOVER_STATE_/);
    assert.deepEqual(await fs.readdir(f.root), []);
  }
});

test('failed state write leaves unmistakable incomplete directory and never permits retry overwrite', async (t) => {
  const f = await stateFixture(t);
  const open = f.io.fs.open;
  f.io.fs.open = async (p, ...args) => {
    if (p.endsWith('state.json')) throw new Error('disk-full');
    return open(p, ...args);
  };
  await assert.rejects(initializeFirstMaintenanceState(f.input, f.io), /CUTOVER_STATE_/);
  assert.deepEqual(await fs.readdir(join(f.root, 'ordinary-maintenance')), []);
  f.io.fs.open = open;
  await assert.rejects(initializeFirstMaintenanceState(f.input, f.io), /CUTOVER_STATE_/);
});

test('real command boundary uses fixed PM2 argv for exactly one observed id', async () => {
  const f = fixture();
  const calls = [];
  const effects = createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      return '';
    },
  });
  await effects.pm2Stop(target);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'pm2');
  assert.deepEqual(calls[0].args, ['stop', '2', '--watch']);
  assert.equal(calls[0].options.env.PM2_HOME, '/root/.pm2');
  assert.equal(calls[0].options.env.PATH, '/opt/node22/bin:/usr/local/bin:/usr/bin:/bin');
  assert.equal(calls[0].options.env.DASHSCOPE_API_KEY, undefined);
});

test('command boundary rechecks tree after earlier runtime checks and sanitizes errors', async () => {
  const f = fixture();
  let calls = 0;
  const effects = createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async () => {
      calls++;
      throw new Error('secret command output');
    },
  });
  f.inventory.processes.push({ ...target, pid: 101, ppid: 100 });
  await assert.rejects(effects.pm2Stop(target, [target]), /CUTOVER_/);
  assert.equal(calls, 0);
  f.inventory.processes.pop();
  await assert.rejects(effects.pm2Stop(target), { message: 'CUTOVER_STOP_UNCERTAIN' });
  assert.equal(calls, 1);
});

test('unmanaged command target is JSON stdin, never a shell argument or PM2 stop', async () => {
  const f = fixture();
  const calls = [];
  const p = { ...target, ppid: 1, managerIdentity: { kind: 'unmanaged' } };
  f.inventory.processes = [p];
  f.inventory.managers = [];
  const effects = createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => {
      calls.push(args);
      return '';
    },
  });
  await effects.signalPinned(p);
  assert.equal(calls[0][0], '/usr/bin/python3');
  assert.equal(calls[0][1].at(-1), '--stdin');
  assert.deepEqual(JSON.parse(calls[0][2].input), p);
});
