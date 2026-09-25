// Importable diagnostic contract; importing never connects to a database or writes data.
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  checkMaintenanceServices,
  verifyProductionMaintenanceReadiness,
} from '../src/execution/ordinary-maintenance-readiness.js';
import { readOrdinaryMaintenanceRecord } from '../src/execution/ordinary-maintenance-store.js';
export { verifyMaintenanceReadiness } from '../src/execution/ordinary-maintenance-readiness.js';

export async function runMaintenanceReadinessCommand(
  args: string[],
  operations: {
    services(): Promise<void>;
    readIdentity(): { candidate: string; bootId: string };
    verify(
      identity: { candidate: string; bootId: string },
      expected: { candidate: string; bootId: string },
    ): Promise<void>;
    closeDatabase(): Promise<void>;
  },
): Promise<void> {
  if (args.length === 1 && args[0] === 'services') return operations.services();
  if (
    args.length !== 2 ||
    !/^[a-f0-9]{40}$/.test(args[0] ?? '') ||
    !/^[a-f0-9]{32}$/.test(args[1] ?? '')
  )
    throw new Error('MAINTENANCE_READINESS_INPUT');
  const expected = { candidate: args[0]!, bootId: args[1]! };
  const identity = operations.readIdentity();
  if (identity.candidate !== expected.candidate || identity.bootId !== expected.bootId)
    throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
  try {
    await operations.verify(identity, expected);
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
