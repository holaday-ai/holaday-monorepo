import { describe, expect, it } from 'vitest';
import type { UiTask } from '@/types/task';
import {
  emptyProjectTaskFilterState,
  projectFilterChipState,
  projectTaskFilterAppendPage,
  projectTaskFilterAfterFailedTasksCleared,
  projectTaskFilterAfterTaskDelete,
  projectTaskFilterAfterTaskMove,
  projectTaskFilterFirstPage,
  projectTaskFilterLoadMoreFailed,
  projectTaskFilterStartLoadMore,
  refreshProjectTaskFilterState,
  resolveProjectFilteredTasks,
  type ProjectTaskFilterState,
} from './project-task-filter-state';

describe('project task filter state', () => {
  it('does not show stale tasks while a different project is loading', () => {
    const fallback = [task('tsk_recent')];
    const previousProjectState = state({
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
    });

    expect(resolveProjectFilteredTasks('proj_b', previousProjectState, fallback)).toEqual([]);
  });

  it('returns the matching project tasks and unfiltered fallback', () => {
    const fallback = [task('tsk_recent')];
    const active = state({
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
    });

    expect(resolveProjectFilteredTasks('proj_a', active, fallback)).toEqual([
      task('tsk_a'),
    ]);
    expect(resolveProjectFilteredTasks(null, active, fallback)).toEqual(fallback);
  });

  it('keeps project filters visible while project metadata is unavailable', () => {
    expect(
      projectFilterChipState({
        projectId: 'project-with-long-id',
        projectName: null,
        state: null,
      }),
    ).toEqual({
      projectId: 'project-with-long-id',
      name: '项目 project-wi…',
      detail: '正在加载任务…',
      tone: 'loading',
    });
  });

  it('describes project task loading and failed refresh states', () => {
    expect(
      projectFilterChipState({
        projectId: 'proj_a',
        projectName: '  Launch  ',
        state: state({
          projectId: 'proj_a',
          tasks: [task('tsk_a')],
          loading: true,
        }),
      }),
    ).toEqual({
      projectId: 'proj_a',
      name: 'Launch',
      detail: '正在刷新任务…',
      tone: 'loading',
    });

    expect(
      projectFilterChipState({
        projectId: 'proj_a',
        projectName: 'Launch',
        state: state({
          projectId: 'proj_a',
          tasks: [],
          error: 'offline',
        }),
      }),
    ).toEqual({
      projectId: 'proj_a',
      name: 'Launch',
      detail: '任务暂时无法加载',
      tone: 'error',
    });
  });

  it('starts a fresh loading state when the project changes', () => {
    const previous = state({
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
      error: 'offline',
    });

    expect(refreshProjectTaskFilterState(previous, 'proj_b')).toEqual(
      emptyProjectTaskFilterState('proj_b'),
    );
  });

  it('keeps current tasks visible when refreshing the same project', () => {
    const previous = state({
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
      nextCursor: 51,
      hasMore: true,
      error: 'offline',
    });

    expect(refreshProjectTaskFilterState(previous, 'proj_a')).toEqual({
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
      loading: true,
      loadingMore: false,
      nextCursor: 51,
      hasMore: true,
      error: null,
    });
  });

  it('tracks project-filter pagination independently from the global task pager', () => {
    const first = projectTaskFilterFirstPage({
      projectId: 'proj_a',
      tasks: [task('tsk_a'), task('tsk_dup', { status: 'executing' })],
      nextCursor: 51,
    });

    expect(first.hasMore).toBe(true);
    expect(projectTaskFilterStartLoadMore(first, 'proj_a')).toEqual({
      ...first,
      loadingMore: true,
    });
    expect(
      projectTaskFilterAppendPage(projectTaskFilterStartLoadMore(first, 'proj_a'), {
        projectId: 'proj_a',
        tasks: [
          task('tsk_dup', { status: 'completed' }),
          task('tsk_next'),
        ],
        nextCursor: null,
      }),
    ).toEqual({
      ...first,
      tasks: [
        task('tsk_a'),
        task('tsk_dup', { status: 'completed' }),
        task('tsk_next'),
      ],
      loadingMore: false,
      nextCursor: null,
      hasMore: false,
    });
  });

  it('keeps loaded project tasks visible after a load-more failure', () => {
    const current = state({
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
      loadingMore: true,
      nextCursor: 51,
      hasMore: true,
    });

    expect(
      projectTaskFilterLoadMoreFailed(current, {
        projectId: 'proj_a',
        error: 'offline',
      }),
    ).toEqual({
      ...current,
      loading: false,
      loadingMore: false,
      error: 'offline',
    });
  });

  it('removes a moved task from the active project filter', () => {
    const current = state({
      projectId: 'proj_a',
      tasks: [task('tsk_a'), task('tsk_b')],
    });

    expect(
      projectTaskFilterAfterTaskMove(current, {
        taskId: 'tsk_a',
        projectId: 'proj_b',
      }),
    ).toEqual({
      ...current,
      tasks: [task('tsk_b')],
    });
  });

  it('keeps the active project filter when the task remains in that project', () => {
    const current = state({
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
    });

    expect(
      projectTaskFilterAfterTaskMove(current, {
        taskId: 'tsk_a',
        projectId: 'proj_a',
      }),
    ).toBe(current);
  });

  it('removes deleted tasks from the active project filter', () => {
    const current = state({
      projectId: 'proj_a',
      tasks: [task('tsk_a'), task('tsk_b'), task('tsk_c')],
    });

    expect(projectTaskFilterAfterTaskDelete(current, ['tsk_b', 'tsk_missing'])).toEqual({
      ...current,
      tasks: [task('tsk_a'), task('tsk_c')],
    });
  });

  it('keeps the project filter reference when no deleted task is visible', () => {
    const current = state({
      projectId: 'proj_a',
      tasks: [task('tsk_a')],
    });

    expect(projectTaskFilterAfterTaskDelete(current, ['tsk_missing'])).toBe(current);
  });

  it('removes failed tasks after the clear-failed action succeeds', () => {
    const current = state({
      projectId: 'proj_a',
      tasks: [
        task('tsk_done'),
        task('tsk_failed', { status: 'failed' }),
        task('tsk_cancelled', { status: 'cancelled' }),
      ],
    });

    expect(projectTaskFilterAfterFailedTasksCleared(current)).toEqual({
      ...current,
      tasks: [task('tsk_done'), task('tsk_cancelled', { status: 'cancelled' })],
    });
  });
});

function state(
  overrides: Partial<ProjectTaskFilterState> & { projectId: string },
): ProjectTaskFilterState {
  return {
    tasks: [],
    loading: false,
    loadingMore: false,
    nextCursor: null,
    hasMore: false,
    error: null,
    ...overrides,
  };
}

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
