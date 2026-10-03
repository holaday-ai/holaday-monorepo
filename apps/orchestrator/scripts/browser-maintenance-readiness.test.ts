import { execFileSync } from 'node:child_process';
import { validateServicesEvidence } from '../src/execution/ordinary-maintenance-services.js';
import { describe, expect, it, vi } from 'vitest';
import {
  runMaintenanceReadinessCommand,
  verifyMaintenanceReadiness,
} from './browser-maintenance-readiness.js';

const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
const binding = [
  '11111111-1111-4111-8111-111111111111',
  identity.candidate,
  'c'.repeat(64),
  'd'.repeat(64),
  'e'.repeat(64),
] as const;
describe('readiness command used by the release driver', () => {
  const operations = () => ({
    services: vi.fn(async () => {}),
    readIdentity: vi.fn(() => identity),
    verify: vi.fn(async () => {}),
    closeDatabase: vi.fn(async () => {}),
  });
  it('service preflight has no database or identity side effects', async () => {
    const io = operations();
    io.services.mockRejectedValue(new Error('MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN'));
    await expect(runMaintenanceReadinessCommand(['services', ...binding], io)).rejects.toThrow(
      'MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN',
    );
    expect(io.readIdentity).not.toHaveBeenCalled();
    expect(io.verify).not.toHaveBeenCalled();
    expect(io.closeDatabase).not.toHaveBeenCalled();
  });
  it('first-cutover commands carry explicit risk binding without changing ordinary arguments', async () => {
    const riskDigest = '7'.repeat(64);
    const io = operations();
    await runMaintenanceReadinessCommand(['services-first-cutover', ...binding, riskDigest], io);
    expect(io.services).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'first-cutover', riskDigest, stage: 'prepare' }),
    );
    await runMaintenanceReadinessCommand(
      ['verify-first-cutover', ...binding, identity.bootId, riskDigest],
      io,
    );
    expect(io.verify).toHaveBeenCalledWith(
      identity,
      identity,
      expect.objectContaining({ kind: 'first-cutover', riskDigest, stage: 'preopen' }),
    );
    for (const args of [
      ['services', ...binding, riskDigest],
      ['services-first-cutover', ...binding],
      ['verify-first-cutover', ...binding, identity.bootId, ''],
      ['verify', ...binding, identity.bootId, riskDigest],
    ]) {
      const deniedIo = operations();
      await expect(runMaintenanceReadinessCommand(args, deniedIo)).rejects.toThrow(
        'MAINTENANCE_READINESS_INPUT',
      );
      expect(deniedIo.services).not.toHaveBeenCalled();
      expect(deniedIo.verify).not.toHaveBeenCalled();
    }
  });
  it('wrong target rejects before importing or querying database', async () => {
    const io = operations();
    await expect(
      runMaintenanceReadinessCommand(
        ['verify', binding[0], 'c'.repeat(40), ...binding.slice(2), identity.bootId],
        io,
      ),
    ).rejects.toThrow('MAINTENANCE_IDENTITY_MISMATCH');
    expect(io.verify).not.toHaveBeenCalled();
    expect(io.closeDatabase).not.toHaveBeenCalled();
  });
  it('matching target awaits readonly checks and database closure on both success and failure', async () => {
    for (const failed of [false, true]) {
      const io = operations();
      if (failed) io.verify.mockRejectedValue(new Error('SCHEMA_UNPROVEN'));
      const result = runMaintenanceReadinessCommand(['verify', ...binding, identity.bootId], io);
      if (failed) await expect(result).rejects.toThrow('SCHEMA_UNPROVEN');
      else await result;
      expect(io.verify).toHaveBeenCalledWith(
        identity,
        identity,
        expect.objectContaining({
          attempt: binding[0],
          stage: 'preopen',
          identity,
          candidate: identity.candidate,
        }),
      );
      expect(io.closeDatabase).toHaveBeenCalledOnce();
    }
  });
  it.each([
    ['services'],
    [identity.candidate, identity.bootId],
    ['services', '../other', ...binding.slice(1)],
  ])('rejects absent or malformed release binding: %j', async (...args) => {
    const io = operations();
    await expect(runMaintenanceReadinessCommand(args, io)).rejects.toThrow(
      'MAINTENANCE_READINESS_INPUT',
    );
    expect(io.services).not.toHaveBeenCalled();
    expect(io.verify).not.toHaveBeenCalled();
  });
});
function checks() {
  return {
    schemaCheck: vi.fn(async () => {}),
    recordsCheck: vi.fn(async () => {}),
    servicesCheck: vi.fn(async () => {}),
  };
}
describe('maintenance readiness', () => {
  it.each(['candidate', 'bootId'] as const)(
    'rejects foreign %s before running probes',
    async (key) => {
      const probes = checks();
      await expect(
        verifyMaintenanceReadiness({
          identity,
          expectedIdentity: { ...identity, [key]: 'c'.repeat(identity[key].length) },
          ...probes,
        }),
      ).rejects.toThrow('MAINTENANCE_IDENTITY_MISMATCH');
      for (const fn of Object.values(probes)) expect(fn).not.toHaveBeenCalled();
    },
  );
  it('rejects malformed identity and missing probes', async () => {
    for (const input of [
      { identity: { candidate: '', bootId: '' }, expectedIdentity: identity, ...checks() },
      { identity, expectedIdentity: identity, ...checks(), servicesCheck: undefined },
    ]) {
      await expect(verifyMaintenanceReadiness(input as never)).rejects.toThrow(
        'MAINTENANCE_READINESS_INPUT',
      );
    }
  });
  it.each(['schemaCheck', 'recordsCheck', 'servicesCheck'] as const)(
    'propagates %s failure and does not run later probes',
    async (failed) => {
      const probes = checks();
      probes[failed].mockRejectedValue(new Error(failed));
      await expect(
        verifyMaintenanceReadiness({ identity, expectedIdentity: identity, ...probes }),
      ).rejects.toThrow(failed);
      const names = Object.keys(probes) as (keyof typeof probes)[];
      for (const name of names.slice(names.indexOf(failed) + 1))
        expect(probes[name]).not.toHaveBeenCalled();
    },
  );
  it('waits each original probe before invoking the next', async () => {
    let release!: () => void;
    const probes = checks();
    probes.schemaCheck.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const ready = verifyMaintenanceReadiness({ identity, expectedIdentity: identity, ...probes });
    void ready.catch(() => {});
    expect(probes.recordsCheck).not.toHaveBeenCalled();
    release();
    await ready;
    expect(probes.schemaCheck).toHaveBeenCalledOnce();
    expect(probes.recordsCheck).toHaveBeenCalledOnce();
    expect(probes.servicesCheck).toHaveBeenCalledOnce();
    const servicesCall = probes.servicesCheck.mock.invocationCallOrder[0];
    if (servicesCall === undefined) throw new Error('missing services call');
    expect(probes.recordsCheck.mock.invocationCallOrder[0]).toBeLessThan(servicesCall);
  });
});

