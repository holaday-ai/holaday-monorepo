import { describe, expect, it } from 'vitest';
import {
  normalizeQuotaSnapshot,
  quotaIndicatorHref,
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
        quotaMode: 'metered',
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
        quotaMode: 'metered',
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

    expect(
      quotaTaskState({
        plan: 'pro',
        period: 'month',
        quotaMode: 'metered',
        tasksLimit: Number.NaN,
        tasksRemaining: Number.POSITIVE_INFINITY,
        bonusTasks: 0,
      }),
    ).toMatchObject({
      totalLimit: 0,
      remaining: 0,
      usedPct: 0,
      lowOnTasks: false,
      outOfTasks: false,
    });
  });

  it('routes paid exhausted quotas directly to add-ons', () => {
    expect(
      quotaIndicatorHref({
        plan: 'basic',
        period: 'month',
        quotaMode: 'metered',
        tasksLimit: 100,
        tasksRemaining: 0,
        bonusTasks: 0,
      }),
    ).toBe('/plan#addons');
    expect(
      quotaIndicatorHref({
        plan: 'pro',
        period: 'month',
        quotaMode: 'metered',
        tasksLimit: 100,
        tasksRemaining: 3,
        bonusTasks: 0,
      }),
    ).toBe('/plan');
    expect(
      quotaIndicatorHref({
        plan: 'free',
        period: 'day',
        quotaMode: 'metered',
        tasksLimit: 3,
        tasksRemaining: 0,
        bonusTasks: 0,
      }),
    ).toBe('/plan');

    expect(
      quotaIndicatorHref({
        plan: 'basic',
        period: 'month',
        quotaMode: 'unmetered_test',
        tasksLimit: 100,
        tasksRemaining: 100,
        bonusTasks: 0,
      }),
    ).toBe('/usage');
  });

  it('normalizes valid quota snapshots and rejects malformed payloads', () => {
    expect(
      normalizeQuotaSnapshot({
        plan: 'pro',
        period: 'month',
        quotaMode: 'unmetered_test',
        tasksUsed: 3,
        tasksLimit: 20,
        tasksRemaining: 17,
        bonusTasks: 2,
        opusUsed: 1,
        opusLimit: null,
        opusRemaining: null,
        bonusOpus: 0,
        concurrentCount: 0,
        concurrencyLimit: 3,
      }),
    ).toMatchObject({
      plan: 'pro',
      period: 'month',
      quotaMode: 'unmetered_test',
      tasksLimit: 20,
      tasksRemaining: 17,
      opusLimit: null,
    });

    expect(
      normalizeQuotaSnapshot({
        daily: { used: 1, limit: 100 },
        monthly: { used: 1, limit: 1000 },
      }),
    ).toBeNull();
    expect(
      normalizeQuotaSnapshot({
        plan: 'pro',
        period: 'month',
        quotaMode: 'metered',
        tasksUsed: 1,
        tasksLimit: Number.NaN,
        tasksRemaining: 3,
        bonusTasks: 0,
        opusUsed: 0,
        bonusOpus: 0,
        concurrentCount: 0,
        concurrencyLimit: 3,
      }),
    ).toBeNull();
  });

  it('keeps refresh failure copy distinct for stale and unavailable states', () => {
    expect(quotaRefreshStatusCopy({ error: 'offline', hasSnapshot: true })?.title).toBe(
      '额度刷新失败，正在显示上次数据',
    );
    expect(quotaRefreshStatusCopy({ error: 'offline', hasSnapshot: false })?.title).toBe(
      '额度暂时不可用',
    );
    expect(quotaRefreshStatusCopy({ error: null, hasSnapshot: true })).toBeNull();
  });

  it('normalizes quota refresh errors', () => {
    expect(quotaRefreshErrorMessage(new Error('offline'))).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
    expect(quotaRefreshErrorMessage('额度不足')).toBe('额度不足');
    expect(quotaRefreshErrorMessage({})).toBe('额度暂时无法刷新，请稍后重试。');
  });
});
