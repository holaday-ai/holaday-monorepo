import { describe, expect, it } from 'vitest';
import {
  scheduledCalendarErrorMessage,
  scheduledCalendarStatusCopy,
  scheduledCalendarSummary,
  shouldOpenScheduledCalendarPopover,
} from './scheduled-calendar-state';

describe('scheduled calendar state helpers', () => {
  it('summarizes loading, error, stale, empty, and loaded states', () => {
    expect(scheduledCalendarSummary({ loading: true, error: null, count: 0 })).toBe(
      '定时任务加载中…',
    );
    expect(scheduledCalendarSummary({ loading: false, error: 'offline', count: 0 })).toBe(
      '定时任务暂时无法加载',
    );
    expect(scheduledCalendarSummary({ loading: false, error: 'offline', count: 3 })).toBe(
      '刷新失败 · 显示 3 个计划',
    );
    expect(scheduledCalendarSummary({ loading: false, error: null, count: 0 })).toBe(
      '本视图暂无计划',
    );
    expect(scheduledCalendarSummary({ loading: false, error: null, count: 2 })).toBe(
      '本视图 2 个计划',
    );
  });

  it('builds page status copy without treating empty as an error', () => {
    expect(scheduledCalendarStatusCopy({ loading: true, error: null, count: 0 })?.title).toBe(
      '定时任务加载中…',
    );
    expect(scheduledCalendarStatusCopy({ loading: false, error: 'offline', count: 0 })).toEqual({
      title: '定时任务暂时无法加载',
      body: 'offline',
    });
    expect(scheduledCalendarStatusCopy({ loading: false, error: 'offline', count: 1 })?.title).toBe(
      '刷新失败，正在显示上次成功加载的计划',
    );
    expect(scheduledCalendarStatusCopy({ loading: false, error: null, count: 0 })?.title).toBe(
      '当前视图暂无定时任务',
    );
    expect(scheduledCalendarStatusCopy({ loading: false, error: null, count: 1 })).toBeNull();
  });

  it('normalizes unknown errors', () => {
    expect(scheduledCalendarErrorMessage(new Error('offline'))).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
    expect(scheduledCalendarErrorMessage('计划不存在')).toBe('计划不存在');
    expect(scheduledCalendarErrorMessage({})).toBe('请稍后重试');
  });

  it('does not let a calendar click bypass an open quick-create draft', () => {
    expect(
      shouldOpenScheduledCalendarPopover({
        quickCreateOpen: true,
        popoverClosedAt: 0,
        now: 1_000,
      }),
    ).toBe(false);
    expect(
      shouldOpenScheduledCalendarPopover({
        quickCreateOpen: false,
        popoverClosedAt: 900,
        now: 1_000,
      }),
    ).toBe(false);
    expect(
      shouldOpenScheduledCalendarPopover({
        quickCreateOpen: false,
        popoverClosedAt: 0,
        now: 1_000,
      }),
    ).toBe(true);
  });
});
