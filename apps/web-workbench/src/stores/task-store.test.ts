import { describe, expect, it } from 'vitest';
import { normaliseDetailStepStatus, toUiTask } from './task-store';

describe('normaliseDetailStepStatus', () => {
  it('maps DB completed steps to done instead of failed', () => {
    expect(normaliseDetailStepStatus('completed')).toBe('done');
    expect(normaliseDetailStepStatus('done')).toBe('done');
    expect(normaliseDetailStepStatus('ok')).toBe('done');
  });

  it('keeps active DB step states running in the hydrated detail view', () => {
    expect(normaliseDetailStepStatus('pending')).toBe('running');
    expect(normaliseDetailStepStatus('executing')).toBe('running');
    expect(normaliseDetailStepStatus('awaiting_user')).toBe('running');
  });

  it('maps error-like states to failed', () => {
    expect(normaliseDetailStepStatus('failed')).toBe('failed');
    expect(normaliseDetailStepStatus('error')).toBe('failed');
  });

  it('keeps cancelled detail steps distinct from failures', () => {
    expect(normaliseDetailStepStatus('cancelled')).toBe('cancelled');
  });
});

describe('toUiTask', () => {
  it('hydrates persisted verifier failedChecks from tasks.list result JSON', () => {
    const task = toUiTask({
      taskId: 'tsk_partial',
      intent: '查价格并给来源',
      title: null,
      status: 'partial_success',
      result: {
        summary: '已找到部分结果',
        failedChecks: [
          { type: 'source_count', detail: '缺少来源链接' },
          { type: ' ', detail: 'ignored' },
          { type: 'price_sort' },
        ],
      },
      errorMessage: null,
      createdAt: new Date('2026-05-22T00:00:00Z'),
      opusUsed: false,
      starred: false,
      starredAt: null,
      projectId: null,
      verificationPassed: false,
      failureLevel: 'fixable',
    } as never);

    expect(task.failedChecks).toEqual([
      { type: 'source_count', detail: '缺少来源链接' },
    ]);
  });
});
