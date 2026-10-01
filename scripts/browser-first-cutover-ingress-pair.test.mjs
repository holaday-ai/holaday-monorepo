import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { describeCutoverSite } from './browser-first-cutover-fence.mjs';
import * as session from './browser-first-cutover-ingress-session.mjs';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';

const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
async function fixture(t, interrupted = false, reconciliation = false) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-ingress-pair-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = { synthetic: 'two-host-ingress-wiring' };
  const binding = {
    attempt: '12345678-1234-4234-8234-123456789abc',
    candidate: identity.candidate,
    configDigest: 'c'.repeat(64),
    migrationDigest: sha(manifest),
    inventoryDigest: 'd'.repeat(64),
  };
  const journal = await acquireReleaseJournal(root, {
    ...binding,
    kind: 'first-cutover',
    legacyDigest: 'e'.repeat(64),
    ...(interrupted
      ? {
          schemaVersion: 2,
          maintenanceEndsAtMs: 9000,
          reconcileByMs: 12000,
          operatorRef: 'qa-operator',
          legacyInterruption: {
            mode: 'controlled-interruption',
            scope: 'legacy-non-payment-memory',
            approvalRef: 'legacy-interruption-20260928',
            capabilityDigest: '7'.repeat(64),
            observeUntilMs: 8000,
            noAutomaticReplay: true,
          },
        }
      : {}),
  });
  t.after(() => journal.close());
  await journal.bindManifest(manifest);
  const files = [];
  for (const [profile, name] of [
    ['vultr-20260926', 'holaday'],
    ['aliyun-app-20260926', 'hd-app.orangebench.tech'],
    ['aliyun-pay-20260926', 'hd-pay.orangebench.tech'],
  ]) {
    const bytes = await fs.readFile(
      new URL(`./fixtures/cutover-nginx/${name}.conf`, import.meta.url),
      'utf8',
    );
    files.push({
      ...describeCutoverSite(bytes, profile),
      path: `/etc/nginx/sites-available/${name}`,
    });
  }
  const approval = {
    inventoryDigest: binding.inventoryDigest,
    unknownIngress: [],
    files,
    remoteSiteDigest: 'f'.repeat(64),
  };
  const calls = [];
  const receipts = {};
  const counts = { existingSockets: 2, internalWriters: 1, producersRunning: 1 };
  const change = {};
  let now = 1000;
  // Files/nginx/SSH are privileged external boundaries already covered by their
  // physical fixtures. Here real journal transitions drive the two-host ordering.
  let endpointBusy = false;
  const endpoint = async (host, scopeReader, verifyOpened) => {
    const scope = await scopeReader();
    assert.deepEqual(
      scope.files.map((f) => f.path).sort(),
      (host === 'vultr'
        ? ['/etc/nginx/sites-available/holaday']
        : [
            '/etc/nginx/sites-available/hd-app.orangebench.tech',
            '/etc/nginx/sites-available/hd-pay.orangebench.tech',
          ]
      ).sort(),
    );
    const proof = (stage) => ({
      inventoryDigest: binding.inventoryDigest,
      stage,
      observedAtMs: now,
      ...counts,
    });
    const mutate = async (action, stage) => {
      calls.push(`${host}:${action}`);
      receipts[host] = {
        schemaVersion: 1,
        attempt: binding.attempt,
        inventoryDigest: binding.inventoryDigest,
        stage,
        phase: action === 'restore' ? 'restored' : 'active',
        files: scope.files.map((f) => ({
          path: f.path,
          originalDigest: f.digest,
          backupDigest: f.digest,
          generatedDigest: '1'.repeat(64),
        })),
        ...(action === 'restore' ? { identity } : {}),
      };
      if (change.after) await change.after(host, action);
      if (change.fail === `${host}:${action}`) throw new Error('private remote details');
      return action === 'restore' ? undefined : proof(stage);
    };
    return {
      readTransportIdentity: async () => ({
        host: 'vultr',
        binding,
        siteDigest: approval.remoteSiteDigest,
        role: 'ingress-ssh',
        bootId: '11111111-1111-4111-8111-111111111111',
        process: {
          pid: 920,
          ppid: 900,
          start: '100',
          uids: [0, 0, 0, 0],
          cwd: '/',
          exe: '/usr/bin/ssh',
          argvDigest: '7'.repeat(64),
          cgroup: '0::/qa\n',
        },
      }),
      readExecutionIdentity: () => ({
        host,
        binding,
        siteDigest: approval.remoteSiteDigest,
        role: 'ingress',
        bootId: '11111111-1111-4111-8111-111111111111',
        process: {
          pid: 910,
          ppid: 900,
          start: '100',
          uids: [0, 0, 0, 0],
          cwd: '/',
          exe: '/usr/bin/node',
          argvDigest: '8'.repeat(64),
          cgroup: '0::/qa\n',
        },
      }),
      fenceOrders: () => mutate('orders', 'orders'),
      fenceAll: () => mutate('all', 'all-writers'),
      verifyOrders: async () => {
        calls.push(`${host}:verify-orders`);
        return proof('orders');
      },
      verifyFence: async () => {
        calls.push(`${host}:verify`);
        return proof('all-writers');
      },
      restoreIngress: async (v) => {
        assert.deepEqual(v, identity);
        if (change.observeInsideEndpoint) {
          endpointBusy = true;
          try {
            await verifyOpened(v);
          } finally {
            endpointBusy = false;
          }
        }
        return mutate('restore', 'all-writers');
      },
      readFenceReceipt: async () => {
        assert.equal(endpointBusy, false, 'must not recursively occupy an endpoint transport');
        return structuredClone(receipts[host]);
      },
      close: async () => {
        calls.push(`${host}:close`);
      },
    };
  };
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => now,
    journal,
    readApprovedPair: async () => structuredClone(approval),
    observeWriters: async () => ({
      inventoryDigest: binding.inventoryDigest,
      observedAtMs: now,
      ...counts,
    }),
    verifyOpenedIdentity: async () => ({
      identity,
      mode: 'serving',
      idle: false,
      needsReconciliation: true,
    }),
    createLocal: async (input, deps) => {
      assert.deepEqual(input.binding, binding);
      return endpoint('vultr', deps.readApprovedIngress, deps.verifyOpenedIdentity);
    },
    connectRemote: async (input, deps) => {
      assert.equal(input.siteDigest, approval.remoteSiteDigest);
      return endpoint(
        'aliyun',
        async () => ({ ...approval, files: files.slice(1) }),
        deps.verifyOpenedIdentity,
      );
    },
  };
  const phases = [
    'prepared',
    'orders_fenced',
    'legacy_settled',
    'producers_stopped',
    'all_fenced',
    'stopped',
    'backup_verified',
    'migration_started',
    'candidate_started',
    'verified',
    'opened',
    'reconciled',
  ];
  let at = -1;
  const advance = async (phase) => {
    while (phases[at] !== phase) {
      assert(++at < phases.length);
      await journal.persist(phases[at], {
        candidate: identity.candidate,
        ...(at >= 8 ? { identity } : {}),
      });
      if (phases[at] === 'backup_verified')
        await journal.bindBackupReceipt({
          ...binding,
          restoredAtMs: now,
          backupDigest: '1'.repeat(64),
          databaseIdentityDigest: '2'.repeat(64),
          isolatedTargetDigest: '3'.repeat(64),
          encryptionProfileDigest: '4'.repeat(64),
          comparisonDigest: '5'.repeat(64),
          schemaDigest: '6'.repeat(64),
          businessDigest: '7'.repeat(64),
        });
      if (phases[at] === 'migration_started') await journal.bindBootstrapSeed('8'.repeat(32));
    }
  };
  return {
    binding,
    journal,
    approval,
    calls,
    receipts,
    counts,
    change,
    io,
    advance,
    setTime: (v) => {
      now = v;
    },
    start: () => {
      assert.equal(typeof session.createFirstCutoverIngressPair, 'function');
      return session.createFirstCutoverIngressPair(
        { binding, maintenanceEndsAtMs: 9000, ...(reconciliation ? { reconcileByMs: 12000 } : {}) },
        io,
      );
    },
  };
}

