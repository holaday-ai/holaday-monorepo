import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performMaintenanceRelease } from './browser-maintenance-transition.mjs';
const old = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
const next = { candidate: 'c'.repeat(40), bootId: 'd'.repeat(32) };
const closed = {
  protocol: 1,
  identity: old,
  mode: 'closed',
  idle: true,
  needsReconciliation: false,
};
function harness(fail) {
  const events = [];
  const event = async (name) => {
    events.push(name);
    if (fail === name) throw new Error('injected');
  };
  return {
    events,
    adapter: {
      capability: async () => {
        await event('capability');
        return { ...closed, mode: 'serving' };
      },
      preflight: async () => event('preflight'),
      stage: async () => event('stage'),
      persist: async (phase) => event(`phase:${phase}`),
      close: async (identity) => {
        await event(identity === old ? 'close-old' : 'close-new');
      },
      stopWorker: async () => {
        await event('worker');
        return true;
      },
      wait: async () => {
        await event('wait');
        return closed;
      },
      stop: async () => event('stop'),
      migrate: async () => event('migration'),
      start: async () => {
        await event('start');
        return next;
      },
      verify: async () => event('verify'),
      beforeOpen: async () => event('before-open'),
      afterOpen: async () => event('after-open'),
      open: async () => {
        await event('open');
        return {
          ...closed,
          identity: next,
          mode: 'serving',
          needsReconciliation: true,
          idle: false,
        };
      },
      status: async () => {
        await event('status');
        return {
          ...closed,
          identity: next,
          mode: 'serving',
          needsReconciliation: true,
          idle: false,
        };
      },
      resumeWorker: async (identity) => {
        assert.deepEqual(identity, next);
        await event('resume-worker');
      },
    },
  };
}
test('legacy or missing capability stops before stage/close/stop/migration', async () => {
  for (const value of [null, {}, { protocol: 0 }, { protocol: 1 }]) {
    const f = harness();
    f.adapter.capability = async () => {
      f.events.push('capability');
      return value;
    };
    const result = await performMaintenanceRelease({
      candidate: next.candidate,
      adapter: f.adapter,
    });
    assert.equal(result.ok, false);
    assert.equal(result.action, 'abort_without_mutation');
    assert.deepEqual(f.events, ['capability']);
  }
});
test('success persists each next phase before its irreversible action', async () => {
  const f = harness();
  assert.equal(
    (await performMaintenanceRelease({ candidate: next.candidate, adapter: f.adapter })).ok,
    true,
  );
  assert.deepEqual(f.events, [
    'capability',
    'preflight',
    'stage',
    'phase:closed',
    'close-old',
    'worker',
    'wait',
    'phase:stopped',
    'stop',
    'phase:migration_started',
    'migration',
    'phase:candidate_started',
    'start',
    'verify',
    'phase:verified',
    'before-open',
    'open',
    'after-open',
    'resume-worker',
    'phase:opened',
  ]);
});
for (const failure of [
  'capability',
  'preflight',
  'stage',
  'phase:closed',
  'close-old',
  'worker',
  'wait',
  'phase:stopped',
  'stop',
  'phase:migration_started',
  'migration',
  'phase:candidate_started',
  'start',
  'verify',
  'phase:verified',
  'before-open',
  'after-open',
  'resume-worker',
  'phase:opened',
]) {
  test(`failure ${failure} never rolls back or repeats uncertain work`, async () => {
    const f = harness(failure);
    const result = await performMaintenanceRelease({
      candidate: next.candidate,
      adapter: f.adapter,
    });
    assert.equal(result.ok, false);
    assert.equal(
      result.action,
      ['capability', 'preflight', 'stage'].includes(failure)
        ? 'abort_without_mutation'
        : 'hold_maintenance',
    );
    for (const step of ['stage', 'stop', 'migration', 'start', 'open'])
      assert.ok(f.events.filter((e) => e === step).length <= 1);
    assert.equal(f.events.includes('rollback'), false);
    if (failure === 'migration') assert.equal(f.events.includes('start'), false);
    if (failure === 'start') assert.equal(f.events.includes('open'), false);
  });
}
test('worker proof, same old boot, clean idle are independent stop requirements', async () => {
  for (const override of [
    { worker: false },
    { wait: { ...closed, idle: false } },
    { wait: { ...closed, needsReconciliation: true } },
    { wait: { ...closed, identity: next } },
  ]) {
    const f = harness();
    if ('worker' in override) f.adapter.stopWorker = async () => override.worker;
    if ('wait' in override) f.adapter.wait = async () => override.wait;
    const result = await performMaintenanceRelease({
      candidate: next.candidate,
      adapter: f.adapter,
    });
    assert.equal(result.code, 'MAINTENANCE_UNPROVEN');
    assert.equal(f.events.includes('stop'), false);
  }
});
test('lost open ACK only reads same-instance status; never repeats open', async () => {
  const f = harness('open');
  const result = await performMaintenanceRelease({ candidate: next.candidate, adapter: f.adapter });
  assert.equal(result.ok, true);
  assert.deepEqual(f.events.slice(-5), [
    'open',
    'status',
    'after-open',
    'resume-worker',
    'phase:opened',
  ]);
  assert.equal(f.events.filter((e) => e === 'open').length, 1);
});

test('worker startup failure after open closes the same new instance and never claims opened', async () => {
  const f = harness('resume-worker');
  const result = await performMaintenanceRelease({ candidate: next.candidate, adapter: f.adapter });
  assert.equal(result.ok, false);
  assert.equal(result.action, 'hold_maintenance');
  assert.equal(result.phase, 'verified');
  assert.deepEqual(f.events.slice(-3), ['after-open', 'resume-worker', 'close-new']);
  assert.equal(f.events.includes('phase:opened'), false);
});
test('lost open ACK plus closed/foreign/unavailable status holds maintenance', async () => {
  for (const status of [
    closed,
    { ...closed, identity: { ...next, bootId: old.bootId }, mode: 'serving' },
    null,
  ]) {
    const f = harness('open');
    f.adapter.status = async () => status;
    const result = await performMaintenanceRelease({
      candidate: next.candidate,
      adapter: f.adapter,
    });
    assert.equal(result.ok, false);
    assert.equal(result.action, 'hold_maintenance');
    assert.equal(f.events.at(-1), 'close-new');
  }
});
