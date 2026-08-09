import { describe, expect, it } from 'vitest';
import {
  discoveryStoryAliases,
  discoveryStoryClusterKey,
  mergeDiscoveryNews,
} from './stock-news.js';

describe('mergeDiscoveryNews', () => {
  it('collapses syndicated macro headlines while keeping a distinct market story', () => {
    const merged = mergeDiscoveryNews([
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 10:00',
        title: '7月份居民消费价格同比上涨0.5%',
        symbols: [],
        source: '上海证券报',
        url: 'https://finance.eastmoney.com/a/202608090000001.html',
      },
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 09:36',
        title: '2026年7月份居民消费价格同比上涨0.5%',
        symbols: [],
        source: '每日经济新闻',
        url: 'https://finance.eastmoney.com/a/202608090000002.html',
      },
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 09:20',
        title: '7月份工业生产者出厂价格同比下降3.6%',
        symbols: [],
        source: '证券时报',
        url: 'https://finance.eastmoney.com/a/202608090000003.html',
      },
    ], []);

    expect(merged.map((item) => item.title)).toEqual([
      '7月份居民消费价格同比上涨0.5%',
      '7月份工业生产者出厂价格同比下降3.6%',
    ]);
  });

  it('collapses reordered publisher variants of the same market story', () => {
    const merged = mergeDiscoveryNews([
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 10:00',
        title: '中国银河策略：A股市场的三个验证窗口',
        symbols: [],
        source: '中国银河证券',
        url: 'https://publisher.example/strategy-window-1',
      },
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 09:55',
        title: '中国银河：A股市场“三个验证窗口”',
        symbols: [],
        source: '证券时报',
        url: 'https://publisher.example/strategy-window-2',
      },
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 09:40',
        title: '中国银河策略：消费板块盈利预期改善',
        symbols: [],
        source: '中国银河证券',
        url: 'https://publisher.example/consumer-outlook',
      },
    ], []);

    expect(merged.map((item) => item.title)).toEqual([
      '中国银河策略：A股市场的三个验证窗口',
      '中国银河策略：消费板块盈利预期改善',
    ]);
  });

  it('collapses syndicated company-event headlines even when wording and number placement differ', () => {
    const merged = mergeDiscoveryNews([
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 10:30',
        title: '华东医药：KIO015获欧盟MDR CE认证',
        symbols: [],
        url: 'https://publisher.example/kio015-1',
      },
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 10:20',
        title: '华东医药产品KIO015通过MDR认证并获CE标志',
        symbols: [],
        url: 'https://publisher.example/kio015-2',
      },
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 10:10',
        title: '华东医药上半年营收同比增长',
        symbols: [],
        url: 'https://publisher.example/earnings',
      },
    ], []);

    expect(merged.map((item) => item.title)).toEqual([
      '华东医药：KIO015获欧盟MDR CE认证',
      '华东医药上半年营收同比增长',
    ]);
  });

  it('collapses a same-day event with no English anchor without hiding another company event', () => {
    const merged = mergeDiscoveryNews([
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 20:30',
        title: '明天“打新”宇树科技！A股“朋友圈”浮出水面',
        symbols: [],
        url: 'https://publisher.example/unitree-1',
      },
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 19:57',
        title: '宇树科技即将开启申购，A股“朋友圈”浮出水面',
        symbols: [],
        url: 'https://publisher.example/unitree-2',
      },
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 19:40',
        title: '宇树科技发布新一代机器人控制系统',
        symbols: [],
        url: 'https://publisher.example/unitree-product',
      },
    ], []);

    expect(merged.map((item) => item.title)).toEqual([
      '明天“打新”宇树科技！A股“朋友圈”浮出水面',
      '宇树科技发布新一代机器人控制系统',
    ]);
  });

  it('collapses the same syndicated event across watchlist and A-share feeds', () => {
    const merged = mergeDiscoveryNews([
      {
        category: '新闻',
        feed: '自选股新闻',
        time: '08-09 16:10',
        publishedAt: '2026-08-09T08:10:00.000Z',
        title: '泰晶科技：斩获5天3板的泰晶科技发布异动公告',
        symbols: ['603738'],
        source: '证券时报网',
        url: 'https://publisher.example/watchlist-tkj',
      },
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 16:05',
        publishedAt: '2026-08-09T08:05:00.000Z',
        title: '斩获5天3板，泰晶科技发布异动公告',
        symbols: [],
        source: '证券日报',
        url: 'https://publisher.example/market-tkj',
      },
    ], []);

    expect(merged).toHaveLength(1);
  });

  it('keeps the trustworthy source cover and richer summary from a duplicate event', () => {
    const merged = mergeDiscoveryNews([
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 20:30',
        title: '明天“打新”宇树科技！A股“朋友圈”浮出水面',
        symbols: [],
        source: '中国基金报',
        url: 'https://publisher.example/unitree-no-image',
        summary: '简短摘要',
      },
      {
        category: '新闻',
        feed: 'A股要闻',
        time: '08-09 19:57',
        title: '宇树科技即将开启申购，A股“朋友圈”浮出水面',
        symbols: [],
        source: '证券时报',
        url: 'https://publisher.example/unitree-with-image',
        summary: '这是来源返回的更完整摘要，包含事件背景、申购时间和相关公司的可核验信息。',
        imageUrl: 'https://np-newspic.dfcfw.com/download/D25714350878447082823_w1200h675.jpg',
        imageKind: 'source-cover',
      },
    ], []);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.imageUrl).toBe('https://np-newspic.dfcfw.com/download/D25714350878447082823_w1200h675.jpg');
    expect(merged[0]?.imageKind).toBe('source-cover');
    expect(merged[0]?.summary).toContain('更完整摘要');
  });

  it('returns a stable topic cluster for adjacent market-story diversification', () => {
    expect(discoveryStoryClusterKey({
      category: '新闻',
      feed: 'A股要闻',
      time: '08-09 10:00',
      title: '中国银河策略：A股市场的三个验证窗口',
      symbols: [],
    })).toBe('中国银河策略');
    expect(discoveryStoryClusterKey({
      category: '新闻',
      feed: 'A股要闻',
      time: '08-09 09:00',
      title: '2500亿CPO龙头一周吸金60亿元',
      symbols: [],
    })).toBe('cpo');
    expect(discoveryStoryClusterKey({
      category: '新闻',
      feed: '自选股新闻',
      time: '08-09 09:00',
      title: '泰晶科技发布经营数据',
      symbols: ['603738'],
    })).toBe('603738');
  });

  it('groups a market headline with a followed company even when the market row has no symbol', () => {
    const followed = {
      category: '新闻' as const,
      feed: '自选股新闻' as const,
      time: '08-09 16:10',
      title: '泰晶科技：公司发布最新经营动态',
      symbols: ['603738'],
      source: '证券时报',
    };
    const aliases = discoveryStoryAliases([followed]);
    const marketRow = {
      category: '新闻' as const,
      feed: 'A股要闻' as const,
      time: '08-09 17:02',
      title: '强势股追踪：主力资金连续5日净流入166股，泰晶科技居前',
      symbols: [],
      source: '证券时报',
    };

    expect(discoveryStoryClusterKey(marketRow, aliases)).toBe('603738');
  });
});
