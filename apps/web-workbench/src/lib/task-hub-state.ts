import { pageErrorMessage } from './page-error-copy';
import type { AwaitingKind } from './awaiting-user-copy';

export type HistoryStatusFilter = 'all' | 'completed' | 'failed' | 'running';
export type HistoryRangeFilter = '7d' | '30d' | 'all';

export interface NormalizedTaskHubRow {
  readonly taskId: string;
  readonly intent: string;
  readonly title: string | null;
  readonly status: string;
  readonly awaitingKind: AwaitingKind | null;
  readonly createdAt: string | number | Date;
  readonly completedAt: string | number | Date | null;
  readonly starredAt: string | number | Date | null;
}

export interface TaskHubInlineErrorCopy {
  readonly title: string;
  readonly body: string;
}

export function hasHistoryFilters({
  query,
  status,
  range,
}: {
  readonly query: string;
  readonly status: HistoryStatusFilter;
  readonly range: HistoryRangeFilter;
}): boolean {
  return query.trim().length > 0 || status !== 'all' || range !== '30d';
}

export function historyFilterRequestKey({
  query,
  status,
  range,
}: {
  readonly query: string;
  readonly status: HistoryStatusFilter;
  readonly range: HistoryRangeFilter;
}): string {
  return `${status}\n${range}\n${query.trim()}`;
}

export function shouldApplyHistoryResponse({
  requestKey,
  activeKey,
}: {
  readonly requestKey: string;
  readonly activeKey: string;
}): boolean {
  return requestKey === activeKey;
}

export function historyPageSummary({
  loading,
  error,
  count,
  hasMore,
  query,
  status,
  range,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly count: number;
  readonly hasMore: boolean;
  readonly query: string;
  readonly status: HistoryStatusFilter;
  readonly range: HistoryRangeFilter;
}): string {
  if (loading && count === 0) return '历史任务加载中…';
  const suffix = hasMore ? '+' : '';
  if (error && count > 0) return `刷新失败 · 显示 ${count}${suffix} 条`;
  if (error) return '历史任务暂时无法加载';
  if (hasHistoryFilters({ query, status, range })) return `当前筛选 ${count}${suffix} 条`;
  return `近 30 天 ${count}${suffix} 条`;
}

export function starredPageSummary({
  loading,
  error,
  count,
  hasMore,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly count: number;
  readonly hasMore: boolean;
}): string {
  if (loading && count === 0) return '置顶任务加载中…';
  if (error && count > 0) return `刷新失败 · 显示 ${count}${hasMore ? '+' : ''} 个`;
  if (error) return '置顶任务暂时无法加载';
  return `已置顶 ${count}${hasMore ? '+' : ''} 个`;
}

export function taskHubNeedsAttention(status: string): boolean {
  return status === 'awaiting_user';
}

/**
 * Display tone for a task row's status icon, shared across the hub
 * surfaces (history / starred). Collapses the non-terminal statuses
 * (pending / planning / queued / executing / paused) into a single
 * 'running' bucket so callers only branch on the states that get a
 * distinct icon. Kept as a pure classifier so the icon choice is
 * unit-testable without rendering.
 */
export type TaskHubStatusTone =
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'awaiting'
  | 'cancelled'
  | 'running';

export function taskHubStatusTone(status: string): TaskHubStatusTone {
  if (status === 'completed') return 'completed';
  if (status === 'partial_success') return 'partial_success';
  if (status === 'failed') return 'failed';
  if (status === 'awaiting_user') return 'awaiting';
  if (status === 'cancelled') return 'cancelled';
  return 'running';
}

export function taskHubErrorMessage(err: unknown, fallback = '请稍后重试'): string {
  return pageErrorMessage(err, fallback);
}

export function taskHubLoadErrorCopy({
  label,
  message,
}: {
  readonly label: string;
  readonly message: string | null | undefined;
}): TaskHubInlineErrorCopy {
  const safeLabel = label.trim() || '任务列表';
  const body =
    typeof message === 'string' && message.trim()
      ? message.trim()
      : '请稍后重试，或刷新页面后再打开列表。';
  return {
    title: `${safeLabel}暂时无法加载`,
    body,
  };
}

export function taskHubLoadMoreErrorCopy(
  message: string | null | undefined,
): TaskHubInlineErrorCopy {
  const body =
    typeof message === 'string' && message.trim()
      ? message.trim()
      : '请稍后重试，当前列表会保留已加载的任务。';
  return {
    title: '更多任务暂时无法加载',
    body,
  };
}

export function mergeTaskHubRowsById<T extends { readonly taskId: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const merged = [...current];
  const indexByTaskId = new Map<string, number>();
  merged.forEach((item, index) => indexByTaskId.set(item.taskId, index));

  for (const item of incoming) {
    const existingIndex = indexByTaskId.get(item.taskId);
    if (existingIndex === undefined) {
      indexByTaskId.set(item.taskId, merged.length);
      merged.push(item);
      continue;
    }
    merged[existingIndex] = item;
  }

  return merged;
}

export function formatTaskHubTime(value: string | number | Date | null | undefined, now = new Date()): string {
  if (value == null) return '—';
  const ts =
    typeof value === 'string'
      ? Date.parse(value)
      : typeof value === 'number'
        ? value
        : value.getTime();
  if (!Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return `今天 ${hhmm}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hhmm}`;
}

export function normalizeTaskHubRows(value: unknown): NormalizedTaskHubRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = normalizeTaskHubRow(entry);
    return row ? [row] : [];
  });
}

export function normalizeTaskHubCursor(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function normalizeTaskHubRow(value: unknown): NormalizedTaskHubRow | null {
  if (!isRecord(value)) return null;
  const taskId = safeTaskHubText(value.taskId);
  if (!taskId) return null;
  return {
    taskId,
    intent: safeTaskHubText(value.intent) || '未命名任务',
    title: safeNullableTaskHubText(value.title),
    status: normalizeTaskHubStatus(value.status),
    awaitingKind: normalizeAwaitingKind(value.awaitingKind),
    createdAt: safeTaskHubDate(value.createdAt) ?? '',
    completedAt: safeNullableTaskHubDate(value.completedAt),
    starredAt: safeNullableTaskHubDate(value.starredAt),
  };
}

function normalizeTaskHubStatus(value: unknown): string {
  return value === 'pending' ||
    value === 'planning' ||
    value === 'queued' ||
    value === 'executing' ||
    value === 'awaiting_user' ||
    value === 'paused' ||
    value === 'completed' ||
    value === 'partial_success' ||
    value === 'failed' ||
    value === 'cancelled'
    ? value
    : 'queued';
}

function safeNullableTaskHubText(value: unknown): string | null {
  const text = safeTaskHubText(value);
  return text || null;
}

function normalizeAwaitingKind(value: unknown): AwaitingKind | null {
  return value === 'clarification' ||
    value === 'login' ||
    value === 'captcha' ||
    value === 'permission' ||
    value === 'browser_action'
    ? value
    : null;
}

function safeTaskHubText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeNullableTaskHubDate(value: unknown): string | number | Date | null {
  return value == null ? null : safeTaskHubDate(value);
}

function safeTaskHubDate(value: unknown): string | number | Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
