import type { UiTask } from '@/types/task';

export interface ProjectTaskFilterState {
  readonly projectId: string;
  readonly tasks: readonly UiTask[];
  readonly loading: boolean;
  readonly error: string | null;
}

export function emptyProjectTaskFilterState(
  projectId: string,
): ProjectTaskFilterState {
  return {
    projectId,
    tasks: [],
    loading: true,
    error: null,
  };
}

export function refreshProjectTaskFilterState(
  previous: ProjectTaskFilterState | null,
  projectId: string,
): ProjectTaskFilterState {
  if (previous?.projectId !== projectId) {
    return emptyProjectTaskFilterState(projectId);
  }
  return {
    ...previous,
    loading: true,
    error: null,
  };
}

export function resolveProjectFilteredTasks(
  projectId: string | null,
  state: ProjectTaskFilterState | null,
  fallbackTasks: readonly UiTask[],
): readonly UiTask[] {
  if (!projectId) return fallbackTasks;
  if (state?.projectId !== projectId) return [];
  return state.tasks;
}

export function projectTaskFilterAfterTaskMove(
  state: ProjectTaskFilterState | null,
  options: { readonly taskId: string; readonly projectId: string | null },
): ProjectTaskFilterState | null {
  if (!state) return null;
  if (options.projectId === state.projectId) return state;
  const tasks = state.tasks.filter((task) => task.taskId !== options.taskId);
  if (tasks.length === state.tasks.length) return state;
  return { ...state, tasks };
}

export function projectTaskFilterAfterTaskDelete(
  state: ProjectTaskFilterState | null,
  taskIds: readonly string[],
): ProjectTaskFilterState | null {
  if (!state || taskIds.length === 0) return state;
  const deleted = new Set(taskIds);
  const tasks = state.tasks.filter((task) => !deleted.has(task.taskId));
  if (tasks.length === state.tasks.length) return state;
  return { ...state, tasks };
}

export function projectTaskFilterAfterFailedTasksCleared(
  state: ProjectTaskFilterState | null,
): ProjectTaskFilterState | null {
  if (!state) return null;
  const tasks = state.tasks.filter((task) => task.status !== 'failed');
  if (tasks.length === state.tasks.length) return state;
  return { ...state, tasks };
}
