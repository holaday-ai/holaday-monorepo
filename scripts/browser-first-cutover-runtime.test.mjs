import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  captureLegacyRuntime,
  createLegacyProducerEffects,
  createLegacyRuntimeEffects,
  initializeFirstMaintenanceState,
  retireLegacyProducers,
  retireLegacyRuntime,
} from './browser-first-cutover-runtime.mjs';
import * as firstRuntime from './browser-first-cutover-runtime.mjs';
import { retireMaintenanceRuntime } from './browser-maintenance-runtime.mjs';

const digest = 'a'.repeat(64);
function interruptionWork() {
  const approval = {
    schemaVersion: 2,
    kind: 'first-cutover',
    attempt: '12345678-1234-4234-8234-123456789abc',
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    migrationDigest: 'c'.repeat(64),
    inventoryDigest: digest,
    legacyDigest: 'd'.repeat(64),
    maintenanceEndsAtMs: 2000,
    reconcileByMs: 3000,
    operatorRef: 'qa-operator',
    legacyInterruption: {
      mode: 'controlled-interruption',
      scope: 'legacy-non-payment-memory',
      approvalRef: 'legacy-interruption-20260928',
      capabilityDigest: '7'.repeat(64),
      observeUntilMs: 1800,
      noAutomaticReplay: true,
    },
  };
  return {
    approval,
    phase: 'before-stop',
    nowMs: 1000,
    observation: {
      schemaVersion: 2,
      inventoryDigest: digest,
      observedAtMs: 999,
      unsettledWork: 0,
      unknownWriters: 0,
      knownExternalWork: [],
      activeRequests: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
      externalWork: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
      capabilityDigest: '7'.repeat(64),
      replaySourcesDigest: '8'.repeat(64),
      pendingReplay: 0,
    },
  };
}
test('legacy work boundary distinguishes approved unobservable from zero, positive, malformed and expired observations', () => {
  assert.equal(typeof firstRuntime.validateLegacyWorkBoundary, 'function');
  const input = interruptionWork();
  const result = firstRuntime.validateLegacyWorkBoundary(input);
  assert.equal(result.mode, 'controlled-interruption');
  assert.match(result.riskDigest, /^[a-f0-9]{64}$/);
  for (const field of ['activeRequests', 'externalWork']) {
    const zero = structuredClone(input);
    zero.observation[field] = { kind: 'observed', count: 0 };
    assert.deepEqual(firstRuntime.validateLegacyWorkBoundary(zero), result);
    for (const value of [
      null,
      undefined,
      0,
      { kind: 'observed', count: 1 },
      { kind: 'observed', count: -1 },
      { kind: 'unobservable', reason: 'timeout' },
      { kind: 'unobservable', reason: 'legacy-no-inflight-api', count: 0 },
    ]) {
      const bad = structuredClone(input);
      bad.observation[field] = value;
      assert.throws(() => firstRuntime.validateLegacyWorkBoundary(bad), /CUTOVER_/);
    }
  }
  for (const [key, value] of [
    ['unsettledWork', 1],
    ['unknownWriters', 1],
    ['knownExternalWork', ['known-action']],
    ['pendingReplay', 1],
    ['replaySourcesDigest', null],
    ['capabilityDigest', '0'.repeat(64)],
    ['inventoryDigest', '0'.repeat(64)],
    ['observedAtMs', 1001],
    ['schemaVersion', 1],
  ]) {
    const bad = structuredClone(input);
    bad.observation[key] = value;
    assert.throws(() => firstRuntime.validateLegacyWorkBoundary(bad), /CUTOVER_/, key);
  }
  assert.throws(
    () => firstRuntime.validateLegacyWorkBoundary({ ...input, nowMs: 1801 }),
    /CUTOVER_/,
  );
  assert.deepEqual(
    firstRuntime.validateLegacyWorkBoundary({ ...input, nowMs: 1801, phase: 'after-stop' }),
    result,
  );
  assert.throws(
    () => firstRuntime.validateLegacyWorkBoundary({ ...input, nowMs: 2000, phase: 'preopen' }),
    /CUTOVER_/,
  );
  assert.throws(
    () => firstRuntime.validateLegacyWorkBoundary({ ...input, phase: 'unknown' }),
    /CUTOVER_/,
  );
  assert.throws(
    () =>
      firstRuntime.validateLegacyWorkBoundary({
        ...input,
        approval: { ...input.approval, kind: 'ordinary' },
      }),
    /CUTOVER_/,
  );
  const strict = {
    ...input,
    approval: { schemaVersion: 1, inventoryDigest: digest },
    observation: {
      inventoryDigest: digest,
      observedAtMs: 999,
      unsettledWork: 0,
      externalWork: 0,
      activeRequests: 0,
      unknownWriters: 0,
    },
  };
  assert.deepEqual(firstRuntime.validateLegacyWorkBoundary(strict), { mode: 'drained' });
  strict.observation.externalWork = null;
  assert.throws(() => firstRuntime.validateLegacyWorkBoundary(strict), /CUTOVER_/);
  strict.observation.externalWork = 0;
  strict.approval.schemaVersion = 3;
  assert.throws(() => firstRuntime.validateLegacyWorkBoundary(strict), /CUTOVER_/);
});
test('runtime preserves the actual mixed-case kernel hostname in captured targets', async () => {
  const f = fixture();
  f.inventory.host = 'iZbp1ActualNodeZ';
  f.inventory.processes[0].host = f.inventory.host;
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: f.inventory.processes },
    f.io,
  );
  assert.equal(captured.targets[0].host, f.inventory.host);
});
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

