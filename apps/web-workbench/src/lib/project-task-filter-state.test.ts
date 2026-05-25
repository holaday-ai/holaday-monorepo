import { describe, expect, it } from 'vitest';
import type { UiTask } from '@/types/task';
import {
  emptyProjectTaskFilterState,
  projectTaskFilterAfterFailedTasksCleared,
  projectTaskFilterAfterTaskDelete,
  projectTaskFilterAfterTaskMove,
  refreshProjectTaskFilterState,
  resolveProjectFilteredTasks,
} from './project-task-filter-state';

describe('project task filter state', () => {
  it('does not show stale tasks while a different project is loading', () => {
    const fallback = [task('tsk_recent')];
    const previousProjectState = {
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
      loading: false,
      error: null,
    };

    expect(resolveProjectFilteredTasks('proj_b', previousProjectState, fallback)).toEqual([]);
  });

  it('returns the matching project tasks and unfiltered fallback', () => {
    const fallback = [task('tsk_recent')];
    const state = {
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
      loading: false,
      error: null,
    };

    expect(resolveProjectFilteredTasks('proj_a', state, fallback)).toEqual([
      task('tsk_a'),
    ]);
    expect(resolveProjectFilteredTasks(null, state, fallback)).toEqual(fallback);
  });

  it('starts a fresh loading state when the project changes', () => {
    const previous = {
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
      loading: false,
      error: 'offline',
    };

    expect(refreshProjectTaskFilterState(previous, 'proj_b')).toEqual(
      emptyProjectTaskFilterState('proj_b'),
    );
  });

  it('keeps current tasks visible when refreshing the same project', () => {
    const previous = {
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
      loading: false,
      error: 'offline',
    };

    expect(refreshProjectTaskFilterState(previous, 'proj_a')).toEqual({
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
      loading: true,
      error: null,
    });
  });

  it('removes a moved task from the active project filter', () => {
    const state = {
      projectId: 'proj_a',
      tasks: [task('tsk_a'), task('tsk_b')],
      loading: false,
      error: null,
    };

    expect(
      projectTaskFilterAfterTaskMove(state, {
        taskId: 'tsk_a',
        projectId: 'proj_b',
      }),
    ).toEqual({
      ...state,
      tasks: [task('tsk_b')],
    });
  });

  it('keeps the active project filter when the task remains in that project', () => {
    const state = {
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
      loading: false,
      error: null,
    };

    expect(
      projectTaskFilterAfterTaskMove(state, {
        taskId: 'tsk_a',
        projectId: 'proj_a',
      }),
    ).toBe(state);
  });

  it('removes deleted tasks from the active project filter', () => {
    const state = {
      projectId: 'proj_a',
      tasks: [task('tsk_a'), task('tsk_b'), task('tsk_c')],
      loading: false,
      error: null,
    };

    expect(projectTaskFilterAfterTaskDelete(state, ['tsk_b', 'tsk_missing'])).toEqual({
      ...state,
      tasks: [task('tsk_a'), task('tsk_c')],
    });
  });

  it('keeps the project filter reference when no deleted task is visible', () => {
    const state = {
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
      loading: false,
      error: null,
    };

    expect(projectTaskFilterAfterTaskDelete(state, ['tsk_missing'])).toBe(state);
  });

  it('removes failed tasks after the clear-failed action succeeds', () => {
    const state = {
      projectId: 'proj_a',
      tasks: [
        task('tsk_done'),
        task('tsk_failed', { status: 'failed' }),
        task('tsk_cancelled', { status: 'cancelled' }),
      ],
      loading: false,
      error: null,
    };

    expect(projectTaskFilterAfterFailedTasksCleared(state)).toEqual({
      ...state,
      tasks: [task('tsk_done'), task('tsk_cancelled', { status: 'cancelled' })],
    });
  });
});

function task(taskId: string, overrides: Partial<UiTask> = {}): UiTask {
  return {
    taskId,
    intent: 'project task',
    title: null,
    status: 'completed',
    tickCount: 0,
    createdAt: new Date('2026-05-25T00:00:00.000Z'),
    ...overrides,
  };
}
