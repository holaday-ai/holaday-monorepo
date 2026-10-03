import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retireMaintenanceRuntime } from './browser-maintenance-runtime.mjs';
const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
const main = {
  pid: 101,
  start: '1000',
  uid: 998,
  cwd: `/opt/holaday-releases/${identity.candidate}/apps/orchestrator`,
  command: 'main',
  autorestart: false,
};
const worker = { ...main, pid: 102, start: '1001', command: 'worker' };
const receipt = { protocol: 1, identity, mode: 'closed', idle: true, needsReconciliation: false };
function fixture({ workerTicks = 0, mainTicks = 0, portsBusy = false } = {}) {
  let clock = 0;
  let signalled = false;
  const events = [];
  return {
    events,
    effects: {
      now: () => clock,
      sleep: async () => {
        clock++;
      },
      readProcess: async (pid) =>
        pid === worker.pid
          ? clock < workerTicks
            ? worker
            : null
          : !signalled || clock < workerTicks + mainTicks
            ? main
            : null,
      signal: async (pid, signal) => {
        events.push([pid, signal]);
        signalled = true;
      },
      portsFree: async () => !portsBusy,
      managerStopped: async () => true,
    },
  };
}
test('waits for the original worker page/process before TERM to original main', async () => {
  const f = fixture({ workerTicks: 3, mainTicks: 2 });
  await retireMaintenanceRuntime({
    identity,
    receipt,
    main,
    worker,
    deadlineMs: 10,
    effects: f.effects,
  });
  assert.deepEqual(f.events, [[101, 'SIGTERM']]);
  assert.ok(f.effects.now() >= 5);
});
test('busy worker never receives a forced signal and main is untouched', async () => {
  const f = fixture({ workerTicks: 100 });
  await assert.rejects(
    retireMaintenanceRuntime({
      identity,
      receipt,
      main,
      worker,
      deadlineMs: 5,
      effects: f.effects,
    }),
    /MAINTENANCE_WORKER_BUSY/,
  );
  assert.deepEqual(f.events, []);
});
test('main timeout sends one TERM, never KILL or PM2 stop/delete', async () => {
  const f = fixture({ mainTicks: 100 });
  await assert.rejects(
    retireMaintenanceRuntime({
      identity,
      receipt,
      main,
      worker,
      deadlineMs: 5,
      effects: f.effects,
    }),
    /MAINTENANCE_PROCESS_BUSY/,
  );
  assert.deepEqual(f.events, [[101, 'SIGTERM']]);
});
test('refuses dirty/foreign receipt or auto-restarting processes before signals', async () => {
  for (const change of [
    { receipt: { ...receipt, needsReconciliation: true } },
    { receipt: { ...receipt, identity: { ...identity, bootId: 'c'.repeat(32) } } },
    { main: { ...main, autorestart: true } },
    { worker: { ...worker, autorestart: true } },
  ]) {
    const f = fixture();
    await assert.rejects(
      retireMaintenanceRuntime({
        identity,
        receipt,
        main,
        worker,
        deadlineMs: 5,
        effects: f.effects,
        ...change,
      }),
      /MAINTENANCE_/,
    );
    assert.deepEqual(f.events, []);
  }
});
test('PID reuse/start-time mismatch is not original exit proof and is never signalled', async () => {
  const f = fixture();
  f.effects.readProcess = async (pid) => (pid === 101 ? { ...main, start: 'new' } : null);
  await assert.rejects(
    retireMaintenanceRuntime({
      identity,
      receipt,
      main,
      worker,
      deadlineMs: 5,
      effects: f.effects,
    }),
    /MAINTENANCE_PROCESS_IDENTITY/,
  );
  assert.deepEqual(f.events, []);
});
test('port or PM2 ownership remaining after exit still blocks stop completion', async () => {
  for (const failure of ['ports', 'manager']) {
    const f = fixture({ portsBusy: failure === 'ports' });
    if (failure === 'manager') f.effects.managerStopped = async () => false;
    await assert.rejects(
      retireMaintenanceRuntime({
        identity,
        receipt,
        main,
        worker,
        deadlineMs: 5,
        effects: f.effects,
      }),
      /MAINTENANCE_STOP_UNPROVEN/,
    );
  }
});

test('clean receipt for one candidate never authorizes stopping another checkout', async () => {
  const calls = [];
  await assert.rejects(
    retireMaintenanceRuntime({
      identity,
      receipt,
      main: { ...main, cwd: `/opt/holaday-releases/${'c'.repeat(40)}/apps/orchestrator` },
      worker: null,
      deadlineMs: 5,
      effects: {
        now: () => 0,
        readProcess: async () => {
          calls.push('read');
          throw new Error('WRONG_CANDIDATE_REACHED_EFFECTS');
        },
        managerStopped: async () => true,
      },
    }),
    { message: 'MAINTENANCE_STOP_INPUT' },
  );
  assert.deepEqual(calls, []);
});