test('orders isolation remains verifiable at the owned interruption intent before its receipt', async (t) => {
  const f = await fixture(t, true);
  const pair = await f.start();
  await f.advance('orders_fenced');
  await pair.fenceOrders();
  await f.journal.persist('legacy_interruption_accepted', { candidate: f.binding.candidate });
  assert.equal((await pair.verifyOrders()).stage, 'orders');
  assert.deepEqual(f.calls, [
    'vultr:orders',
    'aliyun:orders',
    'vultr:verify-orders',
    'aliyun:verify-orders',
  ]);
  assert.equal((await f.journal.readFirstCutoverEffects()).interruptionObservation, undefined);
  await pair.close();
});
test('orders remain freshly verifiable while producers settle without repeating either fence mutation', async (t) => {
  const f = await fixture(t);
  const pair = await f.start();
  await f.advance('orders_fenced');
  await pair.fenceOrders();
  const receipts = structuredClone(f.receipts);
  await f.advance('producers_stopped');
  f.setTime(1100);
  assert.equal(typeof pair.verifyOrders, 'function');
  const result = await pair.verifyOrders();
  assert.equal(result.stage, 'orders');
  assert.equal(result.observedAtMs, 1100);
  assert.equal(result.producersRunning, 1);
  assert.deepEqual(f.receipts, receipts);
  assert.deepEqual(f.calls, [
    'vultr:orders',
    'aliyun:orders',
    'vultr:verify-orders',
    'aliyun:verify-orders',
  ]);
  await pair.verifyOrders();
  await f.advance('all_fenced');
  await assert.rejects(pair.verifyOrders(), /UNPROVEN/);
});

