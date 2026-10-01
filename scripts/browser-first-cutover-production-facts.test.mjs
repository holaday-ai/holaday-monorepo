import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

test('default facts compose real writer records and refuse preserved or unattributed database owners', async () => {
  const m = await import('./browser-first-cutover-production-facts.mjs');
  const binding = {
    attempt: '12345678-1234-4234-8234-123456789abc',
    inventoryDigest: 'a'.repeat(64),
  };
  const ctx = {
    binding,
    approval: { ...binding, schemaVersion: 2, maintenanceEndsAtMs: 2000 },
    journal: {
      assertOwnership: async () => binding,
      readFirstCutoverEffects: async () => ({ phase: 'orders_fenced' }),
    },
  };
  const actual = {
    inventoryDigest: binding.inventoryDigest,
    observedAtMs: 1000,
    unknownLaunchers: [],
    hosts: [
      {
        host: 'vultr',
        registered: {
          bootId: '1'.repeat(32),
          processes: [{ pid: 20, start: '200', ppid: 1, uids: [0, 0, 0, 0], role: 'main' }],
        },
        unmanaged: { processes: [] },
        tcpObservation: { observedAtMs: 1000, existingSockets: 0 },
      },
      {
        host: 'aliyun',
        registered: { processes: [] },
        unmanaged: { processes: [] },
        tcpObservation: { observedAtMs: 1000, existingSockets: 0 },
      },
    ],
  };
  const database = {
    schemaVersion: 1,
    scope: 'mysql-server-observation-only',
    startedAtMs: 1000,
    observedAtMs: 1000,
    sourceDigest: 'b'.repeat(64),
    counts: {
      sessions: 1,
      transactions: 0,
      enabledEvents: 0,
      replicationReceivers: 0,
      replicationAppliers: 0,
    },
    sessionAttribution: {
      scope: 'current-session-attribution-only',
      observedAtMs: 1000,
      sessions: 1,
      unattributed: 0,
      unknownWritersZeroProven: false,
      eventSchedulers: 0,
      sourceDigest: 'c'.repeat(64),
      processes: [
        { pid: 20, start: '200', ppid: 1, uids: [0, 0, 0, 0], identityDigest: 'e'.repeat(64) },
      ],
    },
  };
  const host = {
    bootId: '11111111-1111-1111-1111-111111111111',
    observedAtMs: 1000,
    pm2Runtime: { pid: 1 },
    processes: [{ pid: 20, start: '200', ppid: 1, uids: [0, 0, 0, 0] }],
  };
  database.sessionAttribution.processes[0].identityDigest = createHash('sha256')
    .update(JSON.stringify({ bootId: host.bootId, owner: host.processes[0] }))
    .digest('hex');
  const facts = m.createFirstCutoverProductionFacts(
    {
      readState: async () => actual,
      readInventory: async () => ({ databaseObserver: {} }),
      readCoordinator: async () => ({ process: { pid: 100, start: '1000' } }),
    },
    {
      now: () => 1000,
      readHost: async () => structuredClone(host),
      readDatabase: async () => structuredClone(database),
    },
  );
  assert.equal((await facts.observeWriters(ctx, { database })).producersRunning, 1);
  const active = structuredClone(database);
  active.counts.transactions = 2;
  active.counts.enabledEvents = 1;
  assert.equal((await facts.observeWriters(ctx, { database: active })).internalWriters, 3);
  for (const fault of ['owner', 'unattributed', 'negative', 'digest', 'ppid', 'uids']) {
    const bad = structuredClone(database);
    if (fault === 'owner') bad.sessionAttribution.processes[0].pid = 30;
    if (fault === 'unattributed') bad.sessionAttribution.unattributed = 1;
    if (fault === 'negative') bad.counts.transactions = -1;
    if (fault === 'digest') bad.sessionAttribution.processes[0].identityDigest = 'f'.repeat(64);
    if (fault === 'ppid') bad.sessionAttribution.processes[0].ppid = 9;
    if (fault === 'uids') bad.sessionAttribution.processes[0].uids = [998, 998, 998, 998];
    await assert.rejects(
      facts.observeWriters(ctx, { database: bad }),
      /CUTOVER_PRODUCTION_FACTS_UNPROVEN/,
    );
  }
});

