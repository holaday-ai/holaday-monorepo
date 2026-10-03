import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ingressDiagnosticError } from './browser-first-cutover-ingress-diagnostics.mjs';
import { performFirstCutover } from './browser-first-cutover-transition.mjs';
const candidate = 'c'.repeat(40);
const identity = { candidate, bootId: 'd'.repeat(32) };
const serving = { protocol: 1, identity, mode: 'serving', needsReconciliation: true, idle: false };
const window = { maintenanceEndsAtMs: 2000, reconcileByMs: 3000, operatorRef: 'qa-operator' };
const run = (f, options = {}) =>
  performFirstCutover({ candidate, adapter: f.adapter, window, clock: () => 1000, ...options });
function fixture(fault) {
  const events = [];
  const step = async (name) => {
    events.push(name);
    if (fault === name) throw new Error('CUTOVER_UNPROVEN');
  };
  const adapter = Object.fromEntries(
    [
      'preflight',
      'stage',
      'fenceOrders',
      'settleLegacy',
      'stopProducers',
      'fenceAll',
      'stopLegacy',
      'backupAndRestoreCheck',
      'migrate',
      'initializeState',
      'verify',
      'beforeOpen',
      'afterOpen',
      'resumeWorker',
      'reconcile',
    ].map((name) => [name, () => step(name)]),
  );
  Object.assign(adapter, {
    persist: (phase) => step(`phase:${phase}`),
    start: async () => {
      await step('start');
      return identity;
    },
    open: async () => {
      await step('open');
      return serving;
    },
    status: async () => {
      await step('status');
      return serving;
    },
    close: async (actual) => {
      assert.deepEqual(actual, identity);
      await step('close');
      return { ...serving, mode: 'closed' };
    },
    holdMaintenance: async (detail) => {
      events.push('hold');
      assert.equal(typeof detail.phase, 'string');
      return { closeAcknowledged: detail.closeAcknowledged === true };
    },
  });
  return { events, adapter };
}
const success = [
  'preflight',
  'stage',
  'phase:prepared',
  'phase:orders_fenced',
  'fenceOrders',
  'phase:legacy_settled',
  'settleLegacy',
  'phase:producers_stopped',
  'stopProducers',
  'phase:all_fenced',
  'fenceAll',
  'phase:stopped',
  'stopLegacy',
  'phase:backup_verified',
  'backupAndRestoreCheck',
  'phase:migration_started',
  'migrate',
  'initializeState',
  'phase:candidate_started',
  'start',
  'verify',
  'phase:verified',
  'beforeOpen',
  'open',
  'afterOpen',
  'resumeWorker',
  'phase:opened',
  'phase:reconciled',
  'reconcile',
];
test('first cutover uses ordered intents, initializes after migration and completes real reconciliation last', async () => {
  const f = fixture();
  assert.deepEqual(await run(f), {
    ok: true,
    phase: 'reconciled',
    identity,
  });
  assert.deepEqual(f.events, success);
});
test('first interruption selection uses its own intent and never falls back to a drain claim', async () => {
  const f = fixture();
  f.adapter.readLegacyDisposition = async () => ({
    mode: 'controlled-interruption',
    riskDigest: '7'.repeat(64),
  });
  f.adapter.acceptLegacyInterruption = async () => f.events.push('accept-interruption');
  assert.equal((await run(f, { window: { ...window, schemaVersion: 2 } })).ok, true);
  assert.deepEqual(
    f.events,
    success.map((name) =>
      name === 'phase:legacy_settled'
        ? 'phase:legacy_interruption_accepted'
        : name === 'settleLegacy'
          ? 'accept-interruption'
          : name,
    ),
  );
  for (const fault of ['reader', 'missing-effect', 'receipt', 'malformed']) {
    const g = fixture();
    g.adapter.readLegacyDisposition = async () => {
      if (fault === 'reader') throw new Error('CUTOVER_WORK_UNPROVEN');
      return {
        mode: 'controlled-interruption',
        riskDigest: fault === 'malformed' ? '' : '7'.repeat(64),
      };
    };
    if (fault !== 'missing-effect')
      g.adapter.acceptLegacyInterruption = async () => {
        throw new Error('CUTOVER_WORK_UNPROVEN');
      };
    assert.equal((await run(g, { window: { ...window, schemaVersion: 2 } })).ok, false, fault);
    assert.equal(g.events.includes('stopProducers'), false, fault);
    assert.equal(g.events.includes('settleLegacy'), false, fault);
    assert.equal(g.events.includes('migrate'), false, fault);
  }
});
test('legacy and v1 windows cannot opt into interruption through an adapter result', async () => {
  for (const version of [{}, { schemaVersion: 1 }]) {
    const f = fixture();
    f.adapter.readLegacyDisposition = async () => ({
      mode: 'controlled-interruption',
      riskDigest: '7'.repeat(64),
    });
    f.adapter.acceptLegacyInterruption = async () => f.events.push('accept-interruption');
    assert.equal((await run(f, { window: { ...window, ...version } })).ok, false);
    assert.equal(f.events.includes('accept-interruption'), false);
    assert.equal(f.events.includes('stopProducers'), false);
    assert.equal(f.events.includes('migrate'), false);
  }
});
test('a v2 window cannot fall through an old adapter or claim the strict drain path', async () => {
  for (const kind of ['old-adapter', 'drained']) {
    const f = fixture();
    if (kind === 'drained') {
      f.adapter.readLegacyDisposition = async () => ({ mode: 'drained' });
      f.adapter.acceptLegacyInterruption = async () => {};
    }
    assert.equal((await run(f, { window: { ...window, schemaVersion: 2 } })).ok, false);
    assert.equal(f.events.includes('settleLegacy'), false);
    assert.equal(f.events.includes('stopProducers'), false);
  }
});
for (const fault of success.filter((event) => event !== 'open')) {
  test(`first cutover interruption at ${fault} never advances or repeats the failed step`, async () => {
    const f = fixture(fault);
    const result = await run(f);
    assert.equal(result.ok, false);
    assert.equal(
      result.action,
      ['preflight', 'stage'].includes(fault) ? 'abort_without_mutation' : 'hold_maintenance',
    );
    const attempted = f.events.filter((e) => e !== 'close' && e !== 'hold');
    assert.deepEqual(attempted, success.slice(0, success.indexOf(fault) + 1));
    if (result.action === 'hold_maintenance') assert.equal(f.events.at(-1), 'hold');
    assert.equal(result.code, 'CUTOVER_UNPROVEN');
  });
}
test('first cutover lost open ACK never repeats open, and still performs post-open verification', async () => {
  const f = fixture('open');
  const result = await run(f);
  assert.equal(result.ok, true);
  assert.equal(f.events.filter((e) => e === 'open').length, 1);
  assert.equal(f.events.includes('status'), true);
  assert.equal(f.events.at(-1), 'reconcile');
});
test('first cutover missing post-open verification refuses before any work', async () => {
  const f = fixture();
  f.adapter.reconcile = undefined;
  const result = await run(f);
  assert.equal(result.ok, false);
  assert.deepEqual(f.events, []);
});
test('first cutover failed hold does not mask original error or claim close acknowledged', async () => {
  const f = fixture('stopLegacy');
  f.adapter.holdMaintenance = async () => {
    throw new Error('sensitive');
  };
  const result = await run(f);
  assert.equal(result.code, 'CUTOVER_UNPROVEN');
  assert.equal(result.closeAcknowledged, false);
});
test('first cutover rejects absent, expired, malformed or regressing maintenance windows before side effects', async () => {
  for (const options of [
    { window: undefined },
    { window: { ...window, reconcileByMs: 1999 } },
    { window: { ...window, operatorRef: '' } },
    { clock: () => 2000 },
    { clock: () => Number.NaN },
    {
      clock: (() => {
        let t = 1000;
        return () => --t;
      })(),
    },
  ]) {
    const f = fixture();
    const result = await run(f, options);
    assert.equal(result.ok, false);
    assert.match(result.code, /^CUTOVER_(WINDOW|DEADLINE)_UNPROVEN$/);
    assert.equal(f.events.includes('fenceOrders'), false);
  }
});
test('a build finishing past the deadline is not killed or retried and cannot close ingress', async () => {
  const f = fixture();
  let now = 1000;
  f.adapter.stage = async () => {
    f.events.push('stage');
    now = 2000;
  };
  const result = await run(f, { clock: () => now });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CUTOVER_DEADLINE_UNPROVEN');
  assert.deepEqual(f.events, ['preflight', 'stage']);
});
test('deadline expiry between journal intent and an irreversible action blocks that action and holds maintenance', async () => {
  for (const [intent, action] of [
    ['orders_fenced', 'fenceOrders'],
    ['producers_stopped', 'stopProducers'],
    ['migration_started', 'migrate'],
    ['candidate_started', 'start'],
  ]) {
    const f = fixture();
    let now = 1000;
    const original = f.adapter.persist;
    f.adapter.persist = async (...args) => {
      await original(...args);
      if (args[0] === intent) now = 2000;
    };
    const result = await run(f, { clock: () => now });
    assert.equal(result.ok, false, intent);
    assert.equal(result.code, 'CUTOVER_DEADLINE_UNPROVEN', intent);
    assert.equal(f.events.includes(action), false, intent);
    assert.equal(f.events.at(-1), 'hold', intent);
  }
});
test('migration completing late is never retried and cannot initialize clean state or start', async () => {
  const f = fixture();
  let now = 1000;
  f.adapter.migrate = async () => {
    f.events.push('migrate');
    now = 2001;
  };
  const result = await run(f, { clock: () => now });
  assert.equal(result.code, 'CUTOVER_DEADLINE_UNPROVEN');
  assert.equal(f.events.filter((e) => e === 'migrate').length, 1);
  assert.equal(f.events.includes('initializeState'), false);
  assert.equal(f.events.includes('start'), false);
  assert.equal(f.events.at(-1), 'hold');
});
test('expiry immediately before open closes the known candidate instead of treating status as authorization', async () => {
  const f = fixture();
  let now = 1000;
  f.adapter.beforeOpen = async () => {
    f.events.push('beforeOpen');
    now = 2000;
  };
  const result = await run(f, { clock: () => now });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CUTOVER_DEADLINE_UNPROVEN');
  assert.equal(f.events.includes('open'), false);
  assert.equal(f.events.includes('resumeWorker'), false);
  assert.equal(f.events.includes('close'), true);
  assert.equal(result.closeAcknowledged, true);
});
test('post-open reconciliation uses its own deadline and expiry still permits a protective hold', async () => {
  for (const nowAfterOpen of [2500, 3000]) {
    const f = fixture();
    let now = 1000;
    const original = f.adapter.persist;
    f.adapter.persist = async (...args) => {
      await original(...args);
      if (args[0] === 'opened') now = nowAfterOpen;
    };
    const result = await run(f, { clock: () => now });
    assert.equal(result.ok, nowAfterOpen === 2500);
    assert.equal(f.events.includes('reconcile'), nowAfterOpen === 2500);
    if (nowAfterOpen === 3000) assert.equal(f.events.at(-1), 'hold');
  }
});

test('fixed attach stage survives transition without leaking a cause message', async () => {
  const f = fixture();
  f.adapter.stage = async () => {
    throw ingressDiagnosticError(
      'CUTOVER_SITE_UNPROVEN',
      'ATTACH_GATEWAY',
      Error('PRIVATE_SECRET'),
    );
  };
  const result = await run(f);
  assert.equal(result.ok, false);
  assert.equal(result.ingressStage, 'ATTACH_GATEWAY');
  assert.equal(JSON.stringify(result).includes('PRIVATE_SECRET'), false);
});
