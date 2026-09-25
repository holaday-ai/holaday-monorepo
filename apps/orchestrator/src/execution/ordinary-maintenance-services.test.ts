import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import * as realFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Exercise real descriptors, links and replacement, substituting only the
// privileged production path/ownership unavailable to this Mac test process.
const disk = vi.hoisted(() => ({
  root: '',
  owner: 0,
  afterRead: undefined as undefined | (() => Promise<void>),
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const prefix = '/var/lib/holaday-deploy/evidence';
  const map = (p: unknown) =>
    typeof p === 'string' && p.startsWith(prefix) ? disk.root + p.slice(prefix.length) : p;
  const stat = (s: Awaited<ReturnType<typeof actual.lstat>>) =>
    new Proxy(s, {
      get(target, key) {
        const v = key === 'uid' ? disk.owner : Reflect.get(target, key);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  return {
    ...actual,
    lstat: async (p: string) => stat(await actual.lstat(map(p) as string)),
    realpath: async (p: string) => {
      const resolved = await actual.realpath(map(p) as string);
      return resolved.startsWith(disk.root) ? prefix + resolved.slice(disk.root.length) : resolved;
    },
    open: async (p: string, flags: number) => {
      const handle = await actual.open(map(p) as string, flags);
      const originalStat = handle.stat.bind(handle);
      const originalRead = handle.read.bind(handle);
      handle.stat = (async () => stat(await originalStat())) as typeof handle.stat;
      handle.read = (async (...args: Parameters<typeof originalRead>) => {
        const result = await originalRead(...args);
        if (disk.afterRead) {
          const hook = disk.afterRead;
          disk.afterRead = undefined;
          await hook();
        }
        return result;
      }) as typeof handle.read;
      return handle;
    },
  };
});
import { checkMaintenanceServices } from './ordinary-maintenance-readiness.js';
import {
  type CutoverEvidence,
  type ServicesContext,
  readActiveServicesContext,
  readServicesEvidence,
  validateServicesEvidence,
} from './ordinary-maintenance-services.js';

const denied = 'MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN';
const context: ServicesContext = {
  attempt: '11111111-1111-4111-8111-111111111111',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
  stage: 'prepare',
  nowMs: 100_000,
};
function evidence(): CutoverEvidence {
  const { nowMs: _, ...binding } = context;
  return {
    ...binding,
    schemaVersion: 1,
    observedAtMs: 99_000,
    maintenanceEndsAtMs: 120_000,
    reconcileByMs: 180_000,
    operatorRef: 'operator-01',
    sources: [
      {
        kind: 'host',
        digest: 'd'.repeat(64),
        observedAtMs: 99_000,
        targetDigest: context.inventoryDigest,
      },
      {
        kind: 'database',
        digest: 'e'.repeat(64),
        observedAtMs: 99_000,
        targetDigest: context.configDigest,
      },
      {
        kind: 'provider-query',
        digest: 'e'.repeat(64),
        observedAtMs: 99_000,
        targetDigest: context.configDigest,
      },
      {
        kind: 'provider-rehearsal',
        digest: 'f'.repeat(64),
        observedAtMs: 1,
        targetDigest: context.configDigest,
      },
    ],
    host: {
      inventoryDigest: context.inventoryDigest,
      unknownWriters: 0,
      unsettledWork: 0,
      phase: 'prepared',
    },
    payments: {
      scopeDigest: 'e'.repeat(64),
      queriedScopeDigest: 'e'.repeat(64),
      unresolved: 0,
      validUnpaid: 1,
      followupDigest: '1'.repeat(64),
      recovery: 'retry-proven',
      recoveryUntilMs: 200_000,
      rehearsalDigest: 'f'.repeat(64),
    },
  };
}
it('accepts bound current facts but not a success switch', () => {
  expect(() => validateServicesEvidence(evidence(), context)).not.toThrow();
  for (const value of [undefined, null, {}, { verified: true }])
    expect(() => validateServicesEvidence(value, context)).toThrow(denied);
});
function source(report: CutoverEvidence, index: number) {
  const value = report.sources[index];
  if (!value) throw new Error('Missing test source');
  return value;
}
const corruptions: Array<[string, (r: CutoverEvidence) => void]> = [
  [
    'old report',
    (r) => {
      r.observedAtMs = 39_999;
    },
  ],
  [
    'future report',
    (r) => {
      r.observedAtMs = 100_001;
    },
  ],
  [
    'old source inside fresh report',
    (r) => {
      source(r, 0).observedAtMs = 39_999;
    },
  ],
  [
    'future historical rehearsal',
    (r) => {
      source(r, 3).observedAtMs = 100_001;
    },
  ],
  [
    'another attempt',
    (r) => {
      r.attempt = '22222222-2222-4222-8222-222222222222';
    },
  ],
  [
    'another candidate',
    (r) => {
      r.candidate = '0'.repeat(40);
    },
  ],
  [
    'another configuration',
    (r) => {
      r.configDigest = '0'.repeat(64);
    },
  ],
  [
    'another migration',
    (r) => {
      r.migrationDigest = '0'.repeat(64);
    },
  ],
  [
    'another inventory',
    (r) => {
      r.host.inventoryDigest = '0'.repeat(64);
    },
  ],
  [
    'wrong merchant/configuration source',
    (r) => {
      source(r, 2).targetDigest = '0'.repeat(64);
    },
  ],
  [
    'unqueried orders',
    (r) => {
      r.payments.queriedScopeDigest = '0'.repeat(64);
    },
  ],
  [
    'wrong database source',
    (r) => {
      source(r, 1).digest = '0'.repeat(64);
    },
  ],
  [
    'wrong rehearsal',
    (r) => {
      source(r, 3).digest = '0'.repeat(64);
    },
  ],
  [
    'missing source',
    (r) => {
      r.sources.pop();
    },
  ],
  [
    'duplicated source',
    (r) => {
      r.sources[3] = { ...source(r, 2) };
    },
  ],
  [
    'unknown writer',
    (r) => {
      r.host.unknownWriters = 1;
    },
  ],
  [
    'unsettled task',
    (r) => {
      r.host.unsettledWork = 1;
    },
  ],
  [
    'unknown payment',
    (r) => {
      r.payments.unresolved = 1;
    },
  ],
  [
    'negative count',
    (r) => {
      r.payments.validUnpaid = -1;
    },
  ],
  [
    'fractional count',
    (r) => {
      r.payments.validUnpaid = 0.5;
    },
  ],
  [
    'expired maintenance',
    (r) => {
      r.maintenanceEndsAtMs = 100_000;
    },
  ],
  [
    'reconciliation before maintenance',
    (r) => {
      r.reconcileByMs = 110_000;
    },
  ],
  [
    'retry ends before followup',
    (r) => {
      r.payments.recoveryUntilMs = 150_000;
    },
  ],
  [
    'extra success flag',
    (r) => {
      Object.assign(r, { verified: true });
    },
  ],
  [
    'nested success flag',
    (r) => {
      Object.assign(r.host, { verified: true });
    },
  ],
];
it.each(corruptions)('rejects %s', (_name, mutate) => {
  const report = evidence();
  mutate(report);
  expect(() => validateServicesEvidence(report, context)).toThrow(denied);
});
it('requires actual new boot identity and physical fencing at preopen', () => {
  const identity = { candidate: context.candidate, bootId: '2'.repeat(32) };
  const report = evidence();
  report.stage = 'preopen';
  report.identity = identity;
  const expected = { ...context, stage: 'preopen' as const, identity };
  expect(() => validateServicesEvidence(report, expected)).toThrow(denied);
  report.host.phase = 'fenced-stopped';
  expect(() => validateServicesEvidence(report, expected)).not.toThrow();
  expect(() =>
    validateServicesEvidence(report, {
      ...expected,
      identity: { ...identity, bootId: '3'.repeat(32) },
    }),
  ).toThrow(denied);
});

const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
async function writeReport(report = evidence()) {
  const bytes = JSON.stringify(report);
  const { nowMs: _, ...binding } = context;
  const index = {
    ...binding,
    stage: report.stage,
    ...(report.identity ? { identity: report.identity } : {}),
    reportDigest: digest(bytes),
  };
  await realFs.writeFile(join(disk.root, `${context.attempt}.json`), bytes, { mode: 0o640 });
  await realFs.writeFile(join(disk.root, 'active.json'), JSON.stringify(index), { mode: 0o640 });
}
beforeEach(async () => {
  disk.root = realpathSync(await realFs.mkdtemp(join(tmpdir(), 'holaday-services-')));
  await realFs.chmod(disk.root, 0o750);
  disk.owner = 0;
  disk.afterRead = undefined;
});
afterEach(async () => {
  vi.restoreAllMocks();
  disk.afterRead = undefined;
  await realFs.rm(disk.root, { recursive: true });
});
it('production services check reads evidence and refreshes the clock rather than trusting caller time', async () => {
  await writeReport();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000);
  await expect(checkMaintenanceServices(context)).resolves.toBeUndefined();
  clock.mockReturnValue(200_000);
  await expect(checkMaintenanceServices(context)).rejects.toThrow(denied);
});
it('reads a complete protected report and rejects a replaced byte digest', async () => {
  await writeReport();
  expect((await readServicesEvidence(context)).payments.validUnpaid).toBe(1);
  const report = evidence();
  report.payments.validUnpaid = 2;
  await realFs.writeFile(join(disk.root, `${context.attempt}.json`), JSON.stringify(report));
  await expect(readServicesEvidence(context)).rejects.toThrow(denied);
});
it('only reads active preopen context matching the running instance', async () => {
  const report = evidence();
  report.stage = 'preopen';
  report.host.phase = 'fenced-stopped';
  report.identity = { candidate: context.candidate, bootId: '2'.repeat(32) };
  await writeReport(report);
  expect((await readActiveServicesContext(report.identity, context.nowMs)).attempt).toBe(
    context.attempt,
  );
  await expect(
    readActiveServicesContext({ ...report.identity, bootId: '3'.repeat(32) }, context.nowMs),
  ).rejects.toThrow(denied);
  await writeReport();
  await expect(readActiveServicesContext(report.identity, context.nowMs)).rejects.toThrow(denied);
});
it.each([
  'owner',
  'mode',
  'directory',
  'symlink',
  'hardlink',
  'oversized',
  'invalid-utf8',
  'replace-index',
  'replace-report',
])('refuses unsafe protected file: %s', async (fault) => {
  await writeReport();
  const file = join(disk.root, `${context.attempt}.json`);
  if (fault === 'owner') disk.owner = 501;
  if (fault === 'mode') await realFs.chmod(file, 0o660);
  if (fault === 'directory') await realFs.chmod(disk.root, 0o770);
  if (fault === 'symlink') {
    await realFs.rename(file, `${file}.old`);
    await realFs.symlink(`${file}.old`, file);
  }
  if (fault === 'hardlink') await realFs.link(file, `${file}.link`);
  if (fault === 'oversized') await realFs.writeFile(file, 'x'.repeat(262145));
  if (fault === 'invalid-utf8') await realFs.writeFile(file, Buffer.from([0xff]));
  if (fault.startsWith('replace-'))
    disk.afterRead = async () => {
      const target = fault === 'replace-index' ? join(disk.root, 'active.json') : file;
      await realFs.copyFile(target, `${target}.new`);
      await realFs.chmod(`${target}.new`, 0o640);
      await realFs.rename(`${target}.new`, target);
    };
  await expect(readServicesEvidence(context)).rejects.toThrow(denied);
});
