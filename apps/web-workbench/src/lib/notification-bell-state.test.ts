import { describe, expect, it } from 'vitest';
import {
  notificationBadgeText,
  notificationButtonTitle,
  notificationErrorMessage,
  notificationListStatusCopy,
  notificationListSummary,
  mergeNotificationRows,
  normalizeNotificationPage,
  safeNotificationCount,
  shouldRenderCompactNotificationDot,
} from './notification-bell-state';

describe('notification bell state helpers', () => {
  it('summarizes loading, hard error, stale error, empty, and loaded states', () => {
    expect(notificationListSummary({ loading: true, error: null, count: 0 })).toBe(
      '通知加载中…',
    );
    expect(notificationListSummary({ loading: false, error: 'offline', count: 0 })).toBe(
      '通知暂时无法加载',
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

  it('keeps the mobile header badge compact when unread counts grow', () => {
    expect(notificationBadgeText(3, 'mobile-header')).toBe('3');
    expect(notificationBadgeText(10, 'mobile-header')).toBe('');
    expect(shouldRenderCompactNotificationDot(10, 'mobile-header')).toBe(true);
    expect(notificationBadgeText(22, 'sidebar-footer')).toBe('22');
    expect(notificationBadgeText(120, 'sidebar-footer')).toBe('99+');
    expect(shouldRenderCompactNotificationDot(120, 'sidebar-footer')).toBe(false);
  });

  it('does not use native browser titles for fixed topbar controls', () => {
    expect(notificationButtonTitle(56, 'topbar')).toBeUndefined();
    expect(notificationButtonTitle(0, 'topbar')).toBeUndefined();
    expect(notificationButtonTitle(56, 'sidebar-footer')).toBe('通知，56 条未读');
    expect(notificationButtonTitle(0, 'sidebar-footer')).toBe('通知');
  });

  it('normalizes paginated notification responses and preserves legacy arrays', () => {
    const item = {
      notificationId: 'not_1',
      type: 'task_complete',
      title: '完成',
      message: '任务已完成',
      isRead: false,
      createdAt: '2026-08-05T00:00:00.000Z',
      scheduledTaskInternalId: null,
    };
    expect(
      normalizeNotificationPage({
        items: [item],
        nextCursor: { id: 9, createdAt: '2026-08-05T00:00:00.000Z' },
      }),
    ).toEqual({
      items: [item],
      nextCursor: { id: 9, createdAt: '2026-08-05T00:00:00.000Z' },
    });
    expect(normalizeNotificationPage([item])).toEqual({ items: [item], nextCursor: null });
  });

  it('appends notification pages without duplicating realtime rows', () => {
    const base = {
      type: 'task_complete',
      title: '完成',
      message: '',
      isRead: false,
      createdAt: '2026-08-05T00:00:00.000Z',
      scheduledTaskInternalId: null,
    };
    expect(
      mergeNotificationRows(
        [{ ...base, notificationId: 'not_1' }],
        [
          { ...base, notificationId: 'not_1', isRead: true },
          { ...base, notificationId: 'not_2' },
        ],
      ).map((row) => [row.notificationId, row.isRead]),
    ).toEqual([
      ['not_1', true],
      ['not_2', false],
    ]);
  });
});
