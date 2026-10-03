import { pathToFileURL } from 'node:url';
import { requestMaintenance } from './browser-maintenance-client.mjs';

export async function runMaintenanceCommand(args, seams) {
  const [op, candidate, bootId] = args;
  const discovery = args.length === 1 && op === 'status';
  if (
    !discovery &&
    (args.length !== 3 ||
      !['status', 'close', 'wait', 'open'].includes(op) ||
      !/^[a-f0-9]{40}$/.test(candidate ?? '') ||
      !/^[a-f0-9]{32}$/.test(bootId ?? ''))
  )
    throw new Error('MAINTENANCE_CLI_INPUT');
  const identity = discovery ? await seams.readIdentity() : { candidate, bootId };
  const snapshot = await seams.request({ identity, op, timeoutMs: op === 'wait' ? 600000 : 5000 });
  return { protocol: 1, ...snapshot, idle: snapshot.counts.idle };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const directory = '/var/lib/holaday/ordinary-maintenance';
    const result = await runMaintenanceCommand(process.argv.slice(2), {
      readIdentity: async () => {
        const { readOrdinaryMaintenanceRecord } = await import(
          '../apps/orchestrator/src/execution/ordinary-maintenance-store.ts'
        );
        return readOrdinaryMaintenanceRecord(directory).identity;
      },
      request: (command) =>
        requestMaintenance({ ...command, socketPath: `${directory}/control.sock` }),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    // Do not expose filesystem, database, URL or credential-bearing error text.
    const code = /^MAINTENANCE_[A-Z_]+$/.test(error?.message)
      ? error.message
      : 'MAINTENANCE_CONTROL_UNPROVEN';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
