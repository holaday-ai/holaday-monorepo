import { describe, expect, it } from 'vitest';
import type { UiTask } from '@/types/task';
import {
  emptyProjectTaskFilterState,
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
});

function task(taskId: string): UiTask {
  return {
    taskId,
    intent: 'project task',
    title: null,
    status: 'completed',
    tickCount: 0,
    createdAt: new Date('2026-05-25T00:00:00.000Z'),
  };
}
