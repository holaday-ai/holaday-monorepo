import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { StockRiskRadarResult } from '../../stocks/stock-risk-radar-service.js';
import { runTrustedStockRiskRadar, stockRiskRadarInputSchema } from './stocks-risk-radar.js';
import { stocksRouter } from './stocks.js';

const SNAPSHOT_ID = 'stkshot_0123456789abcdef01234567';
const DATA_AS_OF = '2026-08-17';

function snapshot(mode: 'current' | 'delayed' | 'historical' | 'unavailable' = 'current') {
  return {
    updatedAt: '2026-08-17T02:05:00.000Z',
    watchlistStocks: [
      { symbol: '600001', name: '测试股份', market: 'A' },
      { symbol: '000002', name: '示例科技', market: 'A' },
    ],
    marketIndices: [],
    sectors: [],
    news: [],
    trust: {
      snapshotId: SNAPSHOT_ID,
      generatedAt: '2026-08-17T02:05:00.000Z',
      dataAsOf: DATA_AS_OF,
      mode,
      evidenceIds: [],
    },
  };
}

function snapshotDb(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(async () => rows.map((snapshotJson) => ({ snapshotJson }))),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return { select: vi.fn(() => chain) };
}

function radarResult(): StockRiskRadarResult {
  return {
    snapshotId: SNAPSHOT_ID,
    dataAsOf: DATA_AS_OF,
    generatedAt: '2026-08-17T12:00:00.000Z',
    requestedStockCount: 2,
    checkedStockCount: 2,
    truncated: false,
    signals: [
      {
        signalId: 'risk_signal_0123456789abcdef01234567',
        evidenceId: 'risk:0123456789abcdef01234567',
        symbol: '600001',
        name: '测试股份',
        key: 'pledge',
        label: '质押',
        severity: '高风险',
        fact: '不应进入日志的详细风险事实',
        trigger: '质押比例超过 50%',
        whyRelevant: '不应进入日志的相关性解释',
        observedAt: '2026-08-14',
        sourceDataAsOf: '2026-08-14',
        source: 'akshare:pledge',
        fetchedAt: '2026-08-17T11:30:00.000Z',
        evidenceUrl: null,
      },
    ],
    checks: [
      {
        symbol: '600001',
        name: '测试股份',
        key: 'pledge',
        status: 'unavailable',
        source: 'akshare:pledge',
        fetchedAt: '2026-08-17T11:30:00.000Z',
        sourceDataAsOf: null,
        errorCode: 'UPSTREAM_UNAVAILABLE',
      },
    ],
  };
}

describe('stock risk radar procedure', () => {
  it('exposes the validated risk radar contract on the stocks router', async () => {
    const caller = stocksRouter.createCaller({
      userId: 'usr_risk_radar',
      db: {},
      logger: { info: vi.fn(), warn: vi.fn() },
    } as never);

    await expect(
      caller.riskRadar({
        snapshotId: 'invalid',
        dataAsOf: DATA_AS_OF,
        trustMode: 'current',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it.each(['current', 'delayed', 'historical'] as const)(
    'validates an owned %s snapshot and inspects only its watchlist',
    async (trustMode) => {
      const execute = vi.fn(async () => radarResult());
      const logger = { info: vi.fn(), warn: vi.fn() };

      const result = await runTrustedStockRiskRadar({
        db: snapshotDb([snapshot(trustMode)]) as never,
        userId: 7,
        logger,
        client: {} as never,
        input: { snapshotId: SNAPSHOT_ID, dataAsOf: DATA_AS_OF, trustMode },
        execute,
      });

      expect(result).toEqual(radarResult());
      expect(execute).toHaveBeenCalledWith({
        client: {},
        snapshotId: SNAPSHOT_ID,
        dataAsOf: DATA_AS_OF,
        stocks: [
          { symbol: '600001', name: '测试股份', market: 'A' },
          { symbol: '000002', name: '示例科技', market: 'A' },
        ],
      });
      const logged = JSON.stringify(logger.info.mock.calls);
      expect(logged).toContain(SNAPSHOT_ID);
      expect(logged).toContain('unavailableCheckCount');
      expect(logged).not.toContain('测试股份');
      expect(logged).not.toContain('详细风险事实');
      expect(logged).not.toContain('相关性解释');
    },
  );

  it.each([
    {
      rows: [],
      input: { snapshotId: SNAPSHOT_ID, dataAsOf: DATA_AS_OF, trustMode: 'current' as const },
    },
    {
      rows: [snapshot('unavailable')],
      input: { snapshotId: SNAPSHOT_ID, dataAsOf: DATA_AS_OF, trustMode: 'current' as const },
    },
    {
      rows: [snapshot()],
      input: { snapshotId: SNAPSHOT_ID, dataAsOf: '2026-08-16', trustMode: 'current' as const },
    },
    {
      rows: [snapshot()],
      input: { snapshotId: SNAPSHOT_ID, dataAsOf: DATA_AS_OF, trustMode: 'delayed' as const },
    },
  ])(
    'rejects an unowned, unavailable, or mismatched snapshot before fetching',
    async ({ rows, input }) => {
      const execute = vi.fn();

      await expect(
        runTrustedStockRiskRadar({
          db: snapshotDb(rows) as never,
          userId: 7,
          logger: { info: vi.fn(), warn: vi.fn() },
          client: {} as never,
          input,
          execute,
        }),
      ).rejects.toBeInstanceOf(TRPCError);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed identifiers and unavailable client modes at the schema boundary', () => {
    expect(
      stockRiskRadarInputSchema.safeParse({
        snapshotId: 'stkshot_bad',
        dataAsOf: DATA_AS_OF,
        trustMode: 'current',
      }).success,
    ).toBe(false);
    expect(
      stockRiskRadarInputSchema.safeParse({
        snapshotId: SNAPSHOT_ID,
        dataAsOf: '20260817',
        trustMode: 'current',
      }).success,
    ).toBe(false);
    expect(
      stockRiskRadarInputSchema.safeParse({
        snapshotId: SNAPSHOT_ID,
        dataAsOf: DATA_AS_OF,
        trustMode: 'unavailable',
      }).success,
    ).toBe(false);
  });
});
