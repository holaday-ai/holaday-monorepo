import { describe, expect, it } from 'vitest';
import {
  notificationErrorMessage,
  notificationListStatusCopy,
  notificationListSummary,
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
    expect(notificationErrorMessage(new Error('offline'))).toBe('offline');
    expect(notificationErrorMessage('bad gateway')).toBe('bad gateway');
    expect(notificationErrorMessage({})).toBe('请稍后重试');
  });
});