// Registration deletion must use the real scheduler settings; treating memory
// restart as zero or inventing a PID for a stopped cron job hides a live source.
test('registration capture preserves memory restart and stopped cron without weakening stop capture', async () => {
  assert.equal(typeof firstRuntime.captureLegacyRegistrations, 'function');
  const f = fixture();
  const workerManager = {
    ...manager,
    name: 'holaday-account-closure-worker',
    memoryRestart: 536870912,
    killTimeoutMs: 660000,
  };
  const worker = { ...target, role: 'worker', managerIdentity: workerManager };
  const cron = {
    ...manager,
    pmId: 5,
    name: 'holaday-files-cron',
    cron: '0 * * * *',
    status: 'stopped',
    rootPid: 0,
  };
  f.inventory.processes = [worker];
  f.inventory.managers = [{ ...workerManager, status: 'online', rootPid: 100 }, cron];
  await assert.rejects(
    captureLegacyRuntime({ inventory: f.inventory, approvedTargets: [worker] }, f.io),
    /CUTOVER_/,
  );
  const captured = await firstRuntime.captureLegacyRegistrations(
    {
      inventory: f.inventory,
      approvedTargets: [worker],
      approvedRegistrations: f.inventory.managers,
    },
    f.io,
  );
  assert.equal(captured.retirement, 'delete-registration');
  assert.equal(captured.managers[0].memoryRestart, 536870912);
  assert.equal(captured.managers[1].rootPid, 0);
  assert.deepEqual(captured.targets, [worker]);
  await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 900000 }, f.io), /CUTOVER_/);
  assert.deepEqual(f.events, []);
});

