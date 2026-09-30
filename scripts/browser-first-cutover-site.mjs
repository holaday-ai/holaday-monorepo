import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual as equal } from 'node:util';
import {
  cutoverLegacyInterruptionRisk,
  readCutoverRehearsalArtifacts,
  validateCutoverLegacyCapability,
  validateFirstCutoverCloudSources,
} from './browser-cutover-evidence.mjs';
import {
  inspectAgeBackupArtifact,
  inspectAgeBackupFacility,
} from './browser-first-cutover-backup.mjs';
import { connectFirstCutoverGatewaySession } from './browser-first-cutover-gateway-session.mjs';
import {
  createFirstCutoverRetirementObserver,
  exportFirstCutoverSourceBackup,
  readFirstCutoverAttributedWriters,
  readFirstCutoverBackupPlan,
  readFirstCutoverCandidateRuntime,
  readFirstCutoverHostPair,
  readFirstCutoverPaymentScope,
  readFirstCutoverPersistedWork,
  readFirstCutoverSourceSnapshot,
  readReviewedFirstCutoverLegacySource,
  recordFirstCutoverFailure,
  resumeFirstCutoverCandidateWorker,
} from './browser-first-cutover-host.mjs';
import {
  createFirstCutoverIngressPair,
  readFirstCutoverExecutionSiteScope,
} from './browser-first-cutover-ingress-session.mjs';
import { compareCutoverMysqlSnapshots } from './browser-first-cutover-mysql.mjs';
import { connectFirstCutoverRecoverySession } from './browser-first-cutover-recovery-session.mjs';
import { retireLocalFirstCutoverProducers } from './browser-first-cutover-registrations.mjs';
import {
  firstCutoverCloudBrowserRecoveryLaunch,
  firstCutoverCloudVncRecoveryMaterial,
  validateLegacyWorkBoundary,
} from './browser-first-cutover-runtime.mjs';

const bindingKeys = ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'];
const fail = () => {
  throw new Error('CUTOVER_SITE_UNPROVEN');
};

/** Wire the existing physical operations into the original host's lifecycle.
 * Business/backup readers are mandatory trusted site code, NOT uploaded
 * booleans or zero-count defaults. They must not call this ingress session from
 * its own writer callback. Candidate control uses the existing actual socket
 * and runtime observer. This module does not install tools or enable the CLI.
 */
