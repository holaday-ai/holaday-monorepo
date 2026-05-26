import type { UiTask } from '@/types/task';

export interface ProjectTaskFilterState {
  readonly projectId: string;
  readonly tasks: readonly UiTask[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly nextCursor: number | null;
  readonly hasMore: boolean;
  readonly error: string | null;
}

export interface ProjectFilterChipState {
  readonly projectId: string;
  readonly name: string;
  readonly detail: string | null;
  readonly tone: 'normal' | 'loading' | 'error';
}

export function emptyProjectTaskFilterState(
  projectId: string,
): ProjectTaskFilterState {
  return {
    projectId,
    tasks: [],
    loading: true,
    loadingMore: false,
    nextCursor: null,
    hasMore: false,
    error: null,
  };
}

export function projectTaskFilterFirstPage(options: {
  readonly projectId: string;
  readonly tasks: readonly UiTask[];
  readonly nextCursor: number | null;
}): ProjectTaskFilterState {
  return {
    projectId: options.projectId,
    tasks: options.tasks,
    loading: false,
    loadingMore: false,
    nextCursor: options.nextCursor,
    hasMore: options.nextCursor !== null,
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

export function projectTaskFilterStartLoadMore(
  previous: ProjectTaskFilterState | null,
  projectId: string,
): ProjectTaskFilterState | null {
  if (!previous || previous.projectId !== projectId) return previous;
  if (previous.loadingMore || !previous.hasMore || previous.nextCursor === null) {
    return previous;
  }
  return {
    ...previous,
    loadingMore: true,
    error: null,
  };
}

export function projectTaskFilterAppendPage(
  previous: ProjectTaskFilterState | null,
  options: {
    readonly projectId: string;
    readonly tasks: readonly UiTask[];
    readonly nextCursor: number | null;
  },
): ProjectTaskFilterState | null {
  if (!previous || previous.projectId !== options.projectId) return previous;
  return {
    ...previous,
    tasks: mergeProjectFilterTasks(previous.tasks, options.tasks),
    loading: false,
    loadingMore: false,
    nextCursor: options.nextCursor,
    hasMore: options.nextCursor !== null,
    error: null,
  };
}

export function projectTaskFilterLoadMoreFailed(
  previous: ProjectTaskFilterState | null,
  options: { readonly projectId: string; readonly error: string },
): ProjectTaskFilterState | null {
  if (!previous || previous.projectId !== options.projectId) return previous;
  return {
    ...previous,
    loading: false,
    loadingMore: false,
    error: options.error,
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

export function projectFilterChipState(options: {
  readonly projectId: string | null;
  readonly projectName: string | null | undefined;
  readonly state: ProjectTaskFilterState | null;
}): ProjectFilterChipState | null {
  if (!options.projectId) return null;
  const stateMatches = options.state?.projectId === options.projectId;
  const name = safeProjectFilterText(options.projectName) ?? shortProjectFilterId(options.projectId);

  if (!stateMatches) {
    return {
      projectId: options.projectId,
      name,
      detail: '正在加载任务…',
      tone: 'loading',
    };
  }

  if (options.state.loading) {
    return {
      projectId: options.projectId,
      name,
      detail: options.state.tasks.length > 0 ? '正在刷新任务…' : '正在加载任务…',
      tone: 'loading',
    };
  }

  if (options.state.error) {
    return {
      projectId: options.projectId,
      name,
      detail:
        options.state.tasks.length > 0
          ? '任务刷新失败，显示上次结果'
          : '任务加载失败',
      tone: 'error',
    };
  }

  return {
    projectId: options.projectId,
    name,
    detail: null,
    tone: 'normal',
  };
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

function safeProjectFilterText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function shortProjectFilterId(projectId: string): string {
  const trimmed = projectId.trim();
  if (!trimmed) return '未知项目';
  return trimmed.length > 14 ? `项目 ${trimmed.slice(0, 10)}…` : `项目 ${trimmed}`;
}

function mergeProjectFilterTasks(
  current: readonly UiTask[],
  incoming: readonly UiTask[],
): UiTask[] {
  const merged = [...current];
  const indexByTaskId = new Map<string, number>();
  merged.forEach((task, index) => indexByTaskId.set(task.taskId, index));

  for (const task of incoming) {
    const existingIndex = indexByTaskId.get(task.taskId);
    if (existingIndex === undefined) {
      indexByTaskId.set(task.taskId, merged.length);
      merged.push(task);
      continue;
    }
    merged[existingIndex] = task;
  }

  return merged;
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
