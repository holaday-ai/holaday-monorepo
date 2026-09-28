import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readFirstCutoverApproval } from './browser-first-cutover-host.mjs';
import * as firstHost from './browser-first-cutover-host.mjs';
import { createFirstCutoverExecutionSite } from './browser-first-cutover-site.mjs';
import { performFirstCutover } from './browser-first-cutover-transition.mjs';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';

const root = '/var/lib/holaday-deploy/maintenance';
const path = `${root}/first-cutover-approved.json`;
const approved = {
  schemaVersion: 1,
  kind: 'first-cutover',
  attempt: '12345678-1234-4234-8234-123456789abc',
  branch: 'codex/browser-release-candidate-20260925',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
  legacyDigest: 'e'.repeat(64),
  maintenanceEndsAtMs: 2000,
  reconcileByMs: 3000,
  operatorRef: 'qa-operator',
};

test('persisted-work host reader owns and closes a dedicated approved database connection', async () => {
  const config = Buffer.from('DATABASE_URL=mysql://synthetic@127.0.0.1/qa');
  const binding = Object.fromEntries(
    ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].map((k) => [
      k,
      approved[k],
    ]),
  );
  binding.configDigest = createHash('sha256').update(config).digest('hex');
  const events = [];
  const context = {
    binding,
    approval: { ...approved, ...binding },
    root: `/opt/holaday-releases/${binding.candidate}`,
    journal: { assertOwnership: async () => binding },
  };
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    readConfig: async () => config,
    parseConfig: () => ({ DATABASE_URL: 'mysql://synthetic@127.0.0.1/qa' }),
    connectWorkDatabase: async (url, sourceRoot) => {
      assert.equal(url, 'mysql://synthetic@127.0.0.1/qa');
      assert.equal(sourceRoot, context.root);
      events.push('connect');
      return {
        query: async (sql) => {
          events.push(sql);
          return [[], []];
        },
        end: async () => events.push('end'),
      };
    },
  };
  const result = await firstHost.readFirstCutoverPersistedWork(context, io);
  assert.deepEqual(result, { observedAtMs: 1000, unsettled: [] });
  assert.equal(events[0], 'connect');
  assert.deepEqual(events.slice(-2), ['ROLLBACK', 'end']);
  assert.equal(events.filter((v) => v.startsWith('SELECT')).length, 12);
  for (const kind of ['config', 'ownership', 'root', 'deadline', 'query', 'close']) {
    const changes = { ...io };
    const ctx = { ...context };
    let closed = 0;
    let connected = 0;
    changes.connectWorkDatabase = async () => {
      connected++;
      return {
        query: async () => {
          if (kind === 'query') throw new Error('secret database details must not escape');
          return [[], []];
        },
        end: async () => {
          closed++;
          if (kind === 'close') throw new Error('private connection');
        },
      };
    };
    if (kind === 'config') changes.readConfig = async () => Buffer.from('wrong');
    if (kind === 'ownership')
      ctx.journal = { assertOwnership: async () => ({ ...binding, attempt: 'wrong' }) };
    if (kind === 'root') ctx.root = '/wrong';
    if (kind === 'deadline') changes.now = () => approved.maintenanceEndsAtMs;
    await assert.rejects(
      firstHost.readFirstCutoverPersistedWork(ctx, changes),
      /^Error: CUTOVER_WORK_OBSERVATION_UNPROVEN$/,
    );
    assert.equal(connected, ['query', 'close'].includes(kind) ? 1 : 0);
    assert.equal(closed, connected);
  }
});

