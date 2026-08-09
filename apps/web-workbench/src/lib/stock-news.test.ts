import { describe, expect, it } from 'vitest';
import { discoveryStoryClusterKey, mergeDiscoveryNews } from './stock-news.js';

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
});
