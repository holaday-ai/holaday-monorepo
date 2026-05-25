import { describe, expect, it } from 'vitest';
import {
  formatTaskHubTime,
  hasHistoryFilters,
  historyFilterRequestKey,
  historyPageSummary,
  shouldApplyHistoryResponse,
  starredPageSummary,
  taskHubErrorMessage,
} from './task-hub-state';

describe('task hub state helpers', () => {
  it('treats the default history range as the unfiltered baseline', () => {
    expect(hasHistoryFilters({ query: '', status: 'all', range: '30d' })).toBe(false);
    expect(hasHistoryFilters({ query: ' invoice ', status: 'all', range: '30d' })).toBe(true);
    expect(hasHistoryFilters({ query: '', status: 'failed', range: '30d' })).toBe(true);
    expect(hasHistoryFilters({ query: '', status: 'all', range: 'all' })).toBe(true);
  });

  it('summarizes history page states', () => {
    expect(
      historyPageSummary({
        loading: true,
        error: null,
        count: 0,
        hasMore: false,
        query: '',
        status: 'all',
        range: '30d',
      }),
    ).toBe('历史任务加载中…');
    expect(
      historyPageSummary({
        loading: false,
        error: 'offline',
        count: 8,
        hasMore: true,
        query: '',
        status: 'all',
        range: '30d',
      }),
    ).toBe('刷新失败 · 显示 8+ 条');
    expect(
      historyPageSummary({
        loading: false,
        error: 'offline',
        count: 0,
        hasMore: false,
        query: '',
        status: 'all',
        range: '30d',
      }),
    ).toBe('历史任务加载失败');
    expect(
      historyPageSummary({
        loading: false,
        error: null,
        count: 50,
        hasMore: true,
        query: '',
        status: 'all',
        range: '30d',
      }),
    ).toBe('近 30 天 50+ 条');
    expect(
      historyPageSummary({
        loading: false,
        error: null,
        count: 3,
        hasMore: false,
        query: '报表',
        status: 'all',
        range: '30d',
      }),
    ).toBe('当前筛选 3 条');
  });

  it('summarizes starred task states', () => {
    expect(starredPageSummary({ loading: true, error: null, count: 0, hasMore: false })).toBe(
      '置顶任务加载中…',
    );
    expect(starredPageSummary({ loading: false, error: 'offline', count: 0, hasMore: false })).toBe(
      '置顶任务加载失败',
    );
    expect(starredPageSummary({ loading: false, error: 'offline', count: 3, hasMore: true })).toBe(
      '刷新失败 · 显示 3+ 个',
    );
    expect(starredPageSummary({ loading: false, error: null, count: 50, hasMore: true })).toBe(
      '已置顶 50+ 个',
    );
  });

  it('keys history requests to the active filter set', () => {
    const activeKey = historyFilterRequestKey({
      query: ' 报表 ',
      status: 'failed',
      range: '7d',
    });
    expect(activeKey).toBe('failed\n7d\n报表');
    expect(
      shouldApplyHistoryResponse({
        requestKey: activeKey,
        activeKey,
      }),
    ).toBe(true);
    expect(
      shouldApplyHistoryResponse({
        requestKey: 'all\n30d\n',
        activeKey,
      }),
    ).toBe(false);
  });

  it('formats dates and errors defensively', () => {
    const now = new Date('2026-05-24T12:00:00.000Z');
    expect(formatTaskHubTime('2026-05-24T01:05:00.000Z', now)).toBe('今天 10:05');
    expect(formatTaskHubTime('2026-05-20T01:05:00.000Z', now)).toBe('2026-05-20 10:05');
    expect(formatTaskHubTime('not-a-date', now)).toBe('—');
    expect(taskHubErrorMessage(new Error('offline'))).toBe('offline');
    expect(taskHubErrorMessage('bad')).toBe('请稍后重试');
  });
});