async function preparationFixture(t, changes = {}) {
  const config = Buffer.from('SYNTHETIC_ONLY=1\n');
  const migrationManifest = { replaysNumberedSql: true };
  const approval = {
    ...approved,
    ...changes,
    configDigest: createHash('sha256').update(config).digest('hex'),
    migrationDigest: createHash('sha256').update(JSON.stringify(migrationManifest)).digest('hex'),
  };
  const f = await fixture(t, approval);
  const events = [];
  const sourceCandidate = 'f'.repeat(40);
  let journal;
  let liveApproval = approval;
  let time = 1000;
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => time,
    readApproval: async (options) => {
      events.push('approval');
      assert.deepEqual(options, { attempt: approved.attempt });
      return {
        ...liveApproval,
        approvalDigest: createHash('sha256').update(JSON.stringify(liveApproval)).digest('hex'),
      };
    },
    inspectLegacySource: async () => ({
      sourceCandidate,
      legacyDigest: approved.legacyDigest,
      observedAtMs: 1000,
    }),
    readConfig: async () => config,
    parseConfig: () => ({
      MODEL_RUNTIME_POLICY: 'qwen_only',
      QWEN_CORE_ROLLOUT_MODE: 'off',
      QWEN_CORE_ENABLED_LANES: 'browser',
      DASHSCOPE_INTL_API_KEY: 'synthetic',
      DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://example.invalid/anthropic',
      DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://example.invalid/responses',
      TEAM_TASK_LIFECYCLE_ENABLED: 'false',
      ACCOUNT_CLOSURE_WORKER_ENABLED: 'false',
    }),
    targetAbsent: async () => events.push('absent'),
    journal: async (path, metadata) => {
      assert.equal(path, root);
      assert.equal(metadata.kind, 'first-cutover');
      assert.equal(metadata.oldIdentity, undefined);
      events.push('lock');
      journal = await acquireReleaseJournal(f.directory, metadata);
      return journal;
    },
    manifest: () => ({ sha256: approval.migrationDigest, manifest: migrationManifest }),
    stageConfig: async () => events.push('config'),
    exec: async (command, args) => {
      events.push([command, ...args].join(' '));
      if (command === 'id') return '998\n';
      if (command === 'git' && args.includes('get-url'))
        return 'https://example.invalid/repo.git\n';
      if (command === 'git' && args.includes('rev-parse')) return `${approved.candidate}\n`;
      return '';
    },
  };
  t.after(async () => {
    await journal?.close();
  });
  return {
    ...f,
    approvalFileIo: f.io,
    io,
    events,
    approval,
    sourceCandidate,
    setTime: (value) => {
      time = value;
    },
    changeApproval: (change) => {
      liveApproval = { ...liveApproval, ...change };
    },
  };
}