for (const fault of [
  'valid',
  'new-candidate-work',
  'historical-rehearsal',
  'stale-rehearsal',
  'candidate-drift',
  'expired-bracket',
  'missing-artifact',
  'binding',
  'deadline',
]) {
  test(`default reconcile brackets actual timestamp-free candidate status and refuses ${fault}`, async () => {
    const { createFirstCutoverProductionFacts } = await import(
      './browser-first-cutover-production-facts.mjs'
    );
    const binding = {
      candidate: 'a'.repeat(40),
      configDigest: 'b'.repeat(64),
      inventoryDigest: 'c'.repeat(64),
    };
    const identity = { candidate: binding.candidate, bootId: 'd'.repeat(32) };
    let now = 1000,
      calls = 0;
    const record = { phase: 'reconciled', identity };
    const ctx = {
      binding,
      approval: { maintenanceEndsAtMs: 500, reconcileByMs: 90000 },
      journal: {
        assertOwnership: async () => binding,
        readFirstCutoverEffects: async () => record,
      },
    };
    const merchant = {
      provider: 'alipay',
      environment: 'live',
      merchantDigest: 'e'.repeat(64),
      codeDigest: 'f'.repeat(64),
    };
    const rehearsal = {
      ...binding,
      observedAtMs: 1000,
      recoveryUntilMs: 90000,
      recovery: 'retry-proven',
      artifacts: [{ ...merchant, transcriptDigest: '1'.repeat(64), retryDigest: '2'.repeat(64) }],
    };
    const candidate = {
      identity,
      mode: 'serving',
      idle: false,
      needsReconciliation: true,
      runtime: { main: { pid: 20, start: '100' }, worker: { pid: 30, start: '200' } },
    };
    const facts = createFirstCutoverProductionFacts(
      {
        readState: async () => {},
        readInventory: async () => ({ merchants: [merchant] }),
        readCoordinator: async () => {},
        queryOrders: async () => [],
        probeBrowser: async () => ({
          kind: 'browser-minimum-execution-result',
          targetDigest: 'a'.repeat(64),
          resultDigest: 'b'.repeat(64),
          observedAtMs: now,
        }),
      },
      {
        now: () => now,
        readCandidate: async () => {
          calls++;
          const result = structuredClone(candidate);
          if (calls === 2 && fault === 'candidate-drift') result.runtime.main.start = '300';
          if (calls === 2 && fault === 'expired-bracket') now = 62000;
          return result;
        },
        readPayments: async () => ({
          observedAtMs: now,
          orders: [],
          unsettled:
            fault === 'new-candidate-work' ? [{ table: 'tasks', id: 1, status: 'running' }] : [],
        }),
        readPersisted: async () => ({ observedAtMs: now, unsettled: [], pendingReplay: 0 }),
        readRehearsal: async () => structuredClone(rehearsal),
      },
    );
    if (fault === 'historical-rehearsal') rehearsal.observedAtMs = 0;
    if (fault === 'stale-rehearsal') rehearsal.observedAtMs = -60000;
    if (fault === 'missing-artifact') rehearsal.artifacts = [];
    if (fault === 'binding') rehearsal.inventoryDigest = '0'.repeat(64);
    if (fault === 'deadline') now = 90000;
    if (['valid', 'new-candidate-work', 'historical-rehearsal'].includes(fault))
      assert.deepEqual((await facts.reconcile(ctx, identity)).identity, identity);
    else await assert.rejects(facts.reconcile(ctx, identity), /CUTOVER_PRODUCTION_FACTS_UNPROVEN/);
  });
}

