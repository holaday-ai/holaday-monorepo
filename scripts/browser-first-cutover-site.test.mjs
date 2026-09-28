import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readCutoverRehearsalArtifacts } from './browser-cutover-evidence.mjs';
import * as siteModule from './browser-first-cutover-site.mjs';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';
import { finishStoppedRelease } from './browser-maintenance-release-tail.mjs';

async function fixture(t, extraInventory = {}) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'cutover-site-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inventory = {
    configurationDigests: ['b'.repeat(64)],
    merchants: [],
    targets: [{ host: 'vultr', pid: 10, start: '1000', role: 'main', ports: [4001, 4002] }],
    ...extraInventory,
  };
  const binding = {
    attempt: '12345678-1234-4234-8234-123456789abc',
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    migrationDigest: createHash('sha256').update('[]').digest('hex'),
    inventoryDigest: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
  };
  const approval = {
    ...binding,
    legacyDigest: 'e'.repeat(64),
    maintenanceEndsAtMs: 9000,
    reconcileByMs: 12000,
    operatorRef: 'synthetic-qa',
  };
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
    ingress: { synthetic: true, unknownIngress: [] },
    gatewaySiteDigest: 'f'.repeat(64),
    producerStartupFiles: [],
    inventory,
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
            ? [{ pid: 10, start: '1000', role: 'main' }]
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
    readPersistedWork: async () => ({ observedAtMs: state.now, unsettled: [] }),
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
        throw new Error('legacy callback must not authorize restoration');
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
        restoreIngress: async (identity) => {
          await deps.verifyOpenedIdentity(identity);
          events.push('restore');
        },
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
    observer: () => activeObserver,
  };
}

async function candidateFixture(t, customize = async () => {}) {
  const f = await fixture(t);
  const identity = { candidate: f.binding.candidate, bootId: '7'.repeat(32) };
  let mode = 'closed';
  const candidate = () => ({
    identity,
    mode,
    idle: mode === 'closed',
    needsReconciliation: mode === 'serving',
    runtime: { identity, root: f.context.root, main: { pid: 70 }, worker: null },
  });
  f.io.readCandidateRuntime = async (asked) => {
    assert.deepEqual(asked, identity);
    f.events.push('control-read');
    return structuredClone(candidate());
  };
  await customize(f);
  const site = f.make();
  await site.lifecycle.attach(f.context);
  const observe = f.observer().read;
  f.observer().readWithCandidate = async (asked) => {
    assert.deepEqual(asked, identity);
    f.events.push('candidate-pair');
    return { ...(await observe()), candidate: structuredClone(candidate()) };
  };
  const request = (stage = 'preopen') => ({
    binding: f.binding,
    stage,
    window: {
      maintenanceEndsAtMs: f.approval.maintenanceEndsAtMs,
      reconcileByMs: f.approval.reconcileByMs,
      operatorRef: f.approval.operatorRef,
    },
    ...(stage === 'preopen' ? { identity } : {}),
  });
  const advance = async () => {
    for (const phase of [
      'prepared',
      'orders_fenced',
      'legacy_settled',
      'producers_stopped',
      'all_fenced',
      'stopped',
      'backup_verified',
    ])
      await f.journal.persist(phase, { candidate: f.binding.candidate });
    await f.journal.bindBackupReceipt({
      ...f.binding,
      backupDigest: '1'.repeat(64),
      databaseIdentityDigest: '2'.repeat(64),
      isolatedTargetDigest: '3'.repeat(64),
      encryptionProfileDigest: '4'.repeat(64),
      comparisonDigest: '5'.repeat(64),
      schemaDigest: '6'.repeat(64),
      businessDigest: '7'.repeat(64),
      restoredAtMs: 1000,
    });
    f.state.producers = 0;
    f.state.gateways = 0;
  };
  return {
    ...f,
    site,
    identity,
    request,
    advance,
    candidate,
    setMode: (value) => {
      mode = value;
    },
  };
}

test('host inventory preserves approved bytes but derives live producers from fresh observations', async (t) => {
  const f = await candidateFixture(t);
  const value = await f.site.evidence.readHostInventory(f.request('prepare'));
  assert.deepEqual(value, {
    inventory: f.scope.inventory,
    observedAtMs: 1000,
    producersRunning: [
      { host: 'vultr', pid: 10, start: '1000', role: 'main', ports: [4001, 4002] },
    ],
    unknownWriters: [],
    externalWork: [],
  });
  value.inventory.merchants.push({ forged: true });
  assert.deepEqual(
    (await f.site.evidence.readHostInventory(f.request('prepare'))).inventory.merchants,
    [],
  );
  await f.advance();
  await f.journal.persist('migration_started', { candidate: f.binding.candidate });
  await f.journal.bindBootstrapSeed('8'.repeat(32));
  await f.journal.persist('candidate_started', { candidate: f.binding.candidate });
  assert.deepEqual((await f.site.evidence.readHostInventory(f.request())).producersRunning, []);
  assert.equal((await f.journal.readFirstCutoverEffects()).identity, undefined);
  await f.site.lifecycle.detach(f.context);
});

