import { describe, expect, it } from 'vitest';
import {
  formatUsageDay,
  hasRecentUsage,
  usageDayBars,
  usageErrorMessage,
  usagePageSummary,
  usagePercent,
  usageQuotaTotal,
  usageStatusCopy,
} from './usage-page-state';

const snapshot = {
  monthTasksTotal: 12,
  quotaLimit: 20,
  quotaUsed: 8,
  quotaBonus: 5,
  dailyCounts: [
    { date: '2026-05-23', count: 2 },
    { date: '2026-05-24', count: 0 },
  ],
};

describe('usage page state helpers', () => {
  it('calculates quota totals and percentages defensively', () => {
    expect(usageQuotaTotal(snapshot)).toBe(25);
    expect(usagePercent(8, 25)).toBe(32);
    expect(usagePercent(40, 20)).toBe(100);
    expect(usagePercent(-1, 20)).toBe(0);
    expect(usagePercent(1, 0)).toBe(0);
  });

  it('summarizes loading, failed, empty, and loaded states', () => {
    expect(usagePageSummary({ loading: true, error: null, snapshot: null })).toBe('用量加载中…');
    expect(usagePageSummary({ loading: false, error: 'offline', snapshot: null })).toBe(
      '用量加载失败',
    );
    expect(usagePageSummary({ loading: false, error: 'offline', snapshot })).toBe(
      '刷新失败 · 显示上次用量',
    );
    expect(usagePageSummary({ loading: false, error: null, snapshot: null })).toBe('暂无用量数据');
    expect(usagePageSummary({ loading: false, error: null, snapshot })).toBe(
      '本月 12 次执行 · 32% 已使用',
    );
  });

  it('builds status copy for loading, hard errors, and stale errors', () => {
    expect(usageStatusCopy({ loading: true, error: null, snapshot: null })?.title).toBe(
      '用量加载中…',
    );
    expect(usageStatusCopy({ loading: false, error: 'offline', snapshot: null })).toEqual({
      title: '用量加载失败',
      body: 'offline',
    });
    expect(usageStatusCopy({ loading: false, error: 'offline', snapshot })?.title).toBe(
      '刷新失败，正在显示上次成功加载的用量',
    );
    expect(usageStatusCopy({ loading: false, error: null, snapshot })).toBeNull();
  });

  it('formats recent usage day labels relative to today', () => {
    const today = new Date('2026-05-24T00:00:00.000Z');

    expect(formatUsageDay(new Date('2026-05-24T00:00:00.000Z'), today)).toBe('今天');
    expect(formatUsageDay(new Date('2026-05-23T00:00:00.000Z'), today)).toBe('昨天');
    expect(formatUsageDay(new Date('2026-05-20T00:00:00.000Z'), today)).toBe('5/20');
  });

  it('builds non-negative day bars and detects recent activity', () => {
    const bars = usageDayBars(
      [
        { date: '2026-05-23', count: -1 },
        { date: '2026-05-24', count: 2 },
      ],
      new Date('2026-05-24T00:00:00.000Z'),
    );

    expect(bars.map((bar) => bar.count)).toEqual([0, 2]);
    expect(hasRecentUsage(bars)).toBe(true);
    expect(hasRecentUsage([{ count: 0 }, { count: 0 }])).toBe(false);
  });

  it('normalizes unknown usage errors', () => {
    expect(usageErrorMessage(new Error('offline'))).toBe('offline');
    expect(usageErrorMessage('bad gateway')).toBe('bad gateway');
    expect(usageErrorMessage({})).toBe('请稍后重试');
  });
});
