import { describe, expect, it } from 'vitest';
import {
  notificationErrorMessage,
  notificationListStatusCopy,
  notificationListSummary,
  safeNotificationCount,
} from './notification-bell-state';

describe('notification bell state helpers', () => {
  it('summarizes loading, hard error, stale error, empty, and loaded states', () => {
    expect(notificationListSummary({ loading: true, error: null, count: 0 })).toBe(
      '通知加载中…',
    );
    expect(notificationListSummary({ loading: false, error: 'offline', count: 0 })).toBe(
      '通知加载失败',
    );
    expect(notificationListSummary({ loading: false, error: 'offline', count: 2 })).toBe(
      '刷新失败 · 显示 2 条通知',
    );
    expect(notificationListSummary({ loading: false, error: null, count: 0 })).toBe('暂无通知');
    expect(notificationListSummary({ loading: false, error: null, count: 3 })).toBe(
      '3 条通知',
    );
  });

  it('builds status copy without treating empty notifications as an error', () => {
    expect(notificationListStatusCopy({ loading: true, error: null, count: 0 })?.title).toBe(
      '通知加载中…',
    );
    expect(notificationListStatusCopy({ loading: false, error: 'offline', count: 0 })).toBeNull();
    expect(notificationListStatusCopy({ loading: false, error: 'offline', count: 1 })?.title).toBe(
      '刷新失败，正在显示上次成功加载的通知',
    );
    expect(notificationListStatusCopy({ loading: false, error: null, count: 0 })).toBeNull();
  });

  it('normalizes unknown notification errors', () => {
    expect(notificationErrorMessage(new Error('offline'))).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
    expect(notificationErrorMessage('通知不存在')).toBe('通知不存在');
    expect(notificationErrorMessage({})).toBe('请稍后重试');
  });

  it('normalizes malformed notification counts before rendering', () => {
    expect(safeNotificationCount(Number.NaN)).toBe(0);
    expect(safeNotificationCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(safeNotificationCount('4')).toBe(0);
    expect(safeNotificationCount(-2)).toBe(0);
    expect(safeNotificationCount(2.9)).toBe(2);
    expect(notificationListSummary({ loading: false, error: null, count: Number.NaN })).toBe(
      '暂无通知',
    );
    expect(notificationListStatusCopy({ loading: true, error: null, count: 'bad' })?.title).toBe(
      '通知加载中…',
    );
  });
});
