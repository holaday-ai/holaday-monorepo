import { describe, expect, it } from 'vitest';
import { mergeDiscoveryNews } from './stock-news.js';

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
});
