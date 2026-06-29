import { afterEach, describe, expect, it, vi } from 'vitest';
import { __stocksDashboardTest } from './stocks.js';

const disclaimer = '数据来源 AkShare 聚合，仅供信息参考，不构成任何投资建议，不预测股价。';

function envelope(data: unknown[]) {
  return {
    data,
    count: data.length,
    source: 'test',
    fetched_at: '2026-06-29T12:00:00.000Z',
    disclaimer,
  };
}

describe('stocks dashboard snapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __stocksDashboardTest.dashboardCache.clear();
  });

  it('keeps watchlist quotes available when slow market signals are deferred', async () => {
    const requestedPaths: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);
      if (url.pathname.startsWith('/market-pulse')) {
        throw new Error('market pulse should not block the quick snapshot');
      }
      if (url.pathname === '/index/cn') {
        return new Response(JSON.stringify(envelope([
          { 代码: 'sh000001', 名称: '上证指数', 最新价: 4073.9, 涨跌幅: 1.16, 成交额: 500_000_000 },
        ])));
      }
      if (url.pathname === '/kline/603528') {
        return new Response(JSON.stringify(envelope([
          { 日期: '2026-06-26', 收盘: 7.11, 涨跌幅: 0.42 },
          { 日期: '2026-06-29', 收盘: 7.28, 涨跌幅: 2.39 },
        ])));
      }
      if (url.pathname.startsWith('/announcements/')) {
        return new Response(JSON.stringify(envelope([])));
      }
      if (url.pathname.startsWith('/stock-rankings/')) {
        return new Response(JSON.stringify(envelope([
          { 代码: 'sh603986', 名称: '兆易创新', 最新价: 840, 涨跌幅: 9.09, 成交额: 12_000_000_000 },
        ])));
      }
      throw new Error(`unexpected path ${url.pathname}`);
    });

    const snapshot = await __stocksDashboardTest.buildDashboardSnapshot({
      logger: { warn: vi.fn() },
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      now: new Date('2026-06-29T12:00:00.000Z'),
      includeSlowSignals: false,
    });

    expect(snapshot.freshness.status).toBe('partial');
    expect(snapshot.watchlistStocks[0]).toMatchObject({
      symbol: '603528',
      name: '多伦科技',
      price: '7.28',
      changePct: 2.39,
    });
    expect(snapshot.leaderboards.gainers[0]?.name).toBe('兆易创新');
    expect(requestedPaths.some((path) => path.startsWith('/market-pulse'))).toBe(false);
  });
});
