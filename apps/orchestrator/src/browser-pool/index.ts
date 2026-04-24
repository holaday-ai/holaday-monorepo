/**
 * Phase 8 browser-pool public surface.
 *
 * Consumers should import from this module only — the individual
 * files are implementation details and may move. Most of the
 * orchestrator uses just BrowserPool + PoolCapacityError.
 */

export { BrowserPool, PoolCapacityError, userIdToDirName } from './browser-pool.js';
export { reapOrphans, type ReaperResult } from './reaper.js';
export type {
  BrowserInstance,
  BrowserSlot,
  InstanceStatus,
  PoolConfig,
  PoolStats,
} from './types.js';
