import { describe, expect, it } from 'vitest';
import type { UiTask } from '@/types/task';
import {
  followUpTargetForTask,
  isLiveBrowserTaskForWorkbench,
  normalizeTaskActionCount,
} from './workbench-state';

function task(overrides: Partial<UiTask> = {}): UiTask {
  return {
    taskId: 'tsk_test',
    intent: '打开 https://example.com 并总结结果',
    title: null,
    status: 'executing',
    tickCount: 0,
    createdAt: new Date('2026-05-21T00:00:00Z'),
    executionMode: 'browser',
    ...overrides,
  };
}

describe('workbench state helpers', () => {
  it('does not treat partial-success browser tasks as live browser sessions', () => {
    expect(isLiveBrowserTaskForWorkbench(task({ status: 'executing' }))).toBe(
      true,
    );
    expect(isLiveBrowserTaskForWorkbench(task({ status: 'awaiting_user' }))).toBe(
      true,
    );
    expect(
      isLiveBrowserTaskForWorkbench(task({ status: 'partial_success' })),
    ).toBe(false);
    expect(isLiveBrowserTaskForWorkbench(task({ status: 'completed' }))).toBe(
      false,
    );
  });

  it('allows follow-up chips for all terminal statuses including partial success', () => {
    expect(
      followUpTargetForTask({
        selectedTask: task({ status: 'partial_success' }),
        selectedTaskId: 'tsk_test',
        selectedNeedsUser: false,
        followUpDismissedTaskId: null,
      }),
    ).toEqual({
      taskId: 'tsk_test',
      title: '打开 https://example.com 并总结结果',
    });
  });

  it('suppresses follow-up chips while the task is still active or awaiting user input', () => {
    expect(
      followUpTargetForTask({
        selectedTask: task({ status: 'executing' }),
        selectedTaskId: 'tsk_test',
        selectedNeedsUser: false,
        followUpDismissedTaskId: null,
      }),
    ).toBeNull();
    expect(
      followUpTargetForTask({
        selectedTask: task({ status: 'completed' }),
        selectedTaskId: 'tsk_test',
        selectedNeedsUser: true,
        followUpDismissedTaskId: null,
      }),
    ).toBeNull();
  });

  it('normalizes task action counts before rendering destructive copy', () => {
    expect(normalizeTaskActionCount(3)).toBe(3);
    expect(normalizeTaskActionCount(3.9)).toBe(3);
    expect(normalizeTaskActionCount(0)).toBe(0);
    expect(normalizeTaskActionCount(-1)).toBe(0);
    expect(normalizeTaskActionCount(Number.NaN)).toBe(0);
    expect(normalizeTaskActionCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeTaskActionCount('4')).toBe(0);
    expect(normalizeTaskActionCount({ count: 4 })).toBe(0);
  });
});
