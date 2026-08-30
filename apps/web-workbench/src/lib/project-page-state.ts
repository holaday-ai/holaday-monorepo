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
  if (options.loading && options.count > 0) return `正在刷新 ${options.count} 个项目…`;
  if (options.loading) return '项目加载中…';
  if (options.error && options.count > 0) return `共 ${options.count} 个项目，上次刷新失败`;
  if (options.error) return '项目暂时无法加载';
  if (options.count === 0) return '尚无项目';
  return `共 ${options.count} 个项目`;
}

export function normalizeProjectRows(
  value: unknown,
  options: { readonly organizationId?: string } = {},
): UiProject[] {
  if (!Array.isArray(value)) return [];
  const requestedOrganizationId = safeProjectText(options.organizationId);
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const projectId = safeProjectOwnText(entry, 'projectId');
    if (!projectId) return [];
    const rawScope = ownValue(entry, 'scope');
    const scope = rawScope === undefined ? 'personal' : rawScope;
    if (scope !== 'personal' && scope !== 'organization') return [];

    let organizationId: string | null = null;
    let organizationName: string | null = null;
    let memberRole: UiProject['memberRole'] = null;
    if (scope === 'organization') {
      organizationId = safeProjectOwnText(entry, 'organizationId') || null;
      if (!organizationId) return [];
      if (requestedOrganizationId && organizationId !== requestedOrganizationId) return [];
      organizationName = safeProjectOwnNullableText(entry, 'organizationName');
      const rawMemberRole = ownValue(entry, 'memberRole');
      if (!isProjectMemberRole(rawMemberRole)) return [];
      memberRole = rawMemberRole;
    }

    return [
      {
        projectId,
        name: safeProjectOwnText(entry, 'name') || '未命名项目',
        description: safeProjectOwnNullableText(entry, 'description'),
        createdAt: safeProjectDate(ownValue(entry, 'createdAt')) ?? new Date(0),
        updatedAt: safeProjectDate(ownValue(entry, 'updatedAt')) ?? new Date(0),
        taskCount: safeProjectCount(ownValue(entry, 'taskCount')),
        scope,
        organizationId,
        organizationName,
        memberRole,
      },
    ];
  });
}

function safeProjectText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeProjectOwnText(value: Record<string, unknown>, key: string): string {
  return safeProjectText(ownValue(value, key));
}

function safeProjectOwnNullableText(value: Record<string, unknown>, key: string): string | null {
  const text = safeProjectOwnText(value, key);
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

function ownValue(value: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

function isProjectMemberRole(value: unknown): value is NonNullable<UiProject['memberRole']> {
  return value === 'lead' || value === 'member' || value === 'viewer';
}
