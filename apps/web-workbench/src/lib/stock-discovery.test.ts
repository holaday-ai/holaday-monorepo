import { describe, expect, it } from 'vitest';
import {
  diversifyDiscoveryEditorialArt,
  diversifyDiscoveryItems,
  discoveryPageIndexes,
  discoveryTimeLabel,
  isExplicitWatchlistNews,
  preferredStockDiscoveryFeed,
  prioritizeAndDiversifyDiscoveryItems,
  shouldPrefetchDiscoveryPage,
} from './stock-discovery';

describe('stock discovery presentation', () => {
  it('chooses a task-relevant default feed without promoting unrelated US or HK news', () => {
    expect(preferredStockDiscoveryFeed({
      自选股新闻: 2,
      重要公告: 8,
      A股要闻: 12,
      美股要闻: 20,
      港股要闻: 20,
    })).toBe('自选股新闻');
    expect(preferredStockDiscoveryFeed({
      自选股新闻: 0,
      重要公告: 3,
      A股要闻: 12,
      美股要闻: 20,
      港股要闻: 20,
    })).toBe('重要公告');
    expect(preferredStockDiscoveryFeed({
      自选股新闻: 0,
      重要公告: 0,
      A股要闻: 12,
      美股要闻: 20,
      港股要闻: 20,
    })).toBe('A股要闻');
    expect(preferredStockDiscoveryFeed({
      自选股新闻: 0,
      重要公告: 0,
      A股要闻: 0,
      美股要闻: 20,
      港股要闻: 20,
    })).toBe('全部');
  });

  it('marks relevance only for an explicit normalized symbol intersection', () => {
    expect(isExplicitWatchlistNews([' sh600519 ', 'aapl'], ['SH600519'])).toBe(true);
    expect(isExplicitWatchlistNews(['600519'], ['SH600519'])).toBe(false);
    expect(isExplicitWatchlistNews([], ['SH600519'])).toBe(false);
    expect(isExplicitWatchlistNews(['SH600519'], [])).toBe(false);
  });

  it('uses different followed stocks before repeating one in a discovery page', () => {
    const items = [
      { item: { symbol: '603738', title: '泰晶科技-最新' }, index: 0 },
      { item: { symbol: '603738', title: '泰晶科技-较早' }, index: 1 },
      { item: { symbol: '603528', title: '多伦科技-最新' }, index: 2 },
      { item: { symbol: '600497', title: '驰宏锌锗-最新' }, index: 3 },
      { item: { symbol: '603528', title: '多伦科技-较早' }, index: 4 },
    ];

    expect(diversifyDiscoveryItems(items, ({ symbol }) => symbol).map(({ index }) => index)).toEqual([0, 2, 3, 1, 4]);
  });

  it('keeps priority ordering without letting one followed stock take over the first page', () => {
    const items = [
      { item: { symbol: '603738', priority: 5 }, index: 0 },
      { item: { symbol: '603738', priority: 5 }, index: 1 },
      { item: { symbol: '603528', priority: 4 }, index: 2 },
      { item: { symbol: '600497', priority: 4 }, index: 3 },
      { item: { symbol: '603738', priority: 3 }, index: 4 },
    ];

    expect(prioritizeAndDiversifyDiscoveryItems(
      items,
      ({ priority }) => priority,
      ({ symbol }) => symbol,
    ).map(({ index }) => index)).toEqual([0, 2, 3, 1, 4]);
  });

  it('suppresses unverified editorial art when the title has no precise visual topic', () => {
    const [result] = diversifyDiscoveryEditorialArt([{
      item: {
        title: '文化消费新观察',
        imageUrl: '/stock-editorial-art/market-2.jpg',
        imageKind: 'editorial-art' as const,
        editorialArtOptions: ['/stock-editorial-art/market-3.jpg'],
      },
      index: 0,
    }]);

    expect(result?.item.imageUrl).toBeUndefined();
    expect(result?.item.imageKind).toBeUndefined();
  });

  it('uses a topic-matched fallback without repeating an image in the rendered feed', () => {
    const items = Array.from({ length: 4 }, (_, index) => ({
      item: {
        title: `CPO 光模块产业进展 ${index + 1}`,
        imageUrl: undefined as string | undefined,
        imageKind: undefined as 'source-cover' | 'editorial-art' | undefined,
      },
      index,
    }));

    const diversified = diversifyDiscoveryEditorialArt(items);
    const imageUrls = diversified.map(({ item }) => item.imageUrl).filter(Boolean);

    expect(imageUrls).toHaveLength(3);
    expect(new Set(imageUrls).size).toBe(3);
    expect(imageUrls.every((url) => [
      '/stock-editorial-art/technology-4.jpg',
      '/stock-editorial-art/technology-5.jpg',
      '/stock-editorial-art/technology-10.jpg',
    ].includes(url as string))).toBe(true);
    expect(diversified[3]?.item.imageUrl).toBeUndefined();
  });

  it('uses disclosure artwork for an announcement without a publisher cover', () => {
    const [result] = diversifyDiscoveryEditorialArt([{
      item: {
        category: '公告',
        title: '某公司股票交易异常波动公告',
        imageUrl: undefined as string | undefined,
        imageKind: undefined as 'source-cover' | 'editorial-art' | undefined,
      },
      index: 0,
    }]);

    expect(result?.item.imageKind).toBe('editorial-art');
    expect(result?.item.imageUrl).toMatch(/^\/stock-editorial-art\/(?:disclosure-1|governance-6)\.jpg$/);
  });

  it('prefers the story event over a company name when choosing fallback art', () => {
    const [positionStory, resourceStory] = diversifyDiscoveryEditorialArt([
      {
        item: {
          category: '新闻',
          title: '私募巨头清仓英伟达、Meta，美股持仓曝光',
          imageUrl: undefined as string | undefined,
          imageKind: undefined as 'source-cover' | 'editorial-art' | undefined,
        },
        index: 0,
      },
      {
        item: {
          category: '新闻',
          title: '全球资源博弈升温，深挖 A 股自主可控大矿主',
          imageUrl: undefined as string | undefined,
          imageKind: undefined as 'source-cover' | 'editorial-art' | undefined,
        },
        index: 1,
      },
    ]);

    expect(positionStory?.item.imageUrl).toMatch(/^\/stock-editorial-art\/market-[23]\.jpg$/);
    expect(resourceStory?.item.imageUrl).toMatch(/^\/stock-editorial-art\/materials-[123]\.jpg$/);
  });

  it('keeps the first verified source cover and falls back to text for repeats', () => {
    const items = [
      {
        item: {
          imageUrl: 'https://np-newspic.dfcfw.com/download/D25714350878447082823_w1200h675.jpg',
          imageKind: 'source-cover' as const,
          editorialArtOptions: ['/stock-editorial-art/market-2.jpg'],
        },
        index: 0,
      },
      {
        item: {
          imageUrl: 'https://np-newspic.dfcfw.com/download/D25714350878447082823_w1200h675.jpg',
          imageKind: 'source-cover' as const,
          editorialArtOptions: ['/stock-editorial-art/market-3.jpg'],
        },
        index: 1,
      },
    ];

    const diversified = diversifyDiscoveryEditorialArt(items);

    expect(diversified.map(({ item }) => item.imageUrl)).toEqual([
      'https://np-newspic.dfcfw.com/download/D25714350878447082823_w1200h675.jpg',
      undefined,
    ]);
    expect(diversified[1]?.item.imageKind).toBeUndefined();
  });

  it('rejects stale local editorial art even when an old snapshot labels it as a source cover', () => {
    const [result] = diversifyDiscoveryEditorialArt([{
      item: {
        imageUrl: '/stock-editorial-art/consumer-1.jpg',
        imageKind: 'source-cover' as const,
      },
      index: 0,
    }]);

    expect(result?.item.imageUrl).toBeUndefined();
    expect(result?.item.imageKind).toBeUndefined();
  });

  it('keeps a verified source-cover proxy returned by the orchestrator', () => {
    const source = 'https://np-newspic.dfcfw.com/download/D25714350878447082823_w1200h675.jpg';
    const proxied = `/api/stock-news/source-cover?url=${encodeURIComponent(source)}`;
    const [result] = diversifyDiscoveryEditorialArt([{
      item: { imageUrl: proxied, imageKind: 'source-cover' as const },
      index: 0,
    }]);

    expect(result?.item.imageUrl).toBe(proxied);
    expect(result?.item.imageKind).toBe('source-cover');
  });

  it('falls back to matched local art when a verified source cover cannot load', () => {
    const items = [{
      item: {
        title: 'CPO 光模块产业链更新',
        imageUrl: 'https://np-newspic.dfcfw.com/download/D25714350878447082823_w1200h675.jpg',
        imageKind: 'source-cover' as const,
        editorialArtOptions: ['/stock-editorial-art/technology-4.jpg'],
      },
      index: 0,
    }];

    const [fallback] = diversifyDiscoveryEditorialArt(
      items,
      new Set(['https://np-newspic.dfcfw.com/download/D25714350878447082823_w1200h675.jpg']),
    );

    expect(fallback?.item.imageUrl).toMatch(/^\/stock-editorial-art\/technology-(?:4|5|10)\.jpg$/);
    expect(fallback?.item.imageKind).toBe('editorial-art');
  });

  it('labels a date-only announcement as a disclosure date without inventing a time', () => {
    expect(discoveryTimeLabel('公告', '08-07')).toBe('08-07 · 披露日');
    expect(discoveryTimeLabel('公告', '08-07 09:30')).toBe('08-07 09:30');
    expect(discoveryTimeLabel('新闻', '08-07')).toBe('08-07');
  });

  it('prefetches the next discovery page once readers reach the third page from the end', () => {
    expect(shouldPrefetchDiscoveryPage({ currentPage: 3, pageCount: 7, hasMore: true, isLoading: false })).toBe(false);
    expect(shouldPrefetchDiscoveryPage({ currentPage: 4, pageCount: 7, hasMore: true, isLoading: false })).toBe(true);
    expect(shouldPrefetchDiscoveryPage({ currentPage: 4, pageCount: 7, hasMore: false, isLoading: false })).toBe(false);
    expect(shouldPrefetchDiscoveryPage({ currentPage: 4, pageCount: 7, hasMore: true, isLoading: true })).toBe(false);
  });

  it('does not prefetch a source page before the reader reaches the end of the loaded items', () => {
    expect(shouldPrefetchDiscoveryPage({
      currentPage: 0,
      pageCount: 3,
      hasMore: true,
      isLoading: false,
      hasExhaustedLoadedItems: false,
    })).toBe(false);
  });

  it('keeps long discovery pagination compact around the current page', () => {
    expect(discoveryPageIndexes(5, 2)).toEqual([0, 1, 2, 3, 4]);
    expect(discoveryPageIndexes(16, 8)).toEqual([0, 7, 8, 9, 15]);
    expect(discoveryPageIndexes(16, 1)).toEqual([0, 1, 2, 15]);
  });
});
