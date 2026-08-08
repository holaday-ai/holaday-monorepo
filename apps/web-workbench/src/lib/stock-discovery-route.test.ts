import { describe, expect, it } from 'vitest';
import {
  discoveryFeedSearch,
  parseDiscoveryFeed,
} from '@/lib/stock-discovery-route';

describe('stock discovery route state', () => {
  it('defaults absent or malformed feeds to all discovery items', () => {
    expect(parseDiscoveryFeed('')).toBe('全部');
    expect(parseDiscoveryFeed('?feed=unknown')).toBe('全部');
  });

  it('preserves a supported selected feed and omits all-feed query state', () => {
    expect(parseDiscoveryFeed('?feed=A%E8%82%A1%E8%A6%81%E9%97%BB')).toBe('A股要闻');
    expect(discoveryFeedSearch('A股要闻')).toBe('?feed=A%E8%82%A1%E8%A6%81%E9%97%BB');
    expect(discoveryFeedSearch('全部')).toBe('');
  });
});
