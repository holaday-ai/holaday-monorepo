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

  it('preserves the last real sector and temperature data when market pulse refresh is empty', () => {
    const previous = {
      updatedAt: '2026-06-29T12:00:00.000Z',
      source: 'akshare' as const,
      isFallbackWatchlist: false,
      watchlistStocks: [],
      marketIndices: [],
      sectors: [
        { name: '半导体', changePct: 3.2, leader: '兆易创新', flow: '领涨股 10.00%', spark: [] },
      ],
      starStocks: [],
      temperature: {
        score: 66,
        mood: '偏乐观',
        dayDelta: null,
        weekDelta: null,
        historicalPosition: '66%',
        notes: ['上涨 3000 家，下跌 2000 家。'],
      },
      news: [
        {
          category: '盘面' as const,
          time: '盘中',
          title: '半导体 板块位居涨幅前列',
          symbols: ['半导体'],
          source: 'AkShare 市场脉冲',
        },
      ],
      leaders: [],
      leaderboards: { gainers: [], losers: [], amount: [] },
      freshness: {
        status: 'fresh' as const,
        cachedAt: '2026-06-29T12:00:00.000Z',
      },
    };
    const next = {
      ...previous,
      updatedAt: '2026-06-29T12:01:00.000Z',
      marketIndices: [{ name: '上证指数', price: '4073.90', changePct: 1.16, turnover: '16662.20亿元' }],
      sectors: [],
      temperature: null,
      news: [],
      leaderboards: {
        gainers: [{ rank: 1, name: 'N科莱', price: '48.68', changePct: 211.65, reason: 'bj920072' }],
        losers: [],
        amount: [],
      },
      freshness: {
        status: 'fresh' as const,
        cachedAt: '2026-06-29T12:01:00.000Z',
      },
    };

    const merged = __stocksDashboardTest.withPreservedSlowSignals(next, previous);

    expect(merged.sectors).toEqual(previous.sectors);
    expect(merged.temperature).toEqual(previous.temperature);
    expect(merged.news).toEqual(previous.news);
    expect(merged.marketIndices).toEqual(next.marketIndices);
    expect(merged.leaderboards.gainers).toEqual(next.leaderboards.gainers);
    expect(merged.freshness.status).toBe('stale');
    expect(merged.freshness.message).toContain('保留最近一次真实数据');
  });

  it('preserves sectors when a refresh keeps temperature but loses industry rankings', () => {
    const previous = {
      updatedAt: '2026-06-29T12:00:00.000Z',
      source: 'akshare' as const,
      isFallbackWatchlist: false,
      watchlistStocks: [],
      marketIndices: [],
      sectors: [
        { name: '半导体', changePct: 3.2, leader: '兆易创新', flow: '领涨股 10.00%', spark: [] },
      ],
      starStocks: [],
      temperature: {
        score: 66,
        mood: '偏乐观',
        dayDelta: null,
        weekDelta: null,
        historicalPosition: '66%',
        notes: ['上涨 3000 家，下跌 2000 家。'],
      },
      news: [],
      leaders: [],
      leaderboards: { gainers: [], losers: [], amount: [] },
      freshness: {
        status: 'fresh' as const,
        cachedAt: '2026-06-29T12:00:00.000Z',
      },
    };
    const next = {
      ...previous,
      updatedAt: '2026-06-29T12:01:00.000Z',
      sectors: [],
      temperature: {
        score: 59,
        mood: '偏乐观',
        dayDelta: null,
        weekDelta: null,
        historicalPosition: '59%',
        notes: ['上涨 2469 家，下跌 2933 家。'],
      },
      leaderboards: {
        gainers: [{ rank: 1, name: 'N科莱', price: '48.68', changePct: 211.65, reason: 'bj920072' }],
        losers: [],
        amount: [],
      },
      freshness: {
        status: 'fresh' as const,
        cachedAt: '2026-06-29T12:01:00.000Z',
      },
    };

    const merged = __stocksDashboardTest.withPreservedSlowSignals(next, previous);

    expect(merged.sectors).toEqual(previous.sectors);
    expect(merged.temperature).toEqual(next.temperature);
    expect(merged.leaderboards.gainers).toEqual(next.leaderboards.gainers);
    expect(merged.freshness.status).toBe('stale');
    expect(merged.freshness.message).toContain('行业趋势保留最近一次真实数据');
  });

  it('marks a full refresh partial when market panels are still missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/kline/603528') {
        return new Response(JSON.stringify(envelope([
          { 日期: '2026-06-26', 收盘: 7.11, 涨跌幅: 0.42 },
          { 日期: '2026-06-29', 收盘: 7.28, 涨跌幅: 2.39 },
        ])));
      }
      return new Response(JSON.stringify(envelope([])));
    });

    const snapshot = await __stocksDashboardTest.buildDashboardSnapshot({
      logger: { warn: vi.fn() },
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      now: new Date('2026-06-29T12:00:00.000Z'),
      includeSlowSignals: true,
    });

    expect(snapshot.freshness.status).toBe('partial');
    expect(snapshot.freshness.message).toContain('指数、行业趋势、市场温度、榜单正在后台补齐');
    expect(snapshot.watchlistStocks[0]?.price).toBe('7.28');
  });
});
