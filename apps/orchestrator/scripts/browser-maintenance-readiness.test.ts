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
