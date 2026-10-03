import { lstat, realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const directory = '/var/lib/holaday/ordinary-maintenance';
const execFileAsync = promisify(execFile);
const system = {
  uid: process.getuid?.(),
  realpath,
  markerExists: async () => {
    try {
      await lstat(directory);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  },
  readHead: async (root) =>
    (
      await execFileAsync(
        'git',
        ['-c', `safe.directory=${root}`, '-C', root, 'rev-parse', '--verify', 'HEAD'],
        {
          encoding: 'utf8',
          timeout: 10000,
          maxBuffer: 4096,
        },
      )
    ).stdout.trim(),
  readRecord: async () => {
    const { readOrdinaryMaintenanceRecord } = await import(
      '../apps/orchestrator/src/execution/ordinary-maintenance-store.ts'
    );
    return readOrdinaryMaintenanceRecord(directory);
  },
};

/** Run before either production entrypoint; application still checks/adopts its
 * own marker and writer lock. This preflight is not authority to open admission. */
export async function verifyMaintenanceStart({ role, root, env }, io = system) {
  let exists;
  try {
    exists = await io.markerExists();
  } catch {
    throw new Error('MAINTENANCE_START_STATE');
  }
  const configured =
    env.HOLADAY_ORDINARY_MAINTENANCE !== undefined || env.HOLADAY_ORDINARY_CANDIDATE !== undefined;
  if (!exists && !configured) return 'legacy';
  const candidate = env.HOLADAY_ORDINARY_CANDIDATE;
  if (
    !['main', 'worker'].includes(role) ||
    env.HOLADAY_ORDINARY_MAINTENANCE !== '1' ||
    !/^[a-f0-9]{40}$/.test(candidate ?? '') ||
    env.HOLADAY_POOL_BOOT !== undefined ||
    env.HOLADAY_POOL_CANDIDATE !== undefined
  )
    throw new Error('MAINTENANCE_START_MODE');
  try {
    if (
      io.uid !== 998 ||
      root !== `/opt/holaday-releases/${candidate}` ||
      (await io.realpath(root)) !== root ||
      (await io.readHead(root)) !== candidate
    )
      throw new Error('identity');
  } catch {
    throw new Error('MAINTENANCE_START_IDENTITY');
  }
  let record;
  try {
    record = await io.readRecord();
  } catch {
    throw new Error('MAINTENANCE_START_STATE');
  }
  if (role === 'worker') {
    if (
      record?.mode !== 'serving' ||
      record.needsReconciliation !== true ||
      record.identity?.candidate !== candidate
    )
      throw new Error('MAINTENANCE_WORKER_NOT_SERVING');
  } else if (record?.mode !== 'closed' || record.needsReconciliation !== false) {
    throw new Error('MAINTENANCE_START_STATE');
  }
  return 'ordinary';
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error('MAINTENANCE_START_MODE');
    await verifyMaintenanceStart({
      role: process.argv[2],
      root: process.argv[3],
      env: process.env,
    });
  } catch (error) {
    process.stderr.write(
      `${/^MAINTENANCE_[A-Z_]+$/.test(error?.message) ? error.message : 'MAINTENANCE_START_UNPROVEN'}\n`,
    );
    process.exitCode = 1;
  }
}