// Real staging orchestration, journal, evidence collector, backup coordinator and
// bootstrap files. Remote processes/DB/providers are deliberately synthetic: this
// tests wiring, NOT a two-host production rehearsal or payment recovery proof.
async function lifecycleFixture(t, fault) {
  const inventory = { configurationDigests: ['1'.repeat(64)], merchants: [], targets: [] };
  const f = await preparationFixture(t, {
    inventoryDigest: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
  });
  const events = f.events;
  const identity = { candidate: approved.candidate, bootId: '9'.repeat(32) };
  const binding = Object.fromEntries(
    ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].map((k) => [
      k,
      f.approval[k],
    ]),
  );
  let mode = 'closed';
  let journal;
  const originalJournal = f.io.journal;
  f.io.journal = async (...args) => {
    journal = await originalJournal(...args);
    return journal;
  };
  const record = async () =>
    JSON.parse(await fs.readFile(join(f.directory, `${approved.attempt}.json`), 'utf8'));
  const expectPhase = async (phase, name) => {
    assert.equal((await record()).phase, phase);
    events.push(name);
    if (fault === name) throw new Error('CUTOVER_TEST_FAILURE');
  };
  const stopped = () => ({
    inventoryDigest: binding.inventoryDigest,
    phase: 'stopped',
    observedAtMs: f.io.now(),
    survivors: [],
    listeners: [],
    unknownLaunchers: [],
  });
  const stateRoot = join(f.directory, 'state-parent');
  await fs.mkdir(stateRoot, { mode: 0o700 });
  const base = '/var/lib/holaday';
  const map = (p) => {
    assert.ok(p === base || p.startsWith(`${base}/`));
    return stateRoot + p.slice(base.length);
  };
  f.io.stateFs = {
    ...fs,
    lstat: async (p) => Object.assign(await fs.lstat(map(p)), { uid: 998 }),
    realpath: async (p) => (await fs.realpath(map(p))).replace(stateRoot, base),
    mkdir: async (p, settings) => {
      await expectPhase('migration_started', 'initialize');
      return fs.mkdir(map(p), settings);
    },
    chown: async () => {},
    open: async (p, flags, permissions) => {
      const h = await fs.open(map(p), flags, permissions);
      h.chown = async () => {};
      return h;
    },
  };
  f.io.lifecycle = {
    attach: async (context) => {
      assert.deepEqual(await context.journal.assertOwnership(), binding);
      await expectPhase('preflight', 'site-attach');
    },
    detach: async () => {
      await fs.stat(join(f.directory, 'release.lock'));
      events.push('site-detach');
      if (fault === 'site-detach') throw new Error('CUTOVER_TEST_FAILURE');
    },
    fenceOrders: async () => expectPhase('orders_fenced', 'fence-orders'),
    settleLegacy: async () => expectPhase('legacy_settled', 'settle'),
    stopProducers: async () => expectPhase('producers_stopped', 'stop-producers'),
    fenceAll: async () => expectPhase('all_fenced', 'fence-all'),
    stopLegacy: async () => {
      await expectPhase('stopped', 'stop-legacy');
      return stopped();
    },
    assertStopped: async () => stopped(),
    verifyFence: async () => ({
      inventoryDigest: binding.inventoryDigest,
      stage: 'all-writers',
      observedAtMs: f.io.now(),
      existingSockets: 0,
      internalWriters: 0,
      unsettledWork: 0,
      externalWork: 0,
      producersRunning: 0,
    }),
    restoreIngress: async (_context, actual) => {
      assert.deepEqual(actual, identity);
      assert.equal(mode, 'serving');
      await expectPhase('verified', 'restore-ingress');
    },
    resumeWorker: async () => expectPhase('verified', 'resume-worker'),
    reconcile: async () => expectPhase('reconciled', 'reconcile'),
    holdMaintenance: async () => events.push('hold'),
    readBackupPlan: async () => ({
      sourceIdentity: { serverUuid: '11111111-1111-1111-1111-111111111111', database: 'source_qa' },
      isolatedTarget: {
        serverUuid: '22222222-2222-2222-2222-222222222222',
        database: 'restore_qa',
      },
    }),
  };
  f.io.backup = {
    readDatabaseIdentity: async (v) => structuredClone(v),
    inspectBackupFacility: async () => ({ encryptionProfileDigest: 'e'.repeat(64) }),
    exportDatabase: async () => {
      await expectPhase('backup_verified', 'backup');
      return { reference: 'synthetic-artifact', encryptionProfileDigest: 'e'.repeat(64) };
    },
    hashArtifact: async () => 'f'.repeat(64),
    restoreIsolated: async () => expectPhase('backup_verified', 'restore-db'),
    compareInventoryAndData: async () => ({
      comparisonDigest: '1'.repeat(64),
      sourceDigest: '2'.repeat(64),
      businessDigest: '3'.repeat(64),
    }),
    runApprovedMigrations: async () => expectPhase('backup_verified', 'restore-migrate'),
    verifySchema: async () => ({ schemaDigest: '4'.repeat(64), businessDigest: '3'.repeat(64) }),
    readSourceDigest: async () => '2'.repeat(64),
  };
  f.io.evidence = {
    readHostInventory: async () => ({
      inventory,
      observedAtMs: f.io.now(),
      unknownWriters: fault === 'unknown-writer' ? ['unknown'] : [],
      externalWork: [],
      producersRunning: [],
    }),
    readDatabaseScope: async () => ({ observedAtMs: f.io.now(), orders: [], unsettled: [] }),
    queryOrders: async () => [],
    readRehearsalArtifacts: async () => ({
      ...binding,
      observedAtMs: 1,
      recovery: 'retry-proven',
      recoveryUntilMs: 4000,
      artifacts: [],
    }),
    readFenceState: async ({ stage }) => ({
      inventoryDigest: binding.inventoryDigest,
      observedAtMs: f.io.now(),
      stage: stage === 'prepare' ? 'observed' : 'all-writers',
      uncovered: [],
      liveLegacy: [],
      regeneratedLegacy: [],
    }),
  };
  f.io.publishEvidence = async (evidence, settings) => {
    assert.deepEqual(await settings.assertJournalOwnership(), binding);
    events.push(`evidence:${evidence.report.stage}`);
  };
  f.io.observe = async (actual) => {
    assert.deepEqual(actual, identity);
    events.push('observe-candidate');
  };
  const exec = f.io.exec;
  f.io.exec = async (command, args, settings) => {
    if (args.includes('db:migrate:numbered')) {
      await expectPhase('migration_started', 'migrate');
      assert.equal((await record()).backupReceipt.backupDigest, 'f'.repeat(64));
    }
    if (command === 'pm2') {
      assert.equal(args[0], 'start'); // No global save/delete or old-name reuse.
      await expectPhase('candidate_started', 'start');
      const state = JSON.parse(
        await fs.readFile(join(stateRoot, 'ordinary-maintenance/state.json'), 'utf8'),
      );
      assert.equal(state.bootId, (await record()).bootstrapSeed);
      assert.notEqual(identity.bootId, state.bootId);
      assert.equal(args[args.indexOf('--uid') + 1], '998');
    }
    const controlAt = args.findIndex((v) => v.endsWith('/browser-maintenance-control.mjs'));
    if (controlAt >= 0) {
      const op = args[controlAt + 1];
      if (args.length > controlAt + 2)
        assert.deepEqual(args.slice(controlAt + 2), [identity.candidate, identity.bootId]);
      events.push(`control:${op}`);
      if (op === 'open') {
        mode = 'serving';
        if (fault === 'open-ack') throw new Error('lost ACK');
      }
      if (op === 'close') mode = 'closed';
      return JSON.stringify({
        protocol: 1,
        identity,
        mode,
        idle: mode === 'closed',
        needsReconciliation: mode === 'serving',
      });
    }
    return exec(command, args, settings);
  };
  return {
    ...f,
    binding,
    identity,
    record,
    stateRoot,
    journal: () => journal,
    candidateStatus: () => ({
      identity,
      mode,
      idle: mode === 'closed',
      needsReconciliation: mode === 'serving',
    }),
  };
}

