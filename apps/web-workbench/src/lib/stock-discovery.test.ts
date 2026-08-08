import { describe, expect, it } from 'vitest';
import {
  diversifyDiscoveryEditorialArt,
  diversifyDiscoveryItems,
  discoveryPageIndexes,
  discoveryTimeLabel,
  shouldPrefetchDiscoveryPage,
} from './stock-discovery';

describe('stock discovery presentation', () => {
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

  it('avoids adjacent duplicate local editorial art after stock diversification', () => {
    const items: Array<{
      item: {
        symbol: string;
        imageUrl: string;
        imageKind: 'source-cover' | 'editorial-art';
        editorialArtOptions?: string[];
      };
      index: number;
    }> = [
      {
        item: {
          symbol: '603738',
          imageUrl: '/stock-editorial-art/macro-1.jpg',
          imageKind: 'editorial-art' as const,
          editorialArtOptions: [
            '/stock-editorial-art/macro-1.jpg',
            '/stock-editorial-art/governance-1.jpg',
          ],
        },
        index: 0,
      },
      { item: { symbol: '603738', imageUrl: '/stock-editorial-art/industrial-1.jpg', imageKind: 'editorial-art' as const }, index: 1 },
      {
        item: {
          symbol: '603528',
          imageUrl: '/stock-editorial-art/macro-1.jpg',
          imageKind: 'editorial-art' as const,
          editorialArtOptions: [
            '/stock-editorial-art/macro-1.jpg',
            '/stock-editorial-art/governance-1.jpg',
          ],
        },
        index: 2,
      },
      { item: { symbol: '600497', imageUrl: 'https://publisher.example/cover.jpg', imageKind: 'source-cover' as const }, index: 3 },
    ];

    const stockFirst = diversifyDiscoveryItems(items, ({ symbol }) => symbol);
    const diversified = diversifyDiscoveryEditorialArt(stockFirst);

    expect(stockFirst.map(({ item }) => item.imageUrl)).toEqual([
      '/stock-editorial-art/macro-1.jpg',
      '/stock-editorial-art/macro-1.jpg',
      'https://publisher.example/cover.jpg',
      '/stock-editorial-art/industrial-1.jpg',
    ]);
    expect(diversified.map(({ item }) => item.imageUrl)).toEqual([
      '/stock-editorial-art/macro-1.jpg',
      expect.not.stringMatching(/macro-1\.jpg$/),
      'https://publisher.example/cover.jpg',
      '/stock-editorial-art/industrial-1.jpg',
    ]);
  });

  it('does not alter a cover merely because the same artwork appeared on an earlier page', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      item: {
        imageUrl: '/stock-editorial-art/macro-1.jpg',
        imageKind: 'editorial-art' as const,
      },
      index,
    }));

    const diversified = diversifyDiscoveryEditorialArt(items);

    expect(diversified[11]?.item.imageUrl).toBe('/stock-editorial-art/macro-1.jpg');
  });

  it('keeps a technology cover in its own candidate set after earlier carousel pages', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      item: {
        imageUrl: `/stock-editorial-art/page-${index}.jpg`,
        imageKind: 'editorial-art' as const,
        editorialArtOptions: [`/stock-editorial-art/page-${index}.jpg`],
      },
      index,
    })).concat({
      item: {
        imageUrl: '/stock-editorial-art/technology-1.jpg',
        imageKind: 'editorial-art' as const,
        editorialArtOptions: [
          '/stock-editorial-art/technology-1.jpg',
          '/stock-editorial-art/advanced-manufacturing-1.jpg',
          '/stock-editorial-art/industrial-1.jpg',
        ],
      },
      index: 12,
    });

    expect(diversifyDiscoveryEditorialArt(items)[12]?.item.imageUrl).toBe('/stock-editorial-art/technology-1.jpg');
  });

  it('does not repeat an actual replacement in the same carousel page', () => {
    const items = [
      {
        item: {
          imageUrl: '/stock-editorial-art/technology-1.jpg',
          imageKind: 'editorial-art' as const,
          editorialArtOptions: [
            '/stock-editorial-art/technology-1.jpg',
            '/stock-editorial-art/advanced-manufacturing-1.jpg',
            '/stock-editorial-art/industrial-1.jpg',
          ],
        },
        index: 0,
      },
      {
        item: {
          imageUrl: '/stock-editorial-art/technology-1.jpg',
          imageKind: 'editorial-art' as const,
          editorialArtOptions: [
            '/stock-editorial-art/technology-1.jpg',
            '/stock-editorial-art/advanced-manufacturing-1.jpg',
            '/stock-editorial-art/industrial-1.jpg',
          ],
        },
        index: 1,
      },
      {
        item: {
          imageUrl: '/stock-editorial-art/technology-1.jpg',
          imageKind: 'editorial-art' as const,
          editorialArtOptions: [
            '/stock-editorial-art/technology-1.jpg',
            '/stock-editorial-art/advanced-manufacturing-1.jpg',
            '/stock-editorial-art/industrial-1.jpg',
          ],
        },
        index: 2,
      },
    ];

    expect(diversifyDiscoveryEditorialArt(items).map(({ item }) => item.imageUrl)).toEqual([
      '/stock-editorial-art/technology-1.jpg',
      '/stock-editorial-art/advanced-manufacturing-1.jpg',
      '/stock-editorial-art/industrial-1.jpg',
    ]);
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

  it('keeps long discovery pagination compact around the current page', () => {
    expect(discoveryPageIndexes(5, 2)).toEqual([0, 1, 2, 3, 4]);
    expect(discoveryPageIndexes(16, 8)).toEqual([0, 7, 8, 9, 15]);
    expect(discoveryPageIndexes(16, 1)).toEqual([0, 1, 2, 15]);
  });
});
