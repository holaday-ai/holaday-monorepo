import { describe, expect, it } from 'vitest';
import {
  nextSearchActiveIndex,
  searchOverlayErrorMessage,
  searchOverlayStatusCopy,
} from './search-overlay-state';

describe('search overlay state helpers', () => {
  it('keeps keyboard active index in range', () => {
    expect(nextSearchActiveIndex({ current: 0, direction: 'down', count: 0 })).toBe(0);
    expect(nextSearchActiveIndex({ current: -1, direction: 'down', count: 3 })).toBe(0);
    expect(nextSearchActiveIndex({ current: 2, direction: 'down', count: 3 })).toBe(2);
    expect(nextSearchActiveIndex({ current: 4, direction: 'up', count: 3 })).toBe(1);
    expect(nextSearchActiveIndex({ current: 0, direction: 'up', count: 3 })).toBe(0);
  });

  it('distinguishes hard search failures from stale result failures', () => {
    expect(
      searchOverlayStatusCopy({
        query: '日报',
        searching: false,
        error: 'offline',
        resultCount: 0,
      }),
    ).toEqual({
      title: '搜索失败',
      body: 'offline',
      retry: true,
    });

    expect(
      searchOverlayStatusCopy({
        query: '日报',
        searching: false,
        error: 'offline',
        resultCount: 2,
      })?.title,
    ).toBe('搜索失败，正在显示上次结果');
  });

  it('normalizes unknown search errors', () => {
    expect(searchOverlayErrorMessage(new Error('offline'))).toBe('offline');
    expect(searchOverlayErrorMessage('bad gateway')).toBe('bad gateway');
    expect(searchOverlayErrorMessage({})).toBe('搜索暂时不可用，请稍后重试。');
  });
});
