import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as siteModule from './browser-first-cutover-site.mjs';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'cutover-site-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binding = {
    attempt: '12345678-1234-4234-8234-123456789abc',
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    migrationDigest: createHash('sha256').update('[]').digest('hex'),
    inventoryDigest: 'd'.repeat(64),
  };
  const approval = { ...binding, legacyDigest: 'e'.repeat(64), maintenanceEndsAtMs: 9000 };
  const journal = await acquireReleaseJournal(root, {
    ...binding,
    legacyDigest: approval.legacyDigest,
    kind: 'first-cutover',
  });
  t.after(() => journal.close());
  await journal.bindManifest([]);
  const context = {
    binding,
    approval,
    journal,
    root: `/opt/holaday-releases/${binding.candidate}`,
    applicationGid: 998,
  };
  const scope = {
    binding,
    maintenanceEndsAtMs: 9000,
    legacyDigest: approval.legacyDigest,
    reviews: { synthetic: true },
    ingress: { synthetic: true },
    gatewaySiteDigest: 'f'.repeat(64),
    producerStartupFiles: [],
  };
  const events = [];
  const state = {
    now: 1000,
    producers: 1,
    gateways: 1,
    busy: 0,
    foreign: false,
    failedPrepare: false,
    failedClose: false,
  };
  const receipt = (host, role, pid) => ({ binding, host, role, process: { pid } });
  const classified = () => ({
    observedAtMs: state.now,
    inventoryDigest: binding.inventoryDigest,
    unknownLaunchers: state.foreign ? [{ pid: 999 }] : [],
    hosts: ['vultr', 'aliyun'].map((host) => ({
      host,
      registered: {
        processes:
          host === 'vultr' && state.producers
            ? [{ pid: 10, role: 'main' }]
            : host === 'aliyun' && state.gateways
              ? [{ pid: 20, role: 'gateway' }]
              : [],
        managers: [],
        listeners: [],
      },
      unmanaged: { processes: [], managers: [], listeners: [] },
    })),
  });
  let activeObserver;
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => state.now,
    sleep: async () => {},
    readSite: async () => structuredClone(scope),
    readCoordinatorIdentity: async () => receipt('vultr', 'coordinator', 100),
    readPair: async () => ({ synthetic: true }),
    inspectSource: async (_input, deps) => {
      assert.deepEqual(
        (await deps.readExecutionIdentities()).map((r) => r.role),
        ['coordinator'],
      );
      return { legacyDigest: approval.legacyDigest, sourceCandidate: '9'.repeat(40) };
    },
    facts: {
      observeWriters: async () => ({
        inventoryDigest: binding.inventoryDigest,
        observedAtMs: state.now,
        existingSockets: 0,
        internalWriters: 0,
        producersRunning: state.producers,
      }),
      observeWork: async () => ({
        inventoryDigest: binding.inventoryDigest,
        observedAtMs: state.now,
        unsettledWork: state.busy,
        externalWork: 0,
        activeRequests: 0,
        unknownWriters: 0,
      }),
      verifyOpenedIdentity: async () => {
        throw new Error('not used in this pre-stop fixture');
      },
      settleLegacy: async () => events.push('settled'),
      resumeWorker: async () => events.push('worker'),
      reconcile: async () => events.push('reconciled'),
      holdMaintenance: async () => events.push('held'),
      readBackupPlan: async () => ({ sourceIdentity: {}, isolatedTarget: {} }),
    },
    createIngress: async (input, deps) => {
      assert.equal(deps.journal, journal);
      assert.deepEqual(input.binding, binding);
      events.push('attach-ingress');
      const verify = async (stage) => ({ ...(await deps.observeWriters()), stage });
      return {
        readExecutionIdentities: () => [receipt('aliyun', 'ingress', 101)],
        readTransportIdentity: async () => receipt('vultr', 'ingress-ssh', 102),
        readFenceReceipts: async () => [],
        fenceOrders: async () => events.push('orders'),
        fenceAll: async () => events.push('all'),
        verifyOrders: () => verify('orders'),
        verifyFence: () => verify('all-writers'),
        restoreIngress: async () => events.push('restore'),
        close: async () => events.push('close-ingress'),
      };
    },
    connectGateway: async (input, deps) => {
      assert.equal(deps.journal, journal);
      assert.deepEqual(input.binding, binding);
      events.push('attach-gateway');
      return {
        readExecutionIdentity: () => receipt('aliyun', 'gateway', 103),
        readTransportIdentity: async () => receipt('vultr', 'gateway-ssh', 104),
        prepare: async () => {
          const proof = await deps.verifyFence();
          assert.equal(proof.stage, 'orders');
          assert.equal(proof.producersRunning, 0);
          assert.equal((await deps.observer.read()).unknownLaunchers.length, 0);
          events.push('prepare-gateway');
          if (state.failedPrepare) throw new Error('lost ack');
        },
        retire: async () => {
          assert.equal((await deps.verifyFence()).stage, 'all-writers');
          events.push('retire-gateway');
          state.gateways = 0;
        },
        close: async () => {
          events.push('close-gateway');
          if (state.failedClose) throw new Error('lost detach');
        },
      };
    },
    createObserver: async (input, deps) => {
      assert.equal(deps.journal, journal);
      assert.deepEqual(input.binding, binding);
      assert.deepEqual(
        (await deps.readExecutionIdentities()).map((r) => r.role),
        ['coordinator', 'ingress', 'ingress-ssh', 'gateway', 'gateway-ssh'],
      );
      events.push('baseline');
      activeObserver = {
        read: async () => classified(),
        readFenceProgress: async () => ({ purpose: 'fence-progress', pair: classified() }),
        readRegistrationProgress: async () => {},
        readUnmanagedProgress: async () => {},
        retireUnmanaged: async () => {},
      };
      return activeObserver;
    },
    retireProducers: async (input, deps) => {
      assert.equal(deps.observer, activeObserver);
      assert.deepEqual(input.binding, {
        attempt: binding.attempt,
        inventoryDigest: binding.inventoryDigest,
      });
      const proof = await deps.verifyFence();
      assert.equal(proof.stage, 'orders');
      assert.equal(proof.runningProducers.length, 1);
      events.push('stop-producers');
      state.producers = 0;
    },
  };
  return {
    root,
    context,
    scope,
    events,
    state,
    io,
    journal,
    approval,
    binding,
    make: () => siteModule.createFirstCutoverExecutionSite({ attempt: binding.attempt }, io),
  };
}

