import { describe, expect, it } from 'vitest';
import {
  nextSearchActiveIndex,
  normalizeSearchOverlayRows,
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
    expect(searchOverlayErrorMessage(new Error('offline'))).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
    expect(searchOverlayErrorMessage('搜索词不能为空')).toBe('搜索词不能为空');
    expect(searchOverlayErrorMessage({})).toBe('搜索暂时不可用，请稍后重试。');
  });

  it('normalizes server search rows before rendering', () => {
    expect(
      normalizeSearchOverlayRows([
        null,
        { taskId: '', intent: 'missing id' },
        {
          taskId: ' tsk_1 ',
          intent: '  Weekly report  ',
          title: '  Report title  ',
          status: 'completed',
          awaitingKind: 'login',
        },
        {
          taskId: 'tsk_2',
          intent: { unsafe: true },
          title: { unsafe: true },
          status: 'mystery',
          awaitingKind: 'mystery',
        },
      ]),
    ).toEqual([
      {
        taskId: 'tsk_1',
        intent: 'Weekly report',
        title: 'Report title',
        status: 'completed',
        awaitingKind: 'login',
      },
      {
        taskId: 'tsk_2',
        intent: '未命名任务',
        title: null,
        status: 'queued',
        awaitingKind: null,
      },
    ]);
  });

  it('treats malformed search row collections as empty', () => {
    expect(normalizeSearchOverlayRows({ tasks: [] })).toEqual([]);
    expect(normalizeSearchOverlayRows('bad')).toEqual([]);
  });
});
