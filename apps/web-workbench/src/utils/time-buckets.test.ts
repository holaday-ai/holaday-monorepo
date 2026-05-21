import { describe, expect, it } from 'vitest';
import type { UiTask } from '@/types/task';
import { bucketByTime, isTaskDeletable } from './time-buckets';

function task(overrides: Partial<UiTask>): UiTask {
  return {
    taskId: 'tsk_x',
    intent: 'test',
    title: null,
    status: 'completed',
    tickCount: 0,
    createdAt: new Date('2026-05-22T00:00:00Z'),
    ...overrides,
  };
}

describe('isTaskDeletable', () => {
  it('allows every terminal task status, including partial_success', () => {
    expect(isTaskDeletable('completed')).toBe(true);
    expect(isTaskDeletable('partial_success')).toBe(true);
    expect(isTaskDeletable('failed')).toBe(true);
    expect(isTaskDeletable('cancelled')).toBe(true);
  });

  it('keeps live task statuses protected from bulk delete', () => {
    expect(isTaskDeletable('queued')).toBe(false);
    expect(isTaskDeletable('executing')).toBe(false);
    expect(isTaskDeletable('awaiting_user')).toBe(false);
    expect(isTaskDeletable('paused')).toBe(false);
  });
});

describe('bucketByTime', () => {
  it('preserves caller order inside each time bucket', () => {
    const buckets = bucketByTime(
      [
        task({ taskId: 'newer', createdAt: new Date('2026-05-22T10:00:00Z') }),
        task({ taskId: 'older', createdAt: new Date('2026-05-22T09:00:00Z') }),
      ],
      new Date('2026-05-22T12:00:00Z'),
    );

    expect(buckets[0]?.tasks.map((t) => t.taskId)).toEqual(['newer', 'older']);
  });
});