test('existing sessions and retirement share one journal from baseline through stopped', async (t) => {
  const f = await fixture(t);
  const site = f.make();
  assert.equal((await site.inspectLegacySource(f.approval)).legacyDigest, f.approval.legacyDigest);
  await site.lifecycle.attach(f.context);
  for (const [phase, method] of [
    ['prepared', null],
    ['orders_fenced', 'fenceOrders'],
    ['legacy_settled', 'settleLegacy'],
    ['producers_stopped', 'stopProducers'],
    ['all_fenced', 'fenceAll'],
    ['stopped', 'stopLegacy'],
  ]) {
    await f.journal.persist(phase, { candidate: f.binding.candidate });
    if (method) await site.lifecycle[method](f.context);
  }
  const proof = await site.lifecycle.assertStopped(f.context);
  assert.deepEqual(proof, {
    inventoryDigest: f.binding.inventoryDigest,
    phase: 'stopped',
    observedAtMs: 1000,
    survivors: [],
    listeners: [],
    unknownLaunchers: [],
  });
  await site.lifecycle.detach(f.context);
  assert.deepEqual(f.events, [
    'attach-ingress',
    'attach-gateway',
    'baseline',
    'orders',
    'settled',
    'stop-producers',
    'prepare-gateway',
    'all',
    'retire-gateway',
    'close-gateway',
    'close-ingress',
  ]);
  assert.equal((await f.journal.readFirstCutoverEffects()).phase, 'stopped');
});

for (const fault of ['busy', 'changed-scope', 'foreign-journal', 'lost-prepare', 'lost-close']) {
  test(`site ${fault} cannot produce a false stopped proof or replay an uncertain effect`, async (t) => {
    const f = await fixture(t);
    const site = f.make();
    await site.lifecycle.attach(f.context);
    for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
      await f.journal.persist(phase, { candidate: f.binding.candidate });
    if (fault === 'busy') f.state.busy = 1;
    if (fault === 'changed-scope') f.scope.gatewaySiteDigest = '1'.repeat(64);
    if (fault === 'lost-prepare') f.state.failedPrepare = true;
    if (fault === 'lost-close') {
      f.state.failedClose = true;
      await assert.rejects(site.lifecycle.detach(f.context), /UNPROVEN/);
      await assert.rejects(site.lifecycle.detach(f.context), /UNPROVEN/);
      assert.deepEqual(f.events.slice(-2), ['close-gateway', 'close-ingress']);
      return;
    }
    const context =
      fault === 'foreign-journal' ? { ...f.context, journal: { ...f.journal } } : f.context;
    await assert.rejects(site.lifecycle.stopProducers(context), /UNPROVEN/);
    await assert.rejects(site.lifecycle.stopProducers(f.context), /UNPROVEN/);
    assert.equal(
      f.events.filter((e) => e === 'stop-producers').length,
      fault === 'lost-prepare' ? 1 : 0,
    );
    await assert.rejects(site.lifecycle.assertStopped(f.context), /UNPROVEN/);
    await site.lifecycle.detach(f.context);
  });
}

test('site refuses missing independent business facts before opening either session', async (t) => {
  const f = await fixture(t);
  f.io.facts.observeWork = undefined;
  assert.throws(() => f.make(), /UNPROVEN/);
  assert.deepEqual(f.events, []);
});
