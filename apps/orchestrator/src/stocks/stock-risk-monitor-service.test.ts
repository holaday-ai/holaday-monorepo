import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { ValidatedStockTaskContext } from './stock-task-context.js';
import type { StockRiskRadarResult } from './stock-risk-radar-service.js';
import {
  createStockRiskMonitor,
  listStockRiskMonitors,
  type StockRiskMonitorRepository,
  type StockRiskMonitorView,
} from './stock-risk-monitor-service.js';

const context: ValidatedStockTaskContext = {
  snapshotId: 'stkshot_1234567890abcdef12345678',
  dataAsOf: '2026-08-19',
  trustMode: 'current',
  evidenceIds: [],
  snapshotPayload: {
    generatedAt: '2026-08-19T09:00:00.000Z',
    dataAsOf: '2026-08-19',
    watchlistStocks: [
      { symbol: '603528', name: '多伦科技', market: 'A' },
      { symbol: '600497', name: '驰宏锌锗', market: 'A' },
    ],
    marketIndices: [],
    sectors: [],
    news: [],
  },
};

const radar: StockRiskRadarResult = {
  snapshotId: context.snapshotId,
  dataAsOf: context.dataAsOf,
  generatedAt: '2026-08-19T09:00:01.000Z',
  requestedStockCount: 2,
  checkedStockCount: 2,
  truncated: false,
  signals: [{
    signalId: 'signal-pledge',
    evidenceId: 'evidence-pledge',
    symbol: '603528',
    name: '多伦科技',
    key: 'pledge',
    label: '质押',
    severity: '警示',
    fact: '质押比例达到阈值',
    trigger: '质押比例达到 30%',
    whyRelevant: '需要继续观察',
    observedAt: '2026-08-19',
    sourceDataAsOf: '2026-08-19',
    source: 'akshare',
    fetchedAt: '2026-08-19T09:00:01.000Z',
    evidenceUrl: null,
  }],
  checks: [
    'pledge',
    'goodwill',
    'forecast',
    'insider',
    'announcements',
  ].flatMap((key) => context.snapshotPayload.watchlistStocks.map((stock) => ({
    symbol: stock.symbol,
    name: String(stock.name),
    key: key as 'pledge' | 'goodwill' | 'forecast' | 'insider' | 'announcements',
    status: 'checked' as const,
    source: 'akshare',
    fetchedAt: '2026-08-19T09:00:01.000Z',
    sourceDataAsOf: '2026-08-19',
    errorCode: null,
  }))),
};

function monitor(overrides: Partial<StockRiskMonitorView> = {}): StockRiskMonitorView {
  return {
    monitorId: 'stockRiskMonitor_123',
    plannedTaskId: 'plannedTask_123',
    symbol: '603528',
    status: 'active',
    nextRunAt: new Date('2026-08-20T08:30:00.000Z'),
    lastRunAt: null,
    lastOutcome: null,
    lastSummary: null,
    ...overrides,
  };
}

function repository(): StockRiskMonitorRepository & {
  createInput: Parameters<StockRiskMonitorRepository['createOrGet']>[0] | null;
} {
  const repo = {
    createInput: null as Parameters<StockRiskMonitorRepository['createOrGet']>[0] | null,
    async createOrGet(input: Parameters<StockRiskMonitorRepository['createOrGet']>[0]) {
      repo.createInput = input;
      return { created: true, monitor: monitor() };
    },
    listByUserSymbols: vi.fn(async () => [monitor()]),
  };
  return repo;
}

describe('stock risk monitor service', () => {
  it('creates a daily plan from server-resolved identity and a silent current baseline', async () => {
    const repo = repository();
    const validateContext = vi.fn(async () => context);
    const loadRadar = vi.fn(async () => radar);

    const result = await createStockRiskMonitor({
      userId: 7,
      input: {
        snapshotId: context.snapshotId,
        dataAsOf: context.dataAsOf,
        trustMode: 'current',
        symbol: '603528',
      },
      repository: repo,
      validateContext,
      loadRadar,
      now: new Date('2026-08-19T09:00:00.000Z'),
    });

    expect(result.created).toBe(true);
    expect(validateContext).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      intent: '监控 603528 风险变化',
    }));
    expect(repo.createInput).toMatchObject({
      userId: 7,
      symbol: '603528',
      name: '多伦科技',
      market: 'A',
      dataAsOf: '2026-08-19',
      nextRunAt: new Date('2026-08-20T08:30:00.000Z'),
      baselineSignals: [{ key: 'pledge', severity: '警示' }],
      baselineUnavailableChecks: [],
    });
  });

  it('rejects non-current trust before creating a monitor', async () => {
    const repo = repository();
    await expect(createStockRiskMonitor({
      userId: 7,
      input: {
        snapshotId: context.snapshotId,
        dataAsOf: context.dataAsOf,
        trustMode: 'delayed' as 'current',
        symbol: '603528',
      },
      repository: repo,
      validateContext: vi.fn(async () => context),
      loadRadar: vi.fn(async () => radar),
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' } satisfies Partial<TRPCError>);
    expect(repo.createInput).toBeNull();
  });

  it('rejects a symbol missing from the owned trusted watchlist', async () => {
    const repo = repository();
    await expect(createStockRiskMonitor({
      userId: 7,
      input: {
        snapshotId: context.snapshotId,
        dataAsOf: context.dataAsOf,
        trustMode: 'current',
        symbol: '600519',
      },
      repository: repo,
      validateContext: vi.fn(async () => context),
      loadRadar: vi.fn(async () => radar),
    })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: '股票不在当前可信关注列表中' });
  });

  it('returns repository idempotency without manufacturing a second plan', async () => {
    const repo = repository();
    repo.createOrGet = vi.fn(async () => ({ created: false, monitor: monitor() }));
    const args = {
      userId: 7,
      input: {
        snapshotId: context.snapshotId,
        dataAsOf: context.dataAsOf,
        trustMode: 'current' as const,
        symbol: '603528',
      },
      repository: repo,
      validateContext: vi.fn(async () => context),
      loadRadar: vi.fn(async () => radar),
    };

    expect(await createStockRiskMonitor(args)).toMatchObject({
      created: false,
      monitor: { monitorId: 'stockRiskMonitor_123' },
    });
    expect(repo.createOrGet).toHaveBeenCalledTimes(1);
  });

  it('lists only symbols present in the validated caller snapshot', async () => {
    const repo = repository();
    await listStockRiskMonitors({
      userId: 7,
      input: {
        snapshotId: context.snapshotId,
        dataAsOf: context.dataAsOf,
        trustMode: 'current',
      },
      repository: repo,
      validateContext: vi.fn(async () => context),
    });
    expect(repo.listByUserSymbols).toHaveBeenCalledWith(7, ['603528', '600497']);
  });
});