test('stopped cron alone can be captured only with zero physical processes and listeners', async () => {
  assert.equal(typeof firstRuntime.captureLegacyRegistrations, 'function');
  const f = fixture();
  f.inventory.processes = [];
  f.inventory.listeners = [];
  f.inventory.managers = [
    {
      ...manager,
      name: 'holaday-files-cron',
      pmId: 5,
      cron: '0 * * * *',
      status: 'stopped',
      rootPid: 0,
    },
  ];
  const input = {
    inventory: f.inventory,
    approvedTargets: [],
    approvedRegistrations: f.inventory.managers,
  };
  const result = await firstRuntime.captureLegacyRegistrations(input, f.io);
  assert.equal(result.targets.length, 0);
  for (const change of [
    (s) => {
      s.managers[0].name = 'unrelated';
    },
    (s) => {
      s.managers[0].rootPid = 999;
    },
    (s) => {
      s.managers[0].status = 'online';
    },
    (s) => {
      s.managers[0].version = '6.0.13';
    },
    (s) => {
      s.managers[0].watch = true;
    },
    (s) => {
      s.managers[0].memoryRestart = -1;
    },
    (s) => {
      s.managers[0].cron = '* * * * *';
    },
    (s) => {
      s.managers.push(structuredClone(s.managers[0]));
    },
    (s) => {
      s.listeners = [{ pid: 999, port: 4001 }];
    },
    (s) => {
      s.unknownLaunchers = ['unexpected'];
    },
  ]) {
    const inventory = structuredClone(f.inventory);
    change(inventory);
    await assert.rejects(
      firstRuntime.captureLegacyRegistrations(
        { inventory, approvedTargets: [], approvedRegistrations: inventory.managers },
        f.io,
      ),
      /CUTOVER_/,
    );
  }
});

test('registration capture refuses omitted, drifted and role-mismatched managed scopes', async () => {
  assert.equal(typeof firstRuntime.captureLegacyRegistrations, 'function');
  for (const change of [
    (i) => {
      i.approvedRegistrations = [];
    },
    (i) => {
      i.approvedRegistrations[0].configDigest = 'f'.repeat(64);
    },
    (i) => {
      i.inventory.managers[0].rootPid = 999;
    },
    (i) => {
      i.approvedTargets[0].managerIdentity.name = 'holaday-cn-payment';
      i.inventory.processes = structuredClone(i.approvedTargets);
      i.inventory.managers[0].name = 'holaday-cn-payment';
      i.approvedRegistrations[0].name = 'holaday-cn-payment';
    },
  ]) {
    const f = fixture();
    const input = structuredClone({
      inventory: f.inventory,
      approvedTargets: f.inventory.processes,
      approvedRegistrations: f.inventory.managers,
    });
    change(input);
    await assert.rejects(firstRuntime.captureLegacyRegistrations(input, f.io), /CUTOVER_/);
    assert.deepEqual(f.events, []);
  }
});

