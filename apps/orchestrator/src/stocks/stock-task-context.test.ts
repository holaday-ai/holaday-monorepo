import { describe, expect, it, vi } from 'vitest';
import {
  type StockTaskContextInput,
  publicStockTaskContext,
  validateStockTaskContext,
  validateStockTaskContextSnapshot,
} from './stock-task-context.js';

const INPUT: StockTaskContextInput = {
  snapshotId: 'stkshot_0123456789abcdef01234567',
  dataAsOf: '2026-08-11',
  trustMode: 'historical',
  evidenceIds: ['quote:603528:2026-08-11'],
};

const SNAPSHOT = {
  updatedAt: '2026-08-16T13:55:00.000Z',
  observedTradeDate: '2026-08-11',
  watchlistStocks: [
    {
      symbol: '603528',
      name: '多伦科技',
      market: 'A',
      price: '6.38',
      changePct: 1.11,
      spark: [6.32, 6.38],
      sparkLabels: ['2026-08-11 09:30:00', '2026-08-11 15:00:00'],
      sparkTradeDate: '2026-08-11',
      tradeDate: '2026-08-11',
      turnoverAmount: 70_000_000,
      volume: 10_000,
    },
  ],
  marketIndices: [{ name: '上证指数', price: '3634.44', changePct: 0.13, turnover: '5000.00亿元' }],
  sectors: [{ name: '半导体', changePct: 3.2, leader: '兆易创新', flow: '领涨', spark: [] }],
  news: [
    {
      category: '新闻',
      time: '08-11 14:00',
      publishedAt: '2026-08-11 14:00:00',
      title: '多伦科技发布公告',
      symbols: ['603528'],
      source: '证券时报',
      url: 'https://example.com/news/1',
    },
  ],
  trust: {
    snapshotId: INPUT.snapshotId,
    generatedAt: '2026-08-16T13:55:00.000Z',
    dataAsOf: INPUT.dataAsOf,
    mode: INPUT.trustMode,
    evidenceIds: ['quote:603528:2026-08-11', 'news:16bf65889b62613d3a30e4ca'],
  },
};

describe('stock task context validation', () => {
  it('returns a bounded snapshot payload for an exact snapshot and evidence subset', () => {
    expect(
      validateStockTaskContextSnapshot({
        snapshot: SNAPSHOT,
        input: INPUT,
        intent: '解释多伦科技当日变化',
      }),
    ).toMatchObject({
      snapshotId: INPUT.snapshotId,
      dataAsOf: '2026-08-11',
      trustMode: 'historical',
      evidenceIds: ['quote:603528:2026-08-11'],
      snapshotPayload: {
        generatedAt: '2026-08-16T13:55:00.000Z',
        watchlistStocks: [{ symbol: '603528', price: '6.38' }],
        marketIndices: [{ name: '上证指数' }],
        sectors: [{ name: '半导体' }],
        news: [],
      },
    });
  });

  it.each([
    ['snapshot id', { ...INPUT, snapshotId: 'stkshot_aaaaaaaaaaaaaaaaaaaaaaaa' }],
    ['data date', { ...INPUT, dataAsOf: '2026-08-12' }],
    ['trust mode', { ...INPUT, trustMode: 'current' as const }],
    ['forged evidence', { ...INPUT, evidenceIds: ['quote:600519:2026-08-11'] }],
  ])('rejects a mismatched %s', (_label, input) => {
    expect(() =>
      validateStockTaskContextSnapshot({
        snapshot: SNAPSHOT,
        input,
        intent: '解释多伦科技当日变化',
      }),
    ).toThrow();
  });

  it('rejects unavailable context, a symbol absent from the snapshot, and present-tense historical intent', () => {
    expect(() =>
      validateStockTaskContextSnapshot({
        snapshot: { ...SNAPSHOT, trust: { ...SNAPSHOT.trust, mode: 'unavailable' } },
        input: INPUT,
        intent: '解释多伦科技当日变化',
      }),
    ).toThrow(/不可用/);
    expect(() =>
      validateStockTaskContextSnapshot({
        snapshot: SNAPSHOT,
        input: INPUT,
        intent: '分析 600519 的风险点',
      }),
    ).toThrow(/不在快照/);
    expect(() =>
      validateStockTaskContextSnapshot({
        snapshot: SNAPSHOT,
        input: INPUT,
        intent: '今天哪只最强',
      }),
    ).toThrow(/截至 08\/11/);
  });

  it('exposes only public provenance and never the private snapshot payload', () => {
    const validated = validateStockTaskContextSnapshot({
      snapshot: SNAPSHOT,
      input: INPUT,
      intent: '解释多伦科技当日变化',
    });
    expect(publicStockTaskContext(validated)).toEqual(INPUT);
    expect(publicStockTaskContext(validated)).not.toHaveProperty('snapshotPayload');
    expect(publicStockTaskContext({ snapshotPayload: validated.snapshotPayload })).toBeNull();
  });

  it('rejects a snapshot that is not in the requesting user scope', async () => {
    const warn = vi.fn();
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => [] }),
          }),
        }),
      }),
    };
    await expect(
      validateStockTaskContext({
        db: db as never,
        userId: 99,
        input: INPUT,
        intent: '解释多伦科技当日变化',
        logger: { warn },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(warn).toHaveBeenCalledWith(
      {
        userId: 99,
        snapshotId: INPUT.snapshotId,
        rejectionCode: 'SNAPSHOT_NOT_OWNED',
      },
      'stocks-task: context rejected',
    );
  });

  it('logs a stable rejection code without the task intent or private payload', async () => {
    const warn = vi.fn();
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => [{ snapshotJson: SNAPSHOT }] }),
          }),
        }),
      }),
    };

    await expect(
      validateStockTaskContext({
        db: db as never,
        userId: 99,
        input: INPUT,
        intent: '今天哪只最强，secret task text',
        logger: { warn },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(warn).toHaveBeenCalledWith(
      {
        userId: 99,
        snapshotId: INPUT.snapshotId,
        rejectionCode: 'HISTORICAL_PRESENT_TENSE',
      },
      'stocks-task: context rejected',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret task text');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('snapshotPayload');
  });
});
