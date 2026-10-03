import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ingressDiagnosticStage } from './browser-first-cutover-ingress-diagnostics.mjs';

// SYNTHETIC protected material: no production disk or package proof.
function syntheticCloudSources(scope) {
  const metadataPath = '/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info';
  const paths = [
    '/usr/bin/unshare',
    '/bin/sh',
    '/usr/bin/mount',
    '/usr/bin/setpriv',
    '/usr/bin/python3',
    '/usr/bin/Xvfb',
    '/opt/brave.com/brave/brave',
    '/opt/brave.com/brave/chrome_crashpad_handler',
    '/opt/holaday-vnc/start.sh',
    '/usr/bin/bash',
    '/usr/bin/x11vnc',
    '/usr/bin/websockify',
    '/usr/bin/pkill',
    '/usr/bin/sleep',
    '/usr/bin/date',
    '/usr/lib/python3.10/site.py',
    '/usr/lib/python3.10/importlib/metadata/__init__.py',
    '/usr/lib/node_modules/pm2/package.json',
    '/usr/lib/node_modules/pm2/lib/God.js',
    '/usr/lib/node_modules/pm2/lib/God/ForkMode.js',
    '/usr/lib/node_modules/pm2/lib/Utility.js',
    '/usr/lib/node_modules/pm2/lib/God/ActionMethods.js',
    ...[
      '__init__.py',
      'websockifyserver.py',
      'websocketproxy.py',
      'websocket.py',
      'websocketserver.py',
      'auth_plugins.py',
      'token_plugins.py',
    ].map((name) => `/usr/lib/python3/dist-packages/websockify/${name}`),
    ...['entry_points.txt', 'PKG-INFO', 'top_level.txt'].map((name) => `${metadataPath}/${name}`),
  ].sort();
  return {
    host: 'vultr',
    hostname: 'qa-vultr',
    bootId: '11111111-1111-4111-8111-111111111111',
    files: paths.map((path) => ({
      path,
      resolvedPath: path,
      uid: 0,
      gid: 0,
      mode: 0o755,
      size: 1,
      digest: '1'.repeat(64),
    })),
    roles: scope.map(({ name, pmId }) => ({
      name,
      pmId,
      selectionDigest: '2'.repeat(64),
    })),
    pythonEntry: {
      metadataPath,
      name: 'websockify',
      version: '0.10.0',
      group: 'console_scripts',
      entry: 'websockify',
      target: 'websockify.websocketproxy:websockify_init',
    },
  };
}

import { readCutoverRehearsalArtifacts } from './browser-cutover-evidence.mjs';
import { backupAndRestoreCheck } from './browser-first-cutover-backup.mjs';
import * as runtimeModule from './browser-first-cutover-runtime.mjs';
import * as siteModule from './browser-first-cutover-site.mjs';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';
import { finishStoppedRelease } from './browser-maintenance-release-tail.mjs';
const capabilityDigest = '8eae2e6ebcaab8d92eb5694bb6f8f89923a23005888342309278fcc35ac35a72';