it('actual host argv binds first-only exact set through CLI context into strict services report', async () => {
  const set = '192900b8bbd82d0456952f07f66cffe145f7131e738ab1c74f97ee327205f446';
  const risk = '7'.repeat(64);
  const bound = {
    attempt: binding[0],
    candidate: binding[1],
    configDigest: binding[2],
    migrationDigest: binding[3],
    inventoryDigest: binding[4],
  };
  const host = new URL('../../../scripts/browser-first-cutover-host.mjs', import.meta.url).href;
  const code = `import {firstCutoverReadinessArguments} from ${JSON.stringify(host)};console.log(JSON.stringify(firstCutoverReadinessArguments(${JSON.stringify({ kind: 'first-cutover', riskDigest: risk, deferredWorkSetFingerprint: set })},${JSON.stringify(bound)})));`;
  const args = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      timeout: 5000,
      maxBuffer: 8192,
      encoding: 'utf8',
    }),
  );
  const deferred = [
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
  ].map((recordFingerprint) => ({
    table: 'task_steps',
    status: 'executing',
    recordFingerprint,
    approvalRef: 'exact-legacy-navigation-deferral-20261002',
    outcome: 'unverified',
    automaticReplay: false,
  }));
  const io = {
    services: async (context: Parameters<typeof validateServicesEvidence>[1]) => {
      expect('deferredWorkSetFingerprint' in context && context.deferredWorkSetFingerprint).toBe(
        set,
      );
      const now = context.nowMs;
      const report = {
        ...bound,
        schemaVersion: 2,
        kind: 'first-cutover',
        stage: 'prepare',
        observedAtMs: now,
        maintenanceEndsAtMs: now + 60000,
        reconcileByMs: now + 120000,
        operatorRef: 'qa',
        sources: ['host', 'database', 'provider-query', 'provider-rehearsal'].map((kind) => ({
          kind,
          digest:
            kind === 'host'
              ? bound.inventoryDigest
              : kind === 'provider-rehearsal'
                ? '4'.repeat(64)
                : '2'.repeat(64),
          observedAtMs: now,
          targetDigest: kind === 'host' ? bound.inventoryDigest : bound.configDigest,
        })),
        host: {
          inventoryDigest: bound.inventoryDigest,
          unknownWriters: 0,
          unsettledWork: 0,
          phase: 'prepared',
          deferredUnverifiedWork: deferred,
          unresolvedWorkCount: 10,
          eligibleReplay: 0,
        },
        payments: {
          scopeDigest: '2'.repeat(64),
          queriedScopeDigest: '2'.repeat(64),
          unresolved: 0,
          validUnpaid: 0,
          followupDigest: '3'.repeat(64),
          recovery: 'query-and-existing-settlement-proven',
          recoveryUntilMs: now + 120000,
          rehearsalDigest: '4'.repeat(64),
        },
        legacyInterruption: {
          riskDigest: risk,
          capabilityDigest: '5'.repeat(64),
          sourceDigest: '6'.repeat(64),
          status: 'authorized-not-stopped',
        },
      };
      expect(() => validateServicesEvidence(report, context)).not.toThrow();
      expect(() =>
        validateServicesEvidence(
          {
            ...report,
            host: {
              inventoryDigest: bound.inventoryDigest,
              unknownWriters: 0,
              unsettledWork: 0,
              phase: 'prepared',
            },
          },
          context,
        ),
      ).toThrow();
    },
    readIdentity: () => identity,
    verify: async () => {},
    closeDatabase: async () => {},
  };
  await runMaintenanceReadinessCommand(args, io);
  for (const invalid of [
    ['services', ...binding, risk, set],
    ['services-first-cutover', ...binding, risk, '0'.repeat(64)],
    ['services-first-cutover', ...binding, risk, set, set],
  ])
    await expect(runMaintenanceReadinessCommand(invalid, io)).rejects.toThrow(
      'MAINTENANCE_READINESS_INPUT',
    );
});