test('site reads original protected rehearsal artifacts without manufacturing a recovery result', async (t) => {
  let path;
  let record;
  const f = await candidateFixture(t, async (f) => {
    const folder = '/var/lib/holaday-deploy/evidence-private';
    const local = `${f.root}/rehearsal`;
    await fs.mkdir(local, { mode: 0o700 });
    path = `${local}/rehearsal-${f.binding.configDigest}.json`;
    record = {
      schemaVersion: 1,
      candidate: f.binding.candidate,
      configDigest: f.binding.configDigest,
      inventoryDigest: f.binding.inventoryDigest,
      observedAtMs: 900,
      recoveryUntilMs: 15000,
      recovery: 'retry-proven',
      artifacts: [],
    };
    await fs.writeFile(path, JSON.stringify(record), { mode: 0o600 });
    const map = (p) => {
      assert(p === folder || p.startsWith(`${folder}/`));
      return local + p.slice(folder.length);
    };
    f.io.readRehearsal = (input) =>
      readCutoverRehearsalArtifacts(input, {
        platform: 'linux',
        uid: 0,
        now: () => f.state.now,
        lstat: async (p) => Object.assign(await fs.lstat(map(p)), { uid: 0 }),
        realpath: async (p) => (await fs.realpath(map(p))).replace(local, folder),
        open: async (p, ...args) => {
          const handle = await fs.open(map(p), ...args);
          const stat = handle.stat.bind(handle);
          handle.stat = async () => Object.assign(await stat(), { uid: 0 });
          return handle;
        },
      });
  });
  const original = await fs.readFile(path, 'utf8');
  const result = await f.site.evidence.readRehearsalArtifacts(f.request('prepare'));
  assert.equal(result.recoveryUntilMs, 15000);
  assert.equal(await fs.readFile(path, 'utf8'), original);
  await fs.writeFile(path, JSON.stringify({ ...record, candidate: '0'.repeat(40) }), {
    mode: 0o600,
  });
  await assert.rejects(
    () => f.site.evidence.readRehearsalArtifacts(f.request('prepare')),
    /UNPROVEN/,
  );
  assert(!f.events.includes('restore'));
  await f.site.lifecycle.detach(f.context);
});

for (const fault of [
  'wrong-pid',
  'pid-reuse',
  'duplicate-producer',
  'unknown',
  'stale',
  'busy',
  'after-busy',
  'serving',
  'window',
  'changed-inventory',
]) {
  test(`host inventory refuses ${fault} without producing readiness`, async (t) => {
    const f = await candidateFixture(t);
    const read = f.observer().read;
    f.observer().read = async () => {
      const actual = await read();
      const p = actual.hosts[0].registered.processes[0];
      if (fault === 'wrong-pid') p.pid++;
      if (fault === 'pid-reuse') p.start = '1001';
      if (fault === 'duplicate-producer') actual.hosts[0].unmanaged.processes.push({ ...p });
      if (fault === 'unknown') actual.unknownLaunchers.push({ pid: 999 });
      if (fault === 'stale') actual.observedAtMs = -1;
      if (fault === 'after-busy') f.state.busy = 1;
      return actual;
    };
    let input = f.request('prepare');
    if (fault === 'busy') f.state.busy = 1;
    if (fault === 'window') input.window.reconcileByMs++;
    if (fault === 'changed-inventory') f.scope.inventory.merchants.push({ forged: true });
    if (fault === 'serving') {
      await f.advance();
      await f.journal.persist('migration_started', { candidate: f.binding.candidate });
      await f.journal.bindBootstrapSeed('8'.repeat(32));
      await f.journal.persist('candidate_started', { candidate: f.binding.candidate });
      f.setMode('serving');
      input = f.request();
    }
    await assert.rejects(() => f.site.evidence.readHostInventory(input), /UNPROVEN/);
    assert(!f.events.includes('restore'));
    await f.site.lifecycle.detach(f.context);
  });
}