async function fixture(t, extraInventory = {}, interrupted = false, exactNavigationPolicy) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'cutover-site-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inventory = {
    configurationDigests: ['b'.repeat(64)],
    merchants: [],
    targets: [
      {
        host: 'vultr',
        pid: 10,
        start: '1000',
        role: 'main',
        ports: [4001, 4002],
      },
    ],
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
    ...(exactNavigationPolicy ? { exactLegacyNavigationDeferral: exactNavigationPolicy } : {}),
    maintenanceEndsAtMs: 9000,
    reconcileByMs: 12000,
    operatorRef: 'synthetic-qa',
    ...(interrupted
      ? {
          schemaVersion: 2,
          kind: 'first-cutover',
          legacyInterruption: {
            mode: 'controlled-interruption',
            scope: 'legacy-non-payment-memory',
            approvalRef: 'legacy-interruption-20260928',
            capabilityDigest,
            observeUntilMs: 8000,
            noAutomaticReplay: true,
          },
        }
      : {}),
  };
  const journal = await acquireReleaseJournal(root, {
    ...approval,
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
    tcp: {
      observedAtMs: 1000,
      existingSockets: 0,
      sourceDigest: '6'.repeat(64),
    },
    capability: {
      schemaVersion: 1,
      sourceCandidate: '107857fe70503e30691073f267d87275596edb20',
      observedAtMs: 1000,
      capabilityDigest,
    },
    legacyWork: {
      schemaVersion: 2,
      knownExternalWork: [],
      activeRequests: {
        kind: 'unobservable',
        reason: 'legacy-no-inflight-api',
      },
      externalWork: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
      capabilityDigest,
      replaySourcesDigest: '8'.repeat(64),
      pendingReplay: 0,
    },
  };
  const receipt = (host, role, pid) => ({
    binding,
    host,
    role,
    process: { pid },
  });
  const classified = () => ({
    legacyCapability: structuredClone(state.capability),
    observedAtMs: state.now,
    inventoryDigest: binding.inventoryDigest,
    unknownLaunchers: state.foreign ? [{ pid: 999 }] : [],
    hosts: ['vultr', 'aliyun'].map((host) => ({
      host,
      tcpObservation: structuredClone(state.tcp),
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
    readPersistedWork: async () => ({
      observedAtMs: state.now,
      unsettled: structuredClone(state.persistedUnsettled ?? []),
      ...(interrupted ? { pendingReplay: 0, replaySourcesDigest: '9'.repeat(64) } : {}),
    }),
    readPair: async () => ({ synthetic: true }),
    inspectSource: async (_input, deps) => {
      assert.deepEqual(
        (await deps.readExecutionIdentities()).map((r) => r.role),
        ['coordinator'],
      );
      return {
        legacyDigest: approval.legacyDigest,
        sourceCandidate: '9'.repeat(40),
      };
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
        ...(interrupted ? structuredClone(state.legacyWork) : {}),
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
      const verify = async (stage) => ({
        ...(await deps.observeWriters()),
        stage,
      });
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
        input.executionSite,
        scope,
        'whole protected scope reaches private observer',
      );
      assert.deepEqual(
        (await deps.readExecutionIdentities()).map((r) => r.role),
        ['coordinator', 'ingress', 'ingress-ssh', 'gateway', 'gateway-ssh'],
      );
      events.push('baseline');
      activeObserver = {
        read: async () => classified(),
        readFenceProgress: async () => ({
          purpose: 'fence-progress',
          pair: classified(),
        }),
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

test('site rejects a recovery recipe digest that differs from the packaged fixed launch before any session', async (t) => {
  const f = await fixture(t);
  f.scope.cloudBrowserRecoveryDigest = '2'.repeat(64);
  await assert.rejects(f.make().lifecycle.attach(f.context), /UNPROVEN/);
  assert.deepEqual(f.events, []);
  assert.equal((await f.journal.readFirstCutoverEffects()).executionSiteDigest, undefined);
});

test('site binds the packaged recovery recipe as part of the actual durable scope', async (t) => {
  const f = await fixture(t);
  assert.equal(typeof runtimeModule.firstCutoverCloudBrowserRecoveryLaunch, 'function');
  f.scope.cloudBrowserRecoveryDigest = createHash('sha256')
    .update(
      JSON.stringify(
        runtimeModule.firstCutoverCloudBrowserRecoveryLaunch({
          attempt: f.binding.attempt,
        }),
      ),
    )
    .digest('hex');
  const site = f.make();
  await site.lifecycle.attach(f.context);
  assert.equal(
    (await f.journal.readFirstCutoverEffects()).executionSiteDigest,
    createHash('sha256').update(JSON.stringify(f.scope)).digest('hex'),
  );
  await site.lifecycle.detach(f.context);
});

function bindCloudRecoveryScope(f) {
  const recipe = createHash('sha256')
    .update(
      JSON.stringify(
        runtimeModule.firstCutoverCloudBrowserRecoveryLaunch({
          attempt: f.binding.attempt,
        }),
      ),
    )
    .digest('hex');
  f.scope.cloudBrowserRecoveryDigest = recipe;
  f.scope.cloudMaintenanceScope = [
    {
      name: 'holaday-vnc',
      pmId: 7,
      scopeDigest: '6'.repeat(64),
      recoveryDigest: createHash('sha256')
        .update(
          JSON.stringify(
            runtimeModule.firstCutoverCloudVncRecoveryMaterial({
              attempt: f.binding.attempt,
            }),
          ),
        )
        .digest('hex'),
    },
    {
      name: 'holaday-chromium-headed',
      pmId: 8,
      scopeDigest: '8'.repeat(64),
      recoveryDigest: recipe,
    },
  ];
  f.scope.cloudRecoverySources = syntheticCloudSources(f.scope.cloudMaintenanceScope);
}

for (const fault of ['missing', 'orphan', 'unknown', 'role']) {
  test(`site rejects synthetic ${fault} cloud source material before sessions or binding`, async (t) => {
    const f = await fixture(t);
    bindCloudRecoveryScope(f);
    if (fault === 'missing') Reflect.deleteProperty(f.scope, 'cloudRecoverySources');
    if (fault === 'orphan') Reflect.deleteProperty(f.scope, 'cloudMaintenanceScope');
    if (fault === 'unknown') f.scope.cloudRecoverySources.accepted = true;
    if (fault === 'role') f.scope.cloudRecoverySources.roles.pop();
    await assert.rejects(f.make().lifecycle.attach(f.context), /UNPROVEN/);
    assert.deepEqual(f.events, []);
    assert.equal((await f.journal.readFirstCutoverEffects()).executionSiteDigest, undefined);
  });
}

for (const kind of ['wrong-digest', 'wrong-attempt', 'old-policy', 'missing']) {
  test(`site rejects ${kind} VNC recovery material before sessions or durable scope binding`, async (t) => {
    const f = await fixture(t);
    bindCloudRecoveryScope(f);
    const material = runtimeModule.firstCutoverCloudVncRecoveryMaterial({
      attempt: f.binding.attempt,
    });
    if (kind === 'wrong-attempt') material.attempt = '22222222-2222-4222-8222-222222222222';
    if (kind === 'old-policy') material.current_conf.max_memory_restart = 0;
    f.scope.cloudMaintenanceScope[0].recoveryDigest =
      kind === 'wrong-digest'
        ? '7'.repeat(64)
        : createHash('sha256').update(JSON.stringify(material)).digest('hex');
    if (kind === 'missing')
      Reflect.deleteProperty(f.scope.cloudMaintenanceScope[0], 'recoveryDigest');
    await assert.rejects(f.make().lifecycle.attach(f.context), /UNPROVEN/);
    assert.deepEqual(f.events, []);
    assert.equal((await f.journal.readFirstCutoverEffects()).executionSiteDigest, undefined);
  });
}

test('site carries approved temporary cloud pair into the same durable journal and forbids omission', async (t) => {
  const f = await fixture(t);
  bindCloudRecoveryScope(f);
  const site = f.make();
  await site.lifecycle.attach(f.context);
  assert.deepEqual(
    JSON.parse(await fs.readFile(f.journal.path, 'utf8')).cloudMaintenanceScope,
    f.scope.cloudMaintenanceScope,
  );
  for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
    await f.journal.persist(phase, { candidate: f.binding.candidate });
  await assert.rejects(
    f.journal.persist('all_fenced', { candidate: f.binding.candidate }),
    /UNPROVEN/,
  );
  f.observer().stopCloudServices = async (input, deps) => {
    assert.equal(input.maintenanceEndsAtMs, 9000);
    assert.equal((await deps.verifyFence()).producersRunning, 0);
    assert.deepEqual(f.events.slice(-2), ['stop-producers', 'prepare-gateway']);
    f.events.push('stop-cloud-pair');
  };
  await site.lifecycle.stopProducers(f.context);
  assert.equal(
    f.events.at(-1),
    'stop-cloud-pair',
    'original site must invoke the guarded controller',
  );
  await site.lifecycle.detach(f.context);
});

test('site refuses a cloud pair whose headed recovery differs from the packaged recipe before sessions', async (t) => {
  const f = await fixture(t);
  bindCloudRecoveryScope(f);
  f.scope.cloudMaintenanceScope[1].recoveryDigest = '9'.repeat(64);
  await assert.rejects(f.make().lifecycle.attach(f.context), /UNPROVEN/);
  assert.deepEqual(f.events, []);
});

test('site pins the complete protected configuration in the real journal before connecting receivers', async (t) => {
  const f = await fixture(t);
  f.scope.backupRecoveryDigest = '1'.repeat(64);
  const expected = createHash('sha256').update(JSON.stringify(f.scope)).digest('hex');
  const connect = f.io.createIngress;
  f.io.createIngress = async (...args) => {
    const disk = JSON.parse(await fs.readFile(f.journal.path, 'utf8'));
    assert.equal(disk.executionSiteDigest, expected);
    assert.equal((await f.journal.readFirstCutoverEffects()).executionSiteDigest, expected);
    return connect(...args);
  };
  const site = f.make();
  await site.inspectLegacySource(f.approval);
  await site.lifecycle.attach(f.context);
  await f.journal.persist('prepared', { candidate: f.binding.candidate });
  assert.equal((await f.journal.readFirstCutoverEffects()).executionSiteDigest, expected);
  await site.lifecycle.detach(f.context);
  const effects = [...f.events];
  await assert.rejects(f.make().lifecycle.attach(f.context), /UNPROVEN/);
  assert.deepEqual(f.events, effects, 'a new site must not resume the same persisted attempt');
});

test('site refuses configuration replacement between review and attachment without receiver effects', async (t) => {
  for (const key of ['backupRecoveryDigest', 'gatewaySiteDigest']) {
    const f = await fixture(t);
    f.scope.backupRecoveryDigest = '1'.repeat(64);
    const site = f.make();
    await site.inspectLegacySource(f.approval);
    f.scope[key] = '2'.repeat(64);
    await assert.rejects(site.lifecycle.attach(f.context), /UNPROVEN/);
    assert.deepEqual(f.events, []);
    assert.equal((await f.journal.readFirstCutoverEffects()).executionSiteDigest, undefined);
  }
});

test('site detects a configuration race while binding and never connects or retries the attempt', async (t) => {
  const f = await fixture(t);
  const digest = createHash('sha256').update(JSON.stringify(f.scope)).digest('hex');
  const bind = f.journal.bindExecutionSite;
  f.journal.bindExecutionSite = async (value) => {
    await bind(value);
    f.scope.gatewaySiteDigest = '2'.repeat(64);
  };
  const site = f.make();
  await assert.rejects(site.lifecycle.attach(f.context), /UNPROVEN/);
  assert.deepEqual(f.events, []);
  assert.equal((await f.journal.readFirstCutoverEffects()).executionSiteDigest, digest);
  f.scope.gatewaySiteDigest = 'f'.repeat(64);
  await assert.rejects(site.lifecycle.attach(f.context), /UNPROVEN/);
  await assert.rejects(f.make().lifecycle.attach(f.context), /UNPROVEN/);
  assert.deepEqual(f.events, []);
});

test('source review refuses configuration drift during inspection and on a later inspection', async (t) => {
  for (const during of [true, false]) {
    const f = await fixture(t);
    const inspect = f.io.inspectSource;
    f.io.inspectSource = async (...args) => {
      const result = await inspect(...args);
      if (during) f.scope.gatewaySiteDigest = '2'.repeat(64);
      return result;
    };
    const site = f.make();
    if (!during) {
      await site.inspectLegacySource(f.approval);
      f.scope.gatewaySiteDigest = '2'.repeat(64);
    }
    await assert.rejects(site.inspectLegacySource(f.approval), /UNPROVEN/);
    assert.deepEqual(f.events, []);
    assert.equal((await f.journal.readFirstCutoverEffects()).executionSiteDigest, undefined);
  }
});

test('site prepare evidence preserves both unknown observations rather than only an empty external list', async (t) => {
  const f = await fixture(t, {}, true);
  const site = f.make();
  await site.lifecycle.attach(f.context);
  const record = await f.journal.readFirstCutoverEffects();
  const input = {
    binding: f.binding,
    stage: 'prepare',
    kind: 'first-cutover',
    riskDigest: record.riskDigest,
    window: {
      maintenanceEndsAtMs: f.approval.maintenanceEndsAtMs,
      reconcileByMs: f.approval.reconcileByMs,
      operatorRef: f.approval.operatorRef,
    },
  };
  const evidence = await site.evidence.readHostInventory(input);
  assert.deepEqual(evidence.externalWork, []);
  const independent = await f.io.facts.observeWork();
  assert.deepEqual(evidence.legacyWork.before.activeRequests, independent.activeRequests);
  assert.notEqual(evidence.legacyWork.before.replaySourcesDigest, independent.replaySourcesDigest);
  assert.deepEqual(evidence.legacyWork.after, evidence.legacyWork.before);
  assert.equal(evidence.riskDigest, record.riskDigest);
  assert.deepEqual(evidence.legacyCapability, f.state.capability);
  evidence.legacyWork.before.pendingReplay = 1;
  assert.equal((await site.evidence.readHostInventory(input)).legacyWork.before.pendingReplay, 0);
  f.state.capability = undefined;
  await assert.rejects(() => site.evidence.readHostInventory(input), /UNPROVEN/);
  await site.lifecycle.detach(f.context);
});
test('site keeps tagged unknown work and requires a durable receipt before producer stop', async (t) => {
  const f = await fixture(t, {}, true);
  const site = f.make();
  await site.lifecycle.attach(f.context);
  const detail = { candidate: f.binding.candidate };
  for (const phase of ['prepared', 'orders_fenced']) await f.journal.persist(phase, detail);
  await site.lifecycle.fenceOrders(f.context);
  const disposition = await site.lifecycle.readLegacyDisposition(f.context);
  assert.equal(disposition.mode, 'controlled-interruption');
  await f.journal.persist('legacy_interruption_accepted', detail);
  await assert.rejects(f.journal.persist('producers_stopped', detail), /UNPROVEN/);
  await site.lifecycle.acceptLegacyInterruption(f.context);
  const receipt = (await f.journal.readFirstCutoverEffects()).interruptionObservation;
  assert.equal(receipt.riskDigest, disposition.riskDigest);
  await f.journal.persist('producers_stopped', detail);
  await site.lifecycle.stopProducers(f.context);
  const proof = await site.lifecycle.verifyFence(f.context);
  assert.equal(proof.externalWork.kind, 'unobservable');
  assert.equal(proof.activeRequests.kind, 'unobservable');
  assert.equal(proof.legacyWork.before.pendingReplay, 0);
  assert.equal(proof.connectedTcp.length, 2);
  assert.ok(proof.connectedTcp.every((tcp) => tcp.sourceDigest === '6'.repeat(64)));
  assert.equal(f.events.includes('settled'), false);
  assert.equal(f.events.filter((event) => event === 'stop-producers').length, 1);
  assert.deepEqual((await f.journal.readFirstCutoverEffects()).interruptionObservation, receipt);
  await site.lifecycle.detach(f.context);
});
test('site cannot accept unknown memory work from approval digest alone without live source proof', async (t) => {
  for (const mode of ['missing', 'changed', 'future', 'unsupported']) {
    const f = await fixture(t, {}, true);
    const site = f.make();
    await site.lifecycle.attach(f.context);
    for (const phase of ['prepared', 'orders_fenced', 'legacy_interruption_accepted'])
      await f.journal.persist(phase, { candidate: f.binding.candidate });
    if (mode === 'missing') f.state.capability = undefined;
    if (mode === 'changed') f.state.capability.capabilityDigest = '7'.repeat(64);
    if (mode === 'future') f.state.capability.observedAtMs = 1001;
    if (mode === 'unsupported') f.state.capability.sourceCandidate = 'a'.repeat(40);
    await assert.rejects(site.lifecycle.acceptLegacyInterruption(f.context), /UNPROVEN/);
    assert.equal((await f.journal.readFirstCutoverEffects()).interruptionObservation, undefined);
    assert.equal(f.events.includes('stop-producers'), false);
    await site.lifecycle.detach(f.context);
  }
});
test('independent connected TCP blocks interruption even when writer callback claims zero', async (t) => {
  for (const tcp of [
    undefined,
    { observedAtMs: 1000, existingSockets: 1, sourceDigest: '6'.repeat(64) },
    { observedAtMs: 1001, existingSockets: 0, sourceDigest: '6'.repeat(64) },
    { observedAtMs: 1000, existingSockets: 0, sourceDigest: '' },
  ]) {
    const f = await fixture(t, {}, true);
    const site = f.make();
    await site.lifecycle.attach(f.context);
    for (const phase of ['prepared', 'orders_fenced', 'legacy_interruption_accepted'])
      await f.journal.persist(phase, { candidate: f.binding.candidate });
    f.state.tcp = tcp;
    await assert.rejects(site.lifecycle.acceptLegacyInterruption(f.context), /UNPROVEN/);
    assert.equal((await f.journal.readFirstCutoverEffects()).interruptionObservation, undefined);
    assert.equal(f.events.includes('stop-producers'), false);
    await site.lifecycle.detach(f.context);
  }
});
test('administrative observation reports known active sources before producer stop and blocks invalid attribution', async (t) => {
  for (const fault of [
    'none',
    'older-attribution',
    'transactions',
    'enabledEvents',
    'replicationReceivers',
    'replicationAppliers',
    'missing',
    'future',
    'digest',
    'read-error',
    'scope-drift',
    'attribution-missing',
    'unattributed',
    'counter-mismatch',
    'future-attribution',
    'claim-global',
  ]) {
    await t.test(fault, async (t) => {
      const databaseObserver = {
        configDigest: 'd'.repeat(64),
        sourceIdentity: {
          database: 'qa',
          serverUuid: '11111111-1111-4111-8111-111111111111',
        },
      };
      const f = await fixture(t, { databaseObserver }, true);
      const proof = {
        schemaVersion: 1,
        scope: 'mysql-server-observation-only',
        startedAtMs: 999,
        observedAtMs: 1000,
        counts: {
          sessions: 5,
          transactions: 0,
          enabledEvents: 0,
          replicationReceivers: 0,
          replicationAppliers: 0,
        },
        sourceDigest: '3'.repeat(64),
        sessionAttribution: {
          scope: 'current-session-attribution-only',
          observedAtMs: 1000,
          sessions: 5,
          unattributed: 0,
          eventSchedulers: 1,
          processes: [
            {
              pid: 10,
              start: '1000',
              ppid: 1,
              uids: [998, 998, 998, 998],
              identityDigest: '4'.repeat(64),
            },
          ],
          sourceDigest: '5'.repeat(64),
          unknownWritersZeroProven: false,
        },
      };
      if (fault in proof.counts) proof.counts[fault] = 1;
      if (fault === 'future') proof.observedAtMs = 1001;
      if (fault === 'digest') proof.sourceDigest = '';
      if (fault === 'attribution-missing') proof.sessionAttribution = undefined;
      if (fault === 'unattributed') proof.sessionAttribution.unattributed = 1;
      if (fault === 'counter-mismatch') proof.sessionAttribution.sessions = 4;
      if (fault === 'future-attribution') proof.sessionAttribution.observedAtMs = 1001;
      if (fault === 'older-attribution') proof.sessionAttribution.observedAtMs = 900;
      if (fault === 'claim-global') proof.sessionAttribution.unknownWritersZeroProven = true;
      let reads = 0;
      f.io.readAdministrativeWriters = async (ctx, inventory) => {
        reads++;
        assert.deepEqual(ctx.binding, f.binding);
        assert.deepEqual(inventory.databaseObserver, databaseObserver);
        if (fault === 'read-error') throw new Error('unavailable');
        if (fault === 'scope-drift')
          f.scope.inventory.databaseObserver.configDigest = '0'.repeat(64);
        return fault === 'missing' ? undefined : structuredClone(proof);
      };
      const original = f.io.facts.observeWriters;
      let delivered = 0;
      f.io.facts.observeWriters = async (ctx, sources) => {
        delivered++;
        assert.deepEqual(sources.database, proof);
        assert.equal(sources.database.unknownWriters, undefined);
        return original(ctx);
      };
      const createIngress = f.io.createIngress;
      f.io.createIngress = (input, deps) =>
        createIngress(input, {
          ...deps,
          observeWriters: async () => {
            const result = await deps.observeWriters();
            if (fault === 'older-attribution') assert.equal(result.observedAtMs, 900);
            if (
              [
                'transactions',
                'enabledEvents',
                'replicationReceivers',
                'replicationAppliers',
              ].includes(fault)
            )
              assert.equal(result.internalWriters, 1);
            return result;
          },
        });
      const site = f.make();
      await site.lifecycle.attach(f.context);
      for (const phase of ['prepared', 'orders_fenced', 'legacy_interruption_accepted'])
        await f.journal.persist(phase, { candidate: f.binding.candidate });
      if (
        [
          'none',
          'older-attribution',
          'transactions',
          'enabledEvents',
          'replicationReceivers',
          'replicationAppliers',
        ].includes(fault)
      ) {
        await site.lifecycle.acceptLegacyInterruption(f.context);
        assert.ok(delivered > 0);
      } else await assert.rejects(site.lifecycle.acceptLegacyInterruption(f.context), /UNPROVEN/);
      assert.ok(reads > 0);
      assert.equal(f.events.includes('stop-producers'), false);
      await site.lifecycle.detach(f.context);
    });
  }
});
test('site interruption refuses known work, source failure and new replay after stop', async (t) => {
  for (const fault of ['known', 'busy', 'foreign', 'read-error', 'after-replay']) {
    const f = await fixture(t, {}, true);
    if (fault === 'known') f.state.legacyWork.knownExternalWork = ['specific-unresolved-action'];
    if (fault === 'busy') f.state.busy = 1;
    if (fault === 'foreign') f.state.foreign = true;
    if (fault === 'read-error')
      f.io.facts.observeWork = async () => {
        throw new Error('cannot observe');
      };
    if (fault === 'after-replay') {
      const original = f.io.retireProducers;
      f.io.retireProducers = async (...args) => {
        await original(...args);
        f.state.legacyWork.pendingReplay = 1;
      };
    }
    const site = f.make();
    await site.lifecycle.attach(f.context);
    const detail = { candidate: f.binding.candidate };
    for (const phase of ['prepared', 'orders_fenced']) await f.journal.persist(phase, detail);
    await site.lifecycle.fenceOrders(f.context);
    await f.journal.persist('legacy_interruption_accepted', detail);
    if (fault === 'after-replay') {
      await site.lifecycle.acceptLegacyInterruption(f.context);
      await f.journal.persist('producers_stopped', detail);
      await assert.rejects(site.lifecycle.stopProducers(f.context), /UNPROVEN/);
      assert.equal(f.events.filter((event) => event === 'stop-producers').length, 1);
      assert.equal(f.events.includes('prepare-gateway'), false);
    } else {
      await assert.rejects(site.lifecycle.acceptLegacyInterruption(f.context), /UNPROVEN/);
      assert.equal(f.events.includes('stop-producers'), false);
      assert.equal((await f.journal.readFirstCutoverEffects()).interruptionObservation, undefined);
    }
    await site.lifecycle.detach(f.context);
  }
});

async function candidateFixture(t, customize = async () => {}, extraInventory = {}) {
  const f = await fixture(t, extraInventory);
  const identity = { candidate: f.binding.candidate, bootId: '7'.repeat(32) };
  let mode = 'closed';
  const candidate = () => ({
    identity,
    mode,
    idle: mode === 'closed',
    needsReconciliation: mode === 'serving',
    runtime: {
      identity,
      root: f.context.root,
      main: { pid: 70 },
      worker: null,
    },
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

async function cloudRecoverySiteFixture(t) {
  const f = await candidateFixture(t, bindCloudRecoveryScope);
  const persist = f.journal.persist;
  f.journal.persist = async (phase, detail) => {
    await persist(phase, detail);
    if (phase === 'producers_stopped')
      for (const service of f.scope.cloudMaintenanceScope)
        for (const event of ['cloud-stop-intent', 'cloud-stopped'])
          await f.journal.recordCloudMaintenanceEvent({
            ...service,
            attempt: f.binding.attempt,
            inventoryDigest: f.binding.inventoryDigest,
            host: 'vultr',
            phase: event,
          });
  };
  await f.advance();
  f.journal.persist = persist;
  await persist('migration_started', { candidate: f.binding.candidate });
  await f.journal.bindBootstrapSeed('8'.repeat(32));
  for (const phase of ['candidate_started', 'verified'])
    await persist(phase, {
      candidate: f.binding.candidate,
      identity: f.identity,
    });
  return f;
}

test('site cloud recovery supplies only nonrecursive work/persisted/fence leaves to the original observer once', async (t) => {
  const f = await cloudRecoverySiteFixture(t);
  assert.equal(typeof f.site.lifecycle.restoreCloudServices, 'function');
  for (const name of ['read', 'readWithCandidate', 'readFenceProgress'])
    f.observer()[name] = async () => {
      throw Error('ordinary observer recursion');
    };
  let calls = 0;
  f.observer().restoreCloudServices = async (input, operations) => {
    calls++;
    assert.deepEqual(input, {
      identity: f.identity,
      maintenanceEndsAtMs: 9000,
    });
    assert.deepEqual(Object.keys(operations), ['readRecoveryFacts']);
    const facts = await operations.readRecoveryFacts();
    assert.deepEqual(Object.keys(facts).sort(), ['fence', 'persisted', 'work']);
    assert.equal(facts.fence.stage, 'all-writers');
    assert.equal(facts.work.unsettledWork, 0);
    assert.deepEqual(facts.persisted.unsettled, []);
    assert.equal((await f.journal.readFirstCutoverEffects()).cloudMaintenanceEvents.length, 4);
    // Synthetic observer boundary only; no claim of native restoration/ACK.
  };
  await f.site.lifecycle.restoreCloudServices(f.context, f.identity);
  await assert.rejects(f.site.lifecycle.restoreCloudServices(f.context, f.identity), /UNPROVEN/);
  assert.equal(calls, 1);
  assert.equal(f.events.includes('restore'), false);
  await f.site.lifecycle.detach(f.context);
});

for (const fault of [
  'missing-controller',
  'boolean-result',
  'uncertain',
  'work',
  'persisted',
  'fence',
  'expired',
  'identity',
]) {
  test(`site cloud recovery refuses ${fault} without recursive fallback or retry`, async (t) => {
    const f = await cloudRecoverySiteFixture(t);
    assert.equal(typeof f.site.lifecycle.restoreCloudServices, 'function');
    let calls = 0;
    if (fault !== 'missing-controller')
      f.observer().restoreCloudServices = async (_input, operations) => {
        calls++;
        if (fault === 'boolean-result') return true;
        if (fault === 'uncertain') throw Error('private uncertain effect');
        await operations.readRecoveryFacts();
      };
    if (fault === 'work') f.state.busy = 1;
    if (fault === 'persisted') f.state.persistedUnsettled = [{}];
    if (fault === 'fence') f.state.producers = 1;
    if (fault === 'expired') f.state.now = 9000;
    const id = fault === 'identity' ? { ...f.identity, bootId: '0'.repeat(32) } : f.identity;
    await assert.rejects(f.site.lifecycle.restoreCloudServices(f.context, id), /UNPROVEN/);
    const attempted = calls;
    await assert.rejects(f.site.lifecycle.restoreCloudServices(f.context, id), /UNPROVEN/);
    assert.equal(calls, attempted);
    assert.equal((await f.journal.readFirstCutoverEffects()).cloudMaintenanceEvents.length, 4);
    assert.equal(f.events.includes('restore'), false);
    await f.site.lifecycle.detach(f.context);
  });
}

test('readiness cannot omit its approved independent database writer source', async (t) => {
  for (const stage of ['prepare', 'preopen']) {
    for (const fault of [
      'none',
      'active',
      'late-active',
      'unavailable',
      'writer-count',
      'foreign',
      'older',
      'sockets',
      'negative-sockets',
      'internal',
    ]) {
      await t.test(`${stage}/${fault}`, async (t) => {
        let reads = 0;
        const f = await candidateFixture(
          t,
          async (f) => {
            f.io.readAdministrativeWriters = async () => {
              reads++;
              if (fault === 'unavailable') throw Error('private unavailable source');
              return {
                schemaVersion: 1,
                scope: 'mysql-server-observation-only',
                startedAtMs: fault === 'older' ? 900 : 1000,
                observedAtMs: 1000,
                counts: {
                  sessions: 1,
                  transactions:
                    fault === 'active' || (fault === 'late-active' && reads > 1) ? 1 : 0,
                  enabledEvents: 0,
                  replicationReceivers: 0,
                  replicationAppliers: 0,
                },
                sourceDigest: '3'.repeat(64),
                sessionAttribution: {
                  scope: 'current-session-attribution-only',
                  observedAtMs: 1000,
                  sessions: 1,
                  unattributed: 0,
                  eventSchedulers: 1,
                  processes: [],
                  sourceDigest: '5'.repeat(64),
                  unknownWritersZeroProven: false,
                },
              };
            };
            const original = f.io.facts.observeWriters;
            f.io.facts.observeWriters = async (ctx, sources) => {
              assert.equal(sources.database.scope, 'mysql-server-observation-only');
              const value = await original(ctx);
              if (fault === 'writer-count') value.producersRunning++;
              if (fault === 'foreign') value.inventoryDigest = '0'.repeat(64);
              if (fault === 'sockets') value.existingSockets = 1;
              if (fault === 'negative-sockets') value.existingSockets = -1;
              if (fault === 'internal') value.internalWriters = 1;
              return value;
            };
          },
          {
            databaseObserver: {
              configDigest: 'd'.repeat(64),
              sourceIdentity: {
                database: 'qa',
                serverUuid: '11111111-1111-4111-8111-111111111111',
              },
            },
          },
        );
        if (stage === 'preopen') {
          await f.advance();
          await f.journal.persist('migration_started', {
            candidate: f.binding.candidate,
          });
          await f.journal.bindBootstrapSeed('8'.repeat(32));
          await f.journal.persist('candidate_started', {
            candidate: f.binding.candidate,
          });
        }
        if (
          ['none', 'older'].includes(fault) ||
          (stage === 'prepare' && ['sockets', 'internal', 'active', 'late-active'].includes(fault))
        ) {
          const result = await f.site.evidence.readHostInventory(f.request(stage));
          assert.equal(reads, 2);
          assert.equal(result.observedAtMs, fault === 'older' ? 900 : 1000);
        } else {
          await assert.rejects(f.site.evidence.readHostInventory(f.request(stage)), /UNPROVEN/);
        }
        assert.equal(f.events.includes('stop-producers'), false);
        assert.equal(f.events.includes('restore'), false);
        await f.site.lifecycle.detach(f.context);
      });
    }
  }
});

test('host inventory preserves approved bytes but derives live producers from fresh observations', async (t) => {
  const f = await candidateFixture(t);
  const value = await f.site.evidence.readHostInventory(f.request('prepare'));
  assert.deepEqual(value, {
    inventory: f.scope.inventory,
    observedAtMs: 1000,
    producersRunning: [
      {
        host: 'vultr',
        pid: 10,
        start: '1000',
        role: 'main',
        ports: [4001, 4002],
      },
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
  await f.journal.persist('migration_started', {
    candidate: f.binding.candidate,
  });
  await f.journal.bindBootstrapSeed('8'.repeat(32));
  await f.journal.persist('candidate_started', {
    candidate: f.binding.candidate,
  });
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
      await f.journal.persist('migration_started', {
        candidate: f.binding.candidate,
      });
      await f.journal.bindBootstrapSeed('8'.repeat(32));
      await f.journal.persist('candidate_started', {
        candidate: f.binding.candidate,
      });
      f.setMode('serving');
      input = f.request();
    }
    await assert.rejects(() => f.site.evidence.readHostInventory(input), /UNPROVEN/);
    assert(!f.events.includes('restore'));
    await f.site.lifecycle.detach(f.context);
  });
}

test('site worker default uses the same live serving observer and rejects regenerated legacy', async (t) => {
  for (const foreign of [false, true]) {
    const f = await candidateFixture(t, async (f) => {
      f.io.facts.resumeWorker = undefined;
      f.io.resumeWorker = async (ctx, id, files, deps) => {
        assert.equal(ctx.journal, f.journal);
        assert.deepEqual(files, f.scope.producerStartupFiles);
        await deps.assertNoLegacy(id);
        f.events.push('worker-started');
      };
    });
    await f.advance();
    await f.journal.persist('migration_started', {
      candidate: f.binding.candidate,
    });
    await f.journal.bindBootstrapSeed('8'.repeat(32));
    await f.journal.persist('candidate_started', {
      candidate: f.binding.candidate,
    });
    await f.journal.persist('verified', {
      candidate: f.binding.candidate,
      identity: f.identity,
    });
    f.setMode('serving');
    f.state.foreign = foreign;
    if (foreign)
      await assert.rejects(f.site.lifecycle.resumeWorker(f.context, f.identity), /UNPROVEN/);
    else await f.site.lifecycle.resumeWorker(f.context, f.identity);
    assert.equal(f.events.includes('worker-started'), !foreign);
    await f.site.lifecycle.detach(f.context);
  }
});

test('site defaults failure recording to the held journal even after the window or detach', async (t) => {
  const f = await fixture(t);
  f.io.facts.holdMaintenance = undefined;
  let calls = 0;
  f.io.recordFailure = async (ctx, result) => {
    assert.equal(ctx.journal, f.journal);
    assert.equal(result.closeAcknowledged, true);
    calls++;
    return { closeAcknowledged: false };
  };
  const site = f.make();
  await site.lifecycle.attach(f.context);
  await site.lifecycle.detach(f.context);
  f.state.now = 20000;
  assert.deepEqual(
    await site.lifecycle.holdMaintenance(f.context, {
      closeAcknowledged: true,
    }),
    {
      closeAcknowledged: false,
    },
  );
  assert.equal(calls, 1);
});

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
    await f.journal.persist('migration_started', {
      candidate: f.binding.candidate,
    });
    await f.journal.bindBootstrapSeed('8'.repeat(32));
    if (fault !== 'phase')
      await f.journal.persist('candidate_started', {
        candidate: f.binding.candidate,
      });
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
test('interruption cannot accept a zero work observation without actual persisted replay proof', async (t) => {
  for (const fault of ['missing', 'malformed', 'pending', 'late-pending', 'stale', 'read-failed']) {
    const f = await fixture(t, {}, true);
    let reads = 0;
    f.io.readPersistedWork = async () => {
      reads++;
      if (fault === 'read-failed') throw Error('synthetic database unavailable');
      return {
        observedAtMs: fault === 'stale' ? -1 : f.state.now,
        unsettled: [],
        ...(fault === 'missing'
          ? {}
          : {
              pendingReplay:
                fault === 'pending' || (fault === 'late-pending' && reads === 2) ? 1 : 0,
              replaySourcesDigest: fault === 'malformed' ? '' : '9'.repeat(64),
            }),
      };
    };
    const site = f.make();
    await site.lifecycle.attach(f.context);
    await f.journal.persist('prepared', { candidate: f.binding.candidate });
    await f.journal.persist('orders_fenced', {
      candidate: f.binding.candidate,
    });
    await site.lifecycle.fenceOrders(f.context);
    await f.journal.persist('legacy_interruption_accepted', {
      candidate: f.binding.candidate,
    });
    await assert.rejects(site.lifecycle.acceptLegacyInterruption(f.context), /UNPROVEN/);
    assert.equal((await f.journal.readFirstCutoverEffects()).interruptionObservation, undefined);
    assert(!f.events.includes('stop-producers'));
    await site.lifecycle.detach(f.context);
  }
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
    await f.journal.persist('orders_fenced', {
      candidate: f.binding.candidate,
    });
    await site.lifecycle.fenceOrders(f.context);
    await f.journal.persist('legacy_settled', {
      candidate: f.binding.candidate,
    });
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
  await f.journal.persist('migration_started', {
    candidate: f.binding.candidate,
  });
  await f.journal.bindBootstrapSeed('8'.repeat(32));
  await f.journal.persist('candidate_started', {
    candidate: f.binding.candidate,
  });
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
    window: {
      maintenanceEndsAtMs: 9000,
      reconcileByMs: 12000,
      operatorRef: 'synthetic-qa',
    },
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
  const facility = { encryptionProfileDigest: '4'.repeat(64) };
  f.io.inspectSourceFacility = async () => facility;
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
    binding: f.binding,
    facility,
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
  for (const fault of ['source', 'binding', 'facility', 'returned-profile', 'none']) {
    const plan = {
      sourceIdentity: { database: 'source_qa' },
      isolatedTarget: { database: 'restore_qa' },
    };
    const f = await fixture(t, { backupPlan: plan });
    const facility = { encryptionProfileDigest: '4'.repeat(64) };
    f.io.inspectSourceFacility = async () => facility;
    let exports = 0;
    f.io.exportSourceBackup = async (_context, _inventory, deps) => {
      await deps.assertWritersStopped();
      exports++;
      return {
        reference: 'encrypted-only',
        encryptionProfileDigest: (fault === 'returned-profile' ? '5' : '4').repeat(64),
      };
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
      binding: { ...f.binding },
      facility: fault === 'facility' ? { encryptionProfileDigest: '5'.repeat(64) } : facility,
    };
    if (fault === 'binding') scope.binding.attempt = 'foreign';
    const action = site.backup.exportDatabase(
      fault === 'source' ? { database: 'wrong' } : plan.sourceIdentity,
      scope,
    );
    if (fault === 'none')
      assert.deepEqual(await action, {
        reference: 'encrypted-only',
        ...facility,
      });
    else await assert.rejects(action, /UNPROVEN/);
    assert.equal(exports, ['none', 'returned-profile'].includes(fault) ? 1 : 0);
    await site.lifecycle.detach(f.context);
  }
});

test('original backup coordinator can consume site source export without reshaping its contract', async (t) => {
  const plan = {
    sourceIdentity: {
      serverUuid: '11111111-1111-4111-8111-111111111111',
      database: 'source_qa',
    },
    isolatedTarget: {
      serverUuid: '22222222-2222-4222-8222-222222222222',
      database: 'restore_qa',
    },
  };
  const facility = { encryptionProfileDigest: '4'.repeat(64) };
  const profile = { synthetic: 'approved-source-profile' };
  const f = await fixture(t, {
    backupPlan: plan,
    backupSource: { facility: profile },
  });
  f.io.inspectSourceFacility = async (input) => {
    assert.deepEqual(input, profile);
    return facility;
  };
  f.io.exportSourceBackup = async (_context, _inventory, deps) => {
    await deps.assertWritersStopped();
    f.events.push('source-export');
    return { reference: '/synthetic/encrypted.sql.age', ...facility };
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
  f.state.producers = f.state.gateways = 0;
  const receipt = await backupAndRestoreCheck(
    { ...plan, binding: f.binding, maintenanceEndsAtMs: 9000 },
    {
      now: () => f.state.now,
      assertOwnership: () => f.journal.assertOwnership(),
      assertWritersStopped: () => site.lifecycle.assertStopped(f.context),
      readDatabaseIdentity: async (value) => value,
      inspectBackupFacility: async () => facility,
      exportDatabase: site.backup.exportDatabase,
      hashArtifact: async () => '1'.repeat(64),
      restoreIsolated: async () => {
        f.events.push('restore-synthetic');
      },
      compareInventoryAndData: async () => ({
        comparisonDigest: '2'.repeat(64),
        sourceDigest: '3'.repeat(64),
        businessDigest: '5'.repeat(64),
      }),
      runApprovedMigrations: async () => {
        f.events.push('migrate-synthetic');
      },
      verifySchema: async () => ({
        schemaDigest: '6'.repeat(64),
        businessDigest: '5'.repeat(64),
      }),
      readSourceDigest: async () => '3'.repeat(64),
      sealReceipt: (value) => f.journal.bindBackupReceipt(value),
    },
  );
  assert.deepEqual(JSON.parse(await fs.readFile(f.journal.path, 'utf8')).backupReceipt, receipt);
  assert.deepEqual(
    f.events.filter((e) => ['source-export', 'restore-synthetic', 'migrate-synthetic'].includes(e)),
    ['source-export', 'restore-synthetic', 'migrate-synthetic'],
  );
  await site.lifecycle.detach(f.context);
});

test('original backup coordinator consumes the full site adapter and closes recovery after sealing the real journal', async (t) => {
  for (const fault of [
    'none',
    'target-identity',
    'artifact-drift',
    'target-data',
    'failure-owner-drift',
    'failure-deadline-drift',
    'migration-ack',
    'business-drift',
    'source-drift',
    'close-unknown',
  ]) {
    const plan = {
      sourceIdentity: {
        serverUuid: '11111111-1111-4111-8111-111111111111',
        database: 'source_qa',
      },
      isolatedTarget: {
        serverUuid: '22222222-2222-4222-8222-222222222222',
        database: 'restore_qa',
      },
    };
    const facility = { encryptionProfileDigest: '4'.repeat(64) };
    const source = {
      facility: { synthetic: true },
      directory: '/private/approved-source',
      executable: '/usr/bin/mysqldump',
      executableDigest: '6'.repeat(64),
    };
    const f = await fixture(t, { backupPlan: plan, backupSource: source });
    f.scope.backupRecoveryDigest = '8'.repeat(64);
    const artifact = {
      reference: `${source.directory}/${f.binding.attempt}.sql.age`,
      ...facility,
    };
    const sourceSnapshot = {
      identity: plan.sourceIdentity,
      objects: [
        {
          name: 'sample',
          kind: 'BASE TABLE',
          engine: 'InnoDB',
          rowCount: 1,
          definitionDigest: 'a'.repeat(64),
          columnsDigest: 'b'.repeat(64),
          dataDigest: 'c'.repeat(64),
        },
      ],
      projection: [{ table: 'sample', columns: ['id'] }],
      schemaDigest: '1'.repeat(64),
      sourceDigest: '2'.repeat(64),
      businessDigest: '3'.repeat(64),
    };
    f.io.inspectSourceFacility = async (input) => {
      assert.deepEqual(input, source.facility);
      return facility;
    };
    f.io.readBackupPlan = async () => plan;
    let artifactReads = 0;
    f.io.inspectSourceArtifact = async (input, options) => {
      assert.deepEqual(input, artifact);
      assert.deepEqual(options, {
        facility: source.facility,
        directory: source.directory,
        attempt: f.binding.attempt,
      });
      artifactReads++;
      return {
        backupDigest: '5'.repeat(64),
        bytes: fault === 'artifact-drift' && artifactReads > 1 ? 124 : 123,
      };
    };
    f.io.exportSourceBackup = async (_context, _inventory, deps) => {
      await deps.assertWritersStopped();
      return artifact;
    };
    let sourceReads = 0;
    f.io.readSourceSnapshot = async (_context, inventory, deps) => {
      assert.deepEqual(inventory.backupPlan, plan);
      await deps.assertWritersStopped();
      sourceReads++;
      return {
        ...structuredClone(sourceSnapshot),
        sourceDigest:
          fault === 'source-drift' && sourceReads > 1
            ? '9'.repeat(64)
            : sourceSnapshot.sourceDigest,
      };
    };
    let recoveryClosed = false;
    const operations = [];
    f.io.connectRecovery = async (scope, deps) => {
      assert.deepEqual(scope, {
        ...plan,
        binding: f.binding,
        maintenanceEndsAtMs: 9000,
        scopeDigest: f.scope.backupRecoveryDigest,
      });
      await deps.assertScope();
      return Object.fromEntries(
        ['inspect', 'restore', 'snapshot', 'migrate', 'verify', 'close'].map((name) => [
          name,
          async (value) => {
            assert.equal(recoveryClosed, false);
            await deps.assertScope();
            operations.push(name);
            if (name === 'restore') {
              assert.deepEqual(value, {
                artifact,
                expectedBackupDigest: '5'.repeat(64),
                expectedBytes: 123,
              });
              return plan.isolatedTarget;
            }
            if (name === 'inspect')
              return fault === 'target-identity' ? plan.sourceIdentity : plan.isolatedTarget;
            if (name === 'snapshot')
              return {
                ...structuredClone(sourceSnapshot),
                identity: plan.isolatedTarget,
                sourceDigest:
                  fault === 'target-data' || fault.startsWith('failure-')
                    ? '9'.repeat(64)
                    : sourceSnapshot.sourceDigest,
              };
            if (name === 'migrate')
              return {
                migrationDigest:
                  fault === 'migration-ack' ? '9'.repeat(64) : f.binding.migrationDigest,
              };
            if (name === 'verify')
              return {
                schemaDigest: '7'.repeat(64),
                businessDigest:
                  fault === 'business-drift' ? '9'.repeat(64) : sourceSnapshot.businessDigest,
              };
            if (fault === 'close-unknown') throw new Error('SYNTHETIC_ACK_LOST');
            recoveryClosed = true;
          },
        ]),
      );
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
    f.state.producers = f.state.gateways = 0;
    const pending = backupAndRestoreCheck(
      { ...plan, binding: f.binding, maintenanceEndsAtMs: 9000 },
      {
        ...site.backup,
        now: () => f.state.now,
        assertOwnership: () => f.journal.assertOwnership(),
        assertWritersStopped: () => site.lifecycle.assertStopped(f.context),
        sealReceipt: (value) => f.journal.bindBackupReceipt(value),
      },
    );
    if (!['none', 'close-unknown'].includes(fault)) {
      await assert.rejects(pending, /UNPROVEN/, fault);
      assert.equal(
        JSON.parse(await fs.readFile(f.journal.path, 'utf8')).backupReceipt,
        undefined,
        fault,
      );
      assert(operations.filter((name) => name === 'migrate').length <= 1, fault);
      if (['target-identity', 'artifact-drift', 'target-data'].includes(fault))
        assert(!operations.includes('migrate'), fault);
      await f.journal.recordFirstCutoverFailure({
        phase: 'backup_verified',
        observedAtMs: f.state.now,
        operatorRef: fault === 'failure-owner-drift' ? 'foreign-owner' : f.approval.operatorRef,
        reconcileByMs: f.approval.reconcileByMs + (fault === 'failure-deadline-drift' ? 1 : 0),
        errorCode: 'CUTOVER_BACKUP_UNPROVEN',
        status: { mode: 'not-started', closeAcknowledged: false },
      });
      // A channel can acknowledge its own detach while the backup remains
      // failed. No restore/migrate retry or release follows that acknowledgement.
      if (fault.startsWith('failure-')) {
        await assert.rejects(site.lifecycle.detach(f.context), /UNPROVEN/);
        await assert.rejects(site.lifecycle.detach(f.context), /UNPROVEN/);
        assert.equal(operations.filter((name) => name === 'close').length, 0, fault);
      } else {
        await site.lifecycle.detach(f.context);
        assert.equal(operations.filter((name) => name === 'close').length, 1, fault);
      }
      await assert.rejects(site.backup.restoreIsolated(artifact, plan.isolatedTarget), /UNPROVEN/);
      await assert.rejects(
        site.backup.runApprovedMigrations(plan.isolatedTarget, f.binding.migrationDigest),
        /UNPROVEN/,
      );
      await fs.stat(join(f.root, 'release.lock'));
      continue;
    }
    const receipt = await pending;
    assert.deepEqual(JSON.parse(await fs.readFile(f.journal.path, 'utf8')).backupReceipt, receipt);
    assert.equal(receipt.sourceDigest, undefined);
    assert.equal(receipt.businessDigest, sourceSnapshot.businessDigest);
    assert.equal(receipt.schemaDigest, '7'.repeat(64));
    assert.equal(recoveryClosed, false);
    if (fault === 'close-unknown') {
      await assert.rejects(site.backup.finishRecovery(f.context), /UNPROVEN/);
      await assert.rejects(site.backup.finishRecovery(f.context), /UNPROVEN/);
      assert.equal(operations.filter((name) => name === 'migrate').length, 1);
      assert.equal(operations.filter((name) => name === 'close').length, 1);
      await assert.rejects(site.lifecycle.detach(f.context), /UNPROVEN/);
      assert.equal(operations.filter((name) => name === 'close').length, 1);
      continue;
    }
    await site.backup.finishRecovery(f.context);
    assert.equal(recoveryClosed, true);
    assert.deepEqual(
      operations.filter((name) => name !== 'inspect'),
      ['restore', 'snapshot', 'migrate', 'verify', 'close'],
    );
    await site.lifecycle.detach(f.context);
  }
});

test('recovery callback uses the original held site journal, approved target and physical stopped facts', async (t) => {
  for (const fault of ['none', 'digest', 'target', 'busy', 'deadline']) {
    const plan = {
      sourceIdentity: {
        serverUuid: '11111111-1111-4111-8111-111111111111',
        database: 'source_qa',
      },
      isolatedTarget: {
        serverUuid: '22222222-2222-4222-8222-222222222222',
        database: 'restore_qa',
      },
    };
    const f = await fixture(t, { backupPlan: plan });
    f.scope.backupRecoveryDigest = '8'.repeat(64);
    const site = f.make();
    assert.equal(typeof site.recovery?.assertScope, 'function');
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
    const request = {
      ...plan,
      binding: f.binding,
      scopeDigest: '8'.repeat(64),
      maintenanceEndsAtMs: 9000,
    };
    await site.recovery.assertScope(request);
    if (fault === 'digest') request.scopeDigest = '9'.repeat(64);
    if (fault === 'target') request.isolatedTarget = plan.sourceIdentity;
    if (fault === 'busy') f.state.busy = 1;
    if (fault === 'deadline') f.state.now = 9000;
    if (fault === 'none') await site.recovery.assertScope(request);
    else await assert.rejects(site.recovery.assertScope(request), /UNPROVEN/);
    assert(!f.events.includes('restore'));
    assert.equal(JSON.parse(await fs.readFile(f.journal.path, 'utf8')).backupReceipt, undefined);
    await site.lifecycle.detach(f.context);
  }
});

test('site refuses missing independent business facts before opening either session', async (t) => {
  const f = await fixture(t);
  f.io.facts.observeWork = undefined;
  assert.throws(() => f.make(), /UNPROVEN/);
  assert.deepEqual(f.events, []);
});

for (const afterDeadline of [false, true])
  test(`default site facts reconcile real SQL with resumed candidate (${afterDeadline})`, async (t) => {
    const merchant = {
      provider: 'wechat',
      environment: 'production',
      merchantDigest: 'e'.repeat(64),
      codeDigest: 'f'.repeat(64),
    };
    const { readCutoverDatabaseScope } = await import('./browser-cutover-evidence.mjs');
    const f = await candidateFixture(
      t,
      async (f) => {
        delete f.io.facts;
        f.io.readPaymentScope = async () =>
          readCutoverDatabaseScope(
            {
              query: async (sql) => {
                if (sql.includes('FROM payments '))
                  return [
                    sql.includes('COUNT')
                      ? [{ total: 1 }]
                      : [
                          {
                            id: 1,
                            external_id: 'QA',
                            provider: 'wechat',
                            provider_order_id: 'QA_ORDER',
                            provider_capture_id: null,
                            amount_cents: 100,
                            currency: 'CNY',
                            status: 'pending',
                            metadata: null,
                          },
                        ],
                    [],
                  ];
                if (sql.includes('FROM partner_recharge_orders '))
                  return [sql.includes('COUNT') ? [{ total: 0 }] : [], []];
                if (sql.includes('FROM tasks ')) return [[{ id: 99, status: 'running' }], []];
                return [[], []];
              },
            },
            {
              windowStartMs: 0,
              windowEndMs: Math.min(9000, f.state.now),
              now: () => f.state.now,
              resolveMerchant: () => merchant,
            },
          );
        f.io.readRehearsal = async () => ({
          ...f.binding,
          observedAtMs: 0,
          recoveryUntilMs: 12000,
          recovery: 'retry-proven',
          artifacts: [
            {
              ...merchant,
              transcriptDigest: '1'.repeat(64),
              retryDigest: '2'.repeat(64),
            },
          ],
        });
        const connect = f.io.connectGateway;
        f.io.connectGateway = async (...args) => ({
          ...(await connect(...args)),
          queryOrders: async (request) => {
            f.events.push('postopen-query');
            assert.equal(request.stage, 'postopen');
            assert.equal(request.orders.length, 1);
            return request.orders.map((o) => ({
              provider: o.provider,
              environment: o.environment,
              merchantDigest: o.merchantDigest,
              orderRef: o.orderRef,
              observedAtMs: f.state.now,
              rawDigest: '3'.repeat(64),
              state: 'unpaid-valid',
            }));
          },
        });
      },
      { merchants: [merchant] },
    );
    await f.advance();
    await f.journal.persist('migration_started', {
      candidate: f.binding.candidate,
    });
    await f.journal.bindBootstrapSeed('8'.repeat(32));
    for (const phase of ['candidate_started', 'verified', 'opened', 'reconciled'])
      await f.journal.persist(phase, {
        candidate: f.binding.candidate,
        identity: f.identity,
      });
    f.setMode('serving');
    f.state.now = afterDeadline ? 9500 : 4000;
    f.observer().probeBrowser = async () => ({
      kind: 'browser-minimum-execution-result',
      targetDigest: '4'.repeat(64),
      resultDigest: '5'.repeat(64),
      observedAtMs: f.state.now,
    });
    assert.deepEqual(
      (await f.site.lifecycle.reconcile(f.context, f.identity)).identity,
      f.identity,
    );
    assert(!f.events.includes('close-gateway'));
    assert(f.events.includes('postopen-query'));
    await f.site.lifecycle.detach(f.context);
    assert.equal(f.events.filter((e) => e === 'close-gateway').length, 1);
  });

test('source diagnostics separate validated scope drift from scope shape and reader failures', async (t) => {
  const { ingressDiagnosticStage, ingressDiagnosticError } = await import(
    './browser-first-cutover-ingress-diagnostics.mjs'
  );
  for (const mode of ['drift', 'shape', 'reader']) {
    const f = await fixture(t);
    const original = f.io.readSite;
    let failReader = false;
    f.io.readSite = async (...args) => {
      if (failReader)
        throw ingressDiagnosticError(
          'CUTOVER_INGRESS_SESSION_UNPROVEN',
          'SITE_CONTENT',
          Error('PRIVATE_PAYLOAD'),
        );
      return original(...args);
    };
    const site = f.make();
    await site.lifecycle.attach(f.context);
    if (mode === 'drift') f.scope.reviews.extra = 'safe QA drift';
    if (mode === 'shape') f.scope.legacyDigest = 'bad';
    if (mode === 'reader') failReader = true;
    await assert.rejects(site.lifecycle.verifyFence(f.context), (error) => {
      assert.equal(error.message, 'CUTOVER_SITE_UNPROVEN');
      assert.equal(
        ingressDiagnosticStage(error),
        {
          drift: 'RECOVERY_SITE_SOURCE_DRIFT',
          shape: 'RECOVERY_SITE_SOURCE_SHAPE',
          reader: 'SITE_CONTENT',
        }[mode],
      );
      return true;
    });
  }
});

test('real site reconciliation normalizes inner known external work refusal and latches failure', async (t) => {
  let refusals = 0;
  const f = await candidateFixture(t, async (f) => {
    f.io.facts.reconcile = async () => {
      refusals++;
      throw new Error('CUTOVER_KNOWN_EXTERNAL_WORK_UNPROVEN');
    };
  });
  await f.advance();
  await f.journal.persist('migration_started', { candidate: f.binding.candidate });
  await f.journal.bindBootstrapSeed('8'.repeat(32));
  for (const phase of ['candidate_started', 'verified', 'opened', 'reconciled'])
    await f.journal.persist(phase, { candidate: f.binding.candidate, identity: f.identity });
  f.setMode('serving');
  await assert.rejects(f.site.lifecycle.reconcile(f.context, f.identity), {
    message: 'CUTOVER_SITE_UNPROVEN',
  });
  assert.equal(refusals, 1);
  await assert.rejects(f.site.lifecycle.reconcile(f.context, f.identity), {
    message: 'CUTOVER_SITE_UNPROVEN',
  });
  assert.equal(refusals, 1, 'no replay after refusal');
  await f.site.lifecycle.detach(f.context);
});

test('site carries exact deferred unknown navigation and keeps pendingReplay required', async (t) => {
  const policy = {
    approvalRef: 'exact-legacy-navigation-deferral-20261002',
    sourceResultSha256: '653d441102e3ef314816d94165dea9daf633d01d0923c36e7d31bc7d589ed727',
    setFingerprint: '192900b8bbd82d0456952f07f66cffe145f7131e738ab1c74f97ee327205f446',
    noAutomaticReplay: true,
  };
  const f = await fixture(t, {}, true, policy);
  const { cutoverLegacyInterruptionRisk } = await import('./browser-cutover-evidence.mjs');
  const hashes = [
    '029963afa7b27f4fc0ec9e7289aebc636c8b890c7672c733931d6cddd19dae18',
    '13df21db0a1a7fb34d60940fdca443533798a782331109f6e92524f183d06779',
    '16a0d3cd0c433214a3b768a4ffc562571681322fe1e6fafa44d6ab6088097a15',
    '3b82a649a25a426a20bcd94834b12de2803a556b4c39e662e0eaedb7e4e8747e',
    '43dfb2616214e972bd20abdd6567e05771addc8e6bf1a1d83d94544a0f4ce6ea',
    '93f0b00043eec228c8c066d7c86a4d4f623caf874b6109be24b409fa899c6e04',
    'abb03cb495fbe99ff332a2efdc0b5fd6fa75ee2d4c767dae4d7c0cc9e4a3792c',
    'c14af57146be89e84c250d9e250f9ff9d50fe5b9cdf57f05ba18ac074bc8d8bf',
    'd00f2b41837dced30a1d45ae9c8c43743521ec61e7a23b898ecab9ee78067ca7',
    'e5d3f7f2bc421528e90d34b1d4d823cd8e2895c105c5498f372c89a0e3051fd7',
  ];
  const retained = hashes.map((recordFingerprint) => ({
    table: 'task_steps',
    status: 'executing',
    recordFingerprint,
    approvalRef: policy.approvalRef,
    outcome: 'unverified',
    automaticReplay: false,
  }));
  Object.assign(f.state.legacyWork, {
    knownExternalWork: retained,
    deferredUnverifiedWork: retained,
    unresolvedWorkCount: 10,
    eligibleReplay: 0,
    pendingReplay: 10,
  });
  let omit = false;
  f.io.readPersistedWork = async () => ({
    observedAtMs: f.state.now,
    unsettled: [],
    deferredUnverifiedWork: structuredClone(retained),
    unresolvedWorkCount: 10,
    eligibleReplay: 0,
    ...(omit ? {} : { pendingReplay: 10 }),
    replaySourcesDigest: '9'.repeat(64),
  });
  const site = f.make();
  await site.lifecycle.attach(f.context);
  const input = {
    binding: f.binding,
    stage: 'prepare',
    kind: 'first-cutover',
    riskDigest: cutoverLegacyInterruptionRisk(f.approval),
    window: {
      maintenanceEndsAtMs: f.approval.maintenanceEndsAtMs,
      reconcileByMs: f.approval.reconcileByMs,
      operatorRef: f.approval.operatorRef,
    },
  };
  const proof = await site.evidence.readHostInventory(input);
  assert.equal(proof.externalWork.length, 10);
  assert.equal(proof.legacyWork.before.pendingReplay, 10);
  assert.equal(proof.legacyWork.after.unresolvedWorkCount, 10);
  omit = true;
  await assert.rejects(() => site.evidence.readHostInventory(input), /UNPROVEN/);
  await site.lifecycle.detach(f.context);
});

test('attach preserves fixed consumer failure stages and discards private errors', async (t) => {
  for (const [consumer, stage] of [
    ['createIngress', 'ATTACH_INGRESS'],
    ['connectGateway', 'ATTACH_GATEWAY'],
    ['createObserver', 'ATTACH_OBSERVER'],
  ]) {
    const f = await fixture(t);
    f.io[consumer] = async () => {
      throw Error('PRIVATE_AUTHENTICATION_TEXT');
    };
    await assert.rejects(f.make().lifecycle.attach(f.context), (error) => {
      assert.equal(error.message, 'CUTOVER_SITE_UNPROVEN');
      assert.equal(ingressDiagnosticStage(error), stage);
      assert.equal(JSON.stringify(error.cause).includes('PRIVATE_'), false);
      return true;
    });
    assert.equal(f.events.includes('orders'), false);
  }
});

// Synthetic adjacent site/real journal fixture; never a production lease.
const diagnosticDatabase = () => ({
  schemaVersion: 1,
  scope: 'mysql-server-observation-only',
  startedAtMs: 1000,
  observedAtMs: 1000,
  counts: {
    sessions: 1,
    transactions: 0,
    enabledEvents: 0,
    replicationReceivers: 0,
    replicationAppliers: 0,
  },
  sourceDigest: '3'.repeat(64),
  sessionAttribution: {
    scope: 'current-session-attribution-only',
    observedAtMs: 1000,
    sessions: 1,
    unattributed: 0,
    eventSchedulers: 1,
    processes: [],
    sourceDigest: '5'.repeat(64),
    unknownWritersZeroProven: false,
  },
});
const diagnosticInventory = {
  databaseObserver: {
    configDigest: 'd'.repeat(64),
    sourceIdentity: { database: 'qa', serverUuid: '11111111-1111-4111-8111-111111111111' },
  },
};
for (const [fault, expected, publicCode] of [
  ['facts-before', 'READINESS_HOST_WORK_BEFORE_FACTS', 'CUTOVER_WORK_OBSERVATION_UNPROVEN'],
  ['facts-after', 'READINESS_HOST_WORK_AFTER_FACTS', 'CUTOVER_WORK_OBSERVATION_UNPROVEN'],
  ['persisted-before', 'READINESS_HOST_WORK_BEFORE_PERSISTED', 'CUTOVER_WORK_OBSERVATION_UNPROVEN'],
  ['persisted-after', 'READINESS_HOST_WORK_AFTER_PERSISTED', 'CUTOVER_WORK_OBSERVATION_UNPROVEN'],
  ['db-before', 'READINESS_HOST_DB_WRITERS_BEFORE_DATABASE', 'CUTOVER_DATABASE_WRITERS_UNPROVEN'],
  ['db-after', 'READINESS_HOST_DB_WRITERS_AFTER_DATABASE', 'CUTOVER_DATABASE_WRITERS_UNPROVEN'],
  ['writers-before', 'READINESS_HOST_DB_WRITERS_BEFORE_FACTS', 'CUTOVER_DATABASE_WRITERS_UNPROVEN'],
  ['writers-after', 'READINESS_HOST_DB_WRITERS_AFTER_FACTS', 'CUTOVER_DATABASE_WRITERS_UNPROVEN'],
  ['observer', 'READINESS_HOST_OBSERVER', 'CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN'],
  ['legacy', 'READINESS_HOST_LEGACY_VALIDATION', 'UNCLASSIFIED'],
]) {
  test(`readiness diagnostic exact host boundary ${fault}`, async (t) => {
    const trace = [];
    const f = await candidateFixture(
      t,
      async (f) => {
        for (const [owner, key, label] of [
          [f.io.facts, 'observeWork', 'facts'],
          [f.io, 'readPersistedWork', 'persisted'],
          [f.io.facts, 'observeWriters', 'writers'],
        ]) {
          const original = owner[key];
          let count = 0;
          owner[key] = async (...args) => {
            count++;
            trace.push(`${label}${count}`);
            if (fault === `${label}-${count === 1 ? 'before' : 'after'}`) throw Error(publicCode);
            return original(...args);
          };
        }
        let count = 0;
        f.io.readAdministrativeWriters = async () => {
          count++;
          trace.push(`db${count}`);
          if (fault === `db-${count === 1 ? 'before' : 'after'}`) throw Error(publicCode);
          return diagnosticDatabase();
        };
      },
      diagnosticInventory,
    );
    const original = f.observer().read;
    f.observer().read = async () => {
      trace.push('observer');
      if (fault === 'observer') throw Error(publicCode);
      const value = await original();
      if (fault === 'legacy') value.observedAtMs = -1;
      return value;
    };
    let refusal;
    try {
      await f.site.evidence.readHostInventory(f.request('prepare'));
    } catch (error) {
      refusal = error;
    }
    assert(refusal);
    assert.equal(refusal.message, 'CUTOVER_SITE_UNPROVEN');
    assert.equal(refusal.cause.readinessStage, expected);
    assert.equal(refusal.cause.ingressCause, publicCode);
    const beforeRetry = trace.slice();
    await assert.rejects(
      f.site.evidence.readHostInventory(f.request('prepare')),
      /CUTOVER_SITE_UNPROVEN/,
    );
    assert.deepEqual(trace, beforeRetry, 'failed=true blocks all subsequent IO');
    const whole = [
      'facts1',
      'persisted1',
      'db1',
      'writers1',
      'observer',
      'db2',
      'writers2',
      'facts2',
      'persisted2',
    ];
    assert.deepEqual(trace, whole.slice(0, whole.indexOf(trace.at(-1)) + 1));
    const record = await f.journal.readFirstCutoverEffects();
    assert.equal(record.phase, 'preflight');
    assert.equal(record.identity, undefined);
    assert.equal(record.backupReceipt, undefined);
    assert.equal(f.events.includes('stop-producers'), false);
    await f.site.lifecycle.detach(f.context);
  });
}

test('readiness diagnostic actual outer pre/body/post guards remain distinguishable', async (t) => {
  const baseline = await candidateFixture(t);
  let calls = 0;
  const original = baseline.journal.assertOwnership;
  baseline.journal.assertOwnership = async (...args) => {
    calls++;
    return original(...args);
  };
  await baseline.site.evidence.readHostInventory(baseline.request('prepare'));
  const total = calls;
  assert(total > 2);
  await baseline.site.lifecycle.detach(baseline.context);
  for (const [index, expected] of [
    [1, 'READINESS_HOST_PRE_GUARD'],
    [total, 'READINESS_HOST_POST_GUARD'],
  ]) {
    const f = await candidateFixture(t);
    const original = f.journal.assertOwnership;
    let count = 0;
    f.journal.assertOwnership = async (...args) => {
      if (++count === index) throw Error('secret SQL must never be retained');
      return original(...args);
    };
    let error;
    try {
      await f.site.evidence.readHostInventory(f.request('prepare'));
    } catch (e) {
      error = e;
    }
    assert.equal(error?.cause?.readinessStage, expected);
    assert.equal(error?.cause?.ingressStage, 'RECOVERY_SITE_OWNER');
    assert.equal(error?.cause?.ingressCause, 'UNCLASSIFIED');
    assert.equal(count, index);
    await f.site.lifecycle.detach(f.context);
  }
  const f = await candidateFixture(t);
  let error;
  try {
    await f.site.evidence.readHostInventory({ ...f.request('prepare'), binding: {} });
  } catch (e) {
    error = e;
  }
  assert.equal(error?.cause?.readinessStage, 'READINESS_HOST_SCOPE');
  await f.site.lifecycle.detach(f.context);
});

for (const [method, label, code, key] of [
  ['readDatabaseScope', 'DATABASE', 'CUTOVER_PAYMENT_OBSERVATION_UNPROVEN', 'readPaymentScope'],
  ['readRehearsalArtifacts', 'REHEARSAL', 'MAINTENANCE_REHEARSAL_UNPROVEN', 'readRehearsal'],
  ['readFenceState', 'FENCE', 'CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN', 'observer'],
  ['queryOrders', 'ORDERS', 'CUTOVER_PAYMENT_OBSERVATION_UNPROVEN', 'gateway'],
]) {
  test(`readiness diagnostic actual ${label} body keeps original rejection`, async (t) => {
    let reads = 0;
    const reject = async () => {
      reads++;
      throw Error(code);
    };
    const f = await candidateFixture(t, async (f) => {
      if (!['observer', 'gateway'].includes(key)) f.io[key] = reject;
      if (key === 'gateway') {
        const connect = f.io.connectGateway;
        f.io.connectGateway = async (...args) => ({
          ...(await connect(...args)),
          queryOrders: reject,
        });
      }
    });
    if (key === 'observer') f.observer().read = reject;
    let refusal;
    try {
      await f.site.evidence[method](
        ...(method === 'queryOrders'
          ? [{ observedAtMs: 1000, orders: [], unsettled: [] }, f.request('prepare')]
          : [f.request('prepare')]),
      );
    } catch (error) {
      refusal = error;
    }
    assert.equal(refusal?.message, 'CUTOVER_SITE_UNPROVEN');
    assert.equal(refusal?.cause?.readinessStage, `READINESS_${label}_BODY`);
    assert.equal(refusal?.cause?.ingressCause, code);
    assert.equal(reads, 1);
    assert.equal((await f.journal.readFirstCutoverEffects()).phase, 'preflight');
    await f.site.lifecycle.detach(f.context);
  });
}

test('readiness diagnostic success trace records original IO and now calls', async (t) => {
  const trace = [];
  let clocks = 0;
  const f = await candidateFixture(
    t,
    async (f) => {
      const now = f.io.now;
      f.io.now = () => {
        clocks++;
        return now();
      };
      for (const [owner, key, label] of [
        [f.io.facts, 'observeWork', 'work'],
        [f.io, 'readPersistedWork', 'persisted'],
        [f.io.facts, 'observeWriters', 'writers'],
      ]) {
        const original = owner[key];
        owner[key] = async (...args) => {
          trace.push(label);
          return original(...args);
        };
      }
      f.io.readAdministrativeWriters = async () => {
        trace.push('database');
        return diagnosticDatabase();
      };
    },
    diagnosticInventory,
  );
  const read = f.observer().read;
  f.observer().read = async (...args) => {
    trace.push('observer');
    return read(...args);
  };
  clocks = 0;
  const result = await f.site.evidence.readHostInventory(f.request('prepare'));
  assert.deepEqual(trace, [
    'work',
    'persisted',
    'database',
    'writers',
    'observer',
    'database',
    'writers',
    'work',
    'persisted',
  ]);
  const record = await f.journal.readFirstCutoverEffects();
  console.log(
    JSON.stringify({
      kind: 'readiness-original-call-trace',
      trace,
      clocks,
      phase: record.phase,
      producers: result.producersRunning.length,
      observedAtMs: result.observedAtMs,
    }),
  );
  await f.site.lifecycle.detach(f.context);
});
