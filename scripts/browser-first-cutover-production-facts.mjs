import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import {
  readCutoverHostSnapshot,
  validateCutoverLegacyCapability,
  validateLegacyWorkBoundary,
  readCutoverRehearsalArtifacts,
} from './browser-cutover-evidence.mjs';
import {
  readFirstCutoverPersistedWork,
  readFirstCutoverAttributedWriters,
  readFirstCutoverCandidateRuntime,
  readFirstCutoverPaymentScope,
} from './browser-first-cutover-host.mjs';
const fail = () => {
  throw new Error('CUTOVER_PRODUCTION_FACTS_UNPROVEN');
};
const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Independent SQL/session observations are combined with the original physical
 * source classifier. No caller-provided zero counts, settlement or business writes.
 * Missing attribution/legacy capability/provider restoration evidence blocks.
 */
export function createFirstCutoverProductionFacts(options, overrides = {}) {
  if (
    !options ||
    ['readState', 'readInventory', 'readCoordinator'].some((k) => typeof options[k] !== 'function')
  )
    fail();
  const io = {
    now: Date.now,
    readPersisted: readFirstCutoverPersistedWork,
    readDatabase: readFirstCutoverAttributedWriters,
    readHost: readCutoverHostSnapshot,
    readCandidate: readFirstCutoverCandidateRuntime,
    readPayments: readFirstCutoverPaymentScope,
    readRehearsal: readCutoverRehearsalArtifacts,
    ...overrides,
  };
  let last = -1;
  const fresh = (time) =>
    Number.isSafeInteger(time) && time >= 0 && time <= io.now() && io.now() - time <= 60000;
  const guard = async (ctx, reconcile = false) => {
    const now = io.now();
    if (
      !Number.isSafeInteger(now) ||
      now < last ||
      now >= (reconcile ? ctx.approval.reconcileByMs : ctx.approval.maintenanceEndsAtMs) ||
      !equal(await ctx.journal.assertOwnership(), ctx.binding)
    )
      fail();
    last = now;
    return structuredClone(await ctx.journal.readFirstCutoverEffects());
  };
  const writers = async (ctx, input = {}) => {
    const record = await guard(ctx);
    const inventory = await options.readInventory(ctx);
    if (!inventory?.databaseObserver) fail();
    const database = input.database ?? (await io.readDatabase(ctx, inventory));
    const state = await options.readState(ctx);
    if (
      !fresh(state?.observedAtMs) ||
      state.inventoryDigest !== ctx.binding.inventoryDigest ||
      !Array.isArray(state.unknownLaunchers) ||
      state.unknownLaunchers.length ||
      !Array.isArray(state.hosts) ||
      state.hosts.length !== 2 ||
      new Set(state.hosts.map((h) => h.host)).size !== 2
    )
      fail();
    const attribution = database?.sessionAttribution;
    if (
      database?.schemaVersion !== 1 ||
      database.scope !== 'mysql-server-observation-only' ||
      !fresh(database.startedAtMs) ||
      !fresh(database.observedAtMs) ||
      !database.counts ||
      ['transactions', 'enabledEvents', 'replicationReceivers', 'replicationAppliers'].some(
        (k) =>
          !Number.isSafeInteger(database.counts[k]) ||
          database.counts[k] < 0 ||
          database.counts[k] > 10000,
      ) ||
      attribution?.scope !== 'current-session-attribution-only' ||
      !fresh(attribution.observedAtMs) ||
      attribution.unattributed !== 0 ||
      attribution.sessions !== database.counts.sessions ||
      attribution.unknownWritersZeroProven !== false ||
      !Array.isArray(attribution.processes)
    )
      fail();
    const producers = state.hosts.flatMap((h) =>
      [...h.registered.processes, ...h.unmanaged.processes].map((p) => ({ ...p, host: h.host })),
    );
    const known = producers.filter((p) => p.host === 'vultr');
    const host = await io.readHost();
    if (
      !fresh(host?.observedAtMs) ||
      !Array.isArray(host.processes) ||
      host.bootId?.replaceAll('-', '') !==
        state.hosts.find((h) => h.host === 'vultr').registered.bootId
    )
      fail();
    const identity = await options.readCoordinator(ctx);
    if (identity?.process) known.push(identity.process);
    if (state.candidate?.runtime?.main)
      known.push({
        ...state.candidate.runtime.main,
        ppid: host.pm2Runtime.pid,
        uids: [998, 998, 998, 998],
      });
    if (state.candidate?.runtime?.worker)
      known.push({
        ...state.candidate.runtime.worker,
        ppid: host.pm2Runtime.pid,
        uids: [998, 998, 998, 998],
      });
    // Preserve is not a database-writer exemption. An attributed but unrelated
    // DB owner remains blocked, even when idle and otherwise reviewed.
    if (
      attribution.processes.some((p) => {
        const owner = host.processes.find((k) => k.pid === p.pid);
        return (
          !owner ||
          p.identityDigest !== sha({ bootId: host.bootId, owner }) ||
          p.start !== owner.start ||
          p.ppid !== owner.ppid ||
          !equal(p.uids, owner.uids) ||
          !known.some((k) =>
            ['pid', 'start', 'ppid', 'uids', 'exe', 'cwd', 'argvDigest'].every(
              (key) => k[key] === undefined || equal(k[key], owner[key]),
            ),
          )
        );
      })
    )
      fail();
    const tcp = state.hosts.map((h) => h.tcpObservation);
    if (
      tcp.some(
        (p) =>
          !fresh(p?.observedAtMs) ||
          !Number.isSafeInteger(p.existingSockets) ||
          p.existingSockets < 0,
      )
    )
      fail();
    if (!equal(record, await guard(ctx))) fail();
    return {
      inventoryDigest: ctx.binding.inventoryDigest,
      observedAtMs: Math.min(
        state.observedAtMs,
        database.startedAtMs,
        attribution.observedAtMs,
        ...tcp.map((p) => p.observedAtMs),
      ),
      existingSockets: tcp.reduce((n, p) => n + p.existingSockets, 0),
      internalWriters:
        database.counts.transactions +
        database.counts.enabledEvents +
        database.counts.replicationReceivers +
        database.counts.replicationAppliers,
      producersRunning: producers.filter((p) => ['main', 'worker'].includes(p.role)).length,
    };
  };
  const observeWork = async (ctx) => {
    const record = await guard(ctx);
    const state = await options.readState(ctx);
    const persisted = await io.readPersisted(ctx);
    const writer = await writers(ctx);
    if (!fresh(persisted?.observedAtMs) || !Array.isArray(persisted.unsettled)) fail();
    // Only the already-approved unavailable API can retain memory uncertainty.
    // Strict-drain first cutover has no API in this legacy source and refuses.
    if (ctx.approval.schemaVersion !== 2)
      throw new Error('CUTOVER_LEGACY_INFLIGHT_API_UNAVAILABLE');
    if (
      validateCutoverLegacyCapability(state.legacyCapability, io.now()) !==
      ctx.approval.legacyInterruption.capabilityDigest
    )
      fail();
    if (
      !Number.isSafeInteger(persisted.pendingReplay) ||
      !/^[a-f0-9]{64}$/.test(persisted.replaySourcesDigest ?? '')
    )
      fail();
    const result = {
      schemaVersion: 2,
      inventoryDigest: ctx.binding.inventoryDigest,
      observedAtMs: Math.min(state.observedAtMs, persisted.observedAtMs, writer.observedAtMs),
      unsettledWork: persisted.unsettled.length,
      unknownWriters: state.unknownLaunchers.length,
      knownExternalWork: structuredClone(persisted.unsettled),
      activeRequests: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
      externalWork: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
      capabilityDigest: ctx.approval.legacyInterruption.capabilityDigest,
      replaySourcesDigest: persisted.replaySourcesDigest,
      pendingReplay: persisted.pendingReplay,
    };
    if (!equal(record, await guard(ctx))) fail();
    return result;
  };
  return {
    observeWriters: writers,
    observeWork,
    settleLegacy: async (ctx) => {
      const work = await observeWork(ctx);
      validateLegacyWorkBoundary({
        observation: work,
        approval: ctx.approval,
        phase: 'before-stop',
        nowMs: io.now(),
      });
    },
    reconcile: async (ctx, identity) => {
      const started = io.now();
      const record = await guard(ctx, true);
      if (
        record.phase !== 'reconciled' ||
        !equal(record.identity, identity) ||
        typeof options.queryOrders !== 'function' ||
        typeof options.probeBrowser !== 'function'
      )
        fail();
      const inventory = await options.readInventory(ctx);
      const before = await io.readCandidate(identity);
      if (
        !equal(before.identity, identity) ||
        before.mode !== 'serving' ||
        before.idle !== false ||
        before.needsReconciliation !== true
      )
        fail();
      const payments = await io.readPayments(ctx, inventory);
      const observations = await options.queryOrders(ctx, identity, payments);
      const rehearsal = await io.readRehearsal({
        binding: ctx.binding,
        merchants: inventory.merchants,
      });
      if (
        !fresh(payments?.observedAtMs) ||
        !Array.isArray(payments.orders) ||
        !Array.isArray(payments.unsettled) ||
        !Number.isSafeInteger(rehearsal?.observedAtMs) ||
        rehearsal.observedAtMs < 0 ||
        rehearsal.observedAtMs > io.now() ||
        !Array.isArray(rehearsal.artifacts) ||
        !rehearsal.artifacts.length
      )
        fail();
      // The original stop/preopen checks already proved no legacy persisted work.
      // Opened candidate producers can now legitimately create tasks/replay work;
      // that unrelated work is not a payment failure or a second drain obligation.
      const key = (r) => JSON.stringify([r.provider, r.environment, r.merchantDigest, r.orderRef]);
      if (
        !Array.isArray(observations) ||
        observations.length !== payments.orders.length ||
        new Set(observations.map(key)).size !== observations.length ||
        observations.some(
          (r) =>
            !fresh(r.observedAtMs) ||
            !/^[a-f0-9]{64}$/.test(r.rawDigest ?? '') ||
            !['settled', 'closed', 'unpaid-valid'].includes(r.state) ||
            !payments.orders.some((o) => key(o) === key(r)),
        )
      )
        fail();
      // Integrity is independently checked by the protected artifact reader.
      // It does not run a provider rehearsal or manufacture a provider result.
      if (
        rehearsal.candidate !== ctx.binding.candidate ||
        rehearsal.configDigest !== ctx.binding.configDigest ||
        rehearsal.inventoryDigest !== ctx.binding.inventoryDigest ||
        !['retry-proven', 'query-and-existing-settlement-proven'].includes(rehearsal.recovery) ||
        !Number.isSafeInteger(rehearsal.recoveryUntilMs) ||
        rehearsal.recoveryUntilMs < ctx.approval.reconcileByMs ||
        rehearsal.artifacts.length !== inventory.merchants.length ||
        new Set(
          rehearsal.artifacts.map((a) =>
            JSON.stringify([a.provider, a.environment, a.merchantDigest]),
          ),
        ).size !== inventory.merchants.length ||
        rehearsal.artifacts.some(
          (a) =>
            !inventory.merchants.some((m) =>
              ['provider', 'environment', 'merchantDigest', 'codeDigest'].every(
                (k) => m[k] === a[k],
              ),
            ) ||
            [
              'transcriptDigest',
              ...(rehearsal.recovery === 'retry-proven'
                ? ['retryDigest']
                : ['queryDigest', 'settlementDigest']),
            ].some((k) => !/^[a-f0-9]{64}$/.test(a[k] ?? '')),
        )
      )
        fail();
      const browser = await options.probeBrowser(ctx, identity);
      if (
        browser?.kind !== 'browser-minimum-execution-result' ||
        !fresh(browser.observedAtMs) ||
        !['targetDigest', 'resultDigest'].every((k) => /^[a-f0-9]{64}$/.test(browser[k] ?? ''))
      )
        fail();
      const after = await io.readCandidate(identity);
      const stable = (value) =>
        Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'observedAtMs'));
      // The fixed candidate reader performs two real control/status observations
      // and a real process observation. Its contract has no observedAtMs field;
      // bracket those live reads here, never assign a timestamp to old evidence.
      if (
        io.now() - started > 60000 ||
        !equal(stable(before), stable(after)) ||
        !equal(record, await guard(ctx, true))
      )
        fail();
      return {
        identity: structuredClone(identity),
        sourceDigest: sha({ payments, observations, rehearsal, browser }),
        observedAtMs: io.now(),
      };
    },
  };
}
