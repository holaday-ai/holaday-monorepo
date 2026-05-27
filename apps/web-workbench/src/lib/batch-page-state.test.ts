import { describe, expect, it } from 'vitest';
import {
  batchDetailSummary,
  batchErrorMessage,
  batchFinishedCount,
  batchListSummary,
  batchProgressPercent,
  batchRemainingCount,
  batchStatusCopy,
  normalizeBatchDetail,
  normalizeBatchRows,
  safeBatchCount,
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
    expect(
      batchProgressPercent({
        total: Number.NaN,
        done: Number.POSITIVE_INFINITY,
        failed: 1,
        cancelled: 1,
      }),
    ).toBe(0);
  });

  it('calculates finished batch work defensively', () => {
    expect(batchFinishedCount({ done: 4, failed: 1, cancelled: 1 })).toBe(6);
    expect(batchFinishedCount({ done: -1, failed: -1, cancelled: -1 })).toBe(0);
    expect(
      batchFinishedCount({
        done: Number.POSITIVE_INFINITY,
        failed: Number.NaN,
        cancelled: 2.8,
      }),
    ).toBe(2);
  });

  it('calculates remaining batch work defensively', () => {
    expect(batchRemainingCount({ total: 10, done: 4, failed: 1, cancelled: 1 })).toBe(4);
    expect(batchRemainingCount({ total: 10, done: 99, failed: 0, cancelled: 0 })).toBe(0);
    expect(batchRemainingCount({ total: 0, done: 1, failed: 1, cancelled: 1 })).toBe(0);
    expect(batchRemainingCount({ total: 10, done: -1, failed: -1, cancelled: -1 })).toBe(10);
    expect(
      batchRemainingCount({
        total: Number.NaN,
        done: Number.POSITIVE_INFINITY,
        failed: 1,
        cancelled: 1,
      }),
    ).toBe(0);
  });

  it('normalizes unknown errors', () => {
    expect(batchErrorMessage(new Error('offline'))).toBe('offline');
    expect(batchErrorMessage('bad gateway')).toBe('bad gateway');
    expect(batchErrorMessage({})).toBe('请稍后重试');
  });

  it('normalizes malformed batch counters before rendering', () => {
    expect(safeBatchCount(Number.NaN)).toBe(0);
    expect(safeBatchCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(safeBatchCount('7')).toBe(0);
    expect(safeBatchCount(-3)).toBe(0);
    expect(safeBatchCount(4.8)).toBe(4);
    expect(batchListSummary({ loading: false, error: null, count: Number.NaN })).toBe(
      '暂无批量任务',
    );
    expect(
      batchDetailSummary({
        loading: false,
        error: null,
        total: Number.NaN,
        finished: Number.POSITIVE_INFINITY,
      }),
    ).toBe('0 / 0 已处理');
  });

  it('normalizes batch list rows before rendering', () => {
    expect(
      normalizeBatchRows([
        null,
        { name: 'missing id', batchId: '', itemsTotal: 1 },
        {
          batchId: ' batch_1 ',
          name: ' Competitor scan ',
          status: 'partial',
          concurrency: 3,
          itemsTotal: 10.9,
          itemsDone: 4,
          itemsFailed: 2,
          itemsCancelled: 1,
          createdAt: ' 2026-05-25T00:00:00.000Z ',
          completedAt: null,
        },
      ]),
    ).toEqual([
      {
        batchId: 'batch_1',
        name: 'Competitor scan',
        status: 'partial',
        concurrency: 3,
        itemsTotal: 10,
        itemsDone: 4,
        itemsFailed: 2,
        itemsCancelled: 1,
        createdAt: '2026-05-25T00:00:00.000Z',
        completedAt: null,
      },
    ]);
  });

  it('falls back from malformed batch row fields safely', () => {
    expect(
      normalizeBatchRows([
        {
          batchId: 'batch_2',
          name: { unsafe: true },
          status: 'unknown',
          concurrency: -1,
          itemsTotal: Number.NaN,
          itemsDone: Number.POSITIVE_INFINITY,
          itemsFailed: -2,
          itemsCancelled: { unsafe: true },
          createdAt: { unsafe: true },
          completedAt: { unsafe: true },
        },
      ]),
    ).toEqual([
      {
        batchId: 'batch_2',
        name: null,
        status: 'pending',
        concurrency: 1,
        itemsTotal: 0,
        itemsDone: 0,
        itemsFailed: 0,
        itemsCancelled: 0,
        createdAt: '',
        completedAt: null,
      },
    ]);
  });

  it('normalizes batch detail items and drops item rows without ids', () => {
    const detail = normalizeBatchDetail({
      batchId: 'batch_3',
      name: null,
      status: 'running',
      concurrency: 2,
      itemsTotal: 2,
      itemsDone: 1,
      itemsFailed: 0,
      itemsCancelled: 0,
      createdAt: '2026-05-25T00:00:00.000Z',
      completedAt: null,
      items: [
        { batchItemId: '', prompt: 'missing id' },
        {
          batchItemId: ' item_1 ',
          seq: -10,
          prompt: { unsafe: true },
          status: 'unknown',
          errorMessage: { unsafe: true },
          taskId: { unsafe: true },
          createdAt: { unsafe: true },
          completedAt: { unsafe: true },
        },
        {
          batchItemId: 'item_2',
          seq: 7,
          prompt: ' Launch checklist ',
          status: 'completed',
          errorMessage: null,
          taskId: ' tsk_1 ',
          createdAt: '2026-05-25T00:00:00.000Z',
          completedAt: '2026-05-25T00:05:00.000Z',
        },
      ],
    });

    expect(detail?.items).toEqual([
      {
        batchItemId: 'item_1',
        seq: 1,
        prompt: '未命名任务',
        status: 'pending',
        errorMessage: null,
        taskId: null,
        createdAt: '',
        completedAt: null,
      },
      {
        batchItemId: 'item_2',
        seq: 7,
        prompt: 'Launch checklist',
        status: 'completed',
        errorMessage: null,
        taskId: 'tsk_1',
        createdAt: '2026-05-25T00:00:00.000Z',
        completedAt: '2026-05-25T00:05:00.000Z',
      },
    ]);
  });
});
