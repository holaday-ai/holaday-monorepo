import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  collectCutoverEvidence,
  publishCutoverEvidence,
  readCutoverDatabaseScope,
  readCutoverHostSnapshot,
  readCutoverNginxSnapshot,
  readCutoverRehearsalArtifacts,
  readCutoverStartupSnapshot,
  readCutoverWorkScope,
} from './browser-cutover-evidence.mjs';
import { readFirstCutoverPaymentScope } from './browser-first-cutover-host.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const merchant = '9'.repeat(64);
const approvedSandboxDigest = '75467f5b0aec5367761433a57fbd45aa9a41347e638f385178c12f5af7740b95';
const approvedAlipayDigests = [
  '001badc1fe5ae82c8f8f761344928d08736216196677247509a25b1fcee2bc98',
  '02f656819686a0bb479aae7ebd52d1ff73967b37f19450ffa9c08118d54c7bfc',
  '1e17c25e56c43777ec1a5e7c1d97458be38e36e344e7584ddb2c898e01b5cb35',
  '4d03c0f56f550ba70d085c9cb927f119deb9b212f1a1a86313918bc90345ee33',
  'a2cbccfb414687563f62d9268a4dad4884d275e7bb3185ffbbdc6d7de8fe9185',
  'cd4575108c3bf6a0efeb0cc33ef747abe7950159a34deb7d6d7e015c04323521',
  'd0aaa2afa7249ec178781a4c053a317fe730439ead0538cca2dc2a99f40ad354',
  'e6c83abd5d94b0df14d485d49d8bcfb92886f12d8baf752ed0fc451c3599c9b0',
  'fccf56cb4d1199c08e19ee0c5c2dea0b1a8c89e0f809a079c39c11ee9632a738',
];
const alipayRef = 'alipay-historical-20260927';
function fixture() {
  const inventory = {
    hosts: ['vultr', 'aliyun'],
    configurationDigests: ['a'.repeat(64), 'b'.repeat(64)],
    merchants: [
      {
        provider: 'wechat',
        environment: 'production',
        merchantDigest: merchant,
        codeDigest: '5'.repeat(64),
      },
    ],
    targets: [{ host: 'aliyun', pid: 400, start: '1000', role: 'gateway', ports: [4010, 4011] }],
    ingress: [{ host: 'aliyun', configDigest: 'c'.repeat(64) }],
  };
  const binding = {
    attempt: '11111111-1111-4111-8111-111111111111',
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    migrationDigest: 'c'.repeat(64),
    inventoryDigest: hash(inventory),
  };
  const order = {
    provider: 'wechat',
    environment: 'production',
    merchantDigest: merchant,
    orderRef: '1'.repeat(64),
    fieldsDigest: '2'.repeat(64),
  };
  const host = {
    inventory,
    observedAtMs: 99_000,
    unknownWriters: [],
    externalWork: [],
    producersRunning: [],
  };
  const scope = { observedAtMs: 99_000, orders: [order], unsettled: [] };
  const observations = [
    { ...order, observedAtMs: 99_000, rawDigest: '3'.repeat(64), state: 'settled' },
  ];
  const rehearsal = {
    observedAtMs: 1,
    candidate: binding.candidate,
    configDigest: binding.configDigest,
    inventoryDigest: binding.inventoryDigest,
    recovery: 'query-and-existing-settlement-proven',
    recoveryUntilMs: 250_000,
    artifacts: [
      {
        provider: 'wechat',
        environment: 'production',
        merchantDigest: merchant,
        codeDigest: '5'.repeat(64),
        transcriptDigest: '6'.repeat(64),
        queryDigest: '7'.repeat(64),
        settlementDigest: '8'.repeat(64),
      },
    ],
  };
  const fence = {
    inventoryDigest: binding.inventoryDigest,
    stage: 'orders',
    observedAtMs: 99_000,
    uncovered: [],
    liveLegacy: [],
    regeneratedLegacy: [],
  };
  const published = [];
  return {
    binding,
    host,
    scope,
    observations,
    rehearsal,
    fence,
    published,
    input: {
      binding,
      stage: 'prepare',
      window: { maintenanceEndsAtMs: 150_000, reconcileByMs: 200_000, operatorRef: 'operator' },
    },
    io: {
      now: () => 100_000,
      readHostInventory: async () => host,
      readDatabaseScope: async () => scope,
      queryOrders: async () => observations,
      readRehearsalArtifacts: async () => rehearsal,
      readFenceState: async () => fence,
      assertJournalOwnership: async () => ({ ...binding }),
      publishPrivate: async (value) => {
        published.push(value);
      },
    },
  };
}
test('collects twice, binds all sources, and only publishes redacted facts', async () => {
  const f = fixture();
  let reads = 0;
  f.io.readDatabaseScope = async () => {
    reads++;
    return structuredClone(f.scope);
  };
  const result = await collectCutoverEvidence(f.input, f.io);
  assert.equal(reads, 2);
  assert.equal(result.payments.unresolved, 0);
  assert.equal(result.sources.length, 4);
  assert.equal(result.payments.scopeDigest, result.payments.queriedScopeDigest);
  assert.equal(f.published.length, 1);
  assert.equal(JSON.stringify(result).includes('vultr'), false);
  assert.equal(JSON.stringify(result).includes('4011'), false);
});
test('scope changing during provider requests cannot publish a partial success', async () => {
  const f = fixture();
  f.io.queryOrders = async () => {
    f.scope.orders[0].fieldsDigest = '0'.repeat(64);
    return f.observations;
  };
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_PAYMENT_SCOPE_CHANGED/);
  assert.deepEqual(f.published, []);
});
function preparingWithProducer() {
  const f = fixture();
  const producer = { host: 'vultr', pid: 501, start: '2000', role: 'main', ports: [4001, 4002] };
  f.host.inventory.targets.push(producer);
  f.binding.inventoryDigest = hash(f.host.inventory);
  f.rehearsal.inventoryDigest = f.binding.inventoryDigest;
  f.fence.inventoryDigest = f.binding.inventoryDigest;
  f.host.producersRunning = [structuredClone(producer)];
  f.fence.stage = 'observed';
  return f;
}
test('prepare inventories approved running producers without pretending ingress is already closed', async () => {
  const f = preparingWithProducer();
  const result = await collectCutoverEvidence(f.input, f.io);
  assert.equal(result.host.phase, 'prepared');
  assert.equal(result.identity, undefined);
  assert.equal(f.published[0].raw.fence.stage, 'observed');
  assert.equal(f.published[0].raw.host.producersRunning.length, 1);
});
test('prepare rejects unclassified, changed, duplicate or malformed producers', async () => {
  for (const kind of ['unapproved', 'start', 'role', 'duplicate', 'missing', 'zero-pid']) {
    const f = preparingWithProducer();
    if (kind === 'unapproved') f.host.producersRunning[0].host = 'other-host';
    if (kind === 'start') f.host.producersRunning[0].start = '2001';
    if (kind === 'role') f.host.producersRunning[0] = structuredClone(f.host.inventory.targets[0]);
    if (kind === 'duplicate') f.host.producersRunning.push(f.host.producersRunning[0]);
    if (kind === 'missing') f.host.producersRunning = undefined;
    if (kind === 'zero-pid') {
      f.host.producersRunning[0].pid = 0;
      f.host.inventory.targets[1].pid = 0;
      f.binding.inventoryDigest = hash(f.host.inventory);
      f.rehearsal.inventoryDigest = f.binding.inventoryDigest;
      f.fence.inventoryDigest = f.binding.inventoryDigest;
    }
    await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/, kind);
    assert.deepEqual(f.published, [], kind);
  }
});
test('prepare observations never satisfy preopen while legacy producers remain', async () => {
  const f = preparingWithProducer();
  await collectCutoverEvidence(f.input, f.io);
  f.published.length = 0;
  f.input.stage = 'preopen';
  f.input.identity = { candidate: f.binding.candidate, bootId: 'a'.repeat(32) };
  f.fence.stage = 'all-writers';
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
  assert.deepEqual(f.published, []);
});
for (const kind of [
  'missing',
  'duplicate',
  'different-merchant',
  'unknown',
  'paid-unsettled',
  'old-query',
  'future-query',
]) {
  test(`rejects ${kind} provider observation`, async () => {
    const f = fixture();
    if (kind === 'missing') f.observations.length = 0;
    if (kind === 'duplicate') f.observations.push(f.observations[0]);
    if (kind === 'different-merchant') f.observations[0].merchantDigest = '0'.repeat(64);
    if (['unknown', 'paid-unsettled'].includes(kind)) f.observations[0].state = kind;
    if (kind === 'old-query') f.observations[0].observedAtMs = 39_999;
    if (kind === 'future-query') f.observations[0].observedAtMs = 100_001;
    await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
    assert.deepEqual(f.published, []);
  });
}
for (const kind of [
  '4011',
  'producer',
  'external-work',
  'db-work',
  'old-host',
  'rehearsal',
  'window',
  'fence',
  'journal',
  'inventory',
]) {
  test(`rejects ${kind} gaps without success publication`, async () => {
    const f = fixture();
    if (kind === '4011') f.host.unknownWriters.push({ port: 4011 });
    if (kind === 'producer') f.host.producersRunning.push('worker');
    if (kind === 'external-work') f.host.externalWork.push('unknown-browser-action');
    if (kind === 'db-work') f.scope.unsettled.push('running');
    if (kind === 'old-host') f.host.observedAtMs = 39_999;
    if (kind === 'rehearsal') f.rehearsal.artifacts = [];
    if (kind === 'window') f.input.window.reconcileByMs = 260_000;
    if (kind === 'fence') f.fence.uncovered.push('internal-route');
    if (kind === 'journal')
      f.io.assertJournalOwnership = async () => ({ ...f.binding, attempt: 'different' });
    if (kind === 'inventory') f.host.inventory.configurationDigests.push('0'.repeat(64));
    await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
    assert.deepEqual(f.published, []);
  });
}
test('preopen requires fenced stopped legacy identities and the new boot identity', async () => {
  const f = fixture();
  f.input.stage = 'preopen';
  f.input.identity = { candidate: f.binding.candidate, bootId: 'a'.repeat(32) };
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
  f.fence.stage = 'all-writers';
  f.fence.liveLegacy.push('old');
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
  f.fence.liveLegacy = [];
  const result = await collectCutoverEvidence(f.input, f.io);
  assert.equal(result.host.phase, 'fenced-stopped');
  assert.deepEqual(result.identity, f.input.identity);
});
test('historical payment rehearsal for different gateway code cannot authorize new code', async () => {
  const f = fixture();
  f.rehearsal.artifacts[0].codeDigest = '0'.repeat(64);
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
});
test('read-only database reader covers both order tables and fails rather than truncates', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT') && sql.includes('LIMIT'))
        return [[{ id: 1, external_id: 'PRIVATE', provider: 'wechat', status: 'pending' }], []];
      return [[], []];
    },
  };
  await assert.rejects(
    readCutoverDatabaseScope(db, { windowStartMs: 50_000, now: () => 100_000 }),
    /MAINTENANCE_PAYMENT_SCOPE_UNPROVEN/,
  );
  assert.equal(calls[0].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  assert.equal(calls[1].sql, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(
    calls.some((r) => /^(UPDATE|DELETE|INSERT|REPLACE)/.test(r.sql)),
    false,
  );
});
function databaseFixture(overrides = {}) {
  const calls = [];
  const rows = {
    payments: [
      {
        id: 1,
        external_id: 'PRIVATE',
        provider: 'wechat',
        provider_order_id: 'ORDER',
        provider_capture_id: null,
        amount_cents: 1234,
        currency: 'CNY',
        status: 'pending',
        metadata: null,
      },
    ],
    partner_recharge_orders: [],
  };
  const query = async (sql, params) => {
    calls.push({ sql, params });
    const table = Object.keys(rows).find((name) => sql.includes(`FROM ${name} `));
    if (table && sql.includes('COUNT'))
      return [[{ total: overrides.count ?? rows[table].length }], []];
    if (table) return [overrides.page ?? rows[table], []];
    return [[], []];
  };
  const options = {
    now: () => 100_000,
    windowStartMs: 50_000,
    resolveMerchant: () => ({ environment: 'production', merchantDigest: merchant }),
  };
  return { db: { query }, calls, options, rows };
}
test('work-only reader shares a read-only snapshot and never reads merchant orders', async () => {
  const calls = [];
  const work = {
    exploration_runs: { id: 1, status: 'running' },
    video_edit_render_attempts: { id: 2, status: 'pending' },
    video_edit_versions: { id: 3, status: 'rendering' },
    account_closure_requests: { id: 4, status: 'processing' },
    account_closure_steps: { id: 5, status: 'running' },
    planned_task_run_items: { id: 6, status: 'running' },
    batch_task_items: { id: 7, status: 'running' },
  };
  const db = {
    query: async (sql) => {
      calls.push(sql);
      const table = /FROM ([a-z_]+) WHERE/.exec(sql)?.[1];
      return [table && work[table] ? [work[table]] : [], []];
    },
  };
  const result = await readCutoverWorkScope(db, { now: () => 100_000 });
  assert.deepEqual(
    result.unsettled,
    Object.entries(work).map(([table, row]) => ({ table, ...row })),
  );
  assert.equal(result.observedAtMs, 100_000);
  assert.equal(calls[0], 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  assert.equal(calls[1], 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.filter((sql) => sql.startsWith('SELECT')).length, 12);
  assert(!calls.some((sql) => /payments|partner_recharge_orders|UPDATE|DELETE|INSERT/.test(sql)));
});
test('payment readiness includes independent work even when ordinary tasks are empty', async () => {
  const f = databaseFixture();
  const query = f.db.query;
  f.db.query = async (sql, params) =>
    sql.includes('FROM video_edit_render_attempts ')
      ? [[{ id: 17, status: 'pending' }], []]
      : query(sql, params);
  const scope = await readCutoverDatabaseScope(f.db, f.options);
  assert.deepEqual(scope.unsettled, [
    { table: 'video_edit_render_attempts', id: 17, status: 'pending' },
  ]);
  assert.equal(f.calls.filter((c) => c.sql.startsWith('START TRANSACTION')).length, 1);
  const ready = fixture();
  ready.io.readDatabaseScope = async () => ({ ...ready.scope, unsettled: scope.unsettled });
  await assert.rejects(collectCutoverEvidence(ready.input, ready.io), /MAINTENANCE_/);
  assert.deepEqual(ready.published, []);
});
for (const kind of [
  'missing-table',
  'truncated',
  'bad-id',
  'bad-status',
  'duplicate',
  'clock-reversed',
  'stale',
]) {
  test(`work reader refuses ${kind} without replacing uncertainty with zero`, async () => {
    const calls = [];
    let clock = 100_000;
    const db = {
      query: async (sql) => {
        calls.push(sql);
        if (!sql.includes('FROM exploration_runs ')) return [[], []];
        if (kind === 'missing-table') throw new Error('ER_NO_SUCH_TABLE');
        if (kind === 'clock-reversed') clock--;
        if (kind === 'stale') clock += 60_001;
        const row = {
          id: kind === 'bad-id' ? 'unsafe' : 1,
          status: kind === 'bad-status' ? null : 'running',
        };
        return [
          kind === 'truncated' ? Array(100).fill(row) : kind === 'duplicate' ? [row, row] : [row],
          [],
        ];
      },
    };
    await assert.rejects(
      readCutoverWorkScope(db, { now: () => clock }),
      /MAINTENANCE_WORK_SCOPE_UNPROVEN/,
    );
    assert.equal(calls.at(-1), 'ROLLBACK');
  });
}
test('reads ordinary and partner orders with full counts in one read-only snapshot', async () => {
  const f = databaseFixture();
  const result = await readCutoverDatabaseScope(f.db, f.options);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].provider_order_id, 'ORDER');
  assert.equal(result.orders[0].orderRef, hash([merchant, 'ORDER']));
  assert.equal(f.calls.filter((c) => c.sql.includes('COUNT')).length, 2);
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
});
test('failed work snapshot rollback never exposes database diagnostics or returns success', async () => {
  const db = {
    query: async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('private database detail');
      return [[], []];
    },
  };
  await assert.rejects(readCutoverWorkScope(db), /^Error: MAINTENANCE_WORK_SCOPE_UNPROVEN$/);
});
for (const kind of ['missing-page', 'overflow', 'duplicate']) {
  test(`database ${kind} cannot be silently accepted`, async () => {
    const f = databaseFixture(
      kind === 'missing-page' ? { page: [] } : kind === 'overflow' ? { count: 10_000 } : {},
    );
    if (kind === 'duplicate') f.rows.payments.push(f.rows.payments[0]);
    await assert.rejects(
      readCutoverDatabaseScope(f.db, f.options),
      /MAINTENANCE_PAYMENT_SCOPE_UNPROVEN/,
    );
    assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  });
}
function deferredDatabaseFixture() {
  const f = databaseFixture();
  const row = {
    id: 2,
    external_id: 'synthetic-sandbox',
    provider: 'paypal',
    provider_order_id: 'synthetic-order',
    provider_capture_id: null,
    amount_cents: 990,
    currency: 'USD',
    status: 'pending',
    metadata: { env: 'sandbox' },
    created_at: '1970-01-01T00:00:01.000Z',
    updated_at: '1970-01-01T00:00:01.000Z',
  };
  const recordDigest = hash([
    'payments',
    'synthetic-sandbox',
    'paypal',
    'synthetic-order',
    null,
    990,
    'USD',
    'pending',
    [['env', 'sandbox']],
    '1970-01-01T00:00:01.000Z',
    '1970-01-01T00:00:01.000Z',
  ]);
  f.options.deferredSandboxPayment = { recordDigest, approvalRef: 'paypal-sandbox-20260927' };
  f.options.resolveMerchant = (provider) => {
    assert.notEqual(provider, 'paypal', 'must not resolve PayPal credentials');
    return { environment: 'production', merchantDigest: merchant };
  };
  f.rows.payments.push(row);
  return { ...f, row };
}
test('one approved unchanged sandbox record is explicitly deferred without merchant access or writes', async () => {
  const f = deferredDatabaseFixture();
  const original = structuredClone(f.rows);
  const scope = await readCutoverDatabaseScope(f.db, f.options);
  assert.equal(scope.orders.length, 1);
  assert.deepEqual(scope.deferredUnverified, [
    {
      ...f.options.deferredSandboxPayment,
      fieldsDigest: hash(f.row),
      state: 'unverified-deferred',
    },
  ]);
  assert.deepEqual(f.rows, original);
  assert.equal(
    f.calls.some((c) => /^(UPDATE|DELETE|INSERT|REPLACE)/.test(c.sql)),
    false,
  );
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
});
test('deferral refuses other records, production, changed money/status/capture/time and missing approval target', async () => {
  for (const mutate of [
    (f) => {
      f.row.external_id = 'another';
    },
    (f) => {
      f.row.metadata.env = 'live';
    },
    (f) => {
      f.row.amount_cents++;
    },
    (f) => {
      f.row.status = 'completed';
    },
    (f) => {
      f.row.provider_capture_id = 'capture';
    },
    (f) => {
      f.row.updated_at = '1970-01-01T00:00:02.000Z';
    },
    (f) => {
      f.rows.payments.pop();
    },
    (f) => {
      f.rows.payments.push({ ...f.row, id: 3, external_id: 'second' });
    },
    (f) => {
      f.options.deferredSandboxPayment.allowAll = true;
    },
  ]) {
    const f = deferredDatabaseFixture();
    mutate(f);
    await assert.rejects(
      readCutoverDatabaseScope(f.db, f.options),
      /MAINTENANCE_PAYMENT_SCOPE_UNPROVEN/,
    );
  }
});
function deferredCollectorFixture() {
  const f = fixture();
  const approval = { recordDigest: approvedSandboxDigest, approvalRef: 'paypal-sandbox-20260927' };
  f.host.inventory.deferredSandboxPayment = approval;
  f.host.inventory.paypalCheckoutEnabled = false;
  f.binding.inventoryDigest = hash(f.host.inventory);
  f.rehearsal.inventoryDigest = f.binding.inventoryDigest;
  f.fence.inventoryDigest = f.binding.inventoryDigest;
  f.scope.deferredUnverified = [
    { ...approval, fieldsDigest: '5'.repeat(64), state: 'unverified-deferred' },
  ];
  return f;
}
test('collector reports the unverified exception separately and binds it to database evidence, not provider verification', async () => {
  const f = deferredCollectorFixture();
  f.io.queryOrders = async (scope) => {
    assert.equal(scope.orders.length, 1);
    assert.equal(scope.orders[0].provider, 'wechat');
    return f.observations;
  };
  const report = await collectCutoverEvidence(f.input, f.io);
  assert.deepEqual(report.payments.deferredUnverified, f.scope.deferredUnverified);
  assert.equal(report.payments.scopeDigest, hash(f.scope.orders));
  assert.equal(
    report.sources.find((s) => s.kind === 'database').digest,
    hash([
      hash(f.scope.orders),
      [[approvedSandboxDigest, '5'.repeat(64), 'paypal-sandbox-20260927', 'unverified-deferred']],
    ]),
  );
  assert.equal(
    report.sources.find((s) => s.kind === 'provider-query').digest,
    hash(f.scope.orders),
  );
});
test('collector refuses missing/foreign/duplicate deferrals and checkout enabled before provider calls', async () => {
  for (const mutate of [
    (f) => {
      f.scope.deferredUnverified = undefined;
    },
    (f) => {
      f.scope.deferredUnverified[0].recordDigest = '0'.repeat(64);
    },
    (f) => {
      f.scope.deferredUnverified.push(f.scope.deferredUnverified[0]);
    },
    (f) => {
      f.host.inventory.deferredSandboxPayment = undefined;
    },
    (f) => {
      f.host.inventory.paypalCheckoutEnabled = true;
    },
    (f) => {
      f.scope.orders.push({ ...f.scope.orders[0], provider: 'paypal' });
    },
  ]) {
    const f = deferredCollectorFixture();
    mutate(f);
    let queried = false;
    f.io.queryOrders = async () => {
      queried = true;
      return f.observations;
    };
    await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
    assert.equal(queried, false);
    assert.equal(f.published.length, 0);
  }
});
test('deferral changes during queries or another unknown payment still block publication', async () => {
  const f = deferredCollectorFixture();
  f.io.queryOrders = async () => {
    f.scope.deferredUnverified[0].fieldsDigest = '6'.repeat(64);
    return f.observations;
  };
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_PAYMENT_SCOPE_CHANGED/);
  const other = deferredCollectorFixture();
  other.observations[0].state = 'unknown';
  await assert.rejects(collectCutoverEvidence(other.input, other.io), /MAINTENANCE_/);
  assert.equal(f.published.length + other.published.length, 0);
});
test('even a rebound inventory cannot extend this approval to a different sandbox record', async () => {
  const f = deferredCollectorFixture();
  f.host.inventory.deferredSandboxPayment.recordDigest = '0'.repeat(64);
  f.scope.deferredUnverified[0].recordDigest = '0'.repeat(64);
  f.binding.inventoryDigest = hash(f.host.inventory);
  f.rehearsal.inventoryDigest = f.binding.inventoryDigest;
  f.fence.inventoryDigest = f.binding.inventoryDigest;
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
});
function alipayDatabaseFixture() {
  const f = deferredDatabaseFixture();
  const rows = Array.from({ length: 9 }, (_, n) => ({
    id: n + 3,
    external_id: `synthetic-alipay-${n}`,
    provider: 'alipay',
    provider_order_id: `synthetic-alipay-order-${n}`,
    provider_capture_id: null,
    amount_cents: 9900,
    currency: 'CNY',
    status: 'pending',
    metadata: null,
    created_at: '1970-01-01T00:00:01.000Z',
    updated_at: '1970-01-01T00:00:02.000Z',
  }));
  f.rows.payments.push(...rows);
  f.options.deferredAlipayPayments = {
    approvalRef: alipayRef,
    recordDigests: rows
      .map((r) =>
        hash([
          'payments',
          r.id,
          'alipay',
          r.provider_order_id,
          null,
          9900,
          'CNY',
          'pending',
          '1970-01-01T00:00:01.000Z',
          '1970-01-01T00:00:02.000Z',
        ]),
      )
      .sort(),
  };
  return { ...f, alipay: rows };
}
test('nine exact historical Alipay rows coexist with the sandbox deferral without hiding new orders', async () => {
  const f = alipayDatabaseFixture();
  f.rows.payments.push({
    ...f.alipay[0],
    id: 12,
    external_id: 'new',
    provider_order_id: 'new',
    created_at: '1970-01-01T00:01:01.000Z',
    updated_at: '1970-01-01T00:01:01.000Z',
  });
  const original = structuredClone(f.rows);
  const s = await readCutoverDatabaseScope(f.db, f.options);
  assert.equal(s.deferredUnverified.length, 10);
  assert.equal(s.orders.length, 2);
  assert.equal(s.orders[1].provider_order_id, 'new');
  assert.deepEqual(
    s.deferredUnverified
      .filter((r) => r.approvalRef === alipayRef)
      .map((r) => r.recordDigest)
      .sort(),
    f.options.deferredAlipayPayments.recordDigests,
  );
  assert.ok(s.deferredUnverified.every((r) => r.state === 'unverified-deferred'));
  for (const row of f.alipay)
    assert.ok(s.deferredUnverified.some((r) => r.fieldsDigest === hash(row)));
  assert.deepEqual(f.rows, original);
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(
    f.calls.some((c) => /^(UPDATE|DELETE|INSERT|REPLACE)/.test(c.sql)),
    false,
  );
});
test('first site database connection preserves both exact deferrals and never resolves PayPal', async () => {
  const f = alipayDatabaseFixture();
  const expected = await readCutoverDatabaseScope(f.db, f.options);
  const config = Buffer.from('DATABASE_URL=mysql://qa@127.0.0.1/fixture');
  const inventory = {
    paymentWindowStartMs: f.options.windowStartMs,
    merchants: [{ provider: 'wechat', environment: 'production', merchantDigest: merchant }],
    deferredSandboxPayment: f.options.deferredSandboxPayment,
    deferredAlipayPayments: f.options.deferredAlipayPayments,
  };
  const binding = {
    candidate: 'a'.repeat(40),
    attempt: '11111111-1111-4111-8111-111111111111',
    configDigest: createHash('sha256').update(config).digest('hex'),
    inventoryDigest: hash(inventory),
    migrationDigest: 'b'.repeat(64),
  };
  const context = {
    binding,
    approval: { ...binding, maintenanceEndsAtMs: 200_000 },
    root: `/opt/holaday-releases/${binding.candidate}`,
    journal: { assertOwnership: async () => binding },
  };
  let closed = 0;
  const io = {
    platform: 'linux',
    uid: 0,
    now: f.options.now,
    readConfig: async () => config,
    parseConfig: () => ({ DATABASE_URL: 'mysql://qa@127.0.0.1/fixture' }),
    connectWorkDatabase: async () => ({ ...f.db, end: async () => closed++ }),
  };
  assert.deepEqual(await readFirstCutoverPaymentScope(context, inventory, io), expected);
  assert.equal(expected.deferredUnverified.length, 10);
  assert.equal(closed, 1);
  f.rows.payments.push({
    ...f.rows.payments.find((r) => r.provider === 'paypal'),
    id: 99,
    external_id: 'OTHER',
  });
  await assert.rejects(
    readFirstCutoverPaymentScope(context, inventory, io),
    /CUTOVER_PAYMENT_OBSERVATION_UNPROVEN/,
  );
  assert.equal(closed, 2);
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
});

