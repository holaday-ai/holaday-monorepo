import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { StockScreeningFreshnessError } from '../../stocks/stock-screening-service.js';
import {
  previewStockScreening,
  runStockScreeningInputSchema,
  runTrustedStockScreening,
  type RunStockScreeningInput,
} from './stocks-screening.js';
import { stocksRouter } from './stocks.js';

const SNAPSHOT_ID = 'stkshot_0123456789abcdef01234567';
const DATA_AS_OF = '2026-08-17';

type ReadyCriterion = RunStockScreeningInput['criteria'][number];

function criterion(overrides: Partial<ReadyCriterion> = {}): ReadyCriterion {
  return {
    id: 'pe-1',
    field: 'pe_ttm',
    operator: 'lte',
    value: 30,
    unit: null,
    label: '市盈率不超过 30',
    sourceField: '市盈率TTM',
    status: 'ready',
    ...overrides,
  };
}

function snapshot(mode: 'current' | 'delayed' | 'historical' | 'unavailable' = 'current') {
  return {
    updatedAt: '2026-08-17T02:05:00.000Z',
    watchlistStocks: [],
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

function executeResult() {
  return {
    snapshotId: SNAPSHOT_ID,
    dataAsOf: DATA_AS_OF,
    coverage: {
      universeCount: 5_200,
      marketPrefilterCount: 12,
      deepCheckedCount: 12,
      deepCheckLimit: 20 as const,
      truncated: false,
    },
    candidates: [],
    zeroResult: true,
  };
}

describe('stock screening procedures', () => {
  it('exposes preview and run contracts on the stocks router', async () => {
    const caller = stocksRouter.createCaller({
      userId: 'usr_screening',
      db: {},
      logger: { info: vi.fn(), warn: vi.fn() },
    } as never);
    await expect(caller.previewScreening({ prompt: '排除ST，市盈率低于30' })).resolves.toEqual({
      criteria: expect.arrayContaining([
        expect.objectContaining({ field: 'exclude_st' }),
        expect.objectContaining({ field: 'pe_ttm' }),
      ]),
      unparsedClauses: [],
    });
    await expect(caller.runScreening({
      snapshotId: SNAPSHOT_ID,
      dataAsOf: DATA_AS_OF,
      criteria: [],
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('previews editable criteria and keeps unsupported clauses visible', () => {
    expect(previewStockScreening('排除ST，市盈率低于30，最好是行业龙头')).toEqual({
      criteria: [
        expect.objectContaining({ field: 'exclude_st', value: true, status: 'ready' }),
        expect.objectContaining({ field: 'pe_ttm', value: 30, status: 'ready' }),
      ],
      unparsedClauses: ['最好是行业龙头'],
    });
  });

  it.each(['historical', 'delayed', 'unavailable'] as const)(
    'rejects a %s snapshot before screening fetches',
    async (mode) => {
      const execute = vi.fn();
      await expect(runTrustedStockScreening({
        db: snapshotDb([snapshot(mode)]) as never,
        userId: 7,
        logger: { info: vi.fn(), warn: vi.fn() },
        client: {} as never,
        input: { snapshotId: SNAPSHOT_ID, dataAsOf: DATA_AS_OF, criteria: [criterion()] },
        execute,
      })).rejects.toBeInstanceOf(TRPCError);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('rejects an unowned snapshot before screening fetches', async () => {
    const execute = vi.fn();
    await expect(runTrustedStockScreening({
      db: snapshotDb([]) as never,
      userId: 7,
      logger: { info: vi.fn(), warn: vi.fn() },
      client: {} as never,
      input: { snapshotId: SNAPSHOT_ID, dataAsOf: DATA_AS_OF, criteria: [criterion()] },
      execute,
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a mismatched snapshot date before screening fetches', async () => {
    const execute = vi.fn();
    await expect(runTrustedStockScreening({
      db: snapshotDb([snapshot()]) as never,
      userId: 7,
      logger: { info: vi.fn(), warn: vi.fn() },
      client: {} as never,
      input: { snapshotId: SNAPSHOT_ID, dataAsOf: '2026-08-16', criteria: [criterion()] },
      execute,
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects empty, oversized, and incomplete criterion sets', () => {
    expect(runStockScreeningInputSchema.safeParse({
      snapshotId: SNAPSHOT_ID,
      dataAsOf: DATA_AS_OF,
      criteria: [],
    }).success).toBe(false);
    expect(runStockScreeningInputSchema.safeParse({
      snapshotId: SNAPSHOT_ID,
      dataAsOf: DATA_AS_OF,
      criteria: Array.from({ length: 21 }, (_, index) => criterion({ id: `pe-${index}` })),
    }).success).toBe(false);
    expect(runStockScreeningInputSchema.safeParse({
      snapshotId: SNAPSHOT_ID,
      dataAsOf: DATA_AS_OF,
      criteria: [{ ...criterion(), status: 'needs_input', value: null }],
    }).success).toBe(false);
  });

  it('runs a valid current snapshot and logs only bounded screening metadata', async () => {
    const execute = vi.fn(async () => executeResult());
    const logger = { info: vi.fn(), warn: vi.fn() };
    const result = await runTrustedStockScreening({
      db: snapshotDb([snapshot()]) as never,
      userId: 7,
      logger,
      client: {} as never,
      input: { snapshotId: SNAPSHOT_ID, dataAsOf: DATA_AS_OF, criteria: [criterion()] },
      execute,
    });

    expect(result).toEqual(executeResult());
    expect(execute).toHaveBeenCalledWith({
      client: {},
      snapshotId: SNAPSHOT_ID,
      dataAsOf: DATA_AS_OF,
      criteria: [criterion()],
    });
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).toContain('pe_ttm');
    expect(logged).toContain('deepCheckedCount');
    expect(logged).not.toContain('candidates');
    expect(logged).not.toContain('市盈率不超过 30');
  });

  it('canonicalizes client-authored labels before they reach screening output', async () => {
    const execute = vi.fn(async () => executeResult());
    await runTrustedStockScreening({
      db: snapshotDb([snapshot()]) as never,
      userId: 7,
      logger: { info: vi.fn(), warn: vi.fn() },
      client: {} as never,
      input: {
        snapshotId: SNAPSHOT_ID,
        dataAsOf: DATA_AS_OF,
        criteria: [criterion({ label: '立即买入', sourceField: '伪造字段' })],
      },
      execute,
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      criteria: [expect.objectContaining({
        label: '市盈率不超过 30',
        sourceField: '市盈率TTM',
      })],
    }));
  });

  it('returns a refreshable client error when the current trading date changes', async () => {
    await expect(runTrustedStockScreening({
      db: snapshotDb([snapshot()]) as never,
      userId: 7,
      logger: { info: vi.fn(), warn: vi.fn() },
      client: {} as never,
      input: { snapshotId: SNAPSHOT_ID, dataAsOf: DATA_AS_OF, criteria: [criterion()] },
      execute: vi.fn(async () => {
        throw new StockScreeningFreshnessError('股票快照已不是最新交易日，请刷新页面后重试。');
      }),
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '股票快照已不是最新交易日，请刷新页面后重试。',
    });
  });
});
