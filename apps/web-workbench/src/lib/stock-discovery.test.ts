import { describe, expect, it } from 'vitest';
import {
  diversifyDiscoveryEditorialArt,
  diversifyDiscoveryItems,
  discoveryPageIndexes,
  discoveryTimeLabel,
  prioritizeAndDiversifyDiscoveryItems,
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

  it('suppresses unverified editorial art instead of presenting it as news media', () => {
    const [result] = diversifyDiscoveryEditorialArt([{
      item: {
        imageUrl: '/stock-editorial-art/market-2.jpg',
        imageKind: 'editorial-art' as const,
        editorialArtOptions: ['/stock-editorial-art/market-3.jpg'],
      },
      index: 0,
    }]);

    expect(result?.item.imageUrl).toBeUndefined();
    expect(result?.item.imageKind).toBeUndefined();
  });

  it('keeps the first verified source cover and falls back to text for repeats', () => {
    const items = [
      {
        item: {
          imageUrl: 'https://publisher.example/generic-market-photo.jpg',
          imageKind: 'source-cover' as const,
          editorialArtOptions: ['/stock-editorial-art/market-2.jpg'],
        },
        index: 0,
      },
      {
        item: {
          imageUrl: 'https://publisher.example/generic-market-photo.jpg',
          imageKind: 'source-cover' as const,
          editorialArtOptions: ['/stock-editorial-art/market-3.jpg'],
        },
        index: 1,
      },
    ];

    const diversified = diversifyDiscoveryEditorialArt(items);

    expect(diversified.map(({ item }) => item.imageUrl)).toEqual([
      'https://publisher.example/generic-market-photo.jpg',
      undefined,
    ]);
    expect(diversified[1]?.item.imageKind).toBeUndefined();
  });

  it('falls back to a title-first card when a verified source cover cannot load', () => {
    const items = [{
      item: {
        imageUrl: 'https://publisher.example/blocked-source-photo.jpg',
        imageKind: 'source-cover' as const,
        editorialArtOptions: ['/stock-editorial-art/technology-4.jpg'],
      },
      index: 0,
    }];

    const [fallback] = diversifyDiscoveryEditorialArt(
      items,
      new Set(['https://publisher.example/blocked-source-photo.jpg']),
    );

    expect(fallback?.item.imageUrl).toBeUndefined();
    expect(fallback?.item.imageKind).toBeUndefined();
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