test('unarchived Alipay fields remain bound independently of historical identity', async () => {
  const f = alipayDatabaseFixture();
  const before = await readCutoverDatabaseScope(f.db, f.options);
  f.alipay[0].external_id = 'changed-current-external-id';
  f.alipay[0].metadata = { current: 'new-value' };
  const after = await readCutoverDatabaseScope(f.db, f.options);
  assert.deepEqual(
    before.deferredUnverified.map((r) => r.recordDigest),
    after.deferredUnverified.map((r) => r.recordDigest),
  );
  const record = after.deferredUnverified.find((r) => r.fieldsDigest === hash(f.alipay[0]));
  assert.ok(record);
  assert.notEqual(
    before.deferredUnverified.find((r) => r.recordDigest === record.recordDigest).fieldsDigest,
    record.fieldsDigest,
  );
});
test('missing Alipay approval does not silently omit historical pending rows', async () => {
  const f = alipayDatabaseFixture();
  f.options.deferredAlipayPayments = undefined;
  const s = await readCutoverDatabaseScope(f.db, f.options);
  assert.equal(s.orders.length, 10);
  assert.equal(s.deferredUnverified.length, 1);
});
test('Alipay-only approval and SQL UTC dates retain the same exact historical scope', async () => {
  const f = alipayDatabaseFixture();
  f.options.deferredSandboxPayment = undefined;
  f.rows.payments.splice(f.rows.payments.indexOf(f.row), 1);
  for (const row of f.alipay) {
    row.created_at = '1970-01-01 00:00:01';
    row.updated_at = '1970-01-01 00:00:02.000';
  }
  const s = await readCutoverDatabaseScope(f.db, f.options);
  assert.equal(s.deferredUnverified.length, 9);
  assert.equal(s.orders.length, 1);
  assert.deepEqual(
    s.deferredUnverified.map((r) => r.recordDigest).sort(),
    f.options.deferredAlipayPayments.recordDigests,
  );
});
test('PayPal target after Alipay rows is counted independently', async () => {
  const f = alipayDatabaseFixture();
  const paypal = f.rows.payments.find((r) => r.provider === 'paypal');
  paypal.id = 20;
  f.rows.payments.sort((a, b) => a.id - b.id);
  const s = await readCutoverDatabaseScope(f.db, f.options);
  assert.equal(s.deferredUnverified.length, 10);
  assert.equal(s.deferredUnverified.at(-1).approvalRef, 'paypal-sandbox-20260927');
});
test('Alipay deferral refuses changed identity, money, time, status, capture and incomplete scope', async () => {
  for (const change of [
    (f) => {
      f.alipay[0].id = 99;
    },
    (f) => {
      f.alipay[0].provider_order_id = 'replaced';
    },
    (f) => {
      f.alipay[0].amount_cents++;
    },
    (f) => {
      f.alipay[0].currency = 'USD';
    },
    (f) => {
      f.alipay[0].status = 'completed';
    },
    (f) => {
      f.alipay[0].provider_capture_id = 'paid';
    },
    (f) => {
      f.alipay[0].updated_at = '1970-01-01T00:00:03.000Z';
    },
    (f) => {
      f.options.windowStartMs = 1000;
    },
    (f) => {
      f.rows.payments.pop();
    },
    (f) => {
      f.options.deferredAlipayPayments.recordDigests.pop();
    },
    (f) => {
      f.options.deferredAlipayPayments.recordDigests[0] =
        f.options.deferredAlipayPayments.recordDigests[1];
    },
    (f) => {
      f.options.deferredAlipayPayments.approvalRef = 'all-alipay';
    },
  ]) {
    const f = alipayDatabaseFixture();
    change(f);
    await assert.rejects(
      readCutoverDatabaseScope(f.db, f.options),
      /MAINTENANCE_PAYMENT_SCOPE_UNPROVEN/,
    );
  }
});
function alipayCollectorFixture() {
  const f = deferredCollectorFixture();
  f.host.inventory.deferredAlipayPayments = {
    recordDigests: [...approvedAlipayDigests],
    approvalRef: alipayRef,
  };
  f.scope.deferredUnverified.push(
    ...approvedAlipayDigests.map((recordDigest) => ({
      recordDigest,
      fieldsDigest: '6'.repeat(64),
      approvalRef: alipayRef,
      state: 'unverified-deferred',
    })),
  );
  f.binding.inventoryDigest = hash(f.host.inventory);
  f.rehearsal.inventoryDigest = f.binding.inventoryDigest;
  f.fence.inventoryDigest = f.binding.inventoryDigest;
  return f;
}
test('collector separately binds both approved deferrals and does not call them provider-verified', async () => {
  const f = alipayCollectorFixture();
  const r = await collectCutoverEvidence(f.input, f.io);
  assert.equal(r.payments.deferredUnverified.length, 10);
  assert.equal(r.payments.scopeDigest, hash(f.scope.orders));
  assert.notEqual(r.sources.find((s) => s.kind === 'database').digest, r.payments.scopeDigest);
  assert.equal(r.sources.find((s) => s.kind === 'provider-query').digest, r.payments.scopeDigest);
});
test('Alipay-only collector approval does not require PayPal checkout to be disabled', async () => {
  const f = alipayCollectorFixture();
  f.host.inventory.deferredSandboxPayment = undefined;
  f.host.inventory.paypalCheckoutEnabled = undefined;
  f.scope.deferredUnverified.shift();
  f.binding.inventoryDigest = hash(f.host.inventory);
  f.rehearsal.inventoryDigest = f.binding.inventoryDigest;
  f.fence.inventoryDigest = f.binding.inventoryDigest;
  const r = await collectCutoverEvidence(f.input, f.io);
  assert.equal(r.payments.deferredUnverified.length, 9);
});
test('collector cannot extend or partly apply Alipay approval even with a rebound inventory', async () => {
  for (const change of [
    (f) => {
      f.scope.deferredUnverified.pop();
    },
    (f) => {
      f.scope.deferredUnverified.push(f.scope.deferredUnverified[1]);
    },
    (f) => {
      f.scope.deferredUnverified[1].state = 'settled';
    },
    (f) => {
      f.host.inventory.deferredAlipayPayments = undefined;
    },
    (f) => {
      f.host.inventory.deferredAlipayPayments.recordDigests[0] = '0'.repeat(64);
      f.scope.deferredUnverified[1].recordDigest = '0'.repeat(64);
    },
  ]) {
    const f = alipayCollectorFixture();
    change(f);
    f.binding.inventoryDigest = hash(f.host.inventory);
    f.rehearsal.inventoryDigest = f.binding.inventoryDigest;
    f.fence.inventoryDigest = f.binding.inventoryDigest;
    await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_/);
    assert.equal(f.published.length, 0);
  }
});
test('Alipay deferred field drift during collection and unknown new orders still block', async () => {
  const f = alipayCollectorFixture();
  f.io.queryOrders = async () => {
    f.scope.deferredUnverified[1].fieldsDigest = '7'.repeat(64);
    return f.observations;
  };
  await assert.rejects(collectCutoverEvidence(f.input, f.io), /MAINTENANCE_PAYMENT_SCOPE_CHANGED/);
  const g = alipayCollectorFixture();
  const order = { ...g.scope.orders[0], provider: 'alipay', orderRef: 'a'.repeat(64) };
  g.scope.orders.push(order);
  g.observations.push({
    ...order,
    observedAtMs: 99_000,
    rawDigest: '3'.repeat(64),
    state: 'unknown',
  });
  let queried;
  g.io.queryOrders = async (orders) => {
    queried = structuredClone(orders);
    return g.observations;
  };
  await assert.rejects(collectCutoverEvidence(g.input, g.io), /MAINTENANCE_/);
  assert.ok(queried.orders.some((r) => r.provider === 'alipay' && r.orderRef === order.orderRef));
  assert.equal(g.published.length, 0);
});
function hostFixture() {
  const calls = [];
  const args = '/opt/node22/bin/node\0/opt/holaday-cn-payment/src/index.ts\0';
  const files = new Map([
    ['/proc/sys/kernel/random/boot_id', '11111111-1111-4111-8111-111111111111'],
    ['/proc/401/cmdline', args],
    ['/proc/401/status', 'Uid:\t998\t998\t998\t998\nPPid:\t10\n'],
    ['/proc/401/stat', `401 (node worker) S ${Array(18).fill('1').join(' ')} 12345 0`],
    ['/proc/401/cgroup', '0::/system.slice/holaday.service'],
  ]);
  const io = {
    platform: 'linux',
    hostname: () => 'qa-linux',
    uid: 0,
    now: () => 100_000,
    pm2RuntimeSnapshot: async () => ({
      pid: 10,
      version: '6.0.14',
      killSignal: 'SIGINT',
      killTimeoutMs: 1600,
      sourceDigest: 'a'.repeat(64),
    }),
    startupSnapshot: async () => ({
      observedAtMs: 100_000,
      files: [],
      directories: [],
      pm2Unit: {},
    }),
    nginxSnapshot: async () => ({
      observedAtMs: 100_000,
      dump: 'observed configuration',
      files: [
        {
          path: '/etc/nginx/nginx.conf',
          resolved: '/etc/nginx/nginx.conf',
          uid: 0,
          gid: 0,
          mode: 0o644,
          digest: 'e'.repeat(64),
          content: 'observed configuration',
        },
      ],
    }),
    readdir: async () => ['401', 'self'],
    readFile: async (path) => {
      if (!files.has(path)) throw new Error('unknown path');
      return files.get(path);
    },
    readlink: async (path) =>
      path.endsWith('/exe') ? '/opt/node22/bin/node' : '/opt/holaday-cn-payment',
    exec: async (command, args) => {
      calls.push([command, ...args]);
      if (command === 'pm2')
        return JSON.stringify([
          {
            pid: 401,
            name: 'gateway',
            pm_id: 2,
            pm2_env: {
              pm_cwd: '/opt/holaday-cn-payment',
              autorestart: true,
              status: 'online',
              PRIVATE_KEY: 'secret',
            },
          },
        ]);
      if (command === 'ss')
        return 'LISTEN 0 511 0.0.0.0:4011 0.0.0.0:* users:(("node",pid=401,fd=1))\n';
      return 'observed configuration';
    },
  };
  return { io, calls, files };
}
test('PM2 runtime observes actual daemon settings and audited defaults without exposing environment', async () => {
  const module = await import('./browser-cutover-evidence.mjs');
  assert.equal(typeof module.readCutoverPM2RuntimeSnapshot, 'function');
  const files = new Map([
    ['/root/.pm2/pm2.pid', '50\n'],
    ['/usr/lib/node_modules/pm2/package.json', '{"version":"6.0.14"}'],
    [
      '/usr/lib/node_modules/pm2/constants.js',
      "  KILL_TIMEOUT            : process.env.PM2_KILL_TIMEOUT || 1600,\n  KILL_SIGNAL             : process.env.PM2_KILL_SIGNAL || 'SIGINT',\n",
    ],
    ['/proc/50/environ', 'PRIVATE_KEY=never-return\0PM2_KILL_TIMEOUT=2200\0'],
    ['/proc/50/cmdline', 'PM2 v6.0.14: God Daemon (/root/.pm2)\0'],
  ]);
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    readFile: async (path) => {
      assert.ok(files.has(path));
      return files.get(path);
    },
  };
  const result = await module.readCutoverPM2RuntimeSnapshot(io);
  assert.equal(result.killTimeoutMs, 2200);
  assert.equal(result.killSignal, 'SIGINT');
  assert.equal(result.pid, 50);
  assert.equal(result.version, '6.0.14');
  assert.equal(JSON.stringify(result).includes('never-return'), false);
  files.set('/proc/50/environ', 'PRIVATE_KEY=never-return\0');
  assert.equal((await module.readCutoverPM2RuntimeSnapshot(io)).killTimeoutMs, 1600);
  files.set('/proc/50/environ', 'PM2_KILL_SIGNAL=SIGTERM\0');
  assert.equal((await module.readCutoverPM2RuntimeSnapshot(io)).killSignal, 'SIGTERM');
  files.set('/proc/50/cmdline', 'PM2 v6.0.13: God Daemon (/root/.pm2)\0');
  await assert.rejects(
    module.readCutoverPM2RuntimeSnapshot(io),
    /MAINTENANCE_PM2_OBSERVATION_UNPROVEN/,
  );
  files.set('/proc/50/cmdline', 'PM2 v6.0.14: God Daemon (/root/.pm2)\0');
  files.set('/usr/lib/node_modules/pm2/constants.js', 'other defaults');
  await assert.rejects(
    module.readCutoverPM2RuntimeSnapshot(io),
    /MAINTENANCE_PM2_OBSERVATION_UNPROVEN/,
  );
});
test('host snapshot includes independently observed PM2 defaults', async () => {
  const f = hostFixture();
  f.io.hostname = () => 'iZbp1ActualNodeZ';
  const result = await readCutoverHostSnapshot(f.io);
  assert.equal(result.pm2Runtime?.killTimeoutMs, 1600);
  assert.equal(result.hostname, 'iZbp1ActualNodeZ');
});
test('host snapshot refuses hostname drift while observing the machine', async () => {
  const f = hostFixture();
  let reads = 0;
  f.io.hostname = () => (reads++ ? 'other-host' : 'i-actual-host');
  await assert.rejects(readCutoverHostSnapshot(f.io), /MAINTENANCE_HOST_OBSERVATION_UNPROVEN/);
});
function hostTreeFixture() {
  const f = hostFixture();
  const links = new Map();
  const pids = ['401'];
  const add = (pid, ppid, exe, argv) => {
    pids.push(String(pid));
    f.files.set(`/proc/${pid}/cmdline`, `${argv}\0`);
    f.files.set(`/proc/${pid}/status`, `Uid:\t0\t0\t0\t0\nPPid:\t${ppid}\n`);
    f.files.set(
      `/proc/${pid}/stat`,
      `${pid} (child) S ${Array(18).fill('1').join(' ')} ${pid}00 0`,
    );
    f.files.set(`/proc/${pid}/cgroup`, '0::/system.slice/service');
    links.set(`/proc/${pid}/exe`, exe);
    links.set(`/proc/${pid}/cwd`, '/srv/gateway');
  };
  // Grandchild sorts before parent: closure must not depend on /proc ordering.
  add(20, 30, '/usr/bin/esbuild', 'esbuild --service');
  add(30, 401, '/usr/bin/dash', 'sh -c runner');
  add(50, 1, '/usr/bin/dash', 'sh unrelated-job');
  add(51, 50, '/usr/bin/sleep', 'sleep 300');
  const readlink = f.io.readlink;
  f.io.readlink = async (path) => links.get(path) ?? readlink(path);
  f.io.readdir = async () => [...pids, 'self'];
  return { ...f, add, links };
}
test('host facts retain non-Node descendants transitively without annexing unrelated trees', async () => {
  const f = hostTreeFixture();
  const result = await readCutoverHostSnapshot(f.io);
  assert.deepEqual(
    result.processes.map((p) => p.pid).sort((a, b) => a - b),
    [20, 30, 401],
  );
  assert.equal(result.processes.find((p) => p.pid === 20).ppid, 30);
  assert.equal(result.processes.find((p) => p.pid === 30).exe, '/usr/bin/dash');
  assert.equal(JSON.stringify(result).includes('sh -c runner'), false);
});
test('host facts recognize Node by executable even when its process title was replaced', async () => {
  const f = hostTreeFixture();
  f.add(60, 1, '/usr/bin/node', 'renamed-worker');
  const result = await readCutoverHostSnapshot(f.io);
  assert.ok(result.processes.some((p) => p.pid === 60));
});
for (const change of ['spawn', 'reparent', 'replace', 'cgroup']) {
  test(`host observation rejects descendant ${change} during startup and ingress observation`, async () => {
    const f = hostTreeFixture();
    const exec = f.io.exec;
    f.io.exec = async (...args) => {
      const result = await exec(...args);
      if (args[0] === 'crontab') {
        if (change === 'spawn') f.add(21, 20, '/usr/bin/sleep', 'sleep 600');
        if (change === 'reparent') f.files.set('/proc/30/status', 'Uid:\t0\t0\t0\t0\nPPid:\t1\n');
        if (change === 'replace')
          f.files.set('/proc/20/stat', `20 (child) S ${Array(18).fill('1').join(' ')} 90000 0`);
        if (change === 'cgroup') f.files.set('/proc/20/cgroup', '0::/other.scope');
      }
      return result;
    };
    await assert.rejects(
      readCutoverHostSnapshot(f.io),
      /^Error: MAINTENANCE_HOST_OBSERVATION_UNPROVEN$/,
    );
  });
}
test('host facts include unmanaged 4011, full proc identity and startup sources', async () => {
  const f = hostFixture();
  const result = await readCutoverHostSnapshot(f.io);
  assert.equal(result.processes[0].pid, 401);
  assert.deepEqual(result.processes[0].uids, [998, 998, 998, 998]);
  assert.equal(result.processes[0].start, '12345');
  assert.equal(result.listeners.includes(':4011'), true);
  assert.equal(result.managers[0].autorestart, true);
  assert.equal(result.nginxFiles[0].path, '/etc/nginx/nginx.conf');
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(
    f.calls.some((call) => call[0] === 'systemctl'),
    true,
  );
  assert.equal(
    f.calls.some((call) => call[0] === 'crontab'),
    true,
  );
});
test('host observations bind private PM2 configuration without returning its values', async () => {
  const f = hostFixture();
  const exec = f.io.exec;
  f.io.exec = async (command, args) => {
    const raw = await exec(command, args);
    if (command !== 'pm2') return raw;
    const rows = JSON.parse(raw);
    rows[0].pm2_env.kill_timeout = 660000;
    return JSON.stringify(rows);
  };
  const result = await readCutoverHostSnapshot(f.io);
  const { registrationConfigDigest } = await import('./browser-first-cutover-registrations.mjs');
  assert.equal(
    result.managers[0].configDigest,
    registrationConfigDigest({
      pm_cwd: '/opt/holaday-cn-payment',
      autorestart: true,
      status: 'online',
      PRIVATE_KEY: 'secret',
      kill_timeout: 660000,
    }),
  );
  assert.equal(result.managers[0].killTimeoutMs, 660000);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
for (const change of ['pid', 'new-registration', 'environment', 'kill-timeout', 'schedule']) {
  test(`host snapshot rejects PM2 ${change} drift during the same observation`, async () => {
    const f = hostFixture();
    const exec = f.io.exec;
    let reads = 0;
    f.io.exec = async (command, args) => {
      const raw = await exec(command, args);
      if (command !== 'pm2') return raw;
      const rows = JSON.parse(raw);
      if (++reads > 1) {
        if (change === 'pid') rows[0].pid = 402;
        if (change === 'new-registration') rows.push({ ...rows[0], pm_id: 3 });
        if (change === 'environment') rows[0].pm2_env.PRIVATE_KEY = 'rotated-private-value';
        if (change === 'kill-timeout') rows[0].pm2_env.kill_timeout = 1;
        if (change === 'schedule') rows[0].pm2_env.cron_restart = '* * * * *';
      }
      return JSON.stringify(rows);
    };
    await assert.rejects(readCutoverHostSnapshot(f.io), /MAINTENANCE_HOST_OBSERVATION_UNPROVEN/);
  });
}
test('PM2 heap metrics may vary without losing the configuration binding', async () => {
  const f = hostFixture();
  const exec = f.io.exec;
  let reads = 0;
  f.io.exec = async (command, args) => {
    const raw = await exec(command, args);
    if (command !== 'pm2') return raw;
    const rows = JSON.parse(raw);
    rows[0].pm2_env.axm_monitor = { heap: ++reads };
    return JSON.stringify(rows);
  };
  const result = await readCutoverHostSnapshot(f.io);
  assert.match(result.managers[0].configDigest, /^[a-f0-9]{64}$/);
  assert.equal(reads, 2);
});
function absentRootCrontab(overrides = {}) {
  return Object.assign(new Error('crontab failed'), {
    code: 1,
    stdout: '',
    stderr: 'no crontab for root\n',
    killed: false,
    signal: null,
    ...overrides,
  });
}
test('host snapshot records confirmed root crontab absence without losing other facts', async () => {
  const f = hostFixture();
  const exec = f.io.exec;
  f.io.exec = async (command, args) => {
    if (command === 'crontab') throw absentRootCrontab();
    return exec(command, args);
  };
  const result = await readCutoverHostSnapshot(f.io);
  assert.equal(result.cron, '');
  assert.equal(result.rootCrontabPresent, false);
  assert.equal(result.processes[0].pid, 401);
  assert.equal(result.listeners.includes(':4011'), true);
});
test('empty installed root crontab is distinct from an absent root crontab', async () => {
  const f = hostFixture();
  const exec = f.io.exec;
  f.io.exec = async (command, args) => (command === 'crontab' ? '' : exec(command, args));
  const result = await readCutoverHostSnapshot(f.io);
  assert.equal(result.cron, '');
  assert.equal(result.rootCrontabPresent, true);
});
for (const overrides of [
  { code: 2 },
  { code: 'ENOENT' },
  { stderr: 'permission denied\n' },
  { stderr: 'no crontab for root\npermission denied\n' },
  { stderr: 'no crontab for another-user\n' },
  { stdout: '* * * * * /srv/worker\n' },
  { killed: true },
  { signal: 'SIGTERM' },
]) {
  test(`crontab error is not absence: ${JSON.stringify(overrides)}`, async () => {
    const f = hostFixture();
    const exec = f.io.exec;
    f.io.exec = async (command, args) => {
      if (command === 'crontab') throw absentRootCrontab(overrides);
      return exec(command, args);
    };
    await assert.rejects(
      readCutoverHostSnapshot(f.io),
      /^Error: MAINTENANCE_HOST_OBSERVATION_UNPROVEN$/,
    );
  });
}
for (const first of ['absent', 'present', 'content']) {
  test(`root crontab changing from ${first} during collection rejects`, async () => {
    const f = hostFixture();
    const exec = f.io.exec;
    let reads = 0;
    f.io.exec = async (command, args) => {
      if (command !== 'crontab') return exec(command, args);
      reads++;
      if ((first === 'absent' && reads === 1) || (first === 'present' && reads > 1))
        throw absentRootCrontab();
      return first === 'content' ? `* * * * * /srv/worker-${reads}\n` : '';
    };
    await assert.rejects(
      readCutoverHostSnapshot(f.io),
      /^Error: MAINTENANCE_HOST_OBSERVATION_UNPROVEN$/,
    );
  });
}
test('host observation failure is not an empty inventory and never touches PM2 state', async () => {
  const f = hostFixture();
  f.io.readFile = async () => {
    throw new Error('permission denied PRIVATE');
  };
  await assert.rejects(
    readCutoverHostSnapshot(f.io),
    /^Error: MAINTENANCE_HOST_OBSERVATION_UNPROVEN$/,
  );
  assert.equal(
    f.calls.some((call) => call.some((x) => ['stop', 'restart', 'delete', 'save'].includes(x))),
    false,
  );
});
test('normal proc accounting changes do not masquerade as process identity changes', async () => {
  const f = hostFixture();
  const read = f.io.readFile;
  let count = 0;
  f.io.readFile = async (path) =>
    `${await read(path)}${path.endsWith('/status') ? `voluntary_ctxt_switches:\t${count++}\n` : ''}`;
  const result = await readCutoverHostSnapshot(f.io);
  assert.equal(result.processes.length, 1);
});
async function startupFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-startup-observation-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const path = (p) => root + p;
  const write = async (p, value) => {
    await fs.mkdir(join(path(p), '..'), { recursive: true });
    await fs.writeFile(path(p), value, { mode: 0o600 });
  };
  await write(
    '/root/.pm2/dump.pm2',
    '[{"name":"holaday-orchestrator","env":{"TEST_SECRET":"private"}}]\n',
  );
  await write('/root/.pm2/dump.pm2.bak', '[{"name":"backup-only"}]\n');
  await write('/etc/crontab', '* * * * * root /srv/system-job\n');
  await write('/etc/cron.d/holaday', '* * * * * root /srv/holaday-job\n');
  await write('/var/spool/cron/crontabs/app', '* * * * * /srv/user-job\n');
  await write(
    '/lib/systemd/system/pm2-root.service',
    '[Service]\nExecStart=/usr/bin/pm2 resurrect\n',
  );
  await write(
    '/etc/systemd/system/pm2-root.service.d/override.conf',
    '[Service]\nRestart=always\n',
  );
  await fs.mkdir(path('/etc/systemd/system/multi-user.target.wants'), { recursive: true });
  await fs.symlink(
    path('/lib/systemd/system/pm2-root.service'),
    path('/etc/systemd/system/multi-user.target.wants/pm2-root.service'),
  );
  const properties =
    'Id=pm2-root.service\nLoadState=loaded\nActiveState=inactive\nSubState=dead\nUnitFileState=enabled\nFragmentPath=/lib/systemd/system/pm2-root.service\nDropInPaths=/etc/systemd/system/pm2-root.service.d/override.conf\nExecStart={ path=/usr/bin/pm2 ; argv[]=/usr/bin/pm2 resurrect ; }\nRestart=always\n';
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 100_000,
    lstat: (p) => fs.lstat(path(p)),
    realpath: async (p) => (await fs.realpath(path(p))).slice(root.length),
    open: (p, ...args) => fs.open(path(p), ...args),
    readdir: (p) => fs.readdir(path(p)),
    exec: async (command, args) => {
      assert.equal(command, 'systemctl');
      assert.equal(args[0], 'show');
      assert.equal(args[1], 'pm2-root.service');
      return properties;
    },
  };
  return { io, path, write, properties };
}
test('startup snapshot retains independent PM2 backups, system and user cron, effective unit sources', async (t) => {
  const f = await startupFixture(t);
  const result = await readCutoverStartupSnapshot(f.io);
  const file = (p) => result.files.find((row) => row.path === p);
  assert.equal(
    file('/root/.pm2/dump.pm2').content,
    '[{"name":"holaday-orchestrator","env":{"TEST_SECRET":"private"}}]\n',
  );
  assert.equal(file('/root/.pm2/dump.pm2.bak').content, '[{"name":"backup-only"}]\n');
  assert.equal(file('/etc/rc.local').present, false);
  assert.equal(file('/etc/crontab').content, '* * * * * root /srv/system-job\n');
  assert.equal(file('/var/spool/cron/crontabs/app').content, '* * * * * /srv/user-job\n');
  assert.equal(
    file('/etc/systemd/system/multi-user.target.wants/pm2-root.service').resolved,
    '/lib/systemd/system/pm2-root.service',
  );
  assert.equal(
    file('/lib/systemd/system/pm2-root.service').content,
    '[Service]\nExecStart=/usr/bin/pm2 resurrect\n',
  );
  assert.equal(
    file('/etc/systemd/system/pm2-root.service.d/override.conf').content,
    '[Service]\nRestart=always\n',
  );
  assert.equal(result.pm2Unit, f.properties);
  assert.equal(result.observedAtMs, 100_000);
});
test('startup snapshot includes the observed application, cleanup and browser launcher files', async (t) => {
  const f = await startupFixture(t);
  const launchers = [
    '/var/lib/holaday-deploy/start-orchestrator-production.sh',
    '/var/lib/holaday-deploy/start-account-closure-worker-production.sh',
    '/opt/holaday-monorepo/start-files-cron.sh',
    '/opt/holaday-headed/start.sh',
    '/opt/holaday-vnc/start.sh',
  ];
  for (const path of launchers) await f.write(path, `#!/bin/sh\n# observed ${path}\n`);
  const result = await readCutoverStartupSnapshot(f.io);
  for (const path of launchers) {
    assert.equal(
      result.files.find((file) => file.path === path)?.content,
      `#!/bin/sh\n# observed ${path}\n`,
    );
  }
});
for (const fault of [
  'content',
  'new-file',
  'new-optional',
  'unit-drift',
  'permission',
  'oversized',
  'invalid-utf8',
  'dangling-link',
  'directory-cycle',
  'stale',
]) {
  test(`startup observation refuses ${fault} instead of publishing incomplete sources`, async (t) => {
    const f = await startupFixture(t);
    if (fault === 'permission') {
      const lstat = f.io.lstat;
      f.io.lstat = async (p) => {
        if (p === '/etc/cron.d')
          throw Object.assign(new Error('private failure'), { code: 'EACCES' });
        return lstat(p);
      };
    }
    if (fault === 'oversized') await f.write('/etc/cron.d/huge', Buffer.alloc(8 * 1024 * 1024 + 1));
    if (fault === 'invalid-utf8') await f.write('/etc/cron.d/broken', Buffer.from([0xff]));
    if (fault === 'dangling-link') await fs.symlink(f.path('/missing'), f.path('/etc/cron.d/link'));
    if (fault === 'directory-cycle')
      await fs.symlink(f.path('/etc/cron.d'), f.path('/etc/cron.d/loop'));
    let shows = 0;
    const exec = f.io.exec;
    f.io.exec = async (...args) => {
      const value = await exec(...args);
      if (++shows === 2) {
        if (fault === 'content') await f.write('/root/.pm2/dump.pm2.bak', '[{"name":"changed"}]');
        if (fault === 'new-file')
          await f.write('/etc/cron.d/new-job', '* * * * * root /srv/new-job\n');
        if (fault === 'new-optional') await f.write('/etc/rc.local', '#!/bin/sh\n/srv/launcher\n');
        if (fault === 'unit-drift') return value.replace('Restart=always', 'Restart=no');
        if (fault === 'stale') f.io.now = () => 160_001;
      }
      return value;
    };
    await assert.rejects(
      readCutoverStartupSnapshot(f.io),
      /^Error: MAINTENANCE_STARTUP_OBSERVATION_UNPROVEN$/,
    );
  });
}
test('host observation includes startup facts and refuses a failed startup read', async () => {
  const f = hostFixture();
  const startup = { observedAtMs: 100_000, files: [{ path: '/etc/rc.local', present: false }] };
  f.io.startupSnapshot = async () => startup;
  assert.deepEqual((await readCutoverHostSnapshot(f.io)).startup, startup);
  f.io.startupSnapshot = async () => {
    throw new Error('read failed');
  };
  await assert.rejects(
    readCutoverHostSnapshot(f.io),
    /^Error: MAINTENANCE_HOST_OBSERVATION_UNPROVEN$/,
  );
});