test('real SQL scope keeps an opened candidate task separate from queried maintenance payments', async () => {
  const { readCutoverDatabaseScope } = await import('./browser-cutover-evidence.mjs');
  const { createFirstCutoverProductionFacts } = await import(
    './browser-first-cutover-production-facts.mjs'
  );
  const calls = [];
  const row = {
    id: 1,
    external_id: 'QA_ONLY',
    provider: 'wechat',
    provider_order_id: 'QA_ORDER',
    provider_capture_id: null,
    amount_cents: 100,
    currency: 'CNY',
    status: 'pending',
    metadata: null,
  };
  const merchant = {
    provider: 'wechat',
    environment: 'production',
    merchantDigest: 'e'.repeat(64),
    codeDigest: 'f'.repeat(64),
  };
  const db = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('FROM payments '))
        return [sql.includes('COUNT') ? [{ total: 1 }] : [row], []];
      if (sql.includes('FROM partner_recharge_orders '))
        return [sql.includes('COUNT') ? [{ total: 0 }] : [], []];
      if (sql.includes('FROM tasks ')) return [[{ id: 2, status: 'running' }], []];
      return [[], []];
    },
  };
  const binding = {
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    inventoryDigest: 'c'.repeat(64),
  };
  const identity = { candidate: binding.candidate, bootId: 'd'.repeat(32) };
  const ctx = {
    binding,
    approval: { maintenanceEndsAtMs: 500, reconcileByMs: 90000 },
    journal: {
      assertOwnership: async () => binding,
      readFirstCutoverEffects: async () => ({ phase: 'reconciled', identity }),
    },
  };
  let queried;
  const facts = createFirstCutoverProductionFacts(
    {
      readState: async () => {},
      readInventory: async () => ({ merchants: [merchant] }),
      readCoordinator: async () => {},
      queryOrders: async (_ctx, _identity, scope) => {
        queried = scope;
        return scope.orders.map((o) => ({
          provider: o.provider,
          environment: o.environment,
          merchantDigest: o.merchantDigest,
          orderRef: o.orderRef,
          observedAtMs: 1000,
          rawDigest: '1'.repeat(64),
          state: 'unpaid-valid',
        }));
      },
      probeBrowser: async () => ({
        kind: 'browser-minimum-execution-result',
        targetDigest: '2'.repeat(64),
        resultDigest: '3'.repeat(64),
        observedAtMs: 1000,
      }),
    },
    {
      now: () => 1000,
      readCandidate: async () => ({
        identity,
        mode: 'serving',
        idle: false,
        needsReconciliation: true,
        runtime: { main: { pid: 20, start: '100' }, worker: { pid: 30, start: '200' } },
      }),
      readPayments: async () =>
        readCutoverDatabaseScope(db, {
          windowStartMs: 0,
          now: () => 1000,
          resolveMerchant: () => ({
            merchantDigest: merchant.merchantDigest,
            environment: merchant.environment,
          }),
        }),
      readRehearsal: async () => ({
        ...binding,
        observedAtMs: 0,
        recoveryUntilMs: 90000,
        recovery: 'retry-proven',
        artifacts: [{ ...merchant, transcriptDigest: '4'.repeat(64), retryDigest: '5'.repeat(64) }],
      }),
      readPersisted: async () => assert.fail('postopen must not impose a new full-database drain'),
    },
  );
  assert.deepEqual((await facts.reconcile(ctx, identity)).identity, identity);
  assert.equal(queried.orders.length, 1);
  assert.deepEqual(queried.unsettled, [{ table: 'tasks', id: 2, status: 'running' }]);
  assert.equal(calls[0], 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert(!calls.some((sql) => /^(UPDATE|INSERT|DELETE|REPLACE)/.test(sql)));
});

for (const observedAtMs of [400, 1000])
  test(`real postopen SQL bounds happened window at ${observedAtMs}`, async () => {
    const { readCutoverDatabaseScope } = await import('./browser-cutover-evidence.mjs');
    const end = Math.min(500, observedAtMs);
    const queries = [];
    const rows = [
      { id: 1, created_at: new Date(10) },
      { id: 2, created_at: new Date(300) },
      { id: 3, created_at: new Date(700) },
    ].map((r) => ({
      ...r,
      external_id: 'QA_' + r.id,
      provider: 'wechat',
      provider_order_id: 'ORDER_' + r.id,
      provider_capture_id: null,
      amount_cents: 100,
      currency: 'CNY',
      status: 'pending',
      metadata: null,
      updated_at: r.created_at,
    }));
    const db = {
      query: async (sql, params = []) => {
        queries.push([sql, params]);
        if (!sql.includes('FROM payments ') && !sql.includes('FROM partner_recharge_orders '))
          return [[], []];
        assert(sql.includes('AND created_at < ?'));
        assert.equal(params[2].getTime(), end);
        const selected = sql.includes('FROM payments ')
          ? rows.filter((r) => r.created_at.getTime() < params[2].getTime())
          : [];
        return [
          sql.includes('COUNT')
            ? [{ total: selected.length }]
            : selected.filter((r) => r.id > params[3]),
          [],
        ];
      },
    };
    const result = await readCutoverDatabaseScope(db, {
      windowStartMs: 100,
      windowEndMs: end,
      now: () => observedAtMs,
      resolveMerchant: () => ({ merchantDigest: 'e'.repeat(64), environment: 'production' }),
    });
    assert.equal(result.orders.length, 2);
    assert.equal(result.observedAtMs, observedAtMs);
    assert.equal(queries.at(-1)[0], 'ROLLBACK');
  });