export function createFirstCutoverExecutionSite(options, overrides = {}) {
  const io = {
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    sleep,
    readPair: readFirstCutoverHostPair,
    readPersistedWork: readFirstCutoverPersistedWork,
    readAdministrativeWriters: readFirstCutoverAttributedWriters,
    readCandidateRuntime: readFirstCutoverCandidateRuntime,
    readRehearsal: readCutoverRehearsalArtifacts,
    readPaymentScope: readFirstCutoverPaymentScope,
    readBackupPlan: readFirstCutoverBackupPlan,
    exportSourceBackup: exportFirstCutoverSourceBackup,
    inspectSourceFacility: inspectAgeBackupFacility,
    inspectSourceArtifact: inspectAgeBackupArtifact,
    readSourceSnapshot: readFirstCutoverSourceSnapshot,
    connectRecovery: connectFirstCutoverRecoverySession,
    inspectSource: readReviewedFirstCutoverLegacySource,
    createIngress: createFirstCutoverIngressPair,
    connectGateway: connectFirstCutoverGatewaySession,
    createObserver: createFirstCutoverRetirementObserver,
    retireProducers: retireLocalFirstCutoverProducers,
    resumeWorker: resumeFirstCutoverCandidateWorker,
    recordFailure: recordFirstCutoverFailure,
    readSite: (approval) => readFirstCutoverExecutionSiteScope({ attempt: approval.attempt }),
    ...overrides,
  };
  if (
    io.platform !== 'linux' ||
    io.uid !== 0 ||
    !options ||
    Object.keys(options).length !== 1 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      options.attempt ?? '',
    ) ||
    ['readSite', 'readCoordinatorIdentity'].some((k) => typeof io[k] !== 'function') ||
    ['observeWriters', 'observeWork', 'settleLegacy', 'reconcile'].some(
      (k) => typeof io.facts?.[k] !== 'function',
    )
  )
    fail();
  const facts = { ...io.facts };
  const observeWork = async () => {
    const work = structuredClone(await facts.observeWork(context));
    const persisted = await io.readPersistedWork(context);
    if (context.approval.schemaVersion === 2) {
      // Validate the independent observation before combining digests: a missing
      // external proof must never become a valid hash of an undefined field.
      validateLegacyWorkBoundary({
        observation: work,
        approval: context.approval,
        phase: 'prepare',
        nowMs: io.now(),
      });
      if (
        !fresh(persisted?.observedAtMs) ||
        !Array.isArray(persisted.unsettled) ||
        persisted.unsettled.length ||
        persisted.pendingReplay !== 0 ||
        !/^[a-f0-9]{64}$/.test(persisted.replaySourcesDigest ?? '')
      )
        fail();
      work.replaySourcesDigest = createHash('sha256')
        .update(
          JSON.stringify({
            candidate: context.binding.candidate,
            independent: work.replaySourcesDigest,
            persisted: persisted.replaySourcesDigest,
          }),
        )
        .digest('hex');
      work.observedAtMs = Math.min(work.observedAtMs, persisted.observedAtMs);
    }
    return { work, persisted };
  };
  const attempt = options.attempt;
  let context;
  let scope;
  let ingress;
  let gateway;
  let observer;
  let attaching = false;
  let attached = false;
  let failed = false;
  let closed = false;
  let closeFailed = false;
  let last = -1;
  let recoveryRecord;
  let recovery;
  let recoveryStarted = false;
  let sourceArtifact;
  let sourceTransfer;
  let backupStage;
  let comparedSnapshot;
  let inspectedScope;
  let executionSiteDigest;
  const used = new Set();
  const readScope = async (approval) => {
    const value = structuredClone(await io.readSite(approval));
    const binding = Object.fromEntries(bindingKeys.map((k) => [k, approval[k]]));
    if (
      approval.attempt !== attempt ||
      !equal(value.binding, binding) ||
      value.legacyDigest !== approval.legacyDigest ||
      value.maintenanceEndsAtMs !== approval.maintenanceEndsAtMs ||
      !value.reviews ||
      !value.ingress ||
      !Array.isArray(value.producerStartupFiles) ||
      Object.hasOwn(value, 'cloudMaintenanceScope') !==
        Object.hasOwn(value, 'cloudRecoverySources') ||
      (Object.hasOwn(value, 'cloudBrowserRecoveryDigest') &&
        value.cloudBrowserRecoveryDigest !==
          createHash('sha256')
            .update(JSON.stringify(firstCutoverCloudBrowserRecoveryLaunch({ attempt })))
            .digest('hex')) ||
      (Object.hasOwn(value, 'cloudMaintenanceScope') &&
        (!Array.isArray(value.cloudMaintenanceScope) ||
          value.cloudMaintenanceScope.length !== 2 ||
          !value.cloudBrowserRecoveryDigest ||
          value.cloudMaintenanceScope[0]?.recoveryDigest !==
            createHash('sha256')
              .update(JSON.stringify(firstCutoverCloudVncRecoveryMaterial({ attempt })))
              .digest('hex') ||
          value.cloudMaintenanceScope[1]?.recoveryDigest !== value.cloudBrowserRecoveryDigest)) ||
      !/^[a-f0-9]{64}$/.test(value.gatewaySiteDigest ?? '')
    )
      fail();
    if (Object.hasOwn(value, 'cloudMaintenanceScope'))
      validateFirstCutoverCloudSources(value.cloudRecoverySources, {
        scope: value.cloudMaintenanceScope,
      });
    return value;
  };
  const guard = async (ctx, phases) => {
    if (
      !context ||
      ctx.journal !== context.journal ||
      !equal(ctx.binding, context.binding) ||
      !equal(ctx.approval, context.approval)
    )
      fail();
    const now = io.now();
    if (!Number.isSafeInteger(now) || now < 0 || now < last || now >= scope.maintenanceEndsAtMs)
      fail();
    last = now;
    if (
      !equal(await context.journal.assertOwnership(), context.binding) ||
      !equal(await readScope(context.approval), scope)
    )
      fail();
    const record = await context.journal.readFirstCutoverEffects();
    if (
      context.approval.schemaVersion === 2 &&
      (record.schemaVersion !== 2 ||
        record.riskDigest !== cutoverLegacyInterruptionRisk(context.approval))
    )
      fail();
    if (
      !bindingKeys.every((k) => record[k] === context.binding[k]) ||
      record.legacyDigest !== scope.legacyDigest ||
      record.executionSiteDigest !== executionSiteDigest ||
      (phases && !phases.includes(record.phase))
    )
      fail();
    return record;
  };
  const identities = async () => {
    const values = [await io.readCoordinatorIdentity()];
    if (ingress)
      values.push(...ingress.readExecutionIdentities(), await ingress.readTransportIdentity());
    if (gateway)
      values.push(gateway.readExecutionIdentity(), await gateway.readTransportIdentity());
    if (values.some((v) => !equal(v.binding, context.binding))) fail();
    return values;
  };
  const fresh = (value) =>
    Number.isSafeInteger(value) && value >= 0 && value <= io.now() && io.now() - value <= 60000;
  const checkIdentity = (identity, record) => {
    if (
      !identity ||
      !equal(Object.keys(identity).sort(), ['bootId', 'candidate']) ||
      identity.candidate !== context.binding.candidate ||
      !/^[a-f0-9]{32}$/.test(identity.bootId ?? '') ||
      !/^[a-f0-9]{32}$/.test(record.bootstrapSeed ?? '') ||
      identity.bootId === record.bootstrapSeed ||
      (record.identity !== undefined && !equal(record.identity, identity))
    )
      fail();
  };
  const legacy = (actual) =>
    actual.hosts.flatMap((host) =>
      [host.registered, host.unmanaged].flatMap((part) =>
        [...part.processes, ...part.managers, ...part.listeners].map((value) => ({
          host: host.host,
          ...value,
        })),
      ),
    );
  const readinessScope = (input) => {
    const request = structuredClone(input);
    if (
      !equal(request?.binding, context.binding) ||
      !equal(request.window, {
        maintenanceEndsAtMs: context.approval.maintenanceEndsAtMs,
        reconcileByMs: context.approval.reconcileByMs,
        operatorRef: context.approval.operatorRef,
      }) ||
      !['prepare', 'preopen'].includes(request.stage) ||
      !Array.isArray(scope.ingress.unknownIngress) ||
      scope.ingress.unknownIngress.length
    )
      fail();
    return request;
  };
  const closedCandidate = (actual, identity) => {
    const candidate = actual.candidate;
    if (
      !equal(candidate?.identity, identity) ||
      candidate.mode !== 'closed' ||
      candidate.idle !== true ||
      candidate.needsReconciliation !== false ||
      candidate.runtime?.worker !== null ||
      legacy(actual).length
    )
      fail();
  };
  const approvedInventory = () => {
    const inventory = scope.inventory;
    if (
      !inventory ||
      !Array.isArray(inventory.targets) ||
      !Array.isArray(inventory.merchants) ||
      !Array.isArray(inventory.configurationDigests) ||
      !inventory.configurationDigests.length ||
      !inventory.configurationDigests.every((value) => /^[a-f0-9]{64}$/.test(value)) ||
      createHash('sha256').update(JSON.stringify(inventory)).digest('hex') !==
        context.binding.inventoryDigest
    )
      fail();
    return structuredClone(inventory);
  };
  const observeWriters = async () => {
    const record = await guard(context);
    const inventory = approvedInventory();
    let database;
    // This is an explicit, separately approved source, never a privilege
    // fallback for the original application reader or independent classifier.
    if (Object.hasOwn(inventory, 'databaseObserver')) {
      database = structuredClone(await io.readAdministrativeWriters(context, inventory));
      const active = [
        'transactions',
        'enabledEvents',
        'replicationReceivers',
        'replicationAppliers',
      ];
      if (
        database?.schemaVersion !== 1 ||
        database.scope !== 'mysql-server-observation-only' ||
        !fresh(database.startedAtMs) ||
        !fresh(database.observedAtMs) ||
        database.startedAtMs > database.observedAtMs ||
        !/^[a-f0-9]{64}$/.test(database.sourceDigest ?? '') ||
        !database.counts ||
        !equal(Object.keys(database.counts).sort(), [...active, 'sessions'].sort()) ||
        !Number.isSafeInteger(database.counts.sessions) ||
        database.counts.sessions < 0 ||
        database.counts.sessions > 10000 ||
        active.some((key) => database.counts[key] !== 0)
      )
        fail();
      const attribution = database.sessionAttribution;
      if (
        attribution?.scope !== 'current-session-attribution-only' ||
        !fresh(attribution.observedAtMs) ||
        attribution.sessions !== database.counts.sessions ||
        attribution.unattributed !== 0 ||
        attribution.unknownWritersZeroProven !== false ||
        !/^[a-f0-9]{64}$/.test(attribution.sourceDigest ?? '') ||
        !Number.isSafeInteger(attribution.eventSchedulers) ||
        attribution.eventSchedulers < 0 ||
        attribution.eventSchedulers > 1 ||
        !Array.isArray(attribution.processes)
      )
        fail();
      // Sessions require separate attribution/exclusion; five idle sessions
      // neither mean five active writers nor prove zero unknown writers.
      if (!equal(record, await guard(context))) fail();
    }
    const result = structuredClone(
      await facts.observeWriters(context, {
        ...(database ? { database: structuredClone(database) } : {}),
      }),
    );
    if (!equal(record, await guard(context))) fail();
    if (database) {
      if (
        !fresh(database.observedAtMs) ||
        !fresh(database.sessionAttribution.observedAtMs) ||
        !fresh(result?.observedAtMs)
      )
        fail();
      result.observedAtMs = Math.min(
        result.observedAtMs,
        database.startedAtMs,
        database.sessionAttribution.observedAtMs,
      );
    }
    return result;
  };
  const checkLegacyCapability = (actual) => {
    if (context.approval.schemaVersion !== 2) return;
    if (
      validateCutoverLegacyCapability(actual.legacyCapability, io.now()) !==
      context.approval.legacyInterruption.capabilityDigest
    )
      fail();
  };
  const boundary = async (identity) => {
    const record = await guard(context);
    if (identity !== undefined) {
      if (!['candidate_started', 'verified'].includes(record.phase)) fail();
      checkIdentity(identity, record);
    }
    const orders = [
      'orders_fenced',
      'legacy_settled',
      'legacy_interruption_accepted',
      'producers_stopped',
    ].includes(record.phase);
    const { work, persisted } = await observeWork();
    const fence = await ingress[orders ? 'verifyOrders' : 'verifyFence']();
    let actual;
    if (identity !== undefined) {
      actual = await observer.readWithCandidate(identity);
      closedCandidate(actual, identity);
    } else {
      const progress = await observer.readFenceProgress();
      if (progress?.purpose !== 'fence-progress') fail();
      actual = progress.pair;
    }
    const { work: after, persisted: persistedAfter } = await observeWork();
    checkLegacyCapability(actual);
    const counts = ['unsettledWork', 'externalWork', 'activeRequests', 'unknownWriters'];
    const workPhase = identity ? 'preopen' : orders ? 'before-stop' : 'after-stop';
    const disposition = validateLegacyWorkBoundary({
      observation: work,
      approval: context.approval,
      phase: workPhase,
      nowMs: io.now(),
    });
    const afterDisposition = validateLegacyWorkBoundary({
      observation: after,
      approval: context.approval,
      phase: workPhase,
      nowMs: io.now(),
    });
    if (
      !fresh(work.observedAtMs) ||
      ![persisted, persistedAfter].every(
        (value) =>
          fresh(value?.observedAtMs) &&
          Array.isArray(value.unsettled) &&
          value.unsettled.length === 0,
      ) ||
      !fresh(after?.observedAtMs) ||
      !fresh(fence.observedAtMs) ||
      !fresh(actual.observedAtMs) ||
      work.inventoryDigest !== context.binding.inventoryDigest ||
      after.inventoryDigest !== context.binding.inventoryDigest ||
      actual.inventoryDigest !== context.binding.inventoryDigest ||
      actual.unknownLaunchers.length ||
      !equal(disposition, afterDisposition)
    )
      fail();
    const runningProducers = actual.hosts
      .flatMap((h) => [...h.registered.processes, ...h.unmanaged.processes])
      .filter((p) => ['main', 'worker'].includes(p.role));
    if (
      context.approval.schemaVersion === 2 &&
      (actual.hosts.length !== 2 ||
        !['aliyun', 'vultr'].every(
          (host) => actual.hosts.filter((h) => h.host === host).length === 1,
        ) ||
        actual.hosts.some(
          ({ tcpObservation: tcp }) =>
            !fresh(tcp?.observedAtMs) ||
            tcp.existingSockets !== 0 ||
            !/^[a-f0-9]{64}$/.test(tcp.sourceDigest ?? ''),
        ))
    )
      fail();
    if (fence.producersRunning !== runningProducers.length || (!orders && runningProducers.length))
      fail();
    if (!equal(record, await guard(context, [record.phase]))) fail();
    return {
      ...fence,
      ...Object.fromEntries(counts.map((k) => [k, work[k]])),
      ...(disposition.mode === 'controlled-interruption'
        ? {
            riskDigest: disposition.riskDigest,
            legacyWork: { before: work, after },
            legacyCapability: actual.legacyCapability,
            connectedTcp: actual.hosts.map(({ host, tcpObservation }) => ({
              host,
              ...tcpObservation,
            })),
          }
        : {}),
      runningProducers,
      liveLegacy: legacy(actual),
      regeneratedLegacy: actual.unknownLaunchers,
      observedAtMs: Math.min(
        work.observedAtMs,
        after.observedAtMs,
        fence.observedAtMs,
        actual.observedAtMs,
        persisted.observedAtMs,
        persistedAfter.observedAtMs,
        ...(context.approval.schemaVersion === 2 ? [actual.legacyCapability.observedAtMs] : []),
      ),
    };
  };
  const stopped = async () => {
    const actual = await observer.read();
    const fence = await boundary();
    const scopes = actual.hosts.flatMap((h) => [h.registered, h.unmanaged]);
    const proof = {
      inventoryDigest: actual.inventoryDigest,
      phase: 'stopped',
      observedAtMs: Math.min(actual.observedAtMs, fence.observedAtMs),
      survivors: scopes.flatMap((s) => [...s.processes, ...s.managers]),
      listeners: scopes.flatMap((s) => s.listeners),
      unknownLaunchers: actual.unknownLaunchers,
    };
    if (
      fence.stage !== 'all-writers' ||
      proof.survivors.length ||
      proof.listeners.length ||
      proof.unknownLaunchers.length
    )
      fail();
    return proof;
  };
  const detach = async (ctx) => {
    if (context && ctx.journal !== context.journal) fail();
    if (closed) {
      if (closeFailed) fail();
      return;
    }
    closed = true;
    for (const handle of [recovery, gateway, ingress]) {
      try {
        await handle?.close();
      } catch {
        closeFailed = true;
      }
    }
    if (closeFailed) fail();
  };
  const run = async (name, ctx, phases, operation, once = true) => {
    try {
      if (!attached || closed || failed || (once && used.has(name))) fail();
      if (once) used.add(name);
      await guard(ctx, phases);
      const result = await operation();
      await guard(ctx, phases);
      return result;
    } catch {
      failed = true;
      fail();
    }
  };
  const backupContext = () => ({
    ...approvedInventory().backupPlan,
    binding: context.binding,
    maintenanceEndsAtMs: context.approval.maintenanceEndsAtMs,
  });
  const recoveryScope = () => ({ ...backupContext(), scopeDigest: scope.backupRecoveryDigest });
  const assertRecoveryScope = (input) =>
    run(
      'recovery-scope',
      context,
      ['backup_verified'],
      async () => {
        if (
          !/^[a-f0-9]{64}$/.test(scope.backupRecoveryDigest ?? '') ||
          !equal(input, recoveryScope())
        )
          fail();
        await guard(context, ['backup_verified']);
        const record = await context.journal.readFirstCutoverEffects({ forBackupRecovery: true });
        if (recoveryRecord && !equal(recoveryRecord, record)) fail();
        await stopped();
        await guard(context, ['backup_verified']);
        if (
          !equal(record, await context.journal.readFirstCutoverEffects({ forBackupRecovery: true }))
        )
          fail();
        recoveryRecord = structuredClone(record);
      },
      false,
    );
  const recoveryConnection = async () => {
    if (recovery) return recovery;
    if (recoveryStarted) fail();
    recoveryStarted = true;
    const approved = recoveryScope();
    recovery = await io.connectRecovery(approved, {
      input: process.stdin,
      output: process.stdout,
      assertScope: () => assertRecoveryScope(approved),
    });
    return recovery;
  };
  const backupRead = (name, operation, once = false) =>
    run(
      name,
      context,
      ['backup_verified'],
      async () => {
        const record = await guard(context, ['backup_verified']);
        const verify = async () => {
          if (!equal(record, await guard(context, ['backup_verified']))) fail();
          await stopped();
          if (!equal(record, await guard(context, ['backup_verified']))) fail();
        };
        await verify();
        const result = await operation(approvedInventory(), verify);
        await verify();
        return result;
      },
      once,
    );
  const lifecycle = {
    attach: async (ctx) => {
      try {
        if (attaching || closed) fail();
        attaching = true;
        context = {
          ...ctx,
          binding: structuredClone(ctx.binding),
          approval: structuredClone(ctx.approval),
        };
        scope = await readScope(context.approval);
        if (inspectedScope && !equal(inspectedScope, scope)) fail();
        await guard(ctx, ['preflight']);
        const digest = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
        await context.journal.bindExecutionSite(digest, scope.cloudMaintenanceScope);
        executionSiteDigest = digest;
        await guard(ctx, ['preflight']);
        const args = { binding: context.binding, maintenanceEndsAtMs: scope.maintenanceEndsAtMs };
        ingress = await io.createIngress(args, {
          ...io.ingress,
          platform: io.platform,
          uid: io.uid,
          now: io.now,
          journal: context.journal,
          readApprovedPair: async () => {
            await guard(context);
            return structuredClone(scope.ingress);
          },
          observeWriters,
          verifyOpenedIdentity: async (id) => {
            const record = await guard(context, ['verified']);
            checkIdentity(id, record);
            if (!equal(record.identity, id)) fail();
            const candidate = await io.readCandidateRuntime(id);
            const actual = await observer.readWithCandidate(id);
            if (
              !equal(candidate.identity, id) ||
              candidate.mode !== 'serving' ||
              candidate.idle !== false ||
              candidate.needsReconciliation !== true ||
              !equal(actual.candidate, candidate) ||
              !fresh(actual.observedAtMs) ||
              actual.inventoryDigest !== context.binding.inventoryDigest ||
              actual.unknownLaunchers.length ||
              legacy(actual).length ||
              !equal(record, await guard(context, ['verified']))
            )
              fail();
            return candidate;
          },
        });
        const proxy = Object.fromEntries(
          ['read', 'readRegistrationProgress', 'readUnmanagedProgress', 'retireUnmanaged'].map(
            (name) => [
              name,
              (...args) => {
                if (!observer) fail();
                return observer[name](...args);
              },
            ],
          ),
        );
        gateway = await io.connectGateway(
          { ...args, siteDigest: scope.gatewaySiteDigest },
          {
            ...io.gateway,
            platform: io.platform,
            uid: io.uid,
            now: io.now,
            sleep: io.sleep,
            journal: context.journal,
            observer: proxy,
            verifyFence: boundary,
          },
        );
        observer = await io.createObserver(
          {
            reviews: scope.reviews,
            binding: context.binding,
            legacyDigest: scope.legacyDigest,
            executionSite: structuredClone(scope),
          },
          {
            now: io.now,
            journal: context.journal,
            readPair: io.readPair,
            readFenceReceipts: () => ingress.readFenceReceipts(),
            readExecutionIdentities: identities,
            ...(io.readCandidateRuntime ? { readCandidateRuntime: io.readCandidateRuntime } : {}),
          },
        );
        await guard(ctx, ['preflight', 'prepared']);
        attached = true;
      } catch {
        failed = true;
        try {
          await detach(ctx);
        } catch {
          /* Both handles were attempted once; preserve failure. */
        }
        fail();
      }
    },
    detach,
    fenceOrders: (ctx) => run('orders', ctx, ['orders_fenced'], () => ingress.fenceOrders()),
    readLegacyDisposition: (ctx) =>
      run(
        'legacy-disposition',
        ctx,
        ['orders_fenced'],
        async () => {
          return context.approval.schemaVersion === 2
            ? {
                mode: 'controlled-interruption',
                riskDigest: cutoverLegacyInterruptionRisk(context.approval),
              }
            : { mode: 'drained' };
        },
        false,
      ),
    acceptLegacyInterruption: (ctx) =>
      run('legacy-interruption', ctx, ['legacy_interruption_accepted'], async () => {
        if (context.approval.schemaVersion !== 2) fail();
        const proof = await boundary();
        const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
        await context.journal.bindLegacyInterruption({
          riskDigest: proof.riskDigest,
          sourceDigest: digest(proof.legacyWork),
          fenceDigest: digest(proof),
          observedAtMs: proof.observedAtMs,
        });
      }),
    settleLegacy: (ctx) =>
      run('settle', ctx, ['legacy_settled'], async () => {
        await facts.settleLegacy(context);
        await boundary();
      }),
    stopProducers: (ctx) =>
      run('producers', ctx, ['producers_stopped'], async () => {
        await boundary();
        await io.retireProducers(
          {
            binding: { attempt, inventoryDigest: context.binding.inventoryDigest },
            files: scope.producerStartupFiles,
            maintenanceEndsAtMs: scope.maintenanceEndsAtMs,
          },
          {
            now: io.now,
            sleep: io.sleep,
            journal: context.journal,
            observer,
            verifyFence: boundary,
          },
          io.producerSystem,
        );
        await gateway.prepare();
        if (scope.cloudMaintenanceScope) {
          await observer.stopCloudServices(
            { maintenanceEndsAtMs: scope.maintenanceEndsAtMs },
            { ...io.cloudSystem, verifyFence: boundary },
          );
        }
      }),
    fenceAll: (ctx) => run('all', ctx, ['all_fenced'], () => ingress.fenceAll()),
    stopLegacy: (ctx) =>
      run('legacy', ctx, ['stopped'], async () => {
        await gateway.retire();
        return stopped();
      }),
    assertStopped: (ctx) =>
      run(
        'stopped',
        ctx,
        ['stopped', 'backup_verified', 'migration_started', 'candidate_started'],
        stopped,
        false,
      ),
    verifyFence: (ctx) => run('fence', ctx, undefined, boundary, false),
    restoreCloudServices: (ctx, identity) =>
      run('cloud-recovery', ctx, ['verified'], async () => {
        const record = await guard(ctx, ['verified']);
        checkIdentity(identity, record);
        if (!record.cloudMaintenanceScope || typeof observer.restoreCloudServices !== 'function')
          fail();
        // Recovery observes intent 5/7 itself. Ordinary boundary/readiness calls
        // reject those prefixes and must never recurse into this callback.
        const readRecoveryFacts = async () => {
          const before = await guard(ctx, ['verified']);
          checkIdentity(identity, before);
          const { work, persisted } = await observeWork();
          validateLegacyWorkBoundary({
            observation: work,
            approval: context.approval,
            phase: 'preopen',
            nowMs: io.now(),
          });
          const fence = await ingress.verifyFence();
          if (
            !fresh(work.observedAtMs) ||
            work.inventoryDigest !== context.binding.inventoryDigest ||
            !fresh(persisted?.observedAtMs) ||
            !Array.isArray(persisted.unsettled) ||
            persisted.unsettled.length ||
            !fresh(fence?.observedAtMs) ||
            fence.inventoryDigest !== context.binding.inventoryDigest ||
            fence.stage !== 'all-writers' ||
            ['existingSockets', 'internalWriters', 'producersRunning'].some(
              (key) => fence[key] !== 0,
            ) ||
            !equal(before, await guard(ctx, ['verified']))
          )
            fail();
          return structuredClone({ work, persisted, fence });
        };
        if (
          (await observer.restoreCloudServices(
            { identity: structuredClone(identity), maintenanceEndsAtMs: scope.maintenanceEndsAtMs },
            { readRecoveryFacts },
          )) !== undefined
        )
          fail();
      }),
    restoreIngress: (ctx, id) =>
      run('restore', ctx, ['verified'], () => ingress.restoreIngress(id)),
    resumeWorker: (ctx, id) =>
      run('worker', ctx, ['verified'], async () => {
        if (facts.resumeWorker) return facts.resumeWorker(context, id);
        return io.resumeWorker(context, id, scope.producerStartupFiles, {
          now: io.now,
          sleep: io.sleep,
          readCandidate: io.readCandidateRuntime,
          assertNoLegacy: async (identity) => {
            const record = await guard(context, ['verified']);
            checkIdentity(identity, record);
            const actual = await observer.readWithCandidate(identity);
            if (
              !equal(record.identity, identity) ||
              !equal(actual.candidate?.identity, identity) ||
              actual.candidate.mode !== 'serving' ||
              actual.candidate.idle !== false ||
              actual.candidate.needsReconciliation !== true ||
              !fresh(actual.observedAtMs) ||
              actual.inventoryDigest !== context.binding.inventoryDigest ||
              actual.unknownLaunchers.length ||
              legacy(actual).length ||
              !equal(record, await guard(context, ['verified']))
            )
              fail();
          },
        });
      }),
    readBackupPlan: (ctx) =>
      run(
        'backup-plan',
        ctx,
        ['backup_verified'],
        async () => {
          const record = await guard(context, ['backup_verified']);
          await stopped();
          const plan = await (facts.readBackupPlan ?? io.readBackupPlan)(
            context,
            approvedInventory(),
          );
          await stopped();
          if (!equal(record, await guard(context, ['backup_verified']))) fail();
          return plan;
        },
        false,
      ),
    // Host owns reconciliation's longer deadline and protective close. Neither
    // callback reopens sessions or performs an implicit ingress restoration.
    reconcile: (ctx, id) => {
      if (!closed || closeFailed || ctx.journal !== context?.journal) fail();
      return facts.reconcile(context, id);
    },
    holdMaintenance: (ctx, result) => {
      if (ctx.journal !== context?.journal) fail();
      return (facts.holdMaintenance ?? io.recordFailure)(context, result);
    },
  };
  return {
    lifecycle,
    recovery: {
      // Supply directly to the recovery session's live scope callback. The Mac
      // never supplies stopped booleans or a substitute journal/approval.
      assertScope: assertRecoveryScope,
    },
    // Original backup coordinator owns ordering and seals its own journal.
    // No uploaded completion flags, replacement receipt or second coordinator.
    backup: {
      readDatabaseIdentity: (identity) =>
        backupRead('backup-identity', async (inventory) => {
          if (equal(identity, inventory.backupPlan?.sourceIdentity)) {
            const plan = await io.readBackupPlan(context, inventory);
            if (!equal(plan, inventory.backupPlan)) fail();
            return plan.sourceIdentity;
          }
          if (!equal(identity, inventory.backupPlan?.isolatedTarget)) fail();
          const result = await (await recoveryConnection()).inspect();
          if (!equal(result, identity)) fail();
          return result;
        }),
      inspectBackupFacility: (input) =>
        backupRead('backup-facility', async (inventory) => {
          if (!equal(input, backupContext())) fail();
          return io.inspectSourceFacility(inventory.backupSource?.facility);
        }),
      hashArtifact: (artifact) =>
        backupRead('backup-hash', async (inventory) => {
          if (!sourceArtifact || !equal(artifact, sourceArtifact)) fail();
          const source = inventory.backupSource;
          const observed = await io.inspectSourceArtifact(artifact, {
            facility: source.facility,
            directory: source.directory,
            attempt,
          });
          if (
            !observed ||
            !equal(Object.keys(observed).sort(), ['backupDigest', 'bytes']) ||
            !/^[a-f0-9]{64}$/.test(observed.backupDigest) ||
            !Number.isSafeInteger(observed.bytes) ||
            observed.bytes <= 0
          )
            fail();
          const transfer = {
            artifact,
            expectedBackupDigest: observed.backupDigest,
            expectedBytes: observed.bytes,
          };
          if (sourceTransfer && !equal(sourceTransfer, transfer)) fail();
          sourceTransfer = structuredClone(transfer);
          return observed.backupDigest;
        }),
      restoreIsolated: (artifact, target) =>
        backupRead(
          'backup-restore',
          async (inventory) => {
            if (
              !sourceTransfer ||
              !equal(artifact, sourceArtifact) ||
              !equal(target, inventory.backupPlan?.isolatedTarget)
            )
              fail();
            if (!equal(await (await recoveryConnection()).restore(sourceTransfer), target)) fail();
            backupStage = 'restored';
          },
          true,
        ),
      compareInventoryAndData: (input) =>
        backupRead(
          'backup-compare',
          async (inventory, verify) => {
            if (backupStage !== 'restored' || !equal(input, backupContext())) fail();
            const source = await io.readSourceSnapshot(context, inventory, {
              assertWritersStopped: verify,
            });
            const target = await (await recoveryConnection()).snapshot();
            const comparison = compareCutoverMysqlSnapshots(source, target);
            comparedSnapshot = structuredClone(source);
            backupStage = 'compared';
            return comparison;
          },
          true,
        ),
      runApprovedMigrations: (target, digest) =>
        backupRead(
          'backup-migrate',
          async (inventory) => {
            if (
              backupStage !== 'compared' ||
              !equal(target, inventory.backupPlan?.isolatedTarget) ||
              digest !== context.binding.migrationDigest
            )
              fail();
            if (!equal(await (await recoveryConnection()).migrate(), { migrationDigest: digest }))
              fail();
            backupStage = 'migrated';
          },
          true,
        ),
      verifySchema: (target) =>
        backupRead(
          'backup-schema',
          async (inventory) => {
            if (backupStage !== 'migrated' || !equal(target, inventory.backupPlan?.isolatedTarget))
              fail();
            const result = await (await recoveryConnection()).verify();
            if (result?.businessDigest !== comparedSnapshot.businessDigest) fail();
            backupStage = 'verified';
            return result;
          },
          true,
        ),
      readSourceDigest: (source) =>
        backupRead('backup-source-digest', async (inventory, verify) => {
          if (backupStage !== 'verified' || !equal(source, inventory.backupPlan?.sourceIdentity))
            fail();
          return (await io.readSourceSnapshot(context, inventory, { assertWritersStopped: verify }))
            .sourceDigest;
        }),
      finishRecovery: (ctx) =>
        backupRead(
          'backup-finish',
          async () => {
            if (backupStage !== 'verified' || ctx.journal !== context.journal) fail();
            await (await recoveryConnection()).close();
            recovery = undefined;
            backupStage = 'finished';
          },
          true,
        ),
      exportDatabase: (source, input) =>
        run('source-backup', context, ['backup_verified'], async () => {
          const inventory = approvedInventory();
          const facility = await io.inspectSourceFacility(inventory.backupSource?.facility);
          const expected = {
            binding: context.binding,
            facility,
          };
          if (!equal(input, expected) || !equal(source, inventory.backupPlan?.sourceIdentity))
            fail();
          const record = await guard(context, ['backup_verified']);
          const verify = async () => {
            if (!equal(record, await guard(context, ['backup_verified']))) fail();
            await stopped();
          };
          await verify();
          const artifact = await io.exportSourceBackup(context, inventory, {
            assertWritersStopped: verify,
          });
          await verify();
          if (
            !equal(await io.inspectSourceFacility(inventory.backupSource?.facility), facility) ||
            artifact?.encryptionProfileDigest !== facility.encryptionProfileDigest
          )
            fail();
          sourceArtifact = structuredClone(artifact);
          return artifact;
        }),
    },
    // Pass this reader directly to the existing host evidence collector. The
    // preopen identity comes from start(), NOT from an early verified journal.
    evidence: {
      queryOrders: (database, input) =>
        run(
          'readiness-query',
          context,
          undefined,
          async () => {
            const request = readinessScope(input);
            const record = await guard(
              context,
              request.stage === 'prepare'
                ? ['preflight', 'prepared']
                : ['candidate_started', 'verified'],
            );
            if (request.stage === 'prepare') {
              if (request.identity !== undefined) fail();
            } else checkIdentity(request.identity, record);
            const selected = structuredClone(database);
            if (
              !fresh(selected?.observedAtMs) ||
              !Array.isArray(selected.orders) ||
              !Array.isArray(selected.unsettled) ||
              selected.unsettled.length
            )
              fail();
            const result = await gateway.queryOrders({
              stage: request.stage,
              observedAtMs: selected.observedAtMs,
              orders: selected.orders,
              ...(request.identity ? { identity: request.identity } : {}),
            });
            if (!equal(record, await guard(context, [record.phase]))) fail();
            return result;
          },
          false,
        ),
      readDatabaseScope: (input) =>
        run(
          'readiness-database',
          context,
          undefined,
          async () => {
            const request = readinessScope(input);
            const record = await guard(
              context,
              request.stage === 'prepare'
                ? ['preflight', 'prepared']
                : ['candidate_started', 'verified'],
            );
            if (request.stage === 'prepare') {
              if (request.identity !== undefined) fail();
            } else checkIdentity(request.identity, record);
            const result = await io.readPaymentScope(context, approvedInventory());
            if (!equal(record, await guard(context, [record.phase]))) fail();
            return result;
          },
          false,
        ),
      readRehearsalArtifacts: (input) =>
        run(
          'readiness-rehearsal',
          context,
          undefined,
          async () => {
            const request = readinessScope(input);
            const record = await guard(
              context,
              request.stage === 'prepare'
                ? ['preflight', 'prepared']
                : ['candidate_started', 'verified'],
            );
            if (request.stage === 'prepare') {
              if (request.identity !== undefined) fail();
            } else checkIdentity(request.identity, record);
            const result = await io.readRehearsal({
              binding: structuredClone(context.binding),
              merchants: approvedInventory().merchants,
            });
            if (!equal(record, await guard(context, [record.phase]))) fail();
            return result;
          },
          false,
        ),
      readHostInventory: (input) =>
        run(
          'readiness-host',
          context,
          undefined,
          async () => {
            const request = readinessScope(input);
            const record = await guard(
              context,
              request.stage === 'prepare'
                ? ['preflight', 'prepared']
                : ['candidate_started', 'verified'],
            );
            const inventory = approvedInventory();
            if (request.stage === 'prepare') {
              if (request.identity !== undefined) fail();
            } else checkIdentity(request.identity, record);
            const { work: before } = await observeWork();
            // The separately approved database source must also participate in
            // readiness, not only the ingress callback. Bracket the host read;
            // do not publish a clean report over a newly active database writer.
            const writerBefore = Object.hasOwn(inventory, 'databaseObserver')
              ? await observeWriters()
              : undefined;
            const actual =
              request.stage === 'prepare'
                ? await observer.read()
                : await observer.readWithCandidate(request.identity);
            if (request.stage === 'preopen') closedCandidate(actual, request.identity);
            const writerAfter = writerBefore === undefined ? undefined : await observeWriters();
            const { work: after } = await observeWork();
            checkLegacyCapability(actual);
            const disposition = validateLegacyWorkBoundary({
              observation: before,
              approval: context.approval,
              phase: request.stage,
              nowMs: io.now(),
            });
            const afterDisposition = validateLegacyWorkBoundary({
              observation: after,
              approval: context.approval,
              phase: request.stage,
              nowMs: io.now(),
            });
            if (
              !equal(disposition, afterDisposition) ||
              !fresh(actual.observedAtMs) ||
              actual.inventoryDigest !== context.binding.inventoryDigest ||
              actual.unknownLaunchers.length
            )
              fail();
            const producersRunning = [];
            const seen = new Set();
            for (const host of actual.hosts) {
              for (const process of [...host.registered.processes, ...host.unmanaged.processes]) {
                if (!['main', 'worker'].includes(process.role)) continue;
                const matches = inventory.targets.filter(
                  (target) =>
                    target.host === host.host &&
                    target.pid === process.pid &&
                    target.start === process.start &&
                    target.role === process.role,
                );
                const key = `${host.host}:${process.pid}`;
                if (matches.length !== 1 || seen.has(key)) fail();
                seen.add(key);
                producersRunning.push(structuredClone(matches[0]));
              }
            }
            const writerTimes = [];
            if (Object.hasOwn(inventory, 'databaseObserver')) {
              for (const writer of [writerBefore, writerAfter]) {
                if (
                  !fresh(writer?.observedAtMs) ||
                  writer.inventoryDigest !== context.binding.inventoryDigest ||
                  !Number.isSafeInteger(writer.internalWriters) ||
                  writer.internalWriters < 0 ||
                  writer.producersRunning !== producersRunning.length ||
                  !Number.isSafeInteger(writer.existingSockets) ||
                  writer.existingSockets < 0 ||
                  (request.stage === 'preopen' &&
                    (writer.existingSockets !== 0 || writer.internalWriters !== 0))
                )
                  fail();
                writerTimes.push(writer.observedAtMs);
              }
            }
            if (!equal(record, await guard(context, [record.phase]))) fail();
            return {
              inventory: structuredClone(inventory),
              observedAtMs: Math.min(
                before.observedAtMs,
                actual.observedAtMs,
                after.observedAtMs,
                ...writerTimes,
                ...(context.approval.schemaVersion === 2
                  ? [actual.legacyCapability.observedAtMs]
                  : []),
              ),
              producersRunning,
              unknownWriters: [],
              externalWork:
                disposition.mode === 'controlled-interruption'
                  ? structuredClone(before.knownExternalWork)
                  : [],
              ...(disposition.mode === 'controlled-interruption'
                ? {
                    riskDigest: disposition.riskDigest,
                    legacyWork: structuredClone({ before, after }),
                    legacyCapability: structuredClone(actual.legacyCapability),
                  }
                : {}),
            };
          },
          false,
        ),
      readFenceState: (input) =>
        run(
          'readiness-fence',
          context,
          undefined,
          async () => {
            const request = readinessScope(input);
            let proof;
            if (request.stage === 'prepare') {
              const record = await guard(context, ['preflight', 'prepared']);
              if (request.identity !== undefined) fail();
              const actual = await observer.read();
              if (
                !fresh(actual.observedAtMs) ||
                actual.inventoryDigest !== context.binding.inventoryDigest ||
                actual.unknownLaunchers.length ||
                !equal(record, await guard(context, [record.phase]))
              )
                fail();
              proof = {
                ...actual,
                stage: 'observed',
                liveLegacy: legacy(actual),
                regeneratedLegacy: actual.unknownLaunchers,
              };
            } else {
              if (request.identity === undefined) fail();
              proof = await boundary(request.identity);
            }
            return {
              inventoryDigest: context.binding.inventoryDigest,
              observedAtMs: proof.observedAtMs,
              stage: proof.stage,
              uncovered: structuredClone(scope.ingress.unknownIngress),
              liveLegacy: proof.liveLegacy,
              regeneratedLegacy: proof.regeneratedLegacy,
            };
          },
          false,
        ),
    },
    inspectLegacySource: async (approval) => {
      const reviewed = await readScope(approval);
      if (inspectedScope && !equal(inspectedScope, reviewed)) fail();
      const result = await io.inspectSource(
        {
          reviews: reviewed.reviews,
          inventoryDigest: reviewed.binding.inventoryDigest,
          binding: reviewed.binding,
        },
        {
          now: io.now,
          readPair: io.readPair,
          readExecutionIdentities: async () => [await io.readCoordinatorIdentity()],
        },
      );
      if (!equal(reviewed, await readScope(approval))) fail();
      inspectedScope = reviewed;
      return result;
    },
  };
}