async function nginxFixture(t) {
  const directory = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), 'holaday-nginx-observation-')),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const main = join(directory, 'nginx.conf');
  const enabled = join(directory, 'enabled.conf');
  const release = join(directory, 'release.conf');
  const mainBytes = `events {}\nhttp { include ${enabled}; }\n`;
  const releaseBytes =
    'server { listen 80; listen [::]:80; server_name fixture.local;\n' +
    ' location / { try_files $uri /index.html; }\n}\n';
  await fs.writeFile(main, mainBytes, { mode: 0o644 });
  await fs.writeFile(release, releaseBytes, { mode: 0o644 });
  await fs.symlink(release, enabled);
  const dump =
    `# configuration file ${main}:\n${mainBytes}\n` +
    `# configuration file ${enabled}:\n${releaseBytes}\n`;
  const calls = [];
  const io = {
    ...fs,
    platform: 'linux',
    uid: 0,
    now: () => 100_000,
    exec: async (command, args) => {
      assert.equal(command, 'nginx');
      assert.deepEqual(args, ['-T']);
      calls.push(command);
      return dump;
    },
  };
  return { io, directory, main, enabled, release, mainBytes, releaseBytes, dump, calls };
}

test('nginx observation retains full original bytes, linked release ownership and source digests', async (t) => {
  const f = await nginxFixture(t);
  const result = await readCutoverNginxSnapshot(f.io);
  assert.equal(result.dump, f.dump);
  assert.equal(result.files.length, 2);
  assert.equal(result.files[1].path, f.enabled);
  assert.equal(result.files[1].resolved, f.release);
  assert.equal(result.files[1].uid, process.getuid());
  assert.equal(result.files[1].content, f.releaseBytes);
  assert.equal(result.files[1].digest, createHash('sha256').update(f.releaseBytes).digest('hex'));
  assert.equal(result.files[1].mode, 0o644);
  assert.equal(result.observedAtMs, 100_000);
  assert.equal(f.calls.length, 2);
});