test('pair exposes receiver proof during an in-flight fence without recursively using its stream', async (t) => {
  const f = await fixture(t);
  const pair = await f.start();
  assert.equal(typeof pair.readTransportIdentity, 'function');
  let observations = 0;
  f.change.after = async () => {
    const [receipt] = pair.readExecutionIdentities();
    assert.equal(receipt.role, 'ingress');
    assert.equal(receipt.process.pid, 910);
    assert.deepEqual(receipt.binding, f.binding);
    assert.equal(receipt.siteDigest, f.approval.remoteSiteDigest);
    const transport = await pair.readTransportIdentity();
    assert.equal(transport.host, 'vultr');
    assert.equal(transport.process.pid, 920);
    assert.deepEqual(transport.binding, f.binding);
    observations++;
  };
  await f.advance('orders_fenced');
  await pair.fenceOrders();
  assert.equal(observations, 2);
  f.setTime(9000);
  assert.throws(() => pair.readExecutionIdentities(), /UNPROVEN/);
  await assert.rejects(pair.readTransportIdentity(), /UNPROVEN/);
});

test('one journal drives both fixed hosts and preserves host-tagged receipts', async (t) => {
  const f = await fixture(t);
  const pair = await f.start();
  assert.deepEqual(await pair.readFenceReceipts(), []);
  await f.advance('orders_fenced');
  const result = await pair.fenceOrders();
  assert.equal(result.existingSockets, 2); // global count must not be doubled
  assert.deepEqual(
    (await pair.readFenceReceipts()).map((r) => r.host),
    ['vultr', 'aliyun'],
  );
  Object.assign(f.counts, { existingSockets: 0, internalWriters: 0, producersRunning: 0 });
  await f.advance('all_fenced');
  await pair.fenceAll();
  assert.equal((await pair.verifyFence()).stage, 'all-writers');
  await f.advance('verified');
  await pair.restoreIngress(identity);
  assert((await pair.readFenceReceipts()).every((r) => r.receipt.phase === 'restored'));
  await pair.close();
  assert.deepEqual(
    f.calls.filter((s) => !s.endsWith(':verify')),
    [
      'vultr:orders',
      'aliyun:orders',
      'vultr:all',
      'aliyun:all',
      'aliyun:restore',
      'vultr:restore',
      'aliyun:close',
    ],
  );
});

