import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetAkshareCircuitBreakersForTests } from '../../agent/a-share/akshare-http-client.js';
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
    vi.useRealTimers();
    resetAkshareCircuitBreakersForTests();
    __stocksDashboardTest.dashboardCache.clear();
  });

  it('limits dashboard watchlist work to three concurrent items', async () => {
    let active = 0;
    let maxActive = 0;
    const values = await __stocksDashboardTest.mapWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7, 8],
      3,
      async (value) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return value * 2;
      },
    );

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(values).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it('never runs more than three watchlist quote requests concurrently', async () => {
    const symbols = Array.from({ length: 8 }, (_, index) => `60000${index + 1}`);
    let activeQuotes = 0;
    let maxActiveQuotes = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/trading-calendar/latest') {
        return new Response(JSON.stringify(envelope([{
          requested_date: url.searchParams.get('on_or_before'),
          latest_trading_date: '2026-08-14',
        }])));
      }
      if (url.pathname.startsWith('/quote/')) {
        const symbol = url.pathname.split('/').at(-1);
        activeQuotes += 1;
        maxActiveQuotes = Math.max(maxActiveQuotes, activeQuotes);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeQuotes -= 1;
        return new Response(JSON.stringify(envelope([{
          代码: symbol,
          名称: symbol,
          最新价: 10,
          涨跌幅: 1,
        }])));
      }
      if (url.pathname.startsWith('/kline/')) {
        return new Response(JSON.stringify(envelope([
          { 日期: '2026-08-13', 收盘: 9.9, 涨跌幅: 0 },
          { 日期: '2026-08-14', 收盘: 10, 涨跌幅: 1 },
        ])));
      }
      return new Response(JSON.stringify(envelope([])));
    });

    await __stocksDashboardTest.buildDashboardSnapshot({
      logger: { warn: vi.fn() },
      watchlistRows: symbols.map((symbol) => ({ symbol, market: 'A' as const, displayName: symbol })),
      effectiveWatchlist: symbols.map((symbol) => ({ symbol, market: 'A' as const, displayName: symbol })),
      now: new Date('2026-08-16T14:00:00.000Z'),
      includeSlowSignals: false,
    });

    expect(maxActiveQuotes).toBeLessThanOrEqual(3);
  });

  it('bounds first paint and every slow dashboard stage to 12 seconds or less', async () => {
    vi.useFakeTimers();
    expect(__stocksDashboardTest.dashboardBudgets).toEqual({
      firstPaintMs: 5_500,
      akshareMs: 8_000,
      slowSignalMs: 12_000,
      rankingMs: 12_000,
      discoveryMs: 12_000,
    });
    const quickTimeout = __stocksDashboardTest.withTimeout(
      new Promise<never>(() => undefined),
      __stocksDashboardTest.dashboardBudgets.firstPaintMs,
    );
    const slowTimeout = __stocksDashboardTest.withTimeout(
      new Promise<never>(() => undefined),
      __stocksDashboardTest.dashboardBudgets.slowSignalMs,
    );
    const quickAssertion = expect(quickTimeout).rejects.toThrow('timeout after 5500ms');
    const slowAssertion = expect(slowTimeout).rejects.toThrow('timeout after 12000ms');
    await vi.advanceTimersByTimeAsync(5_500);
    await quickAssertion;
    await vi.advanceTimersByTimeAsync(6_500);
    await slowAssertion;
  });

  it('sorts discovery announcements by publication time and keeps all real items within the larger feed window', () => {
    const announcement = (title: string, time: string) => ({
      公告标题: title,
      公告时间: time,
      公告链接: `https://example.cninfo.com/${title}`,
    });
    const news = __stocksDashboardTest.buildNews(
      [
        {
          entry: { symbol: '603528', market: 'A' as const, displayName: '多伦科技' },
          env: envelope([
            announcement('多伦-08-01', '2026-08-01'),
            announcement('多伦-08-07', '2026-08-07'),
            announcement('多伦-08-05', '2026-08-05'),
            announcement('多伦-08-03', '2026-08-03'),
            announcement('多伦-08-02', '2026-08-02'),
          ]) as never,
        },
        {
          entry: { symbol: '600497', market: 'A' as const, displayName: '驰宏锌锗' },
          env: envelope([
            announcement('驰宏-08-06', '2026-08-06'),
            announcement('驰宏-08-04', '2026-08-04'),
            announcement('驰宏-07-31', '2026-07-31'),
            announcement('驰宏-07-30', '2026-07-30'),
            announcement('驰宏-07-29', '2026-07-29'),
          ]) as never,
        },
        {
          entry: { symbol: '603738', market: 'A' as const, displayName: '泰晶科技' },
          env: envelope([
            announcement('泰晶-08-07', '2026-08-07 10:30:00'),
            announcement('泰晶-08-06', '2026-08-06 10:30:00'),
            announcement('泰晶-08-05', '2026-08-05 10:30:00'),
            announcement('泰晶-08-04', '2026-08-04 10:30:00'),
            announcement('泰晶-08-03', '2026-08-03 10:30:00'),
          ]) as never,
        },
      ],
      [],
    );

    expect(news).toHaveLength(15);
    expect(news.map((item) => item.title)).toEqual([
      '泰晶科技：泰晶-08-07',
      '多伦科技：多伦-08-07',
      '泰晶科技：泰晶-08-06',
      '驰宏锌锗：驰宏-08-06',
      '泰晶科技：泰晶-08-05',
      '多伦科技：多伦-08-05',
      '泰晶科技：泰晶-08-04',
      '驰宏锌锗：驰宏-08-04',
      '泰晶科技：泰晶-08-03',
      '多伦科技：多伦-08-03',
      '多伦科技：多伦-08-02',
      '多伦科技：多伦-08-01',
      '驰宏锌锗：驰宏-07-31',
      '驰宏锌锗：驰宏-07-30',
      '驰宏锌锗：驰宏-07-29',
    ]);
  });

  it('builds discovery from source-backed news and announcements only', () => {
    const buildSourceDiscovery = __stocksDashboardTest.buildNews as unknown as (
      announcements: Array<{ entry: { symbol: string; market: 'A'; displayName: string }; env: ReturnType<typeof envelope> }>,
      stockNews: Array<{ entry: { symbol: string; market: 'A'; displayName: string }; env: ReturnType<typeof envelope> }>,
    ) => Array<{ category: string; title: string; source: string; url?: string; time: string; imageUrl?: string }>;
    const news = buildSourceDiscovery(
      [
        {
          entry: { symbol: '603528', market: 'A', displayName: '多伦科技' },
          env: envelope([
            {
              公告标题: '多伦科技关于董事会决议的公告',
              公告时间: '2026-08-07 09:00:00',
              公告链接: 'https://www.cninfo.com.cn/notice-603528',
            },
          ]),
        },
      ],
      [
        {
          entry: { symbol: '603528', market: 'A', displayName: '多伦科技' },
          env: envelope([
            {
              新闻标题: '多伦科技发布新产品',
              新闻内容: '公司发布了面向市场的新产品。',
              发布时间: '2026-08-07 11:30:00',
              文章来源: '东方财富',
              新闻链接: 'https://finance.eastmoney.com/a/202607313828387959.html',
              新闻图片: 'https://np-newspic.dfcfw.com/download/D25550525489083947595_w210h154.jpg',
            },
            {
              新闻标题: '重复链接不应计入第二条',
              发布时间: '2026-08-07 11:20:00',
              文章来源: '东方财富',
              新闻链接: 'https://finance.eastmoney.com/a/202607313828387959.html',
            },
          ]),
        },
      ],
    );

    expect(news).toEqual([
      expect.objectContaining({
        category: '新闻',
        title: '多伦科技：多伦科技发布新产品',
        source: '东方财富',
        url: 'https://finance.eastmoney.com/a/202607313828387959.html',
        imageUrl:
          '/api/stock-news/source-cover?url=https%3A%2F%2Fnp-newspic.dfcfw.com%2Fdownload%2FD25550525489083947595_w210h154.jpg',
        time: '08-07 11:30',
      }),
      expect.objectContaining({
        category: '公告',
        title: '多伦科技：多伦科技关于董事会决议的公告',
        source: '巨潮公告',
        url: 'https://www.cninfo.com.cn/notice-603528',
        time: '08-07 09:00',
      }),
    ]);
  });

  it('keeps all fetched self-news and important announcements while capping each market feed deliberately', () => {
    const makeAnnouncements = (symbol: string, name: string) => ({
      entry: { symbol, market: 'A' as const, displayName: name },
      env: envelope(Array.from({ length: 20 }, (_, index) => ({
        公告标题: `${name} 公告 ${index}`,
        公告时间: `2026-08-${String(20 - index).padStart(2, '0')} 09:00:00`,
        公告链接: `https://www.cninfo.com.cn/${symbol}/notice-${index}`,
      }))) as never,
    });
    const makeNews = (symbol: string, name: string) => ({
      entry: { symbol, market: 'A' as const, displayName: name },
      env: envelope(Array.from({ length: 20 }, (_, index) => ({
        新闻标题: `${name} 新闻 ${index}`,
        发布时间: `2026-08-${String(20 - index).padStart(2, '0')} 10:00:00`,
        文章来源: '真实来源',
        新闻链接: `https://finance.eastmoney.com/a/20260808${symbol}${String(index).padStart(4, '0')}.html`,
      }))) as never,
    });
    const makeMarketRows = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({
      新闻标题: `${prefix} 要闻 ${index}`,
      发布时间: `2026-08-${String((index % 28) + 1).padStart(2, '0')} 10:00:00`,
      文章来源: '真实来源',
      新闻链接: `https://finance.eastmoney.com/a/20260808${prefix}${String(index).padStart(4, '0')}.html`,
    }));

    const news = __stocksDashboardTest.buildNews(
      [makeAnnouncements('603528', '多伦科技'), makeAnnouncements('600497', '驰宏锌锗')],
      [makeNews('603528', '多伦科技'), makeNews('600497', '驰宏锌锗')],
      [
        { feed: 'A股要闻', env: envelope(makeMarketRows('cn', 36)) as never },
        { feed: '美股要闻', env: envelope(makeMarketRows('us', 15)) as never },
        { feed: '港股要闻', env: envelope(makeMarketRows('hk', 15)) as never },
      ],
    );

    expect(news.filter((item) => item.feed === '重要公告')).toHaveLength(40);
    expect(news.filter((item) => item.feed === '自选股新闻')).toHaveLength(40);
    expect(news.filter((item) => item.feed === 'A股要闻')).toHaveLength(30);
    expect(news.filter((item) => item.feed === '美股要闻')).toHaveLength(12);
    expect(news.filter((item) => item.feed === '港股要闻')).toHaveLength(12);
  });

  it('collapses syndicated macro headlines within one market feed without dropping a distinct story', () => {
    const news = __stocksDashboardTest.buildNews(
      [],
      [],
      [{
        feed: 'A股要闻',
        env: envelope([
          {
            新闻标题: '7月份居民消费价格同比上涨0.5%',
            发布时间: '2026-08-09 10:00:00',
            文章来源: '上海证券报',
            新闻链接: 'https://finance.eastmoney.com/a/202608090000001.html',
          },
          {
            新闻标题: '2026年7月份居民消费价格同比上涨0.5%',
            发布时间: '2026-08-09 09:36:00',
            文章来源: '每日经济新闻',
            新闻链接: 'https://finance.eastmoney.com/a/202608090000002.html',
          },
          {
            新闻标题: '国家统计局：7月份居民消费价格同比上涨0.5%',
            发布时间: '2026-08-09 09:32:00',
            文章来源: '界面新闻',
            新闻链接: 'https://finance.eastmoney.com/a/202608090000003.html',
          },
          {
            新闻标题: '7月份工业生产者出厂价格同比下降3.6%',
            发布时间: '2026-08-09 09:20:00',
            文章来源: '证券时报',
            新闻链接: 'https://finance.eastmoney.com/a/202608090000004.html',
          },
        ]) as never,
      }],
    );

    expect(news.filter((item) => item.feed === 'A股要闻').map((item) => item.title)).toEqual([
      '7月份居民消费价格同比上涨0.5%',
      '7月份工业生产者出厂价格同比下降3.6%',
    ]);
  });

  it('collapses publisher-prefixed variants of one market event without hiding another story', () => {
    const news = __stocksDashboardTest.buildNews([], [], [{
      feed: 'A股要闻',
      env: envelope([
        {
          新闻标题: '中国银河策略：A股市场的三个验证窗口',
          发布时间: '2026-08-09 10:00:00',
          文章来源: '中国银河证券',
          新闻链接: 'https://publisher.example/strategy-window-1',
        },
        {
          新闻标题: '中国银河：A股市场“三个验证窗口”',
          发布时间: '2026-08-09 09:55:00',
          文章来源: '证券时报',
          新闻链接: 'https://publisher.example/strategy-window-2',
        },
        {
          新闻标题: '中国银河策略：消费板块盈利预期改善',
          发布时间: '2026-08-09 09:40:00',
          文章来源: '中国银河证券',
          新闻链接: 'https://publisher.example/consumer-outlook',
        },
      ]) as never,
    }]);

    expect(news.filter((item) => item.feed === 'A股要闻').map((item) => item.title)).toEqual([
      '中国银河策略：A股市场的三个验证窗口',
      '中国银河策略：消费板块盈利预期改善',
    ]);
  });

  it('collapses syndicated watchlist-news variants without hiding a distinct company event', () => {
    const entry = { symbol: '000963', market: 'A' as const, displayName: '华东医药' };
    const news = __stocksDashboardTest.buildNews([], [{
      entry,
      env: envelope([
        {
          新闻标题: 'KIO015获欧盟MDR CE认证',
          发布时间: '2026-08-09 10:30:00',
          文章来源: '来源甲',
          新闻链接: 'https://publisher.example/kio015-1',
        },
        {
          新闻标题: '产品KIO015通过MDR认证并获CE标志',
          发布时间: '2026-08-09 10:20:00',
          文章来源: '来源乙',
          新闻链接: 'https://publisher.example/kio015-2',
        },
        {
          新闻标题: '上半年营收同比增长',
          发布时间: '2026-08-09 10:10:00',
          文章来源: '来源丙',
          新闻链接: 'https://publisher.example/earnings',
        },
      ]) as never,
    }]);

    expect(news.filter((item) => item.feed === '自选股新闻').map((item) => item.title)).toEqual([
      '华东医药：KIO015获欧盟MDR CE认证',
      '华东医药：上半年营收同比增长',
    ]);
  });

  it('collapses a same-day market event with no English anchor while preserving another company event', () => {
    const news = __stocksDashboardTest.buildNews([], [], [{
      feed: 'A股要闻',
      env: envelope([
        {
          新闻标题: '明天“打新”宇树科技！A股“朋友圈”浮出水面',
          发布时间: '2026-08-09 20:30:00',
          新闻来源: '来源甲',
          新闻链接: 'https://publisher.example/unitree-1',
        },
        {
          新闻标题: '宇树科技即将开启申购，A股“朋友圈”浮出水面',
          发布时间: '2026-08-09 19:57:00',
          新闻来源: '来源乙',
          新闻链接: 'https://publisher.example/unitree-2',
        },
        {
          新闻标题: '宇树科技发布新一代机器人控制系统',
          发布时间: '2026-08-09 19:40:00',
          新闻来源: '来源丙',
          新闻链接: 'https://publisher.example/unitree-product',
        },
      ]) as never,
    }]);

    expect(news.filter((item) => item.feed === 'A股要闻').map((item) => item.title)).toEqual([
      '明天“打新”宇树科技！A股“朋友圈”浮出水面',
      '宇树科技发布新一代机器人控制系统',
    ]);
  });

  it('loads the next market-news page with the feed-specific real-source quota', async () => {
    const requested: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      requested.push(`${url.pathname}${url.search}`);
      const pageRows = Array.from({ length: 12 }, (_, index) => ({
        新闻标题: `美股第 2 页要闻 ${index}`,
        发布时间: `2026-08-08 10:${String(index).padStart(2, '0')}:00`,
        文章来源: '真实来源',
        新闻链接: `https://finance.eastmoney.com/a/2026080838382441${String(index).padStart(2, '0')}.html`,
      }));
      return new Response(JSON.stringify(envelope(pageRows)));
    });

    const result = await __stocksDashboardTest.loadMarketDiscoveryFeed({
      feed: '美股要闻',
      page: 2,
      logger: { warn: vi.fn() },
    });

    expect(requested).toEqual(['/market-news/us?page=2&page_size=12']);
    expect(result).toMatchObject({ feed: '美股要闻', page: 2, hasMore: true });
    expect(result.items).toHaveLength(12);
    expect(result.items.every((item) => item.feed === '美股要闻')).toBe(true);
  });

  it('keeps discovery pagination available when a real source page is partial', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(envelope([
      {
        新闻标题: '港股下一页仍有来源内容',
        发布时间: '2026-08-08 11:00:00',
        文章来源: '真实来源',
        新闻链接: 'https://finance.eastmoney.com/a/202608083838244199.html',
      },
    ]))));

    const result = await __stocksDashboardTest.loadMarketDiscoveryFeed({
      feed: '港股要闻',
      page: 2,
      logger: { warn: vi.fn() },
    });

    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it('requests news and announcements for every A-share in the watchlist', async () => {
    const symbols = ['600001', '600002', '600003', '600004', '600005', '600006'];
    const requestedNewsSymbols: string[] = [];
    const requestedAnnouncementSymbols: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      const stockNews = url.pathname.match(/^\/stock-news\/(\d{6})$/)?.[1];
      const announcements = url.pathname.match(/^\/announcements\/(\d{6})$/)?.[1];
      if (stockNews) {
        requestedNewsSymbols.push(stockNews);
        return new Response(JSON.stringify(envelope([
          {
            新闻标题: `${stockNews} 真实新闻`,
            发布时间: '2026-08-08 11:00:00',
            文章来源: '真实来源',
            新闻链接: `https://finance.eastmoney.com/a/202608083838244${stockNews}.html`,
          },
        ])));
      }
      if (announcements) {
        requestedAnnouncementSymbols.push(announcements);
        return new Response(JSON.stringify(envelope([
          {
            公告标题: `${announcements} 重要公告`,
            公告时间: '2026-08-08 10:00:00',
            公告链接: `https://www.cninfo.com.cn/${announcements}/notice.html`,
          },
        ])));
      }
      return new Response(JSON.stringify(envelope([])));
    });

    await __stocksDashboardTest.buildDashboardSnapshot({
      logger: { warn: vi.fn() },
      watchlistRows: symbols.map((symbol) => ({ symbol, market: 'A' as const, displayName: symbol })),
      effectiveWatchlist: symbols.map((symbol) => ({ symbol, market: 'A' as const, displayName: symbol })),
      now: new Date('2026-08-08T04:00:00.000Z'),
      includeSlowSignals: true,
    });

    expect(requestedNewsSymbols.sort()).toEqual(symbols);
    expect(requestedAnnouncementSymbols.sort()).toEqual(symbols);
  });

  it('uses only declared source covers without deriving an unverified article image', () => {
    const sourceDeclaredImageUrl = __stocksDashboardTest.sourceDeclaredImageUrl as (value?: unknown) => string | undefined;

    expect(sourceDeclaredImageUrl('https://source.example/cover.jpg')).toBe('https://source.example/cover.jpg');
    expect(sourceDeclaredImageUrl('data:image/png;base64,not-a-source-url')).toBeUndefined();
    expect(sourceDeclaredImageUrl('javascript:alert(1)')).toBeUndefined();

    const buildSourceDiscovery = __stocksDashboardTest.buildNews as unknown as (
      announcements: Array<{ entry: { symbol: string; market: 'A'; displayName: string }; env: ReturnType<typeof envelope> }>,
      stockNews: Array<{ entry: { symbol: string; market: 'A'; displayName: string }; env: ReturnType<typeof envelope> }>,
    ) => Array<{ imageUrl?: string; imageKind?: string }>;
    const [item] = buildSourceDiscovery([], [{
      entry: { symbol: '603738', market: 'A', displayName: '泰晶科技' },
      env: envelope([{
        新闻标题: '没有公开封面的真实新闻',
        发布时间: '2026-08-07 11:30:00',
        文章来源: '真实来源',
        新闻链接: 'https://finance.eastmoney.com/a/202608073834244063.html',
      }]),
    }]);

    expect(item?.imageUrl).toBeUndefined();
    expect(item?.imageKind).toBeUndefined();
  });

  it('keeps a declared cover and leaves non-Eastmoney coverless rows title-first', () => {
    const buildSourceDiscovery = __stocksDashboardTest.buildNews as unknown as (
      announcements: Array<{ entry: { symbol: string; market: 'A'; displayName: string }; env: ReturnType<typeof envelope> }>,
      stockNews: Array<{ entry: { symbol: string; market: 'A'; displayName: string }; env: ReturnType<typeof envelope> }>,
    ) => Array<{ imageUrl?: string; imageKind?: string }>;
    const rows = buildSourceDiscovery([], [{
      entry: { symbol: '603738', market: 'A', displayName: '泰晶科技' },
      env: envelope([
        {
          新闻标题: '公司公布业绩数据',
          发布时间: '2026-08-07 12:30:00',
          文章来源: '真实来源',
          新闻链接: 'https://finance.eastmoney.com/a/202608073834244001.html',
          新闻图片: 'https://np-newspic.dfcfw.com/download/D25550525489083947595_w210h154.jpg',
        },
        {
          新闻标题: '公司发布季度经营公告',
          发布时间: '2026-08-07 12:20:00',
          文章来源: '真实来源',
          新闻链接: 'https://publisher.example/articles/quarterly-operations',
        },
        {
          新闻标题: '公司发布投资者关系活动记录',
          发布时间: '2026-08-07 12:10:00',
          文章来源: '真实来源',
          新闻链接: 'https://publisher.example/articles/investor-relations',
        },
      ]),
    }]);

    expect(rows[0]).toMatchObject({
      imageKind: 'source-cover',
      imageUrl:
        '/api/stock-news/source-cover?url=https%3A%2F%2Fnp-newspic.dfcfw.com%2Fdownload%2FD25550525489083947595_w210h154.jpg',
    });
    expect(rows.slice(1).map((row) => row.imageUrl)).toEqual([undefined, undefined]);
    expect(rows.slice(1).map((row) => row.imageKind)).toEqual([undefined, undefined]);
  });

  it('keeps an already-proxied verified cover when a cached dashboard is normalized again', () => {
    const normalizeDiscoveryEditorialArt = __stocksDashboardTest.normalizeDiscoveryEditorialArt as (rows: Array<{
      category: '公告' | '新闻';
      title: string;
      symbols: string[];
      source: string;
      url?: string;
      time: string;
      imageUrl?: string;
      imageKind?: string;
    }>) => Array<{ imageUrl?: string; imageKind?: string }>;
    const proxied =
      '/api/stock-news/source-cover?url=https%3A%2F%2Fnp-newspic.dfcfw.com%2Fdownload%2FD25550525489083947595_w210h154.jpg';

    const [row] = normalizeDiscoveryEditorialArt([{
      category: '新闻',
      title: '中国银河策略：A股市场的三个验证窗口',
      symbols: [],
      source: '银河证券',
      url: 'http://finance.eastmoney.com/a/202608093835916746.html',
      time: '08-09 15:00',
      imageUrl: proxied,
      imageKind: 'source-cover',
    }]);

    expect(row).toMatchObject({ imageUrl: proxied, imageKind: 'source-cover' });
  });

  it('removes a persisted legacy market chart before rendering discovery', () => {
    const normalizeDiscoveryEditorialArt = __stocksDashboardTest.normalizeDiscoveryEditorialArt as (rows: Array<{
      category: '公告' | '新闻';
      title: string;
      symbols: string[];
      source: string;
      url?: string;
      time: string;
      imageUrl?: string;
      imageKind?: string;
    }>) => Array<{ imageUrl?: string; imageKind?: string }>;

    const [row] = normalizeDiscoveryEditorialArt([{
      category: '新闻',
      title: '泰晶科技：历史快照中的无封面新闻',
      symbols: ['603738'],
      source: '真实来源',
      url: 'https://finance.eastmoney.com/a/202608073834244099.html',
      time: '08-07 10:00',
      imageUrl: 'https://webquoteklinepic.eastmoney.com/GetPic.aspx?nid=1.603738',
      imageKind: 'market-chart',
    }]);

    expect(row?.imageUrl).toBeUndefined();
    expect(row?.imageKind).toBeUndefined();
  });

  it('removes a stale local illustration incorrectly marked as a source cover', () => {
    const normalizeDiscoveryEditorialArt = __stocksDashboardTest.normalizeDiscoveryEditorialArt as (rows: Array<{
      category: '公告' | '新闻';
      title: string;
      symbols: string[];
      source: string;
      url?: string;
      time: string;
      imageUrl?: string;
      imageKind?: string;
    }>) => Array<{ imageUrl?: string; imageKind?: string }>;

    const rows = normalizeDiscoveryEditorialArt([
      {
        category: '新闻',
        title: '泰晶科技：无发布方封面的动态',
        symbols: ['603738'],
        source: '真实来源',
        url: 'https://finance.eastmoney.com/a/202608073834244100.html',
        time: '08-07 20:08',
        imageUrl: '/stock-editorial-art/macro-1.jpg',
        imageKind: 'source-cover',
      },
      {
        category: '新闻',
        title: '驰宏锌锗：另一条无发布方封面的动态',
        symbols: ['600497'],
        source: '真实来源',
        url: 'https://finance.eastmoney.com/a/202608073834244101.html',
        time: '08-07 17:02',
        imageUrl: '/stock-editorial-art/macro-1.jpg',
        imageKind: 'source-cover',
      },
    ]);

    expect(rows.map((row) => row.imageUrl)).toEqual([undefined, undefined]);
    expect(rows.map((row) => row.imageKind)).toEqual([undefined, undefined]);
  });

  it('keeps every fetched source-backed row for a multi-stock watchlist', () => {
    const buildSourceDiscovery = __stocksDashboardTest.buildNews as unknown as (
      announcements: Array<{ entry: { symbol: string; market: 'A'; displayName: string }; env: ReturnType<typeof envelope> }>,
      stockNews: Array<{ entry: { symbol: string; market: 'A'; displayName: string }; env: ReturnType<typeof envelope> }>,
    ) => Array<{ category: string; symbols: string[] }>;
    const symbols = ['603528', '600497', '603738'];
    const announcements = symbols.map((symbol) => ({
      entry: { symbol, market: 'A' as const, displayName: symbol },
      env: envelope(Array.from({ length: 6 }, (_, index) => ({
        公告标题: `${symbol} 公告 ${index}`,
        公告时间: `2026-08-07 ${String(index + 8).padStart(2, '0')}:00:00`,
        公告链接: `https://www.cninfo.com.cn/${symbol}/notice-${index}`,
      }))),
    }));
    const stockNews = symbols.map((symbol) => ({
      entry: { symbol, market: 'A' as const, displayName: symbol },
      env: envelope(Array.from({ length: 10 }, (_, index) => ({
        新闻标题: `${symbol} 新闻 ${index}`,
        发布时间: `2026-08-07 ${String(index + 8).padStart(2, '0')}:30:00`,
        文章来源: '东方财富',
        新闻链接: `https://finance.eastmoney.com/a/${symbol}${String(index).padStart(12, '0')}.html`,
      }))),
    }));

    const discovery = buildSourceDiscovery(announcements, stockNews);

    expect(discovery).toHaveLength(48);
    expect(discovery.filter((item) => item.category === '新闻')).toHaveLength(30);
    expect(discovery.filter((item) => item.category === '公告')).toHaveLength(18);
  });

  it('filters, sorts, and deduplicates persisted intraday points to A-share sessions', () => {
    const points = __stocksDashboardTest.observedIntradayPointsForNow(
      [
        { label: '2026-07-30 14:59:00', value: 90 },
        { label: '2026-07-31 11:31:00', value: 999 },
        { label: '2026-07-31 09:31:20', value: 100 },
        { label: '2026-07-31 15:01:00', value: 999 },
        { label: '2026-07-31 13:00:00', value: 102 },
        { label: '2026-07-31 09:31:50', value: 101 },
      ],
      new Date('2026-07-31T07:10:00.000Z'),
    );

    expect(points).toEqual([
      { label: '2026-07-31 09:31:50', value: 101 },
      { label: '2026-07-31 13:00:00', value: 102 },
    ]);
  });

  it('rewrites a persisted intraday stock when points are only out of order', () => {
    const stock = __stocksDashboardTest.observedIntradayStockForNow(
      {
        symbol: '603528',
        name: '多伦科技',
        market: 'A',
        price: '5.92',
        changePct: 0.85,
        signal: '偏强',
        report: '待生成',
        spark: [5.92, 5.9],
        sparkLabels: ['2026-07-31 13:00:00', '2026-07-31 09:31:00'],
        sparkKind: 'intraday',
        sparkBaseline: 5.87,
        sparkTradeDate: '2026-07-31',
        tradeDate: '2026-07-31',
        turnoverAmount: null,
        averageTurnoverAmount: null,
        volume: null,
        averageVolume: null,
        volumeRatio: null,
        volumeSignal: '待观察',
        newsCount: 0,
        note: '来源 AkShare',
      },
      new Date('2026-07-31T07:10:00.000Z'),
    );

    expect(stock.spark).toEqual([5.9, 5.92]);
    expect(stock.sparkLabels).toEqual([
      '2026-07-31 09:31:00',
      '2026-07-31 13:00:00',
    ]);
  });

  it('does not turn a quote without a previous-close baseline into a flat 0 percent move', async () => {
    const client = {
      getStockKline: vi.fn(async () => envelope([])),
      getStockIntraday: vi.fn(async () => envelope([])),
      getStockQuote: vi.fn(async () => envelope([
        { 代码: 'sh603528', 最新价: 5.92, 成交额: 70_081_500 },
      ])),
    };

    const stock = await __stocksDashboardTest.stockSnapshot(
      client as never,
      { symbol: '603528', market: 'A', displayName: '多伦科技' },
      0,
      new Date('2026-07-31T07:10:00.000Z'),
    );

    expect(stock).toMatchObject({
      price: '—',
      signal: '待观察',
      note: '真实价格已返回，但缺少昨收基准；未估算涨跌幅',
    });
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
      sparkTradeDate: '2026-06-29',
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

  it('marks an older quote date historical against the verified exchange calendar', async () => {
    const info = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/trading-calendar/latest') {
        return new Response(JSON.stringify(envelope([
          {
            requested_date: url.searchParams.get('on_or_before'),
            latest_trading_date: '2026-08-14',
          },
        ])));
      }
      if (url.pathname === '/index/cn') {
        return new Response(JSON.stringify(envelope([])));
      }
      if (url.pathname === '/kline/603528') {
        return new Response(JSON.stringify(envelope([
          { 日期: '2026-08-08', 收盘: 6.31, 涨跌幅: -0.31, 成交额: 60_000_000 },
          { 日期: '2026-08-11', 收盘: 6.38, 涨跌幅: 1.11, 成交额: 70_000_000 },
        ])));
      }
      if (url.pathname === '/intraday/603528') {
        return new Response(JSON.stringify(envelope([
          { 时间: '2026-08-11 09:30:00', 最新价: 6.32 },
          { 时间: '2026-08-11 15:00:00', 最新价: 6.38 },
        ])));
      }
      if (url.pathname === '/quote/603528') {
        return new Response(JSON.stringify(envelope([
          { 代码: 'sh603528', 名称: '多伦科技', 最新价: 6.38, 涨跌幅: 1.11, 成交额: 70_000_000 },
        ])));
      }
      throw new Error(`unexpected path ${url.pathname}`);
    });

    const snapshot = await __stocksDashboardTest.buildDashboardSnapshot({
      logger: { warn: vi.fn(), info },
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      now: new Date('2026-08-16T14:00:00.000Z'),
      includeSlowSignals: false,
      snapshotKey: '1:603528:A:多伦科技',
    });

    expect(snapshot.trust).toMatchObject({
      mode: 'historical',
      calendarStatus: 'verified',
      latestExpectedTradingDate: '2026-08-14',
      dataAsOf: '2026-08-11',
      marketTimezone: 'Asia/Shanghai',
      marketSession: 'non-trading',
    });
    expect(snapshot.trust?.sources).toContainEqual(expect.objectContaining({
      key: 'quotes',
      status: 'healthy',
      dataAsOf: '2026-08-11',
    }));
    expect(snapshot.trust?.evidenceIds).toContain('quote:603528:2026-08-11');
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: snapshot.trust?.snapshotId,
        latestExpectedTradingDate: '2026-08-14',
        dataAsOf: '2026-08-11',
        trustMode: 'historical',
        snapshotAgeMs: 0,
        sourceStatuses: expect.arrayContaining([
          expect.objectContaining({ key: 'quotes', status: 'healthy' }),
        ]),
      }),
      'stocks-dashboard: trust snapshot',
    );
  });

  it('preserves the snapshot id after the persisted JSON is reloaded and revalidated', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/trading-calendar/latest') {
        return new Response(JSON.stringify(envelope([
          {
            requested_date: url.searchParams.get('on_or_before'),
            latest_trading_date: '2026-08-14',
          },
        ])));
      }
      if (url.pathname === '/index/cn') return new Response(JSON.stringify(envelope([])));
      if (url.pathname === '/kline/603528') {
        return new Response(JSON.stringify(envelope([
          { 日期: '2026-08-13', 收盘: 6.31, 涨跌幅: -0.31, 成交额: 60_000_000 },
          { 日期: '2026-08-14', 收盘: 6.38, 涨跌幅: 1.11, 成交额: 70_000_000 },
        ])));
      }
      if (url.pathname === '/intraday/603528') {
        return new Response(JSON.stringify(envelope([
          { 时间: '2026-08-14 09:30:00', 最新价: 6.32 },
          { 时间: '2026-08-14 15:00:00', 最新价: 6.38 },
        ])));
      }
      if (url.pathname === '/quote/603528') {
        return new Response(JSON.stringify(envelope([
          { 代码: 'sh603528', 名称: '多伦科技', 最新价: 6.38, 涨跌幅: 1.11, 成交额: 70_000_000 },
        ])));
      }
      throw new Error(`unexpected path ${url.pathname}`);
    });
    const now = new Date('2026-08-16T14:00:00.000Z');
    const snapshotKey = '1:603528:A:多伦科技';
    const built = await __stocksDashboardTest.buildDashboardSnapshot({
      logger: { warn: vi.fn() },
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      now,
      includeSlowSignals: false,
      snapshotKey,
    });
    const reloaded = JSON.parse(JSON.stringify(built));

    const revalidated = await __stocksDashboardTest.revalidateDashboardTrust({
      snapshot: reloaded,
      snapshotKey,
      now,
      logger: { warn: vi.fn() },
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(revalidated.trust?.snapshotId).toBe(built.trust?.snapshotId);
    expect(revalidated.trust?.mode).toBe('current');
  });

  it('keeps verified quotes actionable while a refresh preserves secondary market data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T11:58:00.000Z'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/trading-calendar/latest') {
        return new Response(
          JSON.stringify(
            envelope([
              {
                requested_date: url.searchParams.get('on_or_before'),
                latest_trading_date: '2026-08-17',
              },
            ]),
          ),
        );
      }
      if (url.pathname === '/kline/603528') {
        return new Response(JSON.stringify(envelope([
          { 日期: '2026-08-16', 收盘: 6.38, 涨跌幅: 0.15, 成交额: 60_000_000 },
          { 日期: '2026-08-17', 收盘: 6.40, 涨跌幅: 0.31, 成交额: 35_186_100 },
        ])));
      }
      if (url.pathname === '/intraday/603528') {
        return new Response(JSON.stringify(envelope([
          { 时间: '2026-08-17 09:30:00', 最新价: 6.38, 成交额: 1_000_000 },
          { 时间: '2026-08-17 15:00:00', 最新价: 6.40, 成交额: 35_186_100 },
        ])));
      }
      if (url.pathname === '/quote/603528') {
        return new Response(JSON.stringify(envelope([
          { 代码: 'sh603528', 名称: '多伦科技', 最新价: 6.40, 涨跌幅: 0.31, 成交额: 35_186_100 },
        ])));
      }
      return new Response(JSON.stringify(envelope([])));
    });
    const stock = {
      symbol: '603528',
      name: '多伦科技',
      market: 'A' as const,
      price: '6.40',
      changePct: 0.31,
      signal: '偏强' as const,
      report: '待生成' as const,
      spark: [6.38, 6.40],
      sparkLabels: ['2026-08-17 09:30:00', '2026-08-17 15:00:00'],
      sparkKind: 'intraday' as const,
      sparkBaseline: 6.38,
      sparkTradeDate: '2026-08-17',
      tradeDate: '2026-08-17',
      turnoverAmount: 35_186_100,
      averageTurnoverAmount: 60_000_000,
      volume: null,
      averageVolume: null,
      volumeRatio: 0.59,
      volumeSignal: '缩量' as const,
      newsCount: 0,
      note: '来源 AkShare · 多伦科技 今日真实分钟线',
    };
    const snapshot = {
      updatedAt: '2026-08-17T11:57:50.000Z',
      observedTradeDate: '2026-08-17',
      source: 'akshare' as const,
      isFallbackWatchlist: false,
      watchlistStocks: [stock],
      marketIndices: [
        {
          name: '上证指数',
          price: '3738.00',
          changePct: 0.42,
          turnover: '5000.00亿元',
        },
      ],
      sectors: [],
      starStocks: [stock],
      temperature: null,
      news: [],
      leaders: [],
      leaderboards: { gainers: [], losers: [], amount: [] },
      freshness: {
        status: 'fresh' as const,
        cachedAt: '2026-08-17T11:57:50.000Z',
      },
      trust: {
        snapshotId: 'stkshot_111111111111111111111111',
        generatedAt: '2026-08-17T11:57:50.000Z',
        marketTimezone: 'Asia/Shanghai' as const,
        marketSession: 'closed' as const,
        latestExpectedTradingDate: '2026-08-17',
        dataAsOf: '2026-08-17',
        mode: 'current' as const,
        calendarStatus: 'verified' as const,
        sources: [
          {
            key: 'quotes' as const,
            status: 'healthy' as const,
            dataAsOf: '2026-08-17',
            fetchedAt: '2026-08-17T11:57:50.000Z',
          },
          {
            key: 'indices' as const,
            status: 'healthy' as const,
            dataAsOf: '2026-08-17',
            fetchedAt: '2026-08-17T11:57:50.000Z',
          },
          {
            key: 'news' as const,
            status: 'healthy' as const,
            dataAsOf: '2026-08-17',
            fetchedAt: '2026-08-17T11:57:50.000Z',
          },
          {
            key: 'announcements' as const,
            status: 'healthy' as const,
            dataAsOf: '2026-08-17',
            fetchedAt: '2026-08-17T11:57:50.000Z',
          },
        ],
        evidenceIds: ['quote:603528:2026-08-17'],
      },
    };
    const cacheKey = '1:603528:A:多伦科技';
    __stocksDashboardTest.dashboardCache.set(cacheKey, {
      snapshot,
      freshUntil: Date.now() - 1,
      staleUntil: Date.now() + 60_000,
    });
    const fakeDb = {
      insert: vi.fn(() => ({
        values: () => ({
          onDuplicateKeyUpdate: async () => undefined,
        }),
      })),
    };

    const delivered = await __stocksDashboardTest.resolveDashboardSnapshot({
      db: fakeDb as never,
      logger: { warn: vi.fn() },
      userInternalId: 1,
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
    });

    expect(delivered.freshness.status).toBe('refreshing');
    expect(delivered.trust).toMatchObject({
      latestExpectedTradingDate: '2026-08-17',
      dataAsOf: '2026-08-17',
      mode: 'current',
    });
    await vi.runAllTimersAsync();

    const refreshed = __stocksDashboardTest.dashboardCache.get(cacheKey)?.snapshot;
    expect(refreshed?.marketIndices).toEqual(snapshot.marketIndices);
    expect(refreshed?.freshness).toMatchObject({
      status: 'partial',
    });
    expect(refreshed?.trust).toMatchObject({
      latestExpectedTradingDate: '2026-08-17',
      dataAsOf: '2026-08-17',
      mode: 'current',
      sources: expect.arrayContaining([
        expect.objectContaining({ key: 'quotes', status: 'healthy' }),
        expect.objectContaining({ key: 'indices', status: 'delayed' }),
      ]),
    });
  });

  it('reports failed quote and news sources instead of calling the dashboard fresh', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/trading-calendar/latest') {
        return new Response(JSON.stringify(envelope([
          {
            requested_date: url.searchParams.get('on_or_before'),
            latest_trading_date: '2026-08-14',
          },
        ])));
      }
      return new Response(JSON.stringify({ error: 'upstream unavailable' }), { status: 503 });
    });

    const snapshot = await __stocksDashboardTest.buildDashboardSnapshot({
      logger: { warn: vi.fn() },
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      now: new Date('2026-08-16T14:00:00.000Z'),
      includeSlowSignals: true,
      snapshotKey: '1:603528:A:多伦科技',
    });

    expect(snapshot.freshness.status).toBe('partial');
    expect(snapshot.trust).toMatchObject({ mode: 'unavailable' });
    expect(snapshot.trust?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'quotes', status: 'failed', errorCode: 'NO_VERIFIED_QUOTES' }),
      expect.objectContaining({ key: 'news', status: 'failed', errorCode: 'UPSTREAM_UNAVAILABLE' }),
    ]));
  });

  it('removes quote numbers and charts when a persisted snapshot is outside the safety window', () => {
    const stock = {
      symbol: '603528',
      name: '多伦科技',
      market: 'A' as const,
      price: '6.38',
      changePct: 1.11,
      signal: '强势' as const,
      report: '待生成' as const,
      spark: [6.32, 6.38],
      sparkLabels: ['2026-08-11 09:30:00', '2026-08-11 15:00:00'],
      sparkKind: 'intraday' as const,
      sparkBaseline: 6.31,
      sparkTradeDate: '2026-08-11',
      tradeDate: '2026-08-11',
      turnoverAmount: 70_000_000,
      averageTurnoverAmount: 60_000_000,
      volume: 10_000,
      averageVolume: 9_000,
      volumeRatio: 1.11,
      volumeSignal: '接近均量' as const,
      newsCount: 1,
      note: '来源 AkShare',
    };
    const snapshot = {
      updatedAt: '2026-08-01T08:00:00.000Z',
      observedTradeDate: '2026-08-01',
      source: 'akshare' as const,
      isFallbackWatchlist: false,
      watchlistStocks: [stock],
      marketIndices: [{ name: '上证指数', price: '3634.44', changePct: 0.13, turnover: '5000.00亿元' }],
      sectors: [{ name: '半导体', changePct: 3.2, leader: '兆易创新', flow: '领涨', spark: [1, 2] }],
      starStocks: [stock],
      temperature: null,
      news: [],
      leaders: [],
      leaderboards: { gainers: [], losers: [], amount: [] },
      freshness: { status: 'stale' as const, cachedAt: '2026-08-01T08:00:00.000Z' },
      trust: {
        snapshotId: 'stkshot_old',
        generatedAt: '2026-08-01T08:00:00.000Z',
        marketTimezone: 'Asia/Shanghai' as const,
        marketSession: 'closed' as const,
        latestExpectedTradingDate: '2026-08-14',
        dataAsOf: '2026-08-01',
        mode: 'unavailable' as const,
        calendarStatus: 'verified' as const,
        sources: [],
        evidenceIds: [],
      },
    };

    const safe = __stocksDashboardTest.dashboardForTrustMode(snapshot);

    expect(safe.watchlistStocks[0]).toMatchObject({
      price: '—',
      changePct: 0,
      signal: '待观察',
      spark: [],
      turnoverAmount: null,
      volumeRatio: null,
    });
    expect(safe.marketIndices).toEqual([]);
    expect(safe.sectors).toEqual([]);
    expect(safe.starStocks).toEqual([]);
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

  it('filters same-day intraday points that are ahead of the current Shanghai minute', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/index/cn') {
        return new Response(JSON.stringify(envelope([])));
      }
      if (url.pathname === '/kline/603528') {
        return new Response(JSON.stringify(envelope([
          { 日期: '2026-06-29', 收盘: 5.87, 涨跌幅: 0.1, 成交量: 1000, 成交额: 5_870_000 },
          { 日期: '2026-06-30', 收盘: 5.92, 涨跌幅: 0.85, 成交量: 2000, 成交额: 11_840_000 },
        ])));
      }
      if (url.pathname === '/intraday/603528') {
        return new Response(JSON.stringify(envelope([
          { 时间: '2026-06-30 14:08:00', 最新价: 5.93 },
          { 时间: '2026-06-30 14:09:00', 最新价: 5.92 },
          { 时间: '2026-06-30 15:00:00', 最新价: 5.99 },
        ])));
      }
      if (url.pathname === '/quote/603528') {
        return new Response(JSON.stringify(envelope([
          { 代码: 'sh603528', 名称: '多伦科技', 最新价: 5.92, 涨跌幅: -1.82, 成交额: 70_081_500 },
        ])));
      }
      throw new Error(`unexpected path ${url.pathname}`);
    });

    const snapshot = await __stocksDashboardTest.buildDashboardSnapshot({
      logger: { warn: vi.fn() },
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      now: new Date('2026-06-30T06:10:00.000Z'),
      includeSlowSignals: false,
    });

    expect(snapshot.watchlistStocks[0]).toMatchObject({
      spark: [5.93, 5.92],
      sparkLabels: ['2026-06-30 14:08:00', '2026-06-30 14:09:00'],
      sparkKind: 'intraday',
      sparkTradeDate: '2026-06-30',
    });
  });

  it('shows the latest dated trading-session intraday line on non-trading days', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/index/cn') {
        return new Response(JSON.stringify(envelope([])));
      }
      if (url.pathname === '/kline/603528') {
        return new Response(JSON.stringify(envelope([
          { 日期: '2026-07-02', 收盘: 5.87, 涨跌幅: 0.1, 成交量: 1000, 成交额: 5_870_000 },
          { 日期: '2026-07-03', 收盘: 6.07, 涨跌幅: 2.53, 成交量: 2000, 成交额: 80_291_100 },
        ])));
      }
      if (url.pathname === '/intraday/603528') {
        return new Response(JSON.stringify(envelope([
          { 时间: '2026-07-03 09:30:00', 最新价: 5.95 },
          { 时间: '2026-07-03 11:30:00', 最新价: 6.02 },
          { 时间: '2026-07-03 15:00:00', 最新价: 6.07 },
        ])));
      }
      if (url.pathname === '/quote/603528') {
        return new Response(JSON.stringify(envelope([
          { 代码: 'sh603528', 名称: '多伦科技', 最新价: 6.07, 涨跌幅: 2.53, 成交额: 80_291_100 },
        ])));
      }
      throw new Error(`unexpected path ${url.pathname}`);
    });

    const snapshot = await __stocksDashboardTest.buildDashboardSnapshot({
      logger: { warn: vi.fn() },
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      now: new Date('2026-07-04T07:00:00.000Z'),
      includeSlowSignals: false,
    });

    expect(snapshot.watchlistStocks[0]).toMatchObject({
      price: '6.07',
      changePct: 2.53,
      spark: [5.95, 6.02, 6.07],
      sparkLabels: ['2026-07-03 09:30:00', '2026-07-03 11:30:00', '2026-07-03 15:00:00'],
      sparkKind: 'intraday',
      sparkTradeDate: '2026-07-03',
    });
  });

  it('does not trust intraday points without a trade date', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/index/cn') {
        return new Response(JSON.stringify(envelope([])));
      }
      if (url.pathname === '/kline/603528') {
        return new Response(JSON.stringify(envelope([
          { 日期: '2026-06-30', 收盘: 5.92, 涨跌幅: -1.82, 成交量: 2000, 成交额: 11_840_000 },
        ])));
      }
      if (url.pathname === '/intraday/603528') {
        return new Response(JSON.stringify(envelope([
          { 时间: '14:08:00', 最新价: 5.93 },
          { 时间: '14:09:00', 最新价: 5.92 },
        ])));
      }
      if (url.pathname === '/quote/603528') {
        return new Response(JSON.stringify(envelope([
          { 代码: 'sh603528', 名称: '多伦科技', 最新价: 5.92, 涨跌幅: -1.82, 成交额: 70_081_500 },
        ])));
      }
      throw new Error(`unexpected path ${url.pathname}`);
    });

    const snapshot = await __stocksDashboardTest.buildDashboardSnapshot({
      logger: { warn: vi.fn() },
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      now: new Date('2026-06-30T06:10:00.000Z'),
      includeSlowSignals: false,
    });

    expect(snapshot.watchlistStocks[0]).toMatchObject({
      price: '5.92',
      spark: [],
      sparkLabels: [],
      sparkTradeDate: null,
      note: '来源 AkShare · 多伦科技 最新行情，分时走势暂缺',
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
    expect(merged.news).toEqual([]);
    expect(merged.marketIndices).toEqual(next.marketIndices);
    expect(merged.leaderboards.gainers).toEqual(next.leaderboards.gainers);
    expect(merged.freshness.status).toBe('partial');
    expect(merged.freshness.message).toContain('保留最近一次真实数据');
  });

  it('preserves only prior source-backed discovery records when a refresh returns none', () => {
    const previous = {
      updatedAt: '2026-08-07T03:00:00.000Z',
      source: 'akshare' as const,
      isFallbackWatchlist: false,
      watchlistStocks: [],
      marketIndices: [],
      sectors: [],
      starStocks: [],
      temperature: null,
      news: [
        {
          category: '公告' as const,
          time: '08-07 09:00',
          publishedAt: '2026-08-07T01:00:00.000Z',
          title: '多伦科技：董事会决议公告',
          symbols: ['603528'],
          source: '巨潮公告',
          url: 'https://www.cninfo.com.cn/notice-603528',
        },
        {
          category: '盘面' as const,
          time: '盘中',
          title: '半导体位居涨幅前列',
          symbols: ['半导体'],
          source: 'AkShare 市场脉冲',
        },
        {
          category: '关注' as const,
          time: '关注',
          title: '多伦科技今日涨幅 2%',
          symbols: ['603528'],
          source: 'AkShare 行情',
        },
      ],
      leaders: [],
      leaderboards: { gainers: [], losers: [], amount: [] },
      freshness: { status: 'fresh' as const, cachedAt: '2026-08-07T03:00:00.000Z' },
    };
    const next = {
      ...previous,
      updatedAt: '2026-08-07T03:01:00.000Z',
      news: [],
      freshness: { status: 'fresh' as const, cachedAt: '2026-08-07T03:01:00.000Z' },
    };

    const merged = __stocksDashboardTest.withPreservedSlowSignals(next, previous);

    expect(merged.news).toEqual([
      expect.objectContaining({
        category: '公告',
        time: '08-07 09:00',
        publishedAt: '2026-08-07T01:00:00.000Z',
        title: '多伦科技：董事会决议公告',
        symbols: ['603528'],
        source: '巨潮公告',
        url: 'https://www.cninfo.com.cn/notice-603528',
      }),
    ]);
    expect(merged.news[0]?.imageUrl).toBeUndefined();
    expect(merged.news[0]?.imageKind).toBeUndefined();
  });

  it('keeps prior market discovery feeds when only those source refreshes fail', () => {
    const previous = {
      updatedAt: '2026-08-08T03:00:00.000Z',
      source: 'akshare' as const,
      isFallbackWatchlist: false,
      watchlistStocks: [],
      marketIndices: [],
      sectors: [],
      starStocks: [],
      temperature: null,
      news: [
        {
          category: '新闻' as const,
          feed: '自选股新闻' as const,
          time: '08-08 10:00',
          publishedAt: '2026-08-08T02:00:00.000Z',
          title: '多伦科技：最新自选股新闻',
          symbols: ['603528'],
          source: '东方财富',
          url: 'https://finance.eastmoney.com/a/202608083000000001.html',
        },
        {
          category: '新闻' as const,
          feed: '美股要闻' as const,
          time: '08-08 09:00',
          publishedAt: '2026-08-08T01:00:00.000Z',
          title: '美股要闻：科技股盘前交易活跃',
          symbols: [],
          source: '东方财富',
          url: 'https://finance.eastmoney.com/a/202608083000000002.html',
        },
        {
          category: '新闻' as const,
          feed: '港股要闻' as const,
          time: '08-08 08:00',
          publishedAt: '2026-08-08T00:00:00.000Z',
          title: '港股要闻：恒生科技指数早盘走强',
          symbols: [],
          source: '东方财富',
          url: 'https://finance.eastmoney.com/a/202608083000000003.html',
        },
      ],
      leaders: [],
      leaderboards: { gainers: [], losers: [], amount: [] },
      freshness: { status: 'fresh' as const, cachedAt: '2026-08-08T03:00:00.000Z' },
    };
    const next = {
      ...previous,
      updatedAt: '2026-08-08T03:01:00.000Z',
      news: [
        {
          category: '新闻' as const,
          feed: '自选股新闻' as const,
          time: '08-08 10:30',
          publishedAt: '2026-08-08T02:30:00.000Z',
          title: '多伦科技：刷新后的自选股新闻',
          symbols: ['603528'],
          source: '东方财富',
          url: 'https://finance.eastmoney.com/a/202608083000000004.html',
        },
        {
          category: '新闻' as const,
          feed: 'A股要闻' as const,
          time: '08-08 10:20',
          publishedAt: '2026-08-08T02:20:00.000Z',
          title: 'A股要闻：市场成交额温和放大',
          symbols: [],
          source: '东方财富',
          url: 'https://finance.eastmoney.com/a/202608083000000005.html',
        },
      ],
      freshness: { status: 'fresh' as const, cachedAt: '2026-08-08T03:01:00.000Z' },
    };

    const merged = __stocksDashboardTest.withPreservedSlowSignals(next, previous);

    expect(merged.news.map((item) => item.feed)).toEqual([
      '自选股新闻',
      'A股要闻',
      '美股要闻',
      '港股要闻',
    ]);
    expect(merged.news.some((item) => item.title === '多伦科技：最新自选股新闻')).toBe(false);
    expect(merged.freshness.status).toBe('partial');
    expect(merged.freshness.message).toContain('股市新闻');
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

    expect(merged.watchlistStocks[0]).toMatchObject({
      ...previous.watchlistStocks[0]!,
      sparkTradeDate: '2026-06-30',
    });
    expect(merged.observedTradeDate).toBe('2026-06-30');
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

  it('preserves prior-day intraday lines as clearly dated recent charts', () => {
    const previousStock = {
      symbol: '603528',
      name: '多伦科技',
      market: 'A' as const,
      price: '5.86',
      changePct: -0.17,
      signal: '偏弱' as const,
      report: '待生成' as const,
      spark: [5.88, 5.86],
      sparkLabels: ['2026-06-29 14:59:00', '2026-06-29 15:00:00'],
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
    };
    const nextStock = {
      ...previousStock,
      price: '5.92',
      changePct: -1.82,
      spark: [],
      sparkLabels: [],
      sparkBaseline: 5.87,
      turnoverAmount: 70_081_500,
      note: '来源 AkShare · 多伦科技 最新行情，分时走势暂缺',
    };
    const previous = {
      updatedAt: '2026-06-29T07:05:00.000Z',
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
        cachedAt: '2026-06-29T07:05:00.000Z',
      },
    };
    const next = {
      ...previous,
      updatedAt: '2026-06-30T06:10:00.000Z',
      watchlistStocks: [nextStock],
      starStocks: [nextStock],
      freshness: {
        status: 'partial' as const,
        cachedAt: '2026-06-30T06:10:00.000Z',
        message: '真实行情已先展示，市场温度正在后台补齐。',
      },
    };

    const merged = __stocksDashboardTest.withPreservedSlowSignals(next, previous);

    expect(merged.watchlistStocks[0]).toMatchObject({
      price: '5.92',
      spark: [5.88, 5.86],
      sparkLabels: ['2026-06-29 14:59:00', '2026-06-29 15:00:00'],
      sparkTradeDate: '2026-06-29',
    });
    expect(merged.freshness.message).toContain('分时线');
  });

  it('trims future points before preserving a same-day intraday line', () => {
    const previousStock = {
      symbol: '603528',
      name: '多伦科技',
      market: 'A' as const,
      price: '5.92',
      changePct: -1.82,
      signal: '偏弱' as const,
      report: '待生成' as const,
      spark: [5.93, 5.92, 5.99],
      sparkLabels: ['2026-06-30 14:08:00', '2026-06-30 14:09:00', '2026-06-30 15:00:00'],
      sparkKind: 'intraday' as const,
      sparkBaseline: 6.03,
      turnoverAmount: 70_081_500,
      averageTurnoverAmount: 91_331_400,
      volume: null,
      averageVolume: null,
      volumeRatio: 0.77,
      volumeSignal: '接近均量' as const,
      newsCount: 0,
      note: '来源 AkShare · 多伦科技 今日真实分钟线',
    };
    const nextStock = {
      ...previousStock,
      spark: [],
      sparkLabels: [],
      note: '来源 AkShare · 多伦科技 最新行情，分时走势暂缺',
    };
    const previous = {
      updatedAt: '2026-06-30T06:08:00.000Z',
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
        cachedAt: '2026-06-30T06:08:00.000Z',
      },
    };
    const next = {
      ...previous,
      updatedAt: '2026-06-30T06:10:00.000Z',
      watchlistStocks: [nextStock],
      starStocks: [nextStock],
      freshness: {
        status: 'partial' as const,
        cachedAt: '2026-06-30T06:10:00.000Z',
      },
    };

    const merged = __stocksDashboardTest.withPreservedSlowSignals(next, previous);

    expect(merged.watchlistStocks[0]).toMatchObject({
      spark: [5.93, 5.92],
      sparkLabels: ['2026-06-30 14:08:00', '2026-06-30 14:09:00'],
      sparkKind: 'intraday',
      sparkTradeDate: '2026-06-30',
    });
  });

  it('uses the persisted real snapshot after a process restart while AkShare is unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T08:00:00.000Z'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(envelope([]))));
    const previousStock = {
      symbol: '603528',
      name: '多伦科技',
      market: 'A' as const,
      price: '5.86',
      changePct: -0.17,
      signal: '偏弱' as const,
      report: '待生成' as const,
      spark: [5.88, 5.91, 5.86],
      sparkLabels: ['2026-06-30 09:31:00', '2026-06-30 10:50:00', '2026-06-30 15:00:00'],
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
    const fakeDb = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ snapshotJson: previous }],
          }),
        }),
      })),
      insert: vi.fn(() => ({
        values: () => ({
          onDuplicateKeyUpdate: async () => undefined,
        }),
      })),
    };

    const snapshot = await __stocksDashboardTest.resolveDashboardSnapshot({
      db: fakeDb as never,
      logger: { warn: vi.fn() },
      userInternalId: 1,
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
    });

    expect(snapshot.watchlistStocks[0]).toMatchObject({
      symbol: '603528',
      price: '5.86',
      spark: previousStock.spark,
      sparkLabels: previousStock.sparkLabels,
      sparkKind: 'intraday',
    });
    expect(snapshot.freshness.status).toBe('refreshing');
    expect(snapshot.freshness.message).toContain('最近一次真实数据');
  });

  it('does not serve an empty stale cache when quick real intraday data is available', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T08:00:00.000Z'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/index/cn') {
        return new Response(JSON.stringify(envelope([])));
      }
      if (url.pathname === '/kline/603528') {
        return new Response(JSON.stringify(envelope([
          { 日期: '2026-06-30', 收盘: 5.86, 开盘: 5.8, 最高: 6.01, 最低: 5.8, 成交额: 60_989_093, 涨跌幅: -0.17 },
        ])));
      }
      if (url.pathname === '/intraday/603528') {
        return new Response(JSON.stringify(envelope([
          { 时间: '2026-06-30 09:31:00', 最新价: 5.9, 成交量: 158200, 成交额: 928671 },
          { 时间: '2026-06-30 09:32:00', 最新价: 5.88, 成交量: 159000, 成交额: 936787 },
          { 时间: '2026-06-30 15:00:00', 最新价: 5.86, 成交量: 26800, 成交额: 157048 },
        ])));
      }
      if (url.pathname === '/quote/603528') {
        return new Response(JSON.stringify(envelope([])));
      }
      throw new Error(`unexpected path ${url.pathname}`);
    });
    const emptySnapshot = {
      updatedAt: '2026-06-30T09:40:00.000Z',
      source: 'akshare' as const,
      isFallbackWatchlist: false,
      watchlistStocks: [
        {
          symbol: '603528',
          name: '多伦科技',
          market: 'A' as const,
          price: '—',
          changePct: 0,
          signal: '待观察' as const,
          report: '待生成' as const,
          spark: [],
          sparkLabels: [],
          sparkKind: 'intraday' as const,
          sparkBaseline: null,
          turnoverAmount: null,
          averageTurnoverAmount: null,
          volume: null,
          averageVolume: null,
          volumeRatio: null,
          volumeSignal: '待观察' as const,
          newsCount: 0,
          note: '真实行情暂不可用，未展示走势线',
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
        status: 'partial' as const,
        cachedAt: '2026-06-30T09:40:00.000Z',
      },
    };
    __stocksDashboardTest.dashboardCache.set('1:603528:A:多伦科技', {
      snapshot: emptySnapshot,
      freshUntil: Date.now() + 60_000,
      staleUntil: Date.now() + 60_000,
    });
    const fakeDb = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      })),
      insert: vi.fn(() => ({
        values: () => ({
          onDuplicateKeyUpdate: async () => undefined,
        }),
      })),
    };

    const snapshot = await __stocksDashboardTest.resolveDashboardSnapshot({
      db: fakeDb as never,
      logger: { warn: vi.fn() },
      userInternalId: 1,
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
    });

    expect(snapshot.watchlistStocks[0]).toMatchObject({
      symbol: '603528',
      price: '5.86',
      changePct: -0.17,
      spark: [5.9, 5.88, 5.86],
      sparkKind: 'intraday',
    });
  });

  it('does not let a price-only stale cache hide newly available real intraday data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T07:00:00.000Z'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/index/cn') {
        return new Response(JSON.stringify(envelope([])));
      }
      if (url.pathname === '/kline/603528') {
        return new Response(JSON.stringify(envelope([
          { 日期: '2026-07-02', 收盘: 5.87, 成交额: 60_989_093, 涨跌幅: -0.17 },
          { 日期: '2026-07-03', 收盘: 6.07, 成交额: 80_291_100, 涨跌幅: 2.53 },
        ])));
      }
      if (url.pathname === '/intraday/603528') {
        return new Response(JSON.stringify(envelope([
          { 时间: '2026-07-03 09:30:00', 最新价: 5.95, 成交额: 1_000_000 },
          { 时间: '2026-07-03 11:30:00', 最新价: 6.02, 成交额: 2_000_000 },
          { 时间: '2026-07-03 15:00:00', 最新价: 6.07, 成交额: 3_000_000 },
        ])));
      }
      if (url.pathname === '/quote/603528') {
        return new Response(JSON.stringify(envelope([
          { 代码: 'sh603528', 名称: '多伦科技', 最新价: 6.07, 涨跌幅: 2.53, 成交额: 80_291_100 },
        ])));
      }
      throw new Error(`unexpected path ${url.pathname}`);
    });
    const stalePriceOnlySnapshot = {
      updatedAt: '2026-07-04T06:55:00.000Z',
      source: 'akshare' as const,
      isFallbackWatchlist: false,
      watchlistStocks: [
        {
          symbol: '603528',
          name: '多伦科技',
          market: 'A' as const,
          price: '6.07',
          changePct: 2.53,
          signal: '强势' as const,
          report: '待生成' as const,
          spark: [],
          sparkLabels: [],
          sparkKind: 'intraday' as const,
          sparkBaseline: 6.03,
          sparkTradeDate: null,
          turnoverAmount: 80_291_100,
          averageTurnoverAmount: 89_366_600,
          volume: null,
          averageVolume: null,
          volumeRatio: 0.9,
          volumeSignal: '接近均量' as const,
          newsCount: 0,
          note: '来源 AkShare · 多伦科技 最新行情，分时走势暂缺',
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
        status: 'stale' as const,
        cachedAt: '2026-07-04T06:55:00.000Z',
      },
    };
    __stocksDashboardTest.dashboardCache.set('1:603528:A:多伦科技', {
      snapshot: stalePriceOnlySnapshot,
      freshUntil: Date.now() + 60_000,
      staleUntil: Date.now() + 60_000,
    });
    const fakeDb = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      })),
      insert: vi.fn(() => ({
        values: () => ({
          onDuplicateKeyUpdate: async () => undefined,
        }),
      })),
    };

    const snapshot = await __stocksDashboardTest.resolveDashboardSnapshot({
      db: fakeDb as never,
      logger: { warn: vi.fn() },
      userInternalId: 1,
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
    });

    expect(snapshot.watchlistStocks[0]).toMatchObject({
      symbol: '603528',
      price: '6.07',
      spark: [5.95, 6.02, 6.07],
      sparkKind: 'intraday',
      sparkTradeDate: '2026-07-03',
    });
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
    expect(merged.freshness.status).toBe('partial');
    expect(merged.freshness.message).toContain('行业趋势保留最近一次真实数据');
  });

  it('marks a full refresh partial when market panels are still missing', async () => {
    const requestedPaths: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      requestedPaths.push(url.pathname);
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
    expect(requestedPaths).toContain('/stock-news/603528');
  });

  it('keeps broad market news separate from ranking-selected individual stock news', async () => {
    const requestedNewsSymbols: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/stock-rankings/gainers') {
        return new Response(JSON.stringify(envelope([{ 代码: '600010', 名称: '包钢股份' }])));
      }
      if (url.pathname === '/stock-rankings/losers') {
        return new Response(JSON.stringify(envelope([{ 代码: '600011', 名称: '华能国际' }])));
      }
      if (url.pathname === '/stock-rankings/amount') {
        return new Response(JSON.stringify(envelope([{ 代码: '600012', 名称: '皖通高速' }])));
      }
      if (url.pathname.startsWith('/stock-news/')) {
        const symbol = url.pathname.split('/').at(-1)!;
        requestedNewsSymbols.push(symbol);
        return new Response(JSON.stringify(envelope([{
          新闻标题: `${symbol} 的真实市场动态`,
          发布时间: '2026-08-08 10:00:00',
          文章来源: '东方财富',
          新闻链接: `https://finance.eastmoney.com/a/${symbol}3838244063.html`,
        }])));
      }
      if (url.pathname === '/market-news/cn') {
        return new Response(JSON.stringify(envelope([{
          新闻标题: 'A股市场的真实要闻',
          发布时间: '2026-08-08 10:05:00',
          文章来源: '东方财富',
          新闻链接: 'https://finance.eastmoney.com/a/202608083838244001.html',
        }])));
      }
      if (url.pathname === '/market-news/us') {
        return new Response(JSON.stringify(envelope([{
          新闻标题: '美股市场的真实要闻',
          发布时间: '2026-08-08 10:04:00',
          文章来源: '东方财富',
          新闻链接: 'https://finance.eastmoney.com/a/202608083838244002.html',
        }])));
      }
      if (url.pathname === '/market-news/hk') {
        return new Response(JSON.stringify(envelope([{
          新闻标题: '港股市场的真实要闻',
          发布时间: '2026-08-08 10:03:00',
          文章来源: '东方财富',
          新闻链接: 'https://finance.eastmoney.com/a/202608083838244003.html',
        }])));
      }
      return new Response(JSON.stringify(envelope([])));
    });

    const snapshot = await __stocksDashboardTest.buildDashboardSnapshot({
      logger: { warn: vi.fn() },
      watchlistRows: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      effectiveWatchlist: [{ symbol: '603528', market: 'A', displayName: '多伦科技' }],
      now: new Date('2026-08-08T04:00:00.000Z'),
      includeSlowSignals: true,
    });

    expect(requestedNewsSymbols).toEqual(['603528']);
    expect(snapshot.news.map((item) => item.url)).toEqual(expect.arrayContaining([
      'https://finance.eastmoney.com/a/202608083838244001.html',
      'https://finance.eastmoney.com/a/202608083838244002.html',
      'https://finance.eastmoney.com/a/202608083838244003.html',
    ]));
    expect(snapshot.news).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbols: ['603528'], feed: '自选股新闻' }),
      expect.objectContaining({ feed: 'A股要闻', title: 'A股市场的真实要闻' }),
      expect.objectContaining({ feed: '美股要闻', title: '美股市场的真实要闻' }),
      expect.objectContaining({ feed: '港股要闻', title: '港股市场的真实要闻' }),
    ]));
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
    expect(merged.freshness.status).toBe('partial');
    expect(merged.freshness.message).toContain('市场行情、榜单保留最近一次真实数据');
  });
});
