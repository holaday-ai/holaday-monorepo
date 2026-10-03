export const ORDINARY_MAINTENANCE_DIRECTORY = '/var/lib/holaday/ordinary-maintenance';

export function resolveOrdinaryMaintenanceMode(
  env: NodeJS.ProcessEnv,
  directory = ORDINARY_MAINTENANCE_DIRECTORY,
): boolean {
  let exists = true;
  try {
    fs.lstatSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('MAINTENANCE_STATE_UNAVAILABLE');
    exists = false;
  }
  const configured =
    env.HOLADAY_ORDINARY_MAINTENANCE !== undefined || env.HOLADAY_ORDINARY_CANDIDATE !== undefined;
  if (!exists && !configured) return false;
  if (env.HOLADAY_POOL_BOOT !== undefined || env.HOLADAY_POOL_CANDIDATE !== undefined)
    throw new Error('MAINTENANCE_MODE_CONFLICT');
  if (
    env.HOLADAY_ORDINARY_MAINTENANCE !== '1' ||
    !/^[a-f0-9]{40}$/.test(env.HOLADAY_ORDINARY_CANDIDATE ?? '')
  )
    throw new Error('MAINTENANCE_CONFIGURATION_REQUIRED');
  readOrdinaryMaintenanceRecord(directory);
  return true;
}
import fs from 'node:fs';
import { readOrdinaryMaintenanceRecord } from './ordinary-maintenance-store.js';
