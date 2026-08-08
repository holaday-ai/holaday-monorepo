import { describe, expect, it } from 'vitest';
import {
  diversifyDiscoveryEditorialArt,
  diversifyDiscoveryItems,
  discoveryTimeLabel,
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
      };
      index: number;
    }> = [
      { item: { symbol: '603738', imageUrl: '/stock-editorial-art/macro-1.jpg', imageKind: 'editorial-art' as const }, index: 0 },
      { item: { symbol: '603738', imageUrl: '/stock-editorial-art/industrial-1.jpg', imageKind: 'editorial-art' as const }, index: 1 },
      { item: { symbol: '603528', imageUrl: '/stock-editorial-art/macro-1.jpg', imageKind: 'source-cover' as const }, index: 2 },
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

  it('labels a date-only announcement as a disclosure date without inventing a time', () => {
    expect(discoveryTimeLabel('公告', '08-07')).toBe('08-07 · 披露日');
    expect(discoveryTimeLabel('公告', '08-07 09:30')).toBe('08-07 09:30');
    expect(discoveryTimeLabel('新闻', '08-07')).toBe('08-07');
  });
});