async function runLifecycle(f) {
  assert.equal(typeof firstHost.createFirstCutoverHostAdapter, 'function');
  const adapter = firstHost.createFirstCutoverHostAdapter({ attempt: approved.attempt }, f.io);
  const result = await performFirstCutover({
    candidate: approved.candidate,
    adapter,
    window: f.approval,
    clock: f.io.now,
  });
  return { adapter, result };
}

// Real host, collector, release tail and durable journal; external machines,
// database/backup and runtime processes are explicitly synthetic here.
for (const fault of [undefined, 'candidate-observation', 'opened-observation']) {
  test(`existing host consumes site fence evidence across the full transition (${fault ?? 'success'})`, async (t) => {
    const f = await lifecycleFixture(t);
    const original = f.io.lifecycle;
    let context;
    const pair = () => ({
      observedAtMs: f.io.now(),
      inventoryDigest: f.binding.inventoryDigest,
      unknownLaunchers: [],
      hosts: [],
    });
    const candidate = () => ({
      ...f.candidateStatus(),
      runtime: {
        identity: f.identity,
        root: `/opt/holaday-releases/${f.binding.candidate}`,
        main: { pid: 70 },
        worker: null,
      },
    });
    const site = createFirstCutoverExecutionSite(
      { attempt: f.binding.attempt },
      {
        platform: 'linux',
        uid: 0,
        now: f.io.now,
        readSite: async () => ({
          binding: f.binding,
          legacyDigest: f.approval.legacyDigest,
          maintenanceEndsAtMs: f.approval.maintenanceEndsAtMs,
          reviews: {},
          ingress: { unknownIngress: [] },
          gatewaySiteDigest: 'f'.repeat(64),
          producerStartupFiles: [],
        }),
        readCoordinatorIdentity: async () => ({ binding: f.binding }),
        readPersistedWork: async () => ({ observedAtMs: f.io.now(), unsettled: [] }),
        readCandidateRuntime: async () => candidate(),
        facts: {
          observeWriters: () => original.verifyFence(context),
          observeWork: async () => ({
            inventoryDigest: f.binding.inventoryDigest,
            observedAtMs: f.io.now(),
            unsettledWork: 0,
            externalWork: 0,
            activeRequests: 0,
            unknownWriters: 0,
          }),
          settleLegacy: original.settleLegacy,
          resumeWorker: original.resumeWorker,
          readBackupPlan: original.readBackupPlan,
          reconcile: original.reconcile,
          holdMaintenance: original.holdMaintenance,
        },
        createIngress: async (_args, deps) => ({
          readExecutionIdentities: () => [],
          readTransportIdentity: async () => ({ binding: f.binding }),
          fenceOrders: () => original.fenceOrders(context),
          fenceAll: () => original.fenceAll(context),
          verifyOrders: async () => ({ ...(await original.verifyFence(context)), stage: 'orders' }),
          verifyFence: () => original.verifyFence(context),
          restoreIngress: async (identity) => {
            await deps.verifyOpenedIdentity(identity);
            return original.restoreIngress(context, identity);
          },
          close: async () => {},
        }),
        connectGateway: async () => ({
          readExecutionIdentity: () => ({ binding: f.binding }),
          readTransportIdentity: async () => ({ binding: f.binding }),
          prepare: async () => {},
          retire: () => original.stopLegacy(context),
          close: async () => {},
        }),
        createObserver: async () => ({
          read: async () => pair(),
          readFenceProgress: async () => ({ purpose: 'fence-progress', pair: pair() }),
          readWithCandidate: async (identity) => {
            assert.deepEqual(identity, f.identity);
            const record = await f.record();
            f.events.push(`site-candidate:${record.phase}`);
            if (
              (fault === 'candidate-observation' && record.phase === 'candidate_started') ||
              (fault === 'opened-observation' && f.candidateStatus().mode === 'serving')
            )
              throw new Error('CUTOVER_CANDIDATE_OBSERVATION_UNPROVEN');
            assert.deepEqual(
              record.identity,
              record.phase === 'candidate_started' ? undefined : identity,
            );
            return { ...pair(), candidate: candidate() };
          },
        }),
        retireProducers: () => original.stopProducers(context),
      },
    );
    f.io.lifecycle = {
      ...site.lifecycle,
      attach: async (ctx) => {
        context = ctx;
        await original.attach(ctx);
        await site.lifecycle.attach(ctx);
      },
      detach: async (ctx) => {
        await site.lifecycle.detach(ctx);
        await original.detach(ctx);
      },
    };
    f.io.evidence = { ...f.io.evidence, ...site.evidence };
    const { adapter, result } = await runLifecycle(f);
    assert.equal(result.ok, fault === undefined, JSON.stringify(result));
    if (fault) {
      assert.equal(result.closeAcknowledged, true);
      assert(!f.events.includes('restore-ingress'));
      assert(!f.events.includes('resume-worker'));
      assert(!f.events.includes('reconcile'));
      assert.equal(
        (await f.record()).phase,
        fault === 'candidate-observation' ? 'candidate_started' : 'verified',
      );
    } else {
      assert.deepEqual(
        f.events.filter((event) => event.startsWith('site-candidate:')),
        ['site-candidate:candidate_started', 'site-candidate:verified', 'site-candidate:verified'],
      );
      assert.equal((await f.record()).phase, 'reconciled');
    }
    await adapter.finish(result);
  });
}