test('nginx source bytes must agree with the tested dump, not only its path', async (t) => {
  const f = await nginxFixture(t);
  await fs.writeFile(f.release, f.releaseBytes.replace('80', '81'));
  await assert.rejects(
    readCutoverNginxSnapshot(f.io),
    /^Error: MAINTENANCE_NGINX_OBSERVATION_UNPROVEN$/,
  );
});

test('nginx config changes and symlink retargeting during observation reject', async (t) => {
  for (const mode of ['dump', 'source', 'link']) {
    const f = await nginxFixture(t);
    const exec = f.io.exec;
    f.io.exec = async (...args) => {
      const dump = await exec(...args);
      if (f.calls.length === 2) {
        if (mode === 'dump') return `${dump}\n`;
        if (mode === 'source') await fs.writeFile(f.release, f.releaseBytes.replace('80', '81'));
        if (mode === 'link') {
          const other = join(f.directory, 'other.conf');
          await fs.writeFile(other, f.releaseBytes);
          await fs.unlink(f.enabled);
          await fs.symlink(other, f.enabled);
        }
      }
      return dump;
    };
    await assert.rejects(
      readCutoverNginxSnapshot(f.io),
      /MAINTENANCE_NGINX_OBSERVATION_UNPROVEN/,
      mode,
    );
  }
});

