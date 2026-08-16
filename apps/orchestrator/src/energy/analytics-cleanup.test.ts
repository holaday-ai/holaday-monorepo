import { afterEach, describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-08-16T12:00:00.000Z');

type TableName = 'receipts' | 'visitors' | 'metrics';

interface CleanupCall {
  table: TableName;
  now: Date;
  limit: number;
}

class CleanupStore {
  readonly calls: CleanupCall[] = [];
  receiptCounts: Array<number | Error> = [0];
  visitorCounts: Array<number | Error> = [0];
  metricCounts: Array<number | Error> = [0];

  deleteExpiredReceipts(now: Date, limit: number) {
    return this.take('receipts', this.receiptCounts, now, limit);
  }

  deleteExpiredVisitors(now: Date, limit: number) {
    return this.take('visitors', this.visitorCounts, now, limit);
  }

  deleteExpiredMetrics(now: Date, limit: number) {
    return this.take('metrics', this.metricCounts, now, limit);
  }

  private async take(
    table: TableName,
    values: Array<number | Error>,
    now: Date,
    limit: number,
  ): Promise<number> {
    this.calls.push({ table, now, limit });
    const value = values.shift() ?? 0;
    if (value instanceof Error) throw value;
    return value;
  }
}

interface CleanupModule {
  cleanupEnergyAnalytics(options: {
    store: CleanupStore;
    logger: { warn: ReturnType<typeof vi.fn> };
    now: Date;
  }): Promise<{ receipts: number; visitors: number; metrics: number }>;
  startEnergyAnalyticsCleanup(options: {
    store: CleanupStore;
    logger: { warn: ReturnType<typeof vi.fn> };
    now?: () => Date;
  }): void;
  stopEnergyAnalyticsCleanup(): void;
}

async function loadCleanup(): Promise<CleanupModule | null> {
  const modulePath = './analytics-cleanup.js';
  return import(modulePath).catch(() => null) as Promise<CleanupModule | null>;
}

afterEach(async () => {
  const cleanup = await loadCleanup();
  cleanup?.stopEnergyAnalyticsCleanup();
  vi.restoreAllMocks();
});

describe('energy analytics cleanup', () => {
  it('deletes each table in bounded batches and stops after a short batch', async () => {
    const cleanup = await loadCleanup();
    expect(cleanup).not.toBeNull();
    if (!cleanup) return;
    const store = new CleanupStore();
    store.receiptCounts = [500, 12];
    store.visitorCounts = [0];
    store.metricCounts = [500, 500, 500, 500, 500];

    const result = await cleanup.cleanupEnergyAnalytics({
      store,
      logger: { warn: vi.fn() },
      now: NOW,
    });

    expect(result).toEqual({ receipts: 512, visitors: 0, metrics: 2500 });
    expect(store.calls.every((call) => call.limit === 500)).toBe(true);
    expect(store.calls.every((call) => call.now === NOW)).toBe(true);
    expect(store.calls.filter((call) => call.table === 'metrics')).toHaveLength(5);
  });

  it('isolates table failures and emits one warning without error messages', async () => {
    const cleanup = await loadCleanup();
    expect(cleanup).not.toBeNull();
    if (!cleanup) return;
    const store = new CleanupStore();
    store.receiptCounts = [new TypeError('contains private database detail')];
    store.visitorCounts = [3];
    store.metricCounts = [new RangeError('another private detail')];
    const logger = { warn: vi.fn() };

    await expect(cleanup.cleanupEnergyAnalytics({ store, logger, now: NOW })).resolves.toEqual({
      receipts: 0,
      visitors: 3,
      metrics: 0,
    });
    expect(store.calls.map((call) => call.table)).toEqual(['receipts', 'visitors', 'metrics']);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      {
        feature: 'energy_analytics_cleanup',
        errorNames: ['TypeError', 'RangeError'],
      },
      'energy analytics cleanup partially failed',
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/private|database detail/);
  });

  it('runs hourly with an unrefed idempotent timer and clears it on stop', async () => {
    const cleanup = await loadCleanup();
    expect(cleanup).not.toBeNull();
    if (!cleanup) return;
    const timer = { unref: vi.fn() };
    const interval = vi.spyOn(globalThis, 'setInterval').mockReturnValue(timer as never);
    const clear = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    const store = new CleanupStore();
    const options = { store, logger: { warn: vi.fn() }, now: () => NOW };

    cleanup.startEnergyAnalyticsCleanup(options);
    cleanup.startEnergyAnalyticsCleanup(options);
    await Promise.resolve();

    expect(interval).toHaveBeenCalledOnce();
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1_000);
    expect(timer.unref).toHaveBeenCalledOnce();
    expect(store.calls.length).toBeGreaterThan(0);

    cleanup.stopEnergyAnalyticsCleanup();
    expect(clear).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledWith(timer);
  });

  it('continues bounded cleanup passes while a table may still have expired rows', async () => {
    const cleanup = await loadCleanup();
    expect(cleanup).not.toBeNull();
    if (!cleanup) return;
    const intervalTimer = { unref: vi.fn() };
    vi.spyOn(globalThis, 'setInterval').mockReturnValue(intervalTimer as never);
    const backlogTimer = { unref: vi.fn() };
    const timeout = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(backlogTimer as never);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
    const store = new CleanupStore();
    store.receiptCounts = [500, 500, 500, 500, 500, 1];
    store.visitorCounts = [0, 0];
    store.metricCounts = [0, 0];

    cleanup.startEnergyAnalyticsCleanup({ store, logger: { warn: vi.fn() }, now: () => NOW });
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();

    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 1_000);
    expect(backlogTimer.unref).toHaveBeenCalledOnce();
    const continueCleanup = timeout.mock.calls.find((call) => call[1] === 1_000)?.[0];
    expect(continueCleanup).toBeTypeOf('function');
    if (typeof continueCleanup !== 'function') return;

    continueCleanup();
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    expect(store.calls.filter((call) => call.table === 'receipts')).toHaveLength(6);
    expect(
      store.calls.filter((call) => call.table === 'receipts').map((call) => call.limit),
    ).toEqual([500, 500, 500, 500, 500, 500]);
  });
});