test('first host connects real journal, backup receipt and bootstrap before exact new-instance open', async (t) => {
  const f = await lifecycleFixture(t);
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  const r = await f.record();
  assert.equal(r.phase, 'reconciled');
  assert.equal(r.oldIdentity, undefined);
  assert.equal(r.backupReceipt.attempt, approved.attempt);
  assert.deepEqual(
    f.events.filter((v) =>
      [
        'fence-orders',
        'settle',
        'stop-producers',
        'fence-all',
        'stop-legacy',
        'backup',
        'restore-db',
        'restore-migrate',
        'migrate',
        'initialize',
        'start',
        'restore-ingress',
        'resume-worker',
        'reconcile',
      ].includes(v),
    ),
    [
      'fence-orders',
      'settle',
      'stop-producers',
      'fence-all',
      'stop-legacy',
      'backup',
      'restore-db',
      'restore-migrate',
      'migrate',
      'initialize',
      'start',
      'restore-ingress',
      'resume-worker',
      'reconcile',
    ],
  );
  assert.equal(f.events.filter((v) => v === 'evidence:preopen').length, 2);
  await adapter.finish(result);
  await assert.rejects(fs.stat(join(f.directory, 'release.lock')), { code: 'ENOENT' });
});

test('site attaches to owned journal before readiness and detaches before reconciliation', async (t) => {
  const f = await lifecycleFixture(t);
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, true);
  assert(f.events.indexOf('lock') < f.events.indexOf('site-attach'));
  assert(f.events.indexOf('site-attach') < f.events.indexOf('evidence:prepare'));
  assert(f.events.indexOf('resume-worker') < f.events.indexOf('site-detach'));
  assert(f.events.indexOf('site-detach') < f.events.indexOf('reconcile'));
  await adapter.finish(result);
  assert.equal(f.events.filter((e) => e === 'site-detach').length, 1);
});

test('failed read-only site attach never fences and still closes resources with lock retained', async (t) => {
  const f = await lifecycleFixture(t, 'site-attach');
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, false);
  assert(!f.events.includes('fence-orders'));
  assert(!f.events.includes('evidence:prepare'));
  await adapter.finish(result);
  assert.equal(f.events.filter((e) => e === 'site-detach').length, 1);
  await fs.stat(join(f.directory, 'release.lock'));
});

test('uncertain detach closes candidate, keeps journal and is never repeated by finish', async (t) => {
  const f = await lifecycleFixture(t, 'site-detach');
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, false);
  assert.equal(result.closeAcknowledged, true);
  assert(!f.events.includes('reconcile'));
  await adapter.finish(result);
  assert.equal(f.events.filter((e) => e === 'site-detach').length, 1);
  await fs.stat(join(f.directory, 'release.lock'));
});

test('missing attach or detach refuses before acquisition or any build', async (t) => {
  for (const method of ['attach', 'detach']) {
    const f = await lifecycleFixture(t);
    delete f.io.lifecycle[method];
    assert.throws(
      () => firstHost.createFirstCutoverHostAdapter({ attempt: approved.attempt }, f.io),
      /CUTOVER_HOST_OBSERVER_REQUIRED/,
    );
    assert(!f.events.includes('lock'));
  }
});

for (const fault of [
  'fence-orders',
  'settle',
  'stop-producers',
  'fence-all',
  'stop-legacy',
  'backup',
  'restore-db',
  'restore-migrate',
  'migrate',
  'initialize',
  'start',
  'restore-ingress',
  'resume-worker',
  'reconcile',
]) {
  test(`first host retains journal and stops advancing after ${fault} fails`, async (t) => {
    const f = await lifecycleFixture(t, fault);
    const { adapter, result } = await runLifecycle(f);
    assert.equal(result.ok, false);
    assert.ok(f.events.includes('hold'));
    assert.equal(f.events.filter((v) => v === fault).length, 1);
    if (['restore-ingress', 'resume-worker', 'reconcile'].includes(fault))
      assert.ok(f.events.includes('control:close'));
    else assert.ok(!f.events.includes('control:open'));
    await adapter.finish(result);
    await fs.stat(join(f.directory, 'release.lock'));
  });
}

test('first host resolves lost open ACK against same instance without repeating open', async (t) => {
  const f = await lifecycleFixture(t, 'open-ack');
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(f.events.filter((v) => v === 'control:open').length, 1);
  await adapter.finish(result);
});

