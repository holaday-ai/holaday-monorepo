import { describe, expect, it } from 'vitest';
import {
  quotaRefreshErrorMessage,
  quotaRefreshStatusCopy,
  quotaTaskState,
} from './quota-indicator-state';

describe('quota indicator state helpers', () => {
  it('calculates totals, remaining, and usage percentage defensively', () => {
    expect(
      quotaTaskState({
        plan: 'pro',
        period: 'month',
        tasksLimit: 20,
        tasksRemaining: 18,
        bonusTasks: 5,
      }),
    ).toMatchObject({
      totalLimit: 25,
      remaining: 18,
      usedPct: 28,
      periodLabel: '本月',
      lowOnTasks: false,
      outOfTasks: false,
    });

    expect(
      quotaTaskState({
        plan: 'free',
        period: 'day',
        tasksLimit: 10,
        tasksRemaining: -4,
        bonusTasks: 0,
      }),
    ).toMatchObject({
      remaining: 0,
      usedPct: 100,
      periodLabel: '今日',
      lowOnTasks: true,
      outOfTasks: true,
    });
  });

  it('keeps refresh failure copy distinct for stale and unavailable states', () => {
    expect(
      quotaRefreshStatusCopy({ error: 'offline', hasSnapshot: true })?.title,
    ).toBe('额度刷新失败，正在显示上次数据');
    expect(
      quotaRefreshStatusCopy({ error: 'offline', hasSnapshot: false })?.title,
    ).toBe('额度暂时不可用');
    expect(quotaRefreshStatusCopy({ error: null, hasSnapshot: true })).toBeNull();
  });

  it('normalizes quota refresh errors', () => {
    expect(quotaRefreshErrorMessage(new Error('offline'))).toBe('offline');
    expect(quotaRefreshErrorMessage('bad gateway')).toBe('bad gateway');
    expect(quotaRefreshErrorMessage({})).toBe('额度暂时无法刷新，请稍后重试。');
  });
});
