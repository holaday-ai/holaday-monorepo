import { describe, expect, it } from 'vitest';
import { diversifyDiscoveryItems, discoveryTimeLabel } from './stock-discovery';

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

  it('labels a date-only announcement as a disclosure date without inventing a time', () => {
    expect(discoveryTimeLabel('公告', '08-07')).toBe('08-07 · 披露日');
    expect(discoveryTimeLabel('公告', '08-07 09:30')).toBe('08-07 09:30');
    expect(discoveryTimeLabel('新闻', '08-07')).toBe('08-07');
  });
});