test('nginx malformed, duplicate, oversized and failed observations never become an empty inventory', async (t) => {
  for (const mode of [
    'empty',
    'duplicate',
    'relative',
    'trailing',
    'oversized',
    'failed',
    'non-root',
    'clock',
  ]) {
    const f = await nginxFixture(t);
    if (mode === 'empty') f.io.exec = async () => '';
    if (mode === 'duplicate') f.io.exec = async () => f.dump + f.dump;
    if (mode === 'relative') f.io.exec = async () => f.dump.replace(f.main, 'relative.conf');
    if (mode === 'trailing') f.io.exec = async () => `${f.dump}unaccounted source`;
    if (mode === 'oversized') f.io.exec = async () => 'x'.repeat(8 * 1024 * 1024 + 1);
    if (mode === 'failed')
      f.io.exec = async () => {
        throw new Error('PRIVATE_CONFIG');
      };
    if (mode === 'non-root') f.io.uid = 501;
    if (mode === 'clock') {
      let n = 0;
      f.io.now = () => (n++ ? 99_999 : 100_000);
    }
    await assert.rejects(
      readCutoverNginxSnapshot(f.io),
      /^Error: MAINTENANCE_NGINX_OBSERVATION_UNPROVEN$/,
      mode,
    );
  }
});