test('missing remote lifecycle or backup observers refuses before staging or locking', async (t) => {
  for (const missing of ['lifecycle', 'backup', 'evidence']) {
    const f = await lifecycleFixture(t);
    delete f.io[missing];
    assert.equal(typeof firstHost.createFirstCutoverHostAdapter, 'function');
    assert.throws(
      () => firstHost.createFirstCutoverHostAdapter({ attempt: approved.attempt }, f.io),
      /CUTOVER_HOST_OBSERVER_REQUIRED/,
    );
    assert.ok(!f.events.includes('lock'));
  }
});

test('unresolved prepare evidence cannot reach first ingress mutation', async (t) => {
  const f = await lifecycleFixture(t, 'unknown-writer');
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, false);
  assert.ok(!f.events.includes('fence-orders'));
  await adapter.finish(result);
  await fs.stat(join(f.directory, 'release.lock'));
});

test('lost all-writer fence after retirement prevents exporting or migrating despite empty process proof', async (t) => {
  const f = await lifecycleFixture(t);
  f.io.lifecycle.verifyFence = async () => ({
    inventoryDigest: f.binding.inventoryDigest,
    stage: 'orders',
    unsettledWork: 0,
    externalWork: 0,
    producersRunning: 0,
  });
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, false);
  assert.ok(!f.events.includes('backup'));
  assert.ok(!f.events.includes('migrate'));
  await adapter.finish(result);
});

test('stopped proof cannot be accepted after any process reappears', async (t) => {
  const f = await lifecycleFixture(t);
  const read = f.io.lifecycle.assertStopped;
  f.io.lifecycle.assertStopped = async (...args) => ({
    ...(await read(...args)),
    survivors: [123],
  });
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, false);
  assert.ok(!f.events.includes('backup'));
  await adapter.finish(result);
});

for (const change of [{ observedAtMs: -60000 }, { existingSockets: 1 }, { internalWriters: 1 }]) {
  test(`backup refuses incomplete global isolation: ${JSON.stringify(change)}`, async (t) => {
    const f = await lifecycleFixture(t);
    const read = f.io.lifecycle.verifyFence;
    f.io.lifecycle.verifyFence = async (...args) => ({ ...(await read(...args)), ...change });
    const { adapter, result } = await runLifecycle(f);
    assert.equal(result.ok, false);
    assert.ok(!f.events.includes('backup'));
    await adapter.finish(result);
  });
}

test('concurrent stage requests never start a second candidate preparation', async (t) => {
  const f = await lifecycleFixture(t);
  const adapter = firstHost.createFirstCutoverHostAdapter({ attempt: approved.attempt }, f.io);
  await adapter.preflight(approved.candidate);
  const results = await Promise.allSettled([adapter.stage(), adapter.stage()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(f.events.filter((e) => e === 'lock').length, 1);
  await adapter.finish({ ok: false });
});

test('candidate known from dirty startup is closed even before transition receives start identity', async (t) => {
  const f = await lifecycleFixture(t);
  const exec = f.io.exec;
  f.io.exec = async (command, args, settings) => {
    const value = await exec(command, args, settings);
    if (args.includes('status'))
      return JSON.stringify({ ...JSON.parse(value), needsReconciliation: true });
    return value;
  };
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, false);
  assert.equal(result.closeAcknowledged, true);
  assert.equal(f.events.filter((v) => v === 'control:close').length, 1);
  assert.ok(!f.events.includes('control:open'));
  await adapter.finish(result);
});

test('window expiring after migration neither replays migration nor initializes or starts', async (t) => {
  const f = await lifecycleFixture(t);
  const exec = f.io.exec;
  f.io.exec = async (command, args, settings) => {
    const value = await exec(command, args, settings);
    if (args.includes('db:migrate:numbered')) f.setTime(2000);
    return value;
  };
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, false);
  assert.equal(f.events.filter((v) => v === 'migrate').length, 1);
  assert.ok(!f.events.includes('initialize'));
  await assert.rejects(adapter.migrate(), /CUTOVER_/);
  assert.equal(f.events.filter((v) => v === 'migrate').length, 1);
  await adapter.finish(result);
  await fs.stat(join(f.directory, 'release.lock'));
});

test('protective close still executes when ingress restoration exceeds maintenance deadline', async (t) => {
  const f = await lifecycleFixture(t);
  const restore = f.io.lifecycle.restoreIngress;
  f.io.lifecycle.restoreIngress = async (...args) => {
    await restore(...args);
    f.setTime(2000);
  };
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, false);
  assert.equal(result.closeAcknowledged, true);
  assert.ok(!f.events.includes('resume-worker'));
  await adapter.finish(result);
});

test('reconciliation can finish after maintenance deadline but before separately approved reconcile deadline', async (t) => {
  const f = await lifecycleFixture(t);
  const reconcile = f.io.lifecycle.reconcile;
  f.io.lifecycle.reconcile = async (...args) => {
    await reconcile(...args);
    f.setTime(2500);
  };
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  await adapter.finish(result);
  await assert.rejects(fs.stat(join(f.directory, 'release.lock')), { code: 'ENOENT' });
});

