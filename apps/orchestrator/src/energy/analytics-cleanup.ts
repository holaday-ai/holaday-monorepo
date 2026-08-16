import type { EnergyAnalyticsCleanupStore } from './analytics-store.js';

const CLEANUP_BATCH_SIZE = 500;
const CLEANUP_MAX_ROUNDS = 5;
const CLEANUP_PASS_CAPACITY = CLEANUP_BATCH_SIZE * CLEANUP_MAX_ROUNDS;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;
const CLEANUP_BACKLOG_DELAY_MS = 1_000;

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

let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let cleanupBacklogTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupGeneration = 0;

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
  if (cleanupInterval) return;
  const generation = ++cleanupGeneration;
  let running = false;
  let rerunRequested = false;

  async function run(): Promise<void> {
    if (generation !== cleanupGeneration) return;
    if (running) {
      rerunRequested = true;
      return;
    }
    running = true;
    try {
      const result = await cleanupEnergyAnalytics({ store, logger, now: now() });
      if (generation !== cleanupGeneration) return;
      if (Object.values(result).some((deleted) => deleted >= CLEANUP_PASS_CAPACITY)) {
        scheduleBacklogPass();
      }
    } finally {
      running = false;
      if (generation === cleanupGeneration && rerunRequested) {
        rerunRequested = false;
        scheduleBacklogPass();
      }
    }
  }

  function scheduleBacklogPass(): void {
    if (generation !== cleanupGeneration || cleanupBacklogTimer) return;
    cleanupBacklogTimer = setTimeout(() => {
      cleanupBacklogTimer = null;
      void run();
    }, CLEANUP_BACKLOG_DELAY_MS);
    cleanupBacklogTimer.unref?.();
  }

  void run();
  cleanupInterval = setInterval(() => void run(), CLEANUP_INTERVAL_MS);
  cleanupInterval.unref?.();
}

export function stopEnergyAnalyticsCleanup(): void {
  cleanupGeneration += 1;
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (cleanupBacklogTimer) {
    clearTimeout(cleanupBacklogTimer);
    cleanupBacklogTimer = null;
  }
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
