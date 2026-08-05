import { describe, expect, it } from 'vitest';
import {
  batchDetailRemainingCount,
  batchDetailSummary,
  batchErrorMessage,
  batchFinishedCount,
  batchListSummary,
  batchProgressPercent,
  batchRemainingCount,
  batchShouldPoll,
  batchStatusLabel,
  batchStatusCopy,
  batchPromptImportStateReset,
  mergeBatchRows,
  normalizeBatchPage,
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
      '批量任务暂时无法加载',
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
      '详情暂时无法加载',
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
        title: '批量任务详情暂时无法加载',
        body: 'offline',
      });
    expect(
      batchStatusCopy({ loading: false, error: 'offline', hasData: true, target: 'detail' })?.title,
    ).toBe('刷新失败，正在显示上次成功加载的批量任务详情');
    expect(batchStatusCopy({ loading: false, error: null, hasData: true, target: 'list' })).toBeNull();
  });

  it('calculates progress percent defensively', () => {
    expect(batchProgressPercent({ total: 10, done: 4, review: 2, failed: 1, cancelled: 1 })).toBe(80);
    expect(batchProgressPercent({ total: 10, done: 99, failed: 0, cancelled: 0 })).toBe(100);
    expect(batchProgressPercent({ total: 0, done: 1, review: 1, failed: 1, cancelled: 1 })).toBe(0);
    expect(batchProgressPercent({ total: 10, done: -1, review: -1, failed: -1, cancelled: -1 })).toBe(0);
    expect(
      batchProgressPercent({
        total: Number.NaN,
        done: Number.POSITIVE_INFINITY,
        review: 1,
        failed: 1,
        cancelled: 1,
      }),
    ).toBe(0);
  });

  it('calculates finished batch work defensively', () => {
    expect(batchFinishedCount({ done: 4, review: 2, failed: 1, cancelled: 1 })).toBe(8);
    expect(batchFinishedCount({ done: -1, review: -1, failed: -1, cancelled: -1 })).toBe(0);
    expect(
      batchFinishedCount({
        done: Number.POSITIVE_INFINITY,
        review: 1.2,
        failed: Number.NaN,
        cancelled: 2.8,
      }),
    ).toBe(3);
  });

  it('calculates remaining batch work defensively', () => {
    expect(batchRemainingCount({ total: 10, done: 4, review: 2, failed: 1, cancelled: 1 })).toBe(2);
    expect(batchRemainingCount({ total: 10, done: 99, failed: 0, cancelled: 0 })).toBe(0);
    expect(batchRemainingCount({ total: 0, done: 1, review: 1, failed: 1, cancelled: 1 })).toBe(0);
    expect(batchRemainingCount({ total: 10, done: -1, review: -1, failed: -1, cancelled: -1 })).toBe(10);
    expect(
      batchRemainingCount({
        total: Number.NaN,
        done: Number.POSITIVE_INFINITY,
        review: 1,
        failed: 1,
        cancelled: 1,
      }),
    ).toBe(0);
  });

  it('includes review-needed items when deriving detail remaining work', () => {
    expect(
      batchDetailRemainingCount({
        itemsTotal: 10,
        itemsDone: 4,
        itemsReview: 2,
        itemsFailed: 1,
        itemsCancelled: 1,
      }),
    ).toBe(2);
  });

  it('clears imported prompt state through router navigation without changing the URL', () => {
    expect(
      batchPromptImportStateReset({
        pathname: '/batch',
        search: '?source=composer',
        hash: '#new',
      }),
    ).toEqual({
      to: {
        pathname: '/batch',
        search: '?source=composer',
        hash: '#new',
      },
      options: {
        replace: true,
        state: null,
      },
    });
  });

  it('normalizes unknown errors', () => {
    expect(batchErrorMessage(new Error('offline'))).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
    expect(batchErrorMessage('批量任务不存在')).toBe('批量任务不存在');
    expect(batchErrorMessage({})).toBe('请稍后重试');
  });

  it('polls only batches that can still make progress', () => {
    expect(batchShouldPoll('pending')).toBe(true);
    expect(batchShouldPoll('running')).toBe(true);
    expect(batchShouldPoll('completed')).toBe(false);
    expect(batchShouldPoll('partial')).toBe(false);
    expect(batchShouldPoll('cancelled')).toBe(false);
    expect(batchShouldPoll(null)).toBe(false);
  });

  it('labels partial parent batches as not fully successful, not pure failures', () => {
    expect(batchStatusLabel('pending')).toBe('等待中');
    expect(batchStatusLabel('running')).toBe('运行中');
    expect(batchStatusLabel('completed')).toBe('全部完成');
    expect(batchStatusLabel('partial')).toBe('部分未成功');
    expect(batchStatusLabel('cancelled')).toBe('已取消');
    expect(batchStatusLabel('archived')).toBe('archived');
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
          itemsReview: 3,
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
        itemsReview: 3,
        itemsFailed: 2,
        itemsCancelled: 1,
        createdAt: '2026-05-25T00:00:00.000Z',
        completedAt: null,
      },
    ]);
  });

  it('normalizes paginated batch responses and appends without duplicates', () => {
    const row = {
      batchId: 'batch_1',
      name: 'Daily scan',
      status: 'completed',
      concurrency: 3,
      itemsTotal: 2,
      itemsDone: 2,
      itemsReview: 0,
      itemsFailed: 0,
      itemsCancelled: 0,
      createdAt: '2026-08-05T00:00:00.000Z',
      completedAt: '2026-08-05T00:01:00.000Z',
    };
    const page = normalizeBatchPage({
      items: [row],
      nextCursor: { id: 7, createdAt: '2026-08-05T00:00:00.000Z' },
    });
    expect(page).toEqual({
      items: [row],
      nextCursor: { id: 7, createdAt: '2026-08-05T00:00:00.000Z' },
    });
    expect(
      mergeBatchRows(page.items, [{ ...row, status: 'partial', itemsDone: 1 }]),
    ).toEqual([{ ...row, status: 'partial', itemsDone: 1 }]);
  });

  it('preserves unknown string batch statuses so new backend states are visible', () => {
    expect(
      normalizeBatchRows([
        {
          batchId: 'batch_new',
          status: 'archived',
          concurrency: 1,
          itemsTotal: 1,
          createdAt: '2026-05-25T00:00:00.000Z',
        },
      ])[0]?.status,
    ).toBe('archived');

    expect(
      normalizeBatchDetail({
        batchId: 'batch_detail_new',
        status: 'archived',
        concurrency: 1,
        itemsTotal: 1,
        createdAt: '2026-05-25T00:00:00.000Z',
        items: [
          {
            batchItemId: 'item_new',
            prompt: 'new state',
            status: 'needs_review',
            createdAt: '2026-05-25T00:00:00.000Z',
          },
        ],
      })?.items[0]?.status,
    ).toBe('needs_review');
  });

  it('falls back from malformed batch row fields safely', () => {
    expect(
      normalizeBatchRows([
        {
          batchId: 'batch_2',
          name: { unsafe: true },
          status: { unsafe: true },
          concurrency: -1,
          itemsTotal: Number.NaN,
          itemsDone: Number.POSITIVE_INFINITY,
          itemsReview: -2,
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
        status: 'unknown',
        concurrency: 1,
        itemsTotal: 0,
        itemsDone: 0,
        itemsReview: 0,
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
      itemsReview: 0,
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
        status: 'unknown',
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
