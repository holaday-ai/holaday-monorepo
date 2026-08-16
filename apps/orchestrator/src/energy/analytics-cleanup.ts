import type { EnergyAnalyticsCleanupStore } from './analytics-store.js';

const CLEANUP_BATCH_SIZE = 500;
const CLEANUP_MAX_ROUNDS = 5;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

interface CleanupLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

interface CleanupOptions {
  store: EnergyAnalyticsCleanupStore;
  logger: CleanupLogger;
  now?: Date;
}

interface StartCleanupOptions {
  store: EnergyAnalyticsCleanupStore;
  logger: CleanupLogger;
  now?: () => Date;
}

interface CleanupResult {
  receipts: number;
  visitors: number;
  metrics: number;
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export async function cleanupEnergyAnalytics({
  store,
  logger,
  now = new Date(),
}: CleanupOptions): Promise<CleanupResult> {
  const errors: string[] = [];
  const result: CleanupResult = { receipts: 0, visitors: 0, metrics: 0 };
  const sweeps = [
    ['receipts', store.deleteExpiredReceipts.bind(store)],
    ['visitors', store.deleteExpiredVisitors.bind(store)],
    ['metrics', store.deleteExpiredMetrics.bind(store)],
  ] as const;

  for (const [table, deleteBatch] of sweeps) {
    try {
      result[table] = await sweepTable(deleteBatch, now);
    } catch (error) {
      errors.push(error instanceof Error ? error.name : 'UnknownError');
    }
  }

  if (errors.length > 0) {
    logger.warn(
      { feature: 'energy_analytics_cleanup', errorNames: errors },
      'energy analytics cleanup partially failed',
    );
  }
  return result;
}

export function startEnergyAnalyticsCleanup({
  store,
  logger,
  now = () => new Date(),
}: StartCleanupOptions): void {
  if (cleanupTimer) return;
  const run = () => cleanupEnergyAnalytics({ store, logger, now: now() });
  void run();
  cleanupTimer = setInterval(() => void run(), CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export function stopEnergyAnalyticsCleanup(): void {
  if (!cleanupTimer) return;
  clearInterval(cleanupTimer);
  cleanupTimer = null;
}

async function sweepTable(
  deleteBatch: (now: Date, limit: number) => Promise<number>,
  now: Date,
): Promise<number> {
  let total = 0;
  for (let round = 0; round < CLEANUP_MAX_ROUNDS; round += 1) {
    const deleted = await deleteBatch(now, CLEANUP_BATCH_SIZE);
    total += deleted;
    if (deleted < CLEANUP_BATCH_SIZE) break;
  }
  return total;
}