function producerFixture() {
  const f = fixture();
  f.io.verifyFence = async () => ({
    inventoryDigest: digest,
    stage: 'orders',
    observedAtMs: f.io.now(),
    unsettledWork: 0,
    externalWork: 0,
    activeRequests: 0,
    unknownWriters: 0,
    producersRunning: f.inventory.processes.length,
    runningProducers: structuredClone(f.inventory.processes),
  });
  return f;
}
test('interrupted producer stop needs the live owned receipt and rejects replay on the post-stop read', async () => {
  for (const fault of [
    undefined,
    'missing-reader',
    'missing-receipt',
    'wrong-risk',
    'wrong-owner',
    'wrong-phase',
    'failure',
    'known-work',
    'stripped',
    'post-stop-replay',
  ]) {
    const f = producerFixture();
    const input = interruptionWork();
    const riskDigest = firstRuntime.validateLegacyWorkBoundary(input).riskDigest;
    const effects = {
      ...input.approval,
      riskDigest,
      recordDigest: '1'.repeat(64),
      phase: 'producers_stopped',
      interruptionObservation: {
        riskDigest,
        sourceDigest: '2'.repeat(64),
        fenceDigest: '3'.repeat(64),
        observedAtMs: 999,
      },
    };
    if (fault === 'missing-receipt') effects.interruptionObservation = undefined;
    if (fault === 'wrong-risk') effects.riskDigest = '0'.repeat(64);
    if (fault === 'wrong-phase') effects.phase = 'orders_fenced';
    if (fault === 'failure') effects.failureObservation = {};
    if (fault !== 'missing-reader')
      f.io.readFirstCutoverEffects = async () => structuredClone(effects);
    f.io.assertJournalOwnership = async () => ({
      inventoryDigest: digest,
      attempt: fault === 'wrong-owner' ? 'other' : effects.attempt,
    });
    const base = f.io.verifyFence;
    f.io.verifyFence = async () => {
      const observation = structuredClone(input.observation);
      if (fault === 'known-work') observation.knownExternalWork = ['identified-action'];
      if (fault === 'post-stop-replay' && f.events.length) observation.pendingReplay = 1;
      if (fault === 'stripped') return base();
      return {
        ...(await base()),
        activeRequests: observation.activeRequests,
        externalWork: observation.externalWork,
        riskDigest,
        legacyWork: { before: observation, after: structuredClone(observation) },
      };
    };
    const captured = await capture(f);
    if (fault) {
      await assert.rejects(
        retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io),
        /CUTOVER_/,
        fault,
      );
      assert.equal(f.events.length, fault === 'post-stop-replay' ? 1 : 0, fault);
    } else {
      assert.equal(
        (await retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io)).phase,
        'producers-stopped',
      );
      assert.deepEqual(f.events, [['pm2', 100, 2]]);
    }
  }
});
test('producer-first stop accepts observed running producers only after orders isolation and work checks', async () => {
  const f = producerFixture();
  const captured = await capture(f);
  const receipt = await retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io);
  assert.equal(receipt.phase, 'producers-stopped');
  assert.deepEqual(f.events, [['pm2', 100, 2]]);
  assert.equal(f.inventory.processes.length, 0);
  await assert.rejects(
    retireLegacyRuntime({ captured, producerReceipt: receipt, deadlineMs: 5000 }, f.io),
    /CUTOVER_/,
  );
  f.io.verifyFence = fixture().io.verifyFence;
  const stopped = await retireLegacyRuntime(
    { captured, producerReceipt: receipt, deadlineMs: 5000 },
    f.io,
  );
  assert.equal(stopped.phase, 'stopped');
  assert.equal(f.events.length, 1); // Never signal an already-retired producer again.
});
test('producer-first work, source age and complete producer identity independently guard every stop', async () => {
  for (const bad of [
    { activeRequests: 1 },
    { unsettledWork: 1 },
    { externalWork: 1 },
    { unknownWriters: 1 },
    { observedAtMs: -60000 },
    { observedAtMs: 1001 },
    { producersRunning: 0 },
    { runningProducers: [] },
    { stage: 'unfenced' },
    { runningProducers: [{ ...target, pid: 999 }] },
  ]) {
    const f = producerFixture();
    const verify = f.io.verifyFence;
    f.io.verifyFence = async () => ({ ...(await verify()), ...bad });
    await assert.rejects(
      retireLegacyProducers({ captured: await capture(f), deadlineMs: 5000 }, f.io),
      /CUTOVER_/,
    );
    assert.deepEqual(f.events, []);
  }
});
test('producer-first gateway or unapproved host process is never silently treated as a producer', async () => {
  const f = producerFixture();
  const gateway = {
    ...target,
    role: 'gateway',
    cwd: '/opt/holaday-cn-payment/releases/083a6232aca7-20260804125641',
  };
  f.inventory.processes = [gateway];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [gateway] },
    f.io,
  );
  await assert.rejects(retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
  assert.deepEqual(f.events, []);
});
test('producer receipt cannot be copied, altered or used after a producer respawns', async () => {
  for (const change of ['copy', 'alter', 'respawn', 'manager', 'port']) {
    const f = producerFixture();
    const captured = await capture(f);
    let receipt = await retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io);
    if (change === 'copy') receipt = structuredClone(receipt);
    if (change === 'alter') receipt.inventoryDigest = 'f'.repeat(64);
    if (change === 'respawn') f.inventory.processes = [{ ...target, start: '999' }];
    if (change === 'manager') f.inventory.managers[0].status = 'online';
    if (change === 'port') f.inventory.listeners = [{ pid: 999, port: 4001 }];
    f.io.verifyFence = fixture().io.verifyFence;
    await assert.rejects(
      retireLegacyRuntime({ captured, producerReceipt: receipt, deadlineMs: 5000 }, f.io),
      /CUTOVER_/,
    );
    assert.equal(f.events.length, 1);
  }
});
test('producer command boundary accepts orders stage without weakening the ordinary first-stop factory', async () => {
  const f = producerFixture();
  const captured = await capture(f);
  const calls = [];
  const system = {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => {
      calls.push(args);
    },
  };
  const producer = createLegacyProducerEffects(f.io, captured, system);
  await producer.pm2Stop(target);
  assert.deepEqual(calls[0].slice(0, 2), ['pm2', ['stop', '2', '--watch']]);
  await assert.rejects(createLegacyRuntimeEffects(f.io, system).pm2Stop(target), /CUTOVER_/);
  f.io.verifyFence = async () => ({
    stage: 'orders',
    unsettledWork: 0,
    externalWork: 0,
    producersRunning: 0,
  });
  await assert.rejects(producer.pm2Stop(target), /CUTOVER_/);
  assert.equal(calls.length, 1);
});

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

