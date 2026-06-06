import type { UiProject } from '@/types/task';

export const PROJECT_NAME_MAX_LENGTH = 100;

export interface ProjectNameState {
  readonly name: string;
  readonly length: number;
  readonly remaining: number;
  readonly error: string | null;
  readonly canSubmit: boolean;
}

export interface ProjectLoadErrorCopy {
  readonly title: string;
  readonly body: string;
}

export function normalizeProjectName(value: string): string {
  return value.trim();
}

export function projectLoadErrorCopy(message: string | null | undefined): ProjectLoadErrorCopy {
  const body =
    typeof message === 'string' && message.trim()
      ? message.trim()
      : '请稍后重试，或刷新页面后再打开项目列表。';
  return {
    title: '项目暂时无法加载',
    body,
  };
}

export function projectNameState(
  value: string,
  existingNames: readonly string[] = [],
): ProjectNameState {
  const name = normalizeProjectName(value);
  const duplicateNames = new Set(
    existingNames.map((existingName) => normalizeProjectName(existingName).toLocaleLowerCase()),
  );
  const length = value.length;
  let error: string | null = null;

  if (!name) {
    error = '请输入项目名称';
  } else if (length > PROJECT_NAME_MAX_LENGTH) {
    error = `项目名称不能超过 ${PROJECT_NAME_MAX_LENGTH} 个字符`;
  } else if (duplicateNames.has(name.toLocaleLowerCase())) {
    error = '已有同名项目';
  }

  return {
    name,
    length,
    remaining: PROJECT_NAME_MAX_LENGTH - length,
    error,
    canSubmit: error === null,
  };
}

export function projectCountSummary(options: {
  readonly count: number;
  readonly loading: boolean;
  readonly error: string | null;
}): string {
  if (options.loading && options.count > 0)
    return `正在刷新 ${options.count} 个项目…`;
  if (options.loading) return '项目加载中…';
  if (options.error && options.count > 0)
    return `共 ${options.count} 个项目，上次刷新失败`;
  if (options.error) return '项目暂时无法加载';
  if (options.count === 0) return '尚无项目';
  return `共 ${options.count} 个项目`;
}

export function normalizeProjectRows(value: unknown): UiProject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const projectId = safeProjectText(entry.projectId);
    if (!projectId) return [];
    return [
      {
        projectId,
        name: safeProjectText(entry.name) || '未命名项目',
        description: safeProjectNullableText(entry.description),
        createdAt: safeProjectDate(entry.createdAt) ?? new Date(0),
        updatedAt: safeProjectDate(entry.updatedAt) ?? new Date(0),
        taskCount: safeProjectCount(entry.taskCount),
      },
    ];
  });
}

function safeProjectText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeProjectNullableText(value: unknown): string | null {
  const text = safeProjectText(value);
  return text || null;
}

function safeProjectDate(value: unknown): string | Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && !Number.isNaN(Date.parse(trimmed)) ? trimmed : null;
}

function safeProjectCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