test('reconciled intent without successful effect cannot release the actual journal', async (t) => {
  const f = await lifecycleFixture(t, 'reconcile');
  const { adapter, result } = await runLifecycle(f);
  assert.equal(result.ok, false);
  assert.equal((await f.record()).phase, 'reconciled');
  await assert.rejects(adapter.finish({ ...result, ok: true }), /CUTOVER_HOST_STATE_UNPROVEN/);
  await fs.stat(join(f.directory, 'release.lock'));
});

test('first preparation binds a real reserved journal and stages without fabricating an old boot or stopping services', async (t) => {
  assert.equal(typeof firstHost.prepareFirstCutoverCandidate, 'function');
  const f = await preparationFixture(t);
  f.io.readApproval = (options) => readFirstCutoverApproval(options, f.approvalFileIo);
  const prepared = await firstHost.prepareFirstCutoverCandidate(
    { attempt: approved.attempt },
    f.io,
  );
  assert.equal(prepared.root, `/opt/holaday-releases/${approved.candidate}`);
  assert.equal(prepared.sourceCandidate, f.sourceCandidate);
  const held = await prepared.journal.assertOwnership();
  assert.equal(held.attempt, approved.attempt);
  assert.equal(held.oldIdentity, undefined);
  const record = JSON.parse(
    await fs.readFile(join(f.directory, `${approved.attempt}.json`), 'utf8'),
  );
  assert.equal(record.phase, 'preflight');
  assert.equal(record.kind, 'first-cutover');
  assert.ok(record.migrationManifest);
  assert.ok(f.events.indexOf('lock') < f.events.findIndex((e) => e.startsWith('git clone')));
  assert.ok(!f.events.some((e) => /pm2|nginx|db:migrate|control\.mjs/.test(e)));
  await assert.rejects(
    acquireReleaseJournal(f.directory, {
      candidate: approved.candidate,
      configDigest: f.approval.configDigest,
      migrationDigest: approved.migrationDigest,
      oldIdentity: { candidate: f.sourceCandidate, bootId: '1'.repeat(32) },
    }),
    /MAINTENANCE_RELEASE_LOCKED/,
  );
});

for (const fault of [
  'missing-observer',
  'source-drift',
  'source-stale',
  'source-commit',
  'config',
  'policy',
  'existing-target',
]) {
  test(`first preparation rejects ${fault} before acquiring a journal or staging`, async (t) => {
    assert.equal(typeof firstHost.prepareFirstCutoverCandidate, 'function');
    const f = await preparationFixture(t);
    if (fault === 'missing-observer') f.io.inspectLegacySource = undefined;
    if (fault === 'source-drift')
      f.io.inspectLegacySource = async () => ({
        sourceCandidate: f.sourceCandidate,
        legacyDigest: '0'.repeat(64),
        observedAtMs: 1000,
      });
    if (fault === 'source-stale') {
      f.io.now = () => 100000;
      f.changeApproval({ maintenanceEndsAtMs: 200000, reconcileByMs: 300000 });
    }
    if (fault === 'source-commit')
      f.io.inspectLegacySource = async () => ({
        sourceCandidate: 'HEAD',
        legacyDigest: approved.legacyDigest,
        observedAtMs: 1000,
      });
    if (fault === 'config') f.io.readConfig = async () => Buffer.from('WRONG=1');
    if (fault === 'policy') f.io.parseConfig = () => ({ MODEL_RUNTIME_POLICY: 'legacy' });
    if (fault === 'existing-target')
      f.io.targetAbsent = async () => {
        throw new Error('MAINTENANCE_TARGET_EXISTS');
      };
    await assert.rejects(
      firstHost.prepareFirstCutoverCandidate({ attempt: approved.attempt }, f.io),
    );
    assert.ok(!f.events.includes('lock'));
    assert.ok(!f.events.some((e) => e.startsWith('git clone')));
  });
}