test('system Node PM2 manager is distinct from the UID998 Node22 application identity', async () => {
  const f = fixture();
  const approved = structuredClone(target);
  approved.managerIdentity.exe = '/usr/bin/node';
  f.inventory.processes = [structuredClone(approved)];
  f.inventory.managers[0].exe = '/usr/bin/node';
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [approved] },
    f.io,
  );
  assert.equal(captured.targets[0].exe, '/opt/node22/bin/node');
  assert.deepEqual(captured.targets[0].uids, [998, 998, 998, 998]);
  assert.equal(captured.managers[0].exe, '/usr/bin/node');
  const calls = [];
  await createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => calls.push(args),
  }).pm2Stop(approved);
  assert.deepEqual(calls[0].slice(0, 2), ['pm2', ['stop', '2', '--watch']]);
  await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pm2', 100, 2]]);
});

test('system manager support does not accept a root application or arbitrary executable', async () => {
  for (const change of [
    (p) => {
      p.uids = [0, 0, 0, 0];
    },
    (p) => {
      p.exe = '/usr/bin/node';
    },
    (p) => {
      p.managerIdentity.exe = '/tmp/node';
    },
  ]) {
    const f = fixture();
    const p = structuredClone(target);
    p.managerIdentity.exe = '/usr/bin/node';
    change(p);
    f.inventory.processes = [p];
    f.inventory.managers = [{ ...p.managerIdentity, status: 'online', rootPid: p.pid }];
    await assert.rejects(
      captureLegacyRuntime({ inventory: f.inventory, approvedTargets: [p] }, f.io),
      /CUTOVER_RUNTIME_UNPROVEN/,
    );
    assert.deepEqual(f.events, []);
  }
});

test('approved system manager replacement is refused immediately before the command', async () => {
  const f = fixture();
  const p = structuredClone(target);
  p.managerIdentity.exe = '/usr/bin/node';
  f.inventory.processes = [structuredClone(p)];
  f.inventory.managers = [{ ...p.managerIdentity, status: 'online', rootPid: p.pid }];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [p] },
    f.io,
  );
  // Both are otherwise eligible executables; approval is still for one exact daemon.
  f.inventory.managers[0].exe = '/opt/node22/bin/node';
  await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
  let calls = 0;
  await assert.rejects(
    createLegacyRuntimeEffects(f.io, {
      platform: 'linux',
      uid: 0,
      exec: async () => {
        calls++;
      },
    }).pm2Stop(p),
    /CUTOVER_/,
  );
  assert.equal(calls, 0);
});

