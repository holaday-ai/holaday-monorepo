import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finishStoppedRelease } from './browser-maintenance-release-tail.mjs';

const candidate = 'c'.repeat(40);
const previousBootId = 'b'.repeat(32);
const identity = { candidate, bootId: 'd'.repeat(32) };
const serving = { protocol: 1, identity, mode: 'serving', needsReconciliation: true, idle: false };
function fixture(fault) {
  const events = [];
  const step = async (name) => {
    events.push(name);
    if (name === fault) throw new Error('injected secret');
  };
  const adapter = {
    persist: async (phase, detail) => {
      assert.equal(detail.candidate, candidate);
      if (phase === 'verified' || phase === 'opened') assert.deepEqual(detail.identity, identity);
      await step(`phase:${phase}`);
    },
    migrate: () => step('migrate'),
    start: async () => {
      await step('start');
      return identity;
    },
    verify: () => step('verify'),
    beforeOpen: () => step('beforeOpen'),
    open: async () => {
      await step('open');
      return serving;
    },
    status: async () => {
      await step('status');
      return serving;
    },
    afterOpen: () => step('afterOpen'),
    resumeWorker: () => step('worker'),
    close: async (actual) => {
      assert.deepEqual(actual, identity);
      await step('close');
      return { ...serving, mode: 'closed' };
    },
  };
  return { events, adapter };
}
test('shared tail persists intent before migration/start and refreshes evidence before single open', async () => {
  const f = fixture();
  assert.deepEqual(await finishStoppedRelease({ candidate, previousBootId, adapter: f.adapter }), {
    ok: true,
    phase: 'opened',
    identity,
  });
  assert.deepEqual(f.events, [
    'phase:migration_started',
    'migrate',
    'phase:candidate_started',
    'start',
    'verify',
    'phase:verified',
    'beforeOpen',
    'open',
    'afterOpen',
    'worker',
    'phase:opened',
  ]);
});
for (const fault of [
  'phase:migration_started',
  'migrate',
  'phase:candidate_started',
  'start',
  'verify',
  'phase:verified',
  'beforeOpen',
  'afterOpen',
  'worker',
  'phase:opened',
]) {
  test(`shared tail ${fault} failure never replays or rolls back uncertain actions`, async () => {
    const f = fixture(fault);
    const result = await finishStoppedRelease({ candidate, previousBootId, adapter: f.adapter });
    assert.equal(result.ok, false);
    assert.equal(result.action, 'hold_maintenance');
    assert.equal(result.code, 'MAINTENANCE_RELEASE_FAILED');
    for (const name of ['migrate', 'start', 'open', 'afterOpen', 'worker'])
      assert.ok(f.events.filter((e) => e === name).length <= 1);
    const known = [
      'verify',
      'phase:verified',
      'beforeOpen',
      'afterOpen',
      'worker',
      'phase:opened',
    ].includes(fault);
    assert.equal(result.closeAcknowledged, known);
    if (fault === 'migrate') assert.equal(f.events.includes('start'), false);
    if (fault === 'beforeOpen') assert.equal(f.events.includes('open'), false);
  });
}
test('shared tail lost open ACK queries same instance once', async () => {
  const f = fixture('open');
  const result = await finishStoppedRelease({ candidate, previousBootId, adapter: f.adapter });
  assert.equal(result.ok, true);
  assert.equal(f.events.filter((e) => e === 'open').length, 1);
  assert.deepEqual(f.events.slice(-5), ['open', 'status', 'afterOpen', 'worker', 'phase:opened']);
});
test('shared tail rejects foreign or reused boot before verification/open', async () => {
  for (const started of [
    null,
    {},
    { candidate: 'a'.repeat(40), bootId: identity.bootId },
    { candidate, bootId: previousBootId },
  ]) {
    const f = fixture();
    f.adapter.start = async () => started;
    const result = await finishStoppedRelease({ candidate, previousBootId, adapter: f.adapter });
    assert.equal(result.code, 'MAINTENANCE_IDENTITY_MISMATCH');
    assert.equal(f.events.includes('verify'), false);
    assert.equal(f.events.includes('open'), false);
    assert.equal(f.events.includes('close'), false); // Never close a foreign process.
  }
});
test('shared tail requires explicit pre/post-open gates before any migration', async () => {
  for (const method of ['beforeOpen', 'afterOpen', 'persist', 'status', 'close']) {
    const f = fixture();
    delete f.adapter[method];
    const result = await finishStoppedRelease({ candidate, previousBootId, adapter: f.adapter });
    assert.equal(result.ok, false);
    assert.deepEqual(f.events, []);
  }
});
test('shared tail does not treat wrong/dirty/unknown open status as success', async () => {
  for (const result of [
    null,
    { ...serving, protocol: 0 },
    { ...serving, mode: 'closed' },
    { ...serving, needsReconciliation: false },
    { ...serving, idle: true },
    { ...serving, identity: { ...identity, bootId: previousBootId } },
  ]) {
    const f = fixture('open');
    f.adapter.status = async () => result;
    const actual = await finishStoppedRelease({ candidate, previousBootId, adapter: f.adapter });
    assert.equal(actual.code, 'MAINTENANCE_OPEN_UNPROVEN');
    assert.equal(actual.closeAcknowledged, true);
    assert.equal(f.events.includes('afterOpen'), false);
    assert.equal(f.events.includes('worker'), false);
  }
});
test('shared tail preserves uncertain close rather than fabricating a clean stop', async () => {
  for (const close of [
    async () => {
      throw new Error('lost');
    },
    async () => undefined,
    async () => serving,
    async () => ({ ...serving, mode: 'closed', identity: { ...identity, bootId: previousBootId } }),
  ]) {
    const f = fixture('verify');
    f.adapter.close = close;
    const result = await finishStoppedRelease({ candidate, previousBootId, adapter: f.adapter });
    assert.equal(result.closeAcknowledged, false);
    assert.equal(result.ok, false);
  }
});
