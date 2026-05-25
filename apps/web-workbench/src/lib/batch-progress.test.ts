import {
  applyBatchProgressToDetail,
  applyBatchProgressToRows,
  normalizeBatchProgressFrame,
  type BatchProgressFrame,
} from './batch-progress';
import { describe, expect, it } from 'vitest';

describe('batch progress helpers', () => {
  const frame: BatchProgressFrame = {
    type: 'server.batch.progress',
    batchId: 'batch_1',
    status: 'partial',
    itemsTotal: 4,
    itemsDone: 2,
    itemsFailed: 1,
    itemsCancelled: 1,
  };

  it('updates only the matching batch row counters', () => {
    const rows = [
      {
        batchId: 'batch_1',
        status: 'running',
        itemsTotal: 4,
        itemsDone: 1,
        itemsFailed: 0,
      },
      {
        batchId: 'batch_2',
        status: 'running',
        itemsTotal: 2,
        itemsDone: 0,
        itemsFailed: 0,
      },
    ];

    expect(applyBatchProgressToRows(rows, frame)).toEqual([
      {
        batchId: 'batch_1',
        status: 'partial',
        itemsTotal: 4,
        itemsDone: 2,
        itemsFailed: 1,
        itemsCancelled: 1,
      },
      rows[1],
    ]);
  });

  it('keeps rows referentially stable when the frame is unrelated', () => {
    const rows = [
      {
        batchId: 'batch_2',
        status: 'running',
        itemsTotal: 2,
        itemsDone: 0,
        itemsFailed: 0,
      },
    ];

    expect(applyBatchProgressToRows(rows, frame)).toBe(rows);
  });

  it('patches the matching detail item from live progress', () => {
    const detail = {
      batchId: 'batch_1',
      status: 'running',
      itemsTotal: 2,
      itemsDone: 0,
      itemsFailed: 0,
      items: [
        {
          batchItemId: 'item_1',
          status: 'running',
          taskId: null,
          errorMessage: null,
        },
        {
          batchItemId: 'item_2',
          status: 'pending',
          taskId: null,
          errorMessage: null,
        },
      ],
    };

    expect(
      applyBatchProgressToDetail(detail, {
        ...frame,
        itemsTotal: 2,
        itemsDone: 1,
        itemsFailed: 0,
        itemsCancelled: 0,
        item: {
          batchItemId: 'item_1',
          status: 'completed',
          taskId: 'tsk_1',
        },
      }),
    ).toEqual({
      batchId: 'batch_1',
      status: 'partial',
      itemsTotal: 2,
      itemsDone: 1,
      itemsFailed: 0,
      itemsCancelled: 0,
      items: [
        {
          batchItemId: 'item_1',
          status: 'completed',
          taskId: 'tsk_1',
          errorMessage: null,
        },
        detail.items[1],
      ],
    });
  });

  it('normalizes malformed live progress frames before applying them', () => {
    expect(
      normalizeBatchProgressFrame({
        type: 'server.batch.progress',
        batchId: ' batch_1 ',
        status: 'unknown',
        itemsTotal: Number.NaN,
        itemsDone: 2.8,
        itemsFailed: -1,
        itemsCancelled: { unsafe: true },
        item: {
          batchItemId: ' item_1 ',
          status: 'unknown',
          taskId: { unsafe: true },
          errorMessage: { unsafe: true },
        },
      }),
    ).toEqual({
      type: 'server.batch.progress',
      batchId: 'batch_1',
      status: 'pending',
      itemsTotal: 0,
      itemsDone: 2,
      itemsFailed: 0,
      itemsCancelled: 0,
      item: {
        batchItemId: 'item_1',
        status: 'pending',
      },
    });
  });

  it('ignores malformed progress frames without a stable batch id', () => {
    expect(normalizeBatchProgressFrame({ type: 'server.batch.progress' })).toBeNull();
    const rows = [
      {
        batchId: 'batch_1',
        status: 'running',
        itemsTotal: 1,
        itemsDone: 0,
        itemsFailed: 0,
      },
    ];
    expect(
      applyBatchProgressToRows(rows, {
        type: 'server.batch.progress',
        batchId: '',
        status: 'completed',
        itemsTotal: 1,
        itemsDone: 1,
        itemsFailed: 0,
      }),
    ).toBe(rows);
  });
});