test('explicit eleven-minute stop policy fits a bounded window without shortening PM2 timeout', async () => {
  const f = fixture();
  const p = structuredClone(target);
  p.role = 'worker';
  p.managerIdentity.killTimeoutMs = 660000;
  p.managerIdentity.name = 'holaday-account-closure-worker';
  f.inventory.processes = [p];
  f.inventory.managers = [{ ...p.managerIdentity, status: 'online', rootPid: p.pid }];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [p] },
    f.io,
  );
  const stop = f.io.pm2Stop;
  f.io.pm2Stop = async (approved) => {
    assert.equal(approved.managerIdentity.killTimeoutMs, 660000);
    await f.io.sleep(660000);
    await stop(approved);
  };
  const receipt = await retireLegacyRuntime({ captured, deadlineMs: 720000 }, f.io);
  assert.equal(receipt.phase, 'stopped');
  assert.equal(receipt.observedAtMs, 661100);
  assert.deepEqual(f.events, [['pm2', 100, 2]]);
});

test('insufficient total stop budget refuses before stopping even the first approved process', async () => {
  const f = fixture();
  const worker = structuredClone(target);
  worker.pid = 101;
  worker.role = 'worker';
  worker.managerIdentity.pmId = 3;
  worker.managerIdentity.name = 'holaday-account-closure-worker';
  worker.managerIdentity.killTimeoutMs = 4000;
  f.inventory.processes.push(worker);
  f.inventory.managers.push({ ...worker.managerIdentity, status: 'online', rootPid: worker.pid });
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: f.inventory.processes },
    f.io,
  );
  await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
  assert.deepEqual(f.events, []);
});

test('unknown timeout and restart policies stay blocked instead of being silently normalized', async () => {
  for (const bad of [
    { killTimeoutMs: null },
    { killTimeoutMs: 660001 },
    { killTimeoutMs: 0 },
    { memoryRestart: 536870912 },
    { cron: '0 * * * *' },
    { watch: true },
  ]) {
    const f = fixture();
    const p = { ...target, managerIdentity: { ...manager, ...bad } };
    f.inventory.processes = [p];
    f.inventory.managers = [{ ...p.managerIdentity, status: 'online', rootPid: p.pid }];
    await assert.rejects(
      captureLegacyRuntime({ inventory: f.inventory, approvedTargets: [p] }, f.io),
      /CUTOVER_/,
    );
    assert.deepEqual(f.events, []);
  }
});

function gatewayTreeFixture() {
  const f = fixture();
  const cwd = '/opt/holaday-cn-payment/releases/604ddf17e84a-20260827133820/apps/cn-payment';
  const m = { ...manager, exe: '/usr/bin/node', name: 'holaday-cn-payment', pmId: 1 };
  const executables = [
    '/usr/bin/node',
    '/usr/bin/dash',
    '/usr/bin/node',
    '/usr/bin/node',
    '/opt/holaday-cn-payment/releases/604ddf17e84a-20260827133820/node_modules/.pnpm/@esbuild+linux-x64@0.27.7/node_modules/@esbuild/linux-x64/bin/esbuild',
  ];
  const tree = executables.map((exe, i) => ({
    ...target,
    host: 'aliyun',
    pid: 100 + i,
    ppid: i ? 99 + i : 50,
    start: String(300 + i),
    exe,
    cwd,
    role: 'gateway',
    uids: [0, 0, 0, 0],
    managerIdentity: { ...m },
  }));
  Object.assign(f.inventory, {
    host: 'aliyun',
    processes: tree,
    managers: [{ ...m, status: 'online', rootPid: 100 }],
    ports: [4010],
    listeners: [{ port: 4010, pid: 103 }],
  });
  return { ...f, tree };
}

