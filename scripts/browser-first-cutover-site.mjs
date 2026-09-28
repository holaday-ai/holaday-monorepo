import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual as equal } from 'node:util';
import { connectFirstCutoverGatewaySession } from './browser-first-cutover-gateway-session.mjs';
import {
  createFirstCutoverRetirementObserver,
  readFirstCutoverHostPair,
  readReviewedFirstCutoverLegacySource,
} from './browser-first-cutover-host.mjs';
import {
  createFirstCutoverIngressPair,
  readFirstCutoverExecutionSiteScope,
} from './browser-first-cutover-ingress-session.mjs';
import { retireLocalFirstCutoverProducers } from './browser-first-cutover-registrations.mjs';

const bindingKeys = ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'];
const fail = () => {
  throw new Error('CUTOVER_SITE_UNPROVEN');
};

/** Wire the existing physical operations into the original host's lifecycle.
 * Business/control/backup readers are mandatory trusted site code, NOT uploaded
 * booleans or zero-count defaults. They must not call this ingress session from
 * its own writer callback. This module does not install tools or enable the CLI.
 */
export function createFirstCutoverExecutionSite(options, overrides = {}) {
  const io = {
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    sleep,
    readPair: readFirstCutoverHostPair,
    inspectSource: readReviewedFirstCutoverLegacySource,
    createIngress: createFirstCutoverIngressPair,
    connectGateway: connectFirstCutoverGatewaySession,
    createObserver: createFirstCutoverRetirementObserver,
    retireProducers: retireLocalFirstCutoverProducers,
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
    [
      'observeWriters',
      'observeWork',
      'verifyOpenedIdentity',
      'settleLegacy',
      'resumeWorker',
      'reconcile',
      'holdMaintenance',
      'readBackupPlan',
    ].some((k) => typeof io.facts?.[k] !== 'function')
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
  const boundary = async () => {
    const record = await guard(context);
    const orders = ['orders_fenced', 'legacy_settled', 'producers_stopped'].includes(record.phase);
    const work = structuredClone(await facts.observeWork(context));
    const fence = await ingress[orders ? 'verifyOrders' : 'verifyFence']();
    const progress = await observer.readFenceProgress();
    if (progress?.purpose !== 'fence-progress') fail();
    const actual = progress.pair;
    const after = await facts.observeWork(context);
    const counts = ['unsettledWork', 'externalWork', 'activeRequests', 'unknownWriters'];
    if (
      !fresh(work.observedAtMs) ||
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
    await guard(context, [record.phase]);
    return {
      ...fence,
      ...Object.fromEntries(counts.map((k) => [k, work[k]])),
      runningProducers,
      observedAtMs: Math.min(
        work.observedAtMs,
        after.observedAtMs,
        fence.observedAtMs,
        actual.observedAtMs,
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
    for (const handle of [gateway, ingress]) {
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
          verifyOpenedIdentity: (id) => facts.verifyOpenedIdentity(context, id),
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
      run('worker', ctx, ['verified'], () => facts.resumeWorker(context, id)),
    readBackupPlan: (ctx) =>
      run('backup-plan', ctx, ['backup_verified'], () => facts.readBackupPlan(context), false),
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
