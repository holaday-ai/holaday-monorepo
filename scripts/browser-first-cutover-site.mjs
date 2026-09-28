import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual as equal } from 'node:util';
import { readCutoverRehearsalArtifacts } from './browser-cutover-evidence.mjs';
import {
  inspectAgeBackupArtifact,
  inspectAgeBackupFacility,
} from './browser-first-cutover-backup.mjs';
import { connectFirstCutoverGatewaySession } from './browser-first-cutover-gateway-session.mjs';
import {
  createFirstCutoverRetirementObserver,
  exportFirstCutoverSourceBackup,
  readFirstCutoverBackupPlan,
  readFirstCutoverCandidateRuntime,
  readFirstCutoverHostPair,
  readFirstCutoverPaymentScope,
  readFirstCutoverPersistedWork,
  readFirstCutoverSourceSnapshot,
  readReviewedFirstCutoverLegacySource,
  resumeFirstCutoverCandidateWorker,
} from './browser-first-cutover-host.mjs';
import {
  createFirstCutoverIngressPair,
  readFirstCutoverExecutionSiteScope,
} from './browser-first-cutover-ingress-session.mjs';
import { compareCutoverMysqlSnapshots } from './browser-first-cutover-mysql.mjs';
import { connectFirstCutoverRecoverySession } from './browser-first-cutover-recovery-session.mjs';
import { retireLocalFirstCutoverProducers } from './browser-first-cutover-registrations.mjs';

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
    ['observeWriters', 'observeWork', 'settleLegacy', 'reconcile', 'holdMaintenance'].some(
      (k) => typeof io.facts?.[k] !== 'function',
    )
  )
    fail();
  const facts = { ...io.facts };
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
      !/^[a-f0-9]{64}$/.test(value.gatewaySiteDigest ?? '')
    )
      fail();
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
      !bindingKeys.every((k) => record[k] === context.binding[k]) ||
      record.legacyDigest !== scope.legacyDigest ||
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
  const boundary = async (identity) => {
    const record = await guard(context);
    if (identity !== undefined) {
      if (!['candidate_started', 'verified'].includes(record.phase)) fail();
      checkIdentity(identity, record);
    }
    const orders = ['orders_fenced', 'legacy_settled', 'producers_stopped'].includes(record.phase);
    const work = structuredClone(await facts.observeWork(context));
    const persisted = await io.readPersistedWork(context);
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
    const after = await facts.observeWork(context);
    const persistedAfter = await io.readPersistedWork(context);
    const counts = ['unsettledWork', 'externalWork', 'activeRequests', 'unknownWriters'];
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
      counts.some((k) => work[k] !== 0 || after[k] !== 0)
    )
      fail();
    const runningProducers = actual.hosts
      .flatMap((h) => [...h.registered.processes, ...h.unmanaged.processes])
      .filter((p) => ['main', 'worker'].includes(p.role));
    if (fence.producersRunning !== runningProducers.length || (!orders && runningProducers.length))
      fail();
    if (!equal(record, await guard(context, [record.phase]))) fail();
    return {
      ...fence,
      ...Object.fromEntries(counts.map((k) => [k, work[k]])),
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
        await guard(ctx, ['preflight', 'prepared']);
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
          observeWriters: () => facts.observeWriters(context),
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
          { reviews: scope.reviews, binding: context.binding, legacyDigest: scope.legacyDigest },
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
      return facts.holdMaintenance(context, result);
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
            const before = structuredClone(await facts.observeWork(context));
            const actual =
              request.stage === 'prepare'
                ? await observer.read()
                : await observer.readWithCandidate(request.identity);
            if (request.stage === 'preopen') closedCandidate(actual, request.identity);
            const after = await facts.observeWork(context);
            if (
              ![before, after].every(
                (v) =>
                  fresh(v?.observedAtMs) &&
                  v.inventoryDigest === context.binding.inventoryDigest &&
                  ['unsettledWork', 'externalWork', 'activeRequests', 'unknownWriters'].every(
                    (k) => v[k] === 0,
                  ),
              ) ||
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
            if (!equal(record, await guard(context, [record.phase]))) fail();
            return {
              inventory: structuredClone(inventory),
              observedAtMs: Math.min(before.observedAtMs, actual.observedAtMs, after.observedAtMs),
              producersRunning,
              unknownWriters: [],
              externalWork: [],
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
      return io.inspectSource(
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
    },
  };
}
