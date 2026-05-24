import { describe, expect, it } from 'vitest';
import {
  batchDetailSummary,
  batchErrorMessage,
  batchListSummary,
  batchProgressPercent,
  batchStatusCopy,
} from './batch-page-state';

describe('batch page state helpers', () => {
  it('summarizes batch list states', () => {
    expect(batchListSummary({ loading: true, error: null, count: 0 })).toBe(
      '批量任务加载中…',
    );
    expect(batchListSummary({ loading: false, error: 'offline', count: 0 })).toBe(
      '批量任务加载失败',
    );
    expect(batchListSummary({ loading: false, error: 'offline', count: 2 })).toBe(
      '刷新失败 · 显示 2 个批量',
    );
    expect(batchListSummary({ loading: false, error: null, count: 0 })).toBe('暂无批量任务');
    expect(batchListSummary({ loading: false, error: null, count: 3 })).toBe('共 3 个批量任务');
  });

  it('summarizes batch detail states', () => {
    expect(batchDetailSummary({ loading: true, error: null, total: null, finished: 0 })).toBe(
      '详情加载中…',
    );
    expect(batchDetailSummary({ loading: false, error: 'offline', total: null, finished: 0 })).toBe(
      '详情加载失败',
    );
    expect(batchDetailSummary({ loading: false, error: 'offline', total: 5, finished: 2 })).toBe(
      '刷新失败 · 显示上次详情',
    );
    expect(batchDetailSummary({ loading: false, error: null, total: 5, finished: 3 })).toBe(
      '3 / 5 已处理',
    );
  });

  it('builds loading, hard-error, and stale-error status copy', () => {
    expect(
      batchStatusCopy({ loading: true, error: null, hasData: false, target: 'list' })?.title,
    ).toBe('批量任务加载中…');
    expect(batchStatusCopy({ loading: false, error: 'offline', hasData: false, target: 'detail' }))
      .toEqual({
        title: '批量任务详情加载失败',
        body: 'offline',
      });
    expect(
      batchStatusCopy({ loading: false, error: 'offline', hasData: true, target: 'detail' })?.title,
    ).toBe('刷新失败，正在显示上次成功加载的批量任务详情');
    expect(batchStatusCopy({ loading: false, error: null, hasData: true, target: 'list' })).toBeNull();
  });

  it('calculates progress percent defensively', () => {
    expect(batchProgressPercent({ total: 10, done: 4, failed: 1, cancelled: 1 })).toBe(60);
    expect(batchProgressPercent({ total: 10, done: 99, failed: 0, cancelled: 0 })).toBe(100);
    expect(batchProgressPercent({ total: 0, done: 1, failed: 1, cancelled: 1 })).toBe(0);
    expect(batchProgressPercent({ total: 10, done: -1, failed: -1, cancelled: -1 })).toBe(0);
  });

  it('normalizes unknown errors', () => {
    expect(batchErrorMessage(new Error('offline'))).toBe('offline');
    expect(batchErrorMessage('bad gateway')).toBe('bad gateway');
    expect(batchErrorMessage({})).toBe('请稍后重试');
  });
});