test('site readiness and opened control follow the existing release tail without early verified persistence', async (t) => {
  const f = await candidateFixture(t);
  const prepare = await f.site.evidence.readFenceState(f.request('prepare'));
  assert.equal(prepare.stage, 'observed');
  assert.equal(prepare.liveLegacy.length, 2);
  assert(!f.events.includes('candidate-pair'));
  await f.advance();
  const verify = async (expectedPhase) => {
    const record = await f.journal.readFirstCutoverEffects();
    assert.equal(record.phase, expectedPhase);
    assert.deepEqual(record.identity, expectedPhase === 'verified' ? f.identity : undefined);
    const evidence = await f.site.evidence.readFenceState(f.request());
    assert.equal(evidence.stage, 'all-writers');
    assert.deepEqual(evidence.liveLegacy, []);
    assert.deepEqual(evidence.regeneratedLegacy, []);
    assert.equal((await f.journal.readFirstCutoverEffects()).recordDigest, record.recordDigest);
  };
  const result = await finishStoppedRelease({
    candidate: f.binding.candidate,
    adapter: {
      persist: f.journal.persist,
      migrate: () => f.journal.bindBootstrapSeed('8'.repeat(32)),
      start: async () => f.identity,
      verify: () => verify('candidate_started'),
      beforeOpen: () => verify('verified'),
      open: async () => {
        f.setMode('serving');
        return { protocol: 1, ...f.candidate() };
      },
      status: async () => {
        throw new Error('no retry expected');
      },
      afterOpen: (identity) => f.site.lifecycle.restoreIngress(f.context, identity),
      resumeWorker: (identity) => f.site.lifecycle.resumeWorker(f.context, identity),
      close: async () => {
        throw new Error('no close expected');
      },
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal((await f.journal.readFirstCutoverEffects()).phase, 'opened');
  assert.equal(f.events.filter((e) => e === 'candidate-pair').length, 3);
  assert(f.events.indexOf('control-read') < f.events.indexOf('restore'));
  assert(f.events.indexOf('restore') < f.events.indexOf('worker'));
  await f.site.lifecycle.detach(f.context);
});

for (const fault of [
  'binding',
  'window',
  'phase',
  'missing-identity',
  'bootstrap',
  'serving',
  'legacy',
  'busy',
  'runtime-drift',
]) {
  test(`candidate readiness refuses ${fault} without advancing the journal or restoring ingress`, async (t) => {
    const f = await candidateFixture(t);
    await f.advance();
    await f.journal.persist('migration_started', { candidate: f.binding.candidate });
    await f.journal.bindBootstrapSeed('8'.repeat(32));
    if (fault !== 'phase')
      await f.journal.persist('candidate_started', { candidate: f.binding.candidate });
    const input = structuredClone(f.request());
    if (fault === 'binding') input.binding.configDigest = '0'.repeat(64);
    if (fault === 'window') input.window.maintenanceEndsAtMs++;
    if (fault === 'missing-identity') input.identity = undefined;
    if (fault === 'bootstrap') input.identity.bootId = '8'.repeat(32);
    if (fault === 'serving') f.setMode('serving');
    if (fault === 'legacy') f.state.gateways = 1;
    if (fault === 'busy') f.state.busy = 1;
    if (fault === 'runtime-drift')
      f.observer().readWithCandidate = async () => {
        throw new Error('unproven process');
      };
    const before = await f.journal.readFirstCutoverEffects();
    await assert.rejects(() => f.site.evidence.readFenceState(input), /UNPROVEN/);
    assert.deepEqual(await f.journal.readFirstCutoverEffects(), before);
    assert(!f.events.includes('restore'));
    await f.site.lifecycle.detach(f.context);
  });
}

test('database work cannot be hidden by zero-valued external observations', async (t) => {
  const f = await fixture(t);
  f.io.readPersistedWork = async () => ({
    observedAtMs: f.state.now,
    unsettled: [{ table: 'video_edit_render_attempts', id: 1, status: 'pending' }],
  });
  const site = f.make();
  await site.lifecycle.attach(f.context);
  await f.journal.persist('prepared', { candidate: f.binding.candidate });
  await f.journal.persist('orders_fenced', { candidate: f.binding.candidate });
  await site.lifecycle.fenceOrders(f.context);
  await f.journal.persist('legacy_settled', { candidate: f.binding.candidate });
  await assert.rejects(site.lifecycle.settleLegacy(f.context), /CUTOVER_SITE_UNPROVEN/);
  assert(!f.events.includes('stop-producers'));
  await site.lifecycle.detach(f.context);
});

for (const kind of ['stale', 'future', 'after-busy', 'missing', 'failed']) {
  test(`persisted ${kind} observation cannot authorize retirement`, async (t) => {
    const f = await fixture(t);
    let reads = 0;
    f.io.readPersistedWork = async () => {
      reads++;
      if (kind === 'failed') throw new Error('database unavailable');
      return {
        observedAtMs: kind === 'stale' ? -1 : kind === 'future' ? f.state.now + 1 : f.state.now,
        unsettled:
          kind === 'missing'
            ? undefined
            : kind === 'after-busy' && reads === 2
              ? [{ table: 'exploration_runs', id: 1, status: 'running' }]
              : [],
      };
    };
    const site = f.make();
    await site.lifecycle.attach(f.context);
    await f.journal.persist('prepared', { candidate: f.binding.candidate });
    await f.journal.persist('orders_fenced', { candidate: f.binding.candidate });
    await site.lifecycle.fenceOrders(f.context);
    await f.journal.persist('legacy_settled', { candidate: f.binding.candidate });
    await assert.rejects(site.lifecycle.settleLegacy(f.context));
    assert(!f.events.includes('stop-producers'));
    await site.lifecycle.detach(f.context);
  });
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

test('site routes prepare and preopen database scope through the same held journal and inventory', async (t) => {
  let reads = 0;
  const f = await candidateFixture(t, async (f) => {
    f.io.readPaymentScope = async (context, inventory) => {
      assert.equal(context.journal, f.journal);
      assert.deepEqual(inventory, f.scope.inventory);
      reads++;
      return { observedAtMs: f.state.now, orders: [], unsettled: [] };
    };
  });
  assert.equal(typeof f.site.evidence.readDatabaseScope, 'function');
  assert.deepEqual(await f.site.evidence.readDatabaseScope(f.request('prepare')), {
    observedAtMs: f.state.now,
    orders: [],
    unsettled: [],
  });
  await f.advance();
  await f.journal.persist('migration_started', { candidate: f.binding.candidate });
  await f.journal.bindBootstrapSeed('8'.repeat(32));
  await f.journal.persist('candidate_started', { candidate: f.binding.candidate });
  assert.deepEqual(await f.site.evidence.readDatabaseScope(f.request()), {
    observedAtMs: f.state.now,
    orders: [],
    unsettled: [],
  });
  assert.equal(reads, 2);
  assert.equal((await f.journal.readFirstCutoverEffects()).identity, undefined);
  f.scope.gatewaySiteDigest = '1'.repeat(64);
  await assert.rejects(f.site.evidence.readDatabaseScope(f.request()), /UNPROVEN/);
  assert.equal(reads, 2);
});

test('site sends selected orders through the existing gateway only within the same readiness scope', async (t) => {
  const f = await fixture(t);
  const connect = f.io.connectGateway;
  const orders = [{ provider: 'wechat', orderRef: '1'.repeat(64) }];
  let calls = 0;
  f.io.connectGateway = async (...args) => ({
    ...(await connect(...args)),
    queryOrders: async (request) => {
      assert.equal(request.stage, 'prepare');
      assert.deepEqual(request.orders, orders);
      assert.equal((await f.journal.readFirstCutoverEffects()).phase, 'preflight');
      calls++;
      return [{ state: 'closed' }];
    },
  });
  const site = f.make();
  await site.lifecycle.attach(f.context);
  const scope = {
    binding: f.binding,
    stage: 'prepare',
    window: { maintenanceEndsAtMs: 9000, reconcileByMs: 12000, operatorRef: 'synthetic-qa' },
  };
  assert.equal(typeof site.evidence.queryOrders, 'function');
  assert.deepEqual(
    await site.evidence.queryOrders({ observedAtMs: 1000, orders, unsettled: [] }, scope),
    [{ state: 'closed' }],
  );
  await assert.rejects(
    site.evidence.queryOrders({ observedAtMs: 1000, orders, unsettled: [{ id: 1 }] }, scope),
    /UNPROVEN/,
  );
  assert.equal(calls, 1);
  assert(!f.events.includes('restore'));
  await site.lifecycle.detach(f.context);
});

test('site connects the backup plan reader only around fresh physical-stop checks', async (t) => {
  const f = await fixture(t);
  f.io.facts.readBackupPlan = undefined;
  let reads = 0;
  const plan = {
    sourceIdentity: { database: 'source_qa' },
    isolatedTarget: { database: 'restore_qa' },
  };
  f.io.readBackupPlan = async (context, inventory) => {
    assert.equal(context.journal, f.journal);
    assert.deepEqual(inventory, f.scope.inventory);
    assert.equal((await f.journal.readFirstCutoverEffects()).phase, 'backup_verified');
    reads++;
    return plan;
  };
  const site = f.make();
  await site.lifecycle.attach(f.context);
  for (const phase of [
    'prepared',
    'orders_fenced',
    'legacy_settled',
    'producers_stopped',
    'all_fenced',
    'stopped',
    'backup_verified',
  ])
    await f.journal.persist(phase, { candidate: f.binding.candidate });
  f.state.producers = 0;
  f.state.gateways = 0;
  assert.deepEqual(await site.lifecycle.readBackupPlan(f.context), plan);
  assert.equal((await f.journal.readFirstCutoverEffects()).backupReceipt, undefined);
  f.state.busy = 1;
  await assert.rejects(site.lifecycle.readBackupPlan(f.context), /UNPROVEN/);
  assert.equal(reads, 1);
  await site.lifecycle.detach(f.context);
});

test('site source export is single-attempt, bound and checks stopped during the producer', async (t) => {
  const plan = {
    sourceIdentity: { database: 'source_qa' },
    isolatedTarget: { database: 'restore_qa' },
  };
  const f = await fixture(t, { backupPlan: plan });
  let exports = 0;
  f.io.exportSourceBackup = async (context, inventory, deps) => {
    assert.equal(context.journal, f.journal);
    assert.deepEqual(inventory, f.scope.inventory);
    await deps.assertWritersStopped();
    exports++;
    f.state.busy = 1;
    await deps.assertWritersStopped();
    return { reference: 'must-not-return' };
  };
  const site = f.make();
  assert.equal(typeof site.backup?.exportDatabase, 'function');
  await site.lifecycle.attach(f.context);
  for (const phase of [
    'prepared',
    'orders_fenced',
    'legacy_settled',
    'producers_stopped',
    'all_fenced',
    'stopped',
    'backup_verified',
  ])
    await f.journal.persist(phase, { candidate: f.binding.candidate });
  f.state.producers = f.state.gateways = 0;
  const scope = {
    ...plan,
    binding: f.binding,
    maintenanceEndsAtMs: f.context.approval.maintenanceEndsAtMs,
  };
  await assert.rejects(site.backup.exportDatabase(plan.sourceIdentity, scope), /UNPROVEN/);
  assert.equal(exports, 1);
  f.state.busy = 0;
  await assert.rejects(site.backup.exportDatabase(plan.sourceIdentity, scope), /UNPROVEN/);
  assert.equal(exports, 1);
  assert.equal((await f.journal.readFirstCutoverEffects()).backupReceipt, undefined);
  await site.lifecycle.detach(f.context);
});

test('site source export refuses a different source or binding before invoking a producer', async (t) => {
  for (const fault of ['source', 'binding', 'none']) {
    const plan = {
      sourceIdentity: { database: 'source_qa' },
      isolatedTarget: { database: 'restore_qa' },
    };
    const f = await fixture(t, { backupPlan: plan });
    let exports = 0;
    f.io.exportSourceBackup = async (_context, _inventory, deps) => {
      await deps.assertWritersStopped();
      exports++;
      return { reference: 'encrypted-only' };
    };
    const site = f.make();
    assert.equal(typeof site.backup?.exportDatabase, 'function');
    await site.lifecycle.attach(f.context);
    for (const phase of [
      'prepared',
      'orders_fenced',
      'legacy_settled',
      'producers_stopped',
      'all_fenced',
      'stopped',
      'backup_verified',
    ])
      await f.journal.persist(phase, { candidate: f.binding.candidate });
    f.state.producers = f.state.gateways = 0;
    const scope = {
      ...plan,
      binding: { ...f.binding },
      maintenanceEndsAtMs: f.context.approval.maintenanceEndsAtMs,
    };
    if (fault === 'binding') scope.binding.attempt = 'foreign';
    const action = site.backup.exportDatabase(
      fault === 'source' ? { database: 'wrong' } : plan.sourceIdentity,
      scope,
    );
    if (fault === 'none') assert.deepEqual(await action, { reference: 'encrypted-only' });
    else await assert.rejects(action, /UNPROVEN/);
    assert.equal(exports, fault === 'none' ? 1 : 0);
    await site.lifecycle.detach(f.context);
  }
});

test('site refuses missing independent business facts before opening either session', async (t) => {
  const f = await fixture(t);
  f.io.facts.observeWork = undefined;
  assert.throws(() => f.make(), /UNPROVEN/);
  assert.deepEqual(f.events, []);
});