test('first-host uncertain fence never dispatches to second host or retries', async (t) => {
  const f = await fixture(t);
  const pair = await f.start();
  await f.advance('orders_fenced');
  f.change.fail = 'vultr:orders';
  await assert.rejects(pair.fenceOrders(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  await assert.rejects(pair.fenceOrders(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  assert.deepEqual(f.calls, ['vultr:orders']);
  assert.equal((await pair.readFenceReceipts()).length, 1);
  await pair.close();
});

test('second-host lost acknowledgement retains both receipts without automatic restore', async (t) => {
  const f = await fixture(t);
  const pair = await f.start();
  await f.advance('orders_fenced');
  f.change.fail = 'aliyun:orders';
  await assert.rejects(pair.fenceOrders(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  await f.advance('all_fenced');
  await assert.rejects(pair.fenceAll(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  assert.deepEqual(f.calls, ['vultr:orders', 'aliyun:orders']);
  assert.equal((await pair.readFenceReceipts()).length, 2);
  await pair.close();
});

test('phase drift between hosts refuses the second effect', async (t) => {
  const f = await fixture(t);
  const pair = await f.start();
  await f.advance('orders_fenced');
  f.change.after = async (host) => {
    if (host === 'vultr') await f.advance('legacy_settled');
  };
  await assert.rejects(pair.fenceOrders(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  assert.deepEqual(f.calls, ['vultr:orders']);
  await pair.close();
});

test('scope drift between hosts refuses the second effect', async (t) => {
  const f = await fixture(t);
  const pair = await f.start();
  await f.advance('orders_fenced');
  f.change.after = async (host) => {
    if (host === 'vultr') f.approval.remoteSiteDigest = '9'.repeat(64);
  };
  await assert.rejects(pair.fenceOrders(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  assert.deepEqual(f.calls, ['vultr:orders']);
  await pair.close();
});

test('missing host approval refuses before endpoint construction', async (t) => {
  const f = await fixture(t);
  f.approval.files.pop();
  await assert.rejects(f.start(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  assert.deepEqual(f.calls, []);
});

test('count drift across hosts cannot become one stable fence proof', async (t) => {
  const f = await fixture(t);
  const pair = await f.start();
  await f.advance('orders_fenced');
  f.change.after = async (host) => {
    if (host === 'aliyun') f.counts.existingSockets++;
  };
  await assert.rejects(pair.fenceOrders(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  await pair.close();
});

test('opened identity observation reads bound fence receipts during restoration without recursive transport', async (t) => {
  const f = await fixture(t);
  f.change.observeInsideEndpoint = true;
  const observed = [];
  f.io.verifyOpenedIdentity = async () => {
    observed.push((await pair.readFenceReceipts()).map((r) => r.receipt.phase));
    return { identity, mode: 'serving', idle: false, needsReconciliation: true };
  };
  const pair = await f.start();
  await f.advance('orders_fenced');
  await pair.fenceOrders();
  Object.assign(f.counts, { existingSockets: 0, internalWriters: 0, producersRunning: 0 });
  await f.advance('all_fenced');
  await pair.fenceAll();
  await f.advance('verified');
  await pair.restoreIngress(identity);
  assert.deepEqual(observed, [
    ['active', 'active'],
    ['active', 'active'],
    ['active', 'restored'],
    ['active', 'restored'],
  ]);
  assert.deepEqual(
    (await pair.readFenceReceipts()).map((r) => r.receipt.phase),
    ['restored', 'restored'],
  );
  await pair.close();
});

for (const drift of ['window', 'phase', 'approval', 'concurrent-mutation']) {
  test(`identity receipt observation refuses ${drift} drift and never restores the public origin`, async (t) => {
    const f = await fixture(t);
    f.io.verifyOpenedIdentity = async () => {
      if (drift === 'window') f.setTime(9000);
      if (drift === 'phase')
        await f.journal.persist('opened', { candidate: identity.candidate, identity });
      if (drift === 'approval') f.approval.remoteSiteDigest = '9'.repeat(64);
      if (drift === 'concurrent-mutation') await pair.restoreIngress(identity);
      await pair.readFenceReceipts();
      return { identity, mode: 'serving', idle: false, needsReconciliation: true };
    };
    const pair = await f.start();
    await f.advance('orders_fenced');
    await pair.fenceOrders();
    Object.assign(f.counts, { existingSockets: 0, internalWriters: 0, producersRunning: 0 });
    await f.advance('all_fenced');
    await pair.fenceAll();
    await f.advance('verified');
    await assert.rejects(pair.restoreIngress(identity), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
    assert.equal(f.calls.filter((c) => c.endsWith(':restore')).length, 0);
    await assert.rejects(pair.restoreIngress(identity), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
    await pair.close();
  });
}

test('restoration failure does not reopen remaining public ingress', async (t) => {
  const f = await fixture(t);
  const pair = await f.start();
  await f.advance('orders_fenced');
  await pair.fenceOrders();
  Object.assign(f.counts, { existingSockets: 0, internalWriters: 0, producersRunning: 0 });
  await f.advance('all_fenced');
  await pair.fenceAll();
  await f.advance('verified');
  f.change.fail = 'aliyun:restore';
  await assert.rejects(pair.restoreIngress(identity), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  assert(!f.calls.includes('vultr:restore'));
  await assert.rejects(pair.restoreIngress(identity), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  await pair.close();
});

test('duplicate successful mutation never calls either endpoint twice', async (t) => {
  const f = await fixture(t);
  const pair = await f.start();
  await f.advance('orders_fenced');
  await pair.fenceOrders();
  await assert.rejects(pair.fenceOrders(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  assert.deepEqual(f.calls, ['vultr:orders', 'aliyun:orders']);
  await pair.close();
});

test('expired window between hosts refuses second effect and preserves diagnostics', async (t) => {
  const f = await fixture(t);
  const pair = await f.start();
  await f.advance('orders_fenced');
  f.change.after = async () => f.setTime(9000);
  await assert.rejects(pair.fenceOrders(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  assert.deepEqual(f.calls, ['vultr:orders']);
  await pair.close(); // Detach is allowed even when no new effect is authorized.
});

test('wrong host receipt cannot substitute for successful endpoint response', async (t) => {
  const f = await fixture(t);
  const pair = await f.start();
  await f.advance('orders_fenced');
  f.change.after = async (host) => {
    if (host === 'aliyun') f.receipts.aliyun.files[0].path = '/etc/nginx/sites-available/holaday';
  };
  await assert.rejects(pair.fenceOrders(), /CUTOVER_INGRESS_PAIR_UNPROVEN/);
  await pair.close();
});

for (const fault of ['none', 'phase', 'deadline', 'late-effect']) {
  test(`same ingress pair late receipts ${fault} preserve original reconciliation permission`, async (t) => {
    const f = await fixture(t, false, true);
    const pair = await f.start();
    await f.advance('orders_fenced');
    await pair.fenceOrders();
    Object.assign(f.counts, { existingSockets: 0, internalWriters: 0, producersRunning: 0 });
    await f.advance('all_fenced');
    await pair.fenceAll();
    await f.advance('verified');
    await pair.restoreIngress(identity);
    if (fault !== 'phase') await f.advance('reconciled');
    f.setTime(fault === 'deadline' ? 12000 : 9500);
    if (fault === 'late-effect') await assert.rejects(pair.fenceAll(), /UNPROVEN/);
    else if (fault === 'none')
      assert((await pair.readFenceReceipts()).every((r) => r.receipt.phase === 'restored'));
    else await assert.rejects(pair.readFenceReceipts(), /UNPROVEN/);
  });
}
