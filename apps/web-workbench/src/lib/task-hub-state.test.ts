import { describe, expect, it } from 'vitest';
import {
  formatTaskHubTime,
  hasHistoryFilters,
  historyFilterRequestKey,
  historyPageSummary,
  mergeTaskHubRowsById,
  normalizeTaskHubCursor,
  normalizeTaskHubRows,
  shouldApplyHistoryResponse,
  starredPageSummary,
  taskHubErrorMessage,
  taskHubLoadMoreErrorCopy,
  taskHubNeedsAttention,
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

  it('marks awaiting task hub rows as needing attention', () => {
    expect(taskHubNeedsAttention('awaiting_user')).toBe(true);
    expect(taskHubNeedsAttention('executing')).toBe(false);
    expect(taskHubNeedsAttention('completed')).toBe(false);
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

  it('merges paginated hub rows by replacing duplicates in place', () => {
    const older = { taskId: 'tsk_dup', status: 'executing' };
    const stable = { taskId: 'tsk_stable', status: 'completed' };
    const fresh = { taskId: 'tsk_dup', status: 'completed' };
    const appended = { taskId: 'tsk_new', status: 'failed' };

    expect(mergeTaskHubRowsById([older, stable], [fresh, appended])).toEqual([
      fresh,
      stable,
      appended,
    ]);
  });

  it('formats dates and errors defensively', () => {
    const now = new Date('2026-05-24T12:00:00.000Z');
    expect(formatTaskHubTime('2026-05-24T01:05:00.000Z', now)).toBe('今天 10:05');
    expect(formatTaskHubTime('2026-05-20T01:05:00.000Z', now)).toBe('2026-05-20 10:05');
    expect(formatTaskHubTime('not-a-date', now)).toBe('—');
    expect(taskHubErrorMessage(new Error('offline'))).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
    expect(taskHubErrorMessage('任务不存在')).toBe('任务不存在');
    expect(taskHubErrorMessage({})).toBe('请稍后重试');
  });

  it('formats load-more errors for task hub pages', () => {
    expect(taskHubLoadMoreErrorCopy('  offline  ')).toEqual({
      title: '更多任务暂时无法加载',
      body: 'offline',
    });
    expect(taskHubLoadMoreErrorCopy(undefined)).toEqual({
      title: '更多任务暂时无法加载',
      body: '请稍后重试，当前列表会保留已加载的任务。',
    });
  });

  it('normalizes task hub rows before history or starred rendering', () => {
    expect(
      normalizeTaskHubRows([
        null,
        { taskId: '', intent: 'missing id' },
        {
          taskId: ' tsk_1 ',
          intent: ' Check weekly metrics ',
          title: '  Metrics summary ',
          status: 'completed',
          awaitingKind: 'captcha',
          createdAt: ' 2026-05-25T00:00:00.000Z ',
          completedAt: ' 2026-05-25T00:05:00.000Z ',
          starredAt: 1780000000000,
        },
      ]),
    ).toEqual([
      {
        taskId: 'tsk_1',
        intent: 'Check weekly metrics',
        title: 'Metrics summary',
        status: 'completed',
        awaitingKind: 'captcha',
        createdAt: '2026-05-25T00:00:00.000Z',
        completedAt: '2026-05-25T00:05:00.000Z',
        starredAt: 1780000000000,
      },
    ]);
  });

  it('falls back from malformed task hub fields safely', () => {
    expect(
      normalizeTaskHubRows([
        {
          taskId: 'tsk_2',
          intent: { unsafe: true },
          title: { unsafe: true },
          status: 'mystery',
          awaitingKind: 'bad',
          createdAt: { unsafe: true },
          completedAt: Number.POSITIVE_INFINITY,
          starredAt: 'not-a-date',
        },
      ]),
    ).toEqual([
      {
        taskId: 'tsk_2',
        intent: '未命名任务',
        title: null,
        status: 'queued',
        awaitingKind: null,
        createdAt: '',
        completedAt: null,
        starredAt: null,
      },
    ]);
  });

  it('normalizes task hub cursors', () => {
    expect(normalizeTaskHubCursor(50)).toBe(50);
    expect(normalizeTaskHubCursor(0)).toBeNull();
    expect(normalizeTaskHubCursor('50')).toBeNull();
    expect(normalizeTaskHubCursor(Number.NaN)).toBeNull();
  });
});