test('audited root gateway Node-shell-esbuild tree is captured whole and stopped by one PM2 id', async () => {
  const f = gatewayTreeFixture();
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: f.tree },
    f.io,
  );
  assert.equal(captured.targets.length, 5);
  const calls = [];
  await createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => calls.push(args),
  }).pm2Stop(f.tree[0], f.tree);
  assert.deepEqual(calls[0].slice(0, 2), ['pm2', ['stop', '1', '--watch']]);
  await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pm2', 100, 1]]);
});

test('root gateway exceptions never include another release, app, uid mix or executable', async () => {
  for (const change of [
    (tree) => {
      tree[4].exe = tree[4].exe.replace('604ddf17e84a', 'aaaaaaaaaaaa');
    },
    (tree) => {
      tree[1].exe = '/usr/bin/bash';
    },
    (tree) => {
      tree[3].cwd = '/opt/holaday-monorepo/apps/orchestrator';
    },
    (tree) => {
      tree[3].uids = [0, 998, 0, 0];
    },
    (tree) => {
      tree[3].role = 'worker';
    },
    (tree) => {
      tree[3].cwd = tree[3].cwd.replace('604ddf17e84a', 'aaaaaaaaaaaa');
    },
    (tree) => {
      for (const p of tree) p.managerIdentity.name = 'unrelated';
    },
    (tree) => {
      tree[0].exe = '/usr/bin/dash';
    },
    (tree) => {
      tree[3].ppid = 999;
    },
  ]) {
    const f = gatewayTreeFixture();
    change(f.tree);
    f.inventory.managers[0] = { ...f.tree[0].managerIdentity, status: 'online', rootPid: 100 };
    await assert.rejects(
      captureLegacyRuntime({ inventory: f.inventory, approvedTargets: f.tree }, f.io),
      /CUTOVER_/,
    );
    assert.deepEqual(f.events, []);
  }
});

test('unmanaged root gateway stays restricted to system Node and exact release application path', async () => {
  const f = gatewayTreeFixture();
  const p = { ...f.tree[0], ppid: 1, managerIdentity: { kind: 'unmanaged' } };
  f.inventory.processes = [p];
  f.inventory.managers = [];
  f.inventory.listeners = [{ pid: p.pid, port: 4010 }];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [p] },
    f.io,
  );
  const calls = [];
  await createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => calls.push(args),
  }).signalPinned(p);
  assert.deepEqual(JSON.parse(calls[0][2].input), p);
  await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pidfd', 100]]);
  for (const change of [{ exe: '/usr/bin/dash' }, { cwd: p.cwd.replace('/apps/cn-payment', '') }]) {
    const invalid = { ...p, ...change };
    f.inventory.processes = [invalid];
    await assert.rejects(
      captureLegacyRuntime({ inventory: f.inventory, approvedTargets: [invalid] }, f.io),
      /CUTOVER_/,
    );
  }
});

test('a managed root gateway cannot mix the older UID998 profile into its approved tree', async () => {
  const f = gatewayTreeFixture();
  f.tree[3].uids = [998, 998, 998, 998];
  f.tree[3].exe = '/opt/node22/bin/node';
  // Keep a leaf so no other child's ancestry check hides the mixed-profile defect.
  f.tree.pop();
  await assert.rejects(
    captureLegacyRuntime({ inventory: f.inventory, approvedTargets: f.tree }, f.io),
    /CUTOVER_/,
  );
  assert.deepEqual(f.events, []);
});

test('command boundary independently refuses an orphan in an otherwise matching gateway tree', async () => {
  const f = gatewayTreeFixture();
  f.tree[4].ppid = 999;
  let calls = 0;
  await assert.rejects(
    createLegacyRuntimeEffects(f.io, {
      platform: 'linux',
      uid: 0,
      exec: async () => {
        calls++;
      },
    }).pm2Stop(f.tree[0], f.tree),
    /CUTOVER_/,
  );
  assert.equal(calls, 0);
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