for (const fault of ['approval-drift', 'expired-after-build', 'clock-rollback', 'build-failure']) {
  test(`first preparation ${fault} preserves the incomplete lock and never proceeds to services`, async (t) => {
    assert.equal(typeof firstHost.prepareFirstCutoverCandidate, 'function');
    const f = await preparationFixture(t);
    const exec = f.io.exec;
    f.io.exec = async (command, args) => {
      const result = await exec(command, args);
      if (args.includes('build')) {
        if (fault === 'approval-drift') f.changeApproval({ operatorRef: 'changed' });
        if (fault === 'expired-after-build') f.setTime(2000);
        if (fault === 'clock-rollback') f.setTime(999);
        if (fault === 'build-failure') throw new Error('synthetic failure');
      }
      return result;
    };
    await assert.rejects(
      firstHost.prepareFirstCutoverCandidate({ attempt: approved.attempt }, f.io),
    );
    assert.ok(f.events.includes('lock'));
    await fs.stat(join(f.directory, 'release.lock'));
    const record = JSON.parse(
      await fs.readFile(join(f.directory, `${approved.attempt}.json`), 'utf8'),
    );
    assert.equal(record.phase, 'preflight');
    assert.ok(!record.migrationManifest);
    assert.ok(!f.events.some((e) => /pm2|nginx|db:migrate|control\.mjs/.test(e)));
  });
}
async function fixture(t, record = approved) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-approved-input-')));
  await fs.chmod(directory, 0o700);
  const file = join(directory, 'first-cutover-approved.json');
  const bytes = `${JSON.stringify(record)}\n`;
  await fs.writeFile(file, bytes, { mode: 0o600 });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const map = (p) => {
    assert.ok(p === root || p === path, `unexpected read ${p}`);
    return p === root ? directory : file;
  };
  // Real files exercise inode, mode, hardlink, symlink and read-race behavior.
  // Only the root UID is synthetic on macOS; no production paths are opened.
  const rootStat = (s) => Object.assign(s, { uid: 0 });
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    lstat: async (p) => rootStat(await fs.lstat(map(p))),
    realpath: async (p) => ((await fs.realpath(map(p))) === map(p) ? p : 'not-canonical'),
    open: async (p, flags) => {
      const handle = await fs.open(map(p), flags);
      return {
        stat: async () => rootStat(await handle.stat()),
        readFile: () => handle.readFile(),
        close: () => handle.close(),
      };
    },
  };
  return { io, file, directory, bytes };
}
test('reads only the protected first-cutover manifest and returns its exact content binding', async (t) => {
  const f = await fixture(t);
  const result = await readFirstCutoverApproval({ attempt: approved.attempt }, f.io);
  assert.deepEqual(result, {
    ...approved,
    approvalDigest: createHash('sha256').update(f.bytes).digest('hex'),
  });
});
test('no CLI-selected path, foreign attempt or non-root/non-Linux reader can authorize cutover', async (t) => {
  const f = await fixture(t);
  for (const [options, io] of [
    [{ attempt: approved.attempt, path: '/tmp/approved.json' }, f.io],
    [{ attempt: '22345678-1234-4234-8234-123456789abc' }, f.io],
    [{ attempt: approved.attempt }, { ...f.io, platform: 'darwin' }],
    [{ attempt: approved.attempt }, { ...f.io, uid: 998 }],
  ])
    await assert.rejects(readFirstCutoverApproval(options, io), /CUTOVER_APPROVAL_UNPROVEN/);
});
for (const kind of [
  'symlink',
  'hardlink',
  'writable',
  'public-directory',
  'wrong-owner',
  'replacement',
  'clock-rollback',
  'expired',
  'oversize',
]) {
  test(`approval rejects ${kind} rather than accepting unchecked bytes`, async (t) => {
    const f = await fixture(t);
    if (kind === 'symlink') {
      await fs.rename(f.file, `${f.file}.real`);
      await fs.symlink(`${f.file}.real`, f.file);
    }
    if (kind === 'hardlink') await fs.link(f.file, `${f.file}.link`);
    if (kind === 'writable') await fs.chmod(f.file, 0o660);
    if (kind === 'public-directory') await fs.chmod(f.directory, 0o755);
    if (kind === 'wrong-owner') {
      const stat = f.io.lstat;
      f.io.lstat = async (p) => Object.assign(await stat(p), { uid: 998 });
    }
    if (kind === 'replacement') {
      const open = f.io.open;
      f.io.open = async (...args) => {
        const handle = await open(...args);
        const read = handle.readFile;
        handle.readFile = async () => {
          const bytes = await read();
          await fs.rename(f.file, `${f.file}.old`);
          await fs.writeFile(f.file, bytes, { mode: 0o600 });
          return bytes;
        };
        return handle;
      };
    }
    if (kind === 'clock-rollback') {
      let now = 1000;
      f.io.now = () => --now;
    }
    if (kind === 'expired') f.io.now = () => 2000;
    if (kind === 'oversize') await fs.writeFile(f.file, 'x'.repeat(65537));
    await assert.rejects(
      readFirstCutoverApproval({ attempt: approved.attempt }, f.io),
      /CUTOVER_APPROVAL_UNPROVEN/,
    );
  });
}
test('malformed or extra approval fields cannot silently widen the operation', async (t) => {
  for (const change of [
    { kind: 'normal-release' },
    { candidate: 'HEAD' },
    { branch: '--all' },
    { inventoryDigest: null },
    { legacyDigest: 'unknown' },
    { reconcileByMs: 1999 },
    { operatorRef: '' },
    { skipPayments: true },
  ]) {
    const f = await fixture(t, { ...approved, ...change });
    await assert.rejects(
      readFirstCutoverApproval({ attempt: approved.attempt }, f.io),
      /CUTOVER_APPROVAL_UNPROVEN/,
    );
  }
});
