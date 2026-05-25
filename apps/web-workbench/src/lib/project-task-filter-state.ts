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
