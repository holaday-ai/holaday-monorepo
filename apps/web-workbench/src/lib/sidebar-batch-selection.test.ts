import { describe, expect, it } from 'vitest';
import type { UiTask } from '@/types/task';
import {
  deletableTaskIdsForBatchSelection,
  pruneBatchSelection,
} from './sidebar-batch-selection';

describe('sidebar batch selection', () => {
  it('returns only visible terminal task ids and dedupes repeated rows', () => {
    expect(
      deletableTaskIdsForBatchSelection([
        task('tsk_done', 'completed'),
        task('tsk_running', 'executing'),
        task('tsk_failed', 'failed'),
        task('tsk_partial', 'partial_success'),
        task('tsk_done', 'completed'),
        task('tsk_cancelled', 'cancelled'),
        task('tsk_waiting', 'awaiting_user'),
      ]),
    ).toEqual(['tsk_done', 'tsk_failed', 'tsk_partial', 'tsk_cancelled']);
  });

  it('drops stale selected ids when rows disappear or become active', () => {
    expect(
      [...pruneBatchSelection(
        new Set(['tsk_done', 'tsk_hidden', 'tsk_running', 'tsk_failed']),
        new Set(['tsk_done', 'tsk_failed']),
      )],
    ).toEqual(['tsk_done', 'tsk_failed']);
  });
});

function task(taskId: string, status: UiTask['status']): Pick<UiTask, 'taskId' | 'status'> {
  return { taskId, status };
}
