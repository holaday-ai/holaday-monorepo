// Importable diagnostic contract; importing never connects to a database or writes data.
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  checkMaintenanceServices,
  verifyProductionMaintenanceReadiness,
} from '../src/execution/ordinary-maintenance-readiness.js';
import {
  type ServicesContext,
  parseServicesContext,
} from '../src/execution/ordinary-maintenance-services.js';
import { readOrdinaryMaintenanceRecord } from '../src/execution/ordinary-maintenance-store.js';
export { verifyMaintenanceReadiness } from '../src/execution/ordinary-maintenance-readiness.js';

export async function runMaintenanceReadinessCommand(
  args: string[],
  operations: {
    services(context: ServicesContext): Promise<void>;
    readIdentity(): { candidate: string; bootId: string };
    verify(
      identity: { candidate: string; bootId: string },
      expected: { candidate: string; bootId: string },
      context: ServicesContext,
    ): Promise<void>;
    closeDatabase(): Promise<void>;
  },
): Promise<void> {
  const [command, attempt, candidate, configDigest, migrationDigest, inventoryDigest] = args;
  const first = command === 'services-first-cutover' || command === 'verify-first-cutover';
  const verify = command === 'verify' || command === 'verify-first-cutover';
  const bootId = verify ? args[6] : undefined;
  const riskDigest = first ? args[verify ? 7 : 6] : undefined;
  if (
    !(
      (command === 'services' && args.length === 6) ||
      (command === 'verify' && args.length === 7) ||
      (command === 'services-first-cutover' && args.length === 7) ||
      (command === 'verify-first-cutover' && args.length === 8)
    )
  )
    throw new Error('MAINTENANCE_READINESS_INPUT');
  let context: ServicesContext;
  try {
    context = parseServicesContext({
      attempt,
      candidate,
      configDigest,
      migrationDigest,
      inventoryDigest,
      stage: verify ? 'preopen' : 'prepare',
      nowMs: Date.now(),
      ...(verify ? { identity: { candidate, bootId } } : {}),
      ...(first ? { kind: 'first-cutover', riskDigest } : {}),
    });
  } catch {
    throw new Error('MAINTENANCE_READINESS_INPUT');
  }
  if (!verify) return operations.services(context);
  const expected = context.identity;
  if (!expected) throw new Error('MAINTENANCE_READINESS_INPUT');
  const identity = operations.readIdentity();
  if (identity.candidate !== expected.candidate || identity.bootId !== expected.bootId)
    throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
  try {
    await operations.verify(identity, expected, context);
  } finally {
    await operations.closeDatabase();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runMaintenanceReadinessCommand(process.argv.slice(2), {
    services: checkMaintenanceServices,
    readIdentity: () =>
      readOrdinaryMaintenanceRecord('/var/lib/holaday/ordinary-maintenance').identity,
    verify: verifyProductionMaintenanceReadiness,
    closeDatabase: async () => {
      const { pool } = await import('../src/db/client.js');
      await pool.end();
    },
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    process.stderr.write(
      `${/^MAINTENANCE_[A-Z_]+$/.test(message) ? message : 'MAINTENANCE_READINESS_UNPROVEN'}\n`,
    );
    process.exitCode = 1;
  });
}
