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
          { 日期: '2026-06-26', 收盘: 7.11, 涨跌幅: 0.42, 成交量: 1000, 成交额: 7_100_000 },
          { 日期: '2026-06-29', 收盘: 7.28, 涨跌幅: 2.39, 成交量: 2000, 成交额: 14_560_000 },
        ])));
      }
      if (url.pathname === '/intraday/603528') {
        return new Response(JSON.stringify(envelope([
          { 时间: '2026-06-29 09:30:00', 最新价: 7.22, 成交量: 1200 },
          { 时间: '2026-06-29 09:31:00', 最新价: 7.25, 成交量: 1600 },
          { 时间: '2026-06-29 09:32:00', 最新价: 7.28, 成交量: 1800 },
        ])));
      }
      if (url.pathname === '/quote/603528') {
        return new Response(JSON.stringify(envelope([
          { 代码: 'sh603528', 名称: '多伦科技', 最新价: 7.31, 涨跌幅: 2.82, 成交量: 2400, 成交额: 17_544_000 },
        ])));
      }
      if (url.pathname.startsWith('/announcements/')) {
        throw new Error('announcements should not block the quick snapshot');
      }
      if (url.pathname.startsWith('/stock-rankings/')) {
        throw new Error('rankings should not block the quick snapshot');
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
      price: '7.31',
      changePct: 2.82,
      spark: [7.22, 7.25, 7.28],
      sparkLabels: ['2026-06-29 09:30:00', '2026-06-29 09:31:00', '2026-06-29 09:32:00'],
      sparkKind: 'intraday',
      sparkBaseline: 7.11,
      turnoverAmount: 17_544_000,
      averageTurnoverAmount: 7_100_000,
      volume: 2400,
      averageVolume: 1000,
      volumeRatio: 2.47,
      volumeSignal: '放量',
    });
    expect(snapshot.leaderboards.gainers).toEqual([]);
    expect(requestedPaths.some((path) => path.startsWith('/market-pulse'))).toBe(false);
    expect(requestedPaths.some((path) => path.startsWith('/announcements'))).toBe(false);
    expect(requestedPaths.some((path) => path.startsWith('/stock-rankings'))).toBe(false);
  });

  it('keeps realtime stock cards visible when daily kline is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/index/cn') {
        return new Response(JSON.stringify(envelope([])));
      }
      if (url.pathname === '/kline/603528') {
        return new Response(JSON.stringify({ error: 'kline timeout' }), { status: 503 });
      }
      if (url.pathname === '/intraday/603528') {
        return new Response(JSON.stringify(envelope([
          { 时间: '2026-06-29 14:45:00', 最新价: 7.22, 成交量: 1200 },
          { 时间: '2026-06-29 14:46:00', 最新价: 7.25, 成交量: 1600 },
          { 时间: '2026-06-29 14:47:00', 最新价: 7.28, 成交量: 1800 },
        ])));
      }
      if (url.pathname === '/quote/603528') {
        return new Response(JSON.stringify(envelope([
          { 代码: 'sh603528', 名称: '多伦科技', 最新价: 7.31, 涨跌幅: 2.82 },
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

    expect(snapshot.watchlistStocks[0]).toMatchObject({
      symbol: '603528',
      price: '7.31',
      changePct: 2.82,
      spark: [7.22, 7.25, 7.28],
      sparkLabels: ['2026-06-29 14:45:00', '2026-06-29 14:46:00', '2026-06-29 14:47:00'],
      sparkKind: 'intraday',
    });
  });

  it('does not replace missing intraday charts with daily close charts', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/index/cn') {
        return new Response(JSON.stringify(envelope([])));
      }
      if (url.pathname === '/kline/603528') {
        return new Response(JSON.stringify(envelope([
          { 日期: '2026-06-26', 收盘: 7.11, 涨跌幅: 0.42, 成交量: 1000, 成交额: 7_100_000 },
          { 日期: '2026-06-29', 收盘: 7.28, 涨跌幅: 2.39, 成交量: 2000, 成交额: 14_560_000 },
        ])));
      }
      if (url.pathname === '/intraday/603528') {
        return new Response(JSON.stringify({ error: 'intraday timeout' }), { status: 503 });
      }
      if (url.pathname === '/quote/603528') {
        return new Response(JSON.stringify(envelope([
          { 代码: 'sh603528', 名称: '多伦科技', 最新价: 7.31, 涨跌幅: 2.82, 成交量: 2400, 成交额: 17_544_000 },
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

    expect(snapshot.watchlistStocks[0]).toMatchObject({
      symbol: '603528',
      price: '7.31',
      changePct: 2.82,
      spark: [],
      sparkLabels: [],
      sparkKind: 'intraday',
      sparkBaseline: 7.28,
      turnoverAmount: 17_544_000,
      averageTurnoverAmount: 7_100_000,
    });
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

  it('preserves the last real watchlist quotes when a refresh returns only unavailable stocks', () => {
    const previous = {
      updatedAt: '2026-06-30T09:40:00.000Z',
      source: 'akshare' as const,
      isFallbackWatchlist: false,
      watchlistStocks: [
        {
          symbol: '603528',
          name: '多伦科技',
          market: 'A' as const,
          price: '5.86',
          changePct: -0.17,
          signal: '偏弱' as const,
          report: '待生成' as const,
          spark: [5.87, 5.86],
          sparkLabels: ['2026-06-30 14:59:00', '2026-06-30 15:00:00'],
          sparkKind: 'intraday' as const,
          sparkBaseline: 5.87,
          turnoverAmount: 60_989_093,
          averageTurnoverAmount: 90_455_000,
          volume: null,
          averageVolume: null,
          volumeRatio: 0.67,
          volumeSignal: '缩量' as const,
          newsCount: 0,
          note: '来源 AkShare · 多伦科技 今日真实分钟线',
        },
      ],
      marketIndices: [],
      sectors: [],
      starStocks: [],
      temperature: null,
      news: [],
      leaders: [],
      leaderboards: { gainers: [], losers: [], amount: [] },
      freshness: {
        status: 'fresh' as const,
        cachedAt: '2026-06-30T09:40:00.000Z',
      },
    };
    const next = {
      ...previous,
      updatedAt: '2026-06-30T09:45:00.000Z',
      watchlistStocks: [
        {
          ...previous.watchlistStocks[0]!,
          price: '—',
          changePct: 0,
          spark: [],
          sparkLabels: [],
          sparkBaseline: null,
          turnoverAmount: null,
          averageTurnoverAmount: null,
          volumeRatio: null,
          volumeSignal: '待观察' as const,
          note: '真实行情暂不可用，未展示走势线',
        },
      ],
      freshness: {
        status: 'partial' as const,
        cachedAt: '2026-06-30T09:45:00.000Z',
        message: '真实行情已先展示，市场温度正在后台补齐。',
      },
    };

    const merged = __stocksDashboardTest.withPreservedSlowSignals(next, previous);

    expect(merged.watchlistStocks).toEqual(previous.watchlistStocks);
    expect(merged.freshness.status).toBe('stale');
    expect(merged.freshness.message).toContain('关注股票');
  });

  it('preserves per-stock intraday lines when quotes refresh but minute data is missing', () => {
    const previousStock = {
      symbol: '600497',
      name: '驰宏锌锗',
      market: 'A' as const,
      price: '12.11',
      changePct: -5.39,
      signal: '风险升高' as const,
      report: '待生成' as const,
      spark: [12.8, 12.3, 12.11],
      sparkLabels: ['2026-06-30 09:30:00', '2026-06-30 11:30:00', '2026-06-30 15:00:00'],
      sparkKind: 'intraday' as const,
      sparkBaseline: 12.8,
      turnoverAmount: 4_171_506_704,
      averageTurnoverAmount: 2_311_000_000,
      volume: null,
      averageVolume: null,
      volumeRatio: 1.8,
      volumeSignal: '放量' as const,
      newsCount: 0,
      note: '来源 AkShare · 驰宏锌锗 今日真实分钟线',
    };
    const previous = {
      updatedAt: '2026-06-30T09:40:00.000Z',
      source: 'akshare' as const,
      isFallbackWatchlist: false,
      watchlistStocks: [previousStock],
      marketIndices: [],
      sectors: [],
      starStocks: [previousStock],
      temperature: null,
      news: [],
      leaders: [],
      leaderboards: { gainers: [], losers: [], amount: [] },
      freshness: {
        status: 'fresh' as const,
        cachedAt: '2026-06-30T09:40:00.000Z',
      },
    };
    const nextStock = {
      ...previousStock,
      price: '12.10',
      changePct: -5.47,
      spark: [],
      sparkLabels: [],
      sparkBaseline: 12.8,
      note: '来源 AkShare · 驰宏锌锗 最新行情，分时走势暂缺',
    };
    const next = {
      ...previous,
      updatedAt: '2026-06-30T09:45:00.000Z',
      watchlistStocks: [nextStock],
      starStocks: [nextStock],
      freshness: {
        status: 'partial' as const,
        cachedAt: '2026-06-30T09:45:00.000Z',
        message: '真实行情已先展示，市场温度正在后台补齐。',
      },
    };

    const merged = __stocksDashboardTest.withPreservedSlowSignals(next, previous);

    expect(merged.watchlistStocks[0]).toMatchObject({
      symbol: '600497',
      price: '12.10',
      changePct: -5.47,
      spark: previousStock.spark,
      sparkLabels: previousStock.sparkLabels,
      sparkKind: 'intraday',
      sparkBaseline: 12.8,
    });
    expect(merged.freshness.status).toBe('stale');
    expect(merged.freshness.message).toContain('分时线');
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

  it('preserves market indices and leaderboards when a later refresh loses them', () => {
    const previous = {
      updatedAt: '2026-06-29T12:00:00.000Z',
      source: 'akshare' as const,
      isFallbackWatchlist: false,
      watchlistStocks: [],
      marketIndices: [{ name: '上证指数', price: '4073.90', changePct: 1.16, turnover: '16662.20亿元' }],
      sectors: [],
      starStocks: [],
      temperature: null,
      news: [],
      leaders: [{ rank: 1, name: 'N科莱', price: '48.68', changePct: 211.65, reason: 'bj920072' }],
      leaderboards: {
        gainers: [{ rank: 1, name: 'N科莱', price: '48.68', changePct: 211.65, reason: 'bj920072' }],
        losers: [{ rank: 1, name: '退市股', price: '1.00', changePct: -20, reason: 'sh000000' }],
        amount: [{ rank: 1, name: '成交王', price: '10.00', changePct: 1, reason: '成交额 100亿元' }],
      },
      freshness: {
        status: 'fresh' as const,
        cachedAt: '2026-06-29T12:00:00.000Z',
      },
    };
    const next = {
      ...previous,
      updatedAt: '2026-06-29T12:01:00.000Z',
      marketIndices: [],
      leaders: [],
      leaderboards: { gainers: [], losers: [], amount: [] },
      freshness: {
        status: 'partial' as const,
        cachedAt: '2026-06-29T12:01:00.000Z',
      },
    };

    const merged = __stocksDashboardTest.withPreservedSlowSignals(next, previous);

    expect(merged.marketIndices).toEqual(previous.marketIndices);
    expect(merged.leaders).toEqual(previous.leaderboards.gainers);
    expect(merged.leaderboards).toEqual(previous.leaderboards);
    expect(merged.freshness.status).toBe('stale');
    expect(merged.freshness.message).toContain('市场行情、榜单保留最近一次真实数据');
  });
});