async function publisherFixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-cutover-publish-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(join(directory, 'evidence'), { mode: 0o750 });
  await fs.mkdir(join(directory, 'evidence-private'), { mode: 0o700 });
  const prefix = '/var/lib/holaday-deploy';
  const mapped = (path) => (path.startsWith(prefix) ? directory + path.slice(prefix.length) : path);
  const stat = (s) =>
    new Proxy(s, {
      get(target, key) {
        if (key === 'uid') return 0;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const events = [];
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 100_000,
    lstat: async (path) => stat(await fs.lstat(mapped(path))),
    realpath: async (path) => (await fs.realpath(mapped(path))).replace(directory, prefix),
    open: async (path, flags, mode) => {
      const handle = await fs.open(mapped(path), flags, mode);
      return {
        stat: async () => stat(await handle.stat()),
        writeFile: (bytes) => handle.writeFile(bytes),
        readFile: () => handle.readFile(),
        sync: async () => {
          events.push(['sync', path]);
          await handle.sync();
        },
        chown: async (uid, gid) => {
          assert.equal(uid, 0);
          assert.equal(gid, process.getgid());
        },
        chmod: (mode) => handle.chmod(mode),
        close: () => handle.close(),
      };
    },
    rename: async (from, to) => {
      events.push(['rename', to]);
      await fs.rename(mapped(from), mapped(to));
    },
  };
  const f = fixture();
  const report = await collectCutoverEvidence(f.input, f.io);
  const evidence = f.published[0];
  const options = {
    applicationGid: process.getgid(),
    assertJournalOwnership: async () => f.binding,
  };
  return { directory, io, events, report, evidence, options };
}
test('publishes protected raw evidence before a group-readable report and bound active index', async (t) => {
  const f = await publisherFixture(t);
  await publishCutoverEvidence(f.evidence, f.options, f.io);
  const reportPath = join(f.directory, 'evidence', `${f.report.attempt}.json`);
  const indexPath = join(f.directory, 'evidence', 'active.json');
  const rawFiles = await fs.readdir(join(f.directory, 'evidence-private'));
  assert.equal(rawFiles.length, 1);
  assert.equal(
    (await fs.stat(join(f.directory, 'evidence-private', rawFiles[0]))).mode & 0o777,
    0o600,
  );
  assert.equal((await fs.stat(reportPath)).mode & 0o777, 0o640);
  assert.equal((await fs.stat(indexPath)).mode & 0o777, 0o640);
  const bytes = await fs.readFile(reportPath);
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  assert.equal(index.reportDigest, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(
    f.events.filter((e) => e[0] === 'rename').at(-1)[1],
    '/var/lib/holaday-deploy/evidence/active.json',
  );
  assert.equal(f.events.at(-1)[0], 'sync');
});
test('replaced or writable publication directories cannot publish an index', async (t) => {
  const f = await publisherFixture(t);
  await fs.chmod(join(f.directory, 'evidence'), 0o770);
  await assert.rejects(
    publishCutoverEvidence(f.evidence, f.options, f.io),
    /MAINTENANCE_EVIDENCE_PUBLICATION_UNPROVEN/,
  );
  assert.deepEqual(await fs.readdir(join(f.directory, 'evidence')), []);
});
test('journal loss during publication never replaces active.json', async (t) => {
  const f = await publisherFixture(t);
  let calls = 0;
  f.options.assertJournalOwnership = async () => {
    if (++calls > 1) throw new Error('lost journal');
    return { ...fixture().binding };
  };
  await assert.rejects(
    publishCutoverEvidence(f.evidence, f.options, f.io),
    /MAINTENANCE_EVIDENCE_PUBLICATION_UNPROVEN/,
  );
  assert.equal((await fs.readdir(join(f.directory, 'evidence'))).includes('active.json'), false);
});
test('historical rehearsal must reference protected raw artifacts with matching code and content', async (t) => {
  const f = await publisherFixture(t);
  const base = fixture();
  const rehearsal = structuredClone(base.rehearsal);
  const content = Buffer.from(JSON.stringify({ source: 'test-only-fixture', events: [] }));
  const rawDigest = createHash('sha256').update(content).digest('hex');
  rehearsal.artifacts[0].transcriptDigest = rawDigest;
  rehearsal.artifacts[0].queryDigest = rawDigest;
  rehearsal.artifacts[0].settlementDigest = rawDigest;
  const root = join(f.directory, 'evidence-private');
  await fs.writeFile(join(root, `${rawDigest}.json`), content, { mode: 0o600 });
  await fs.writeFile(
    join(root, `rehearsal-${base.binding.configDigest}.json`),
    JSON.stringify({ schemaVersion: 1, ...rehearsal }),
    { mode: 0o600 },
  );
  const input = { binding: base.binding, merchants: base.host.inventory.merchants };
  const result = await readCutoverRehearsalArtifacts(input, f.io);
  assert.equal(result.artifacts[0].transcriptDigest, rawDigest);
  await fs.writeFile(join(root, `${rawDigest}.json`), '{}');
  await assert.rejects(
    readCutoverRehearsalArtifacts(input, f.io),
    /MAINTENANCE_REHEARSAL_UNPROVEN/,
  );
});
