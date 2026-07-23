import { pageErrorMessage } from './page-error-copy';
import type { AwaitingKind } from './awaiting-user-copy';
import { taskDisplayTitle } from './task-display-copy';
import { deriveTaskProductState } from './task-product-state';

export type HistoryStatusFilter = 'all' | 'completed' | 'review' | 'failed' | 'running';
export type HistoryRangeFilter = '7d' | '30d' | 'all';
export type HistoryServerTaskStatus =
  | 'pending'
  | 'planning'
  | 'queued'
  | 'executing'
  | 'awaiting_user'
  | 'paused'
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'cancelled';

export type HistoryStatusServerFilter =
  | HistoryServerTaskStatus
  | HistoryServerTaskStatus[]
  | null;

export const historyRunningStatuses = [
  'pending',
  'planning',
  'queued',
  'executing',
  'awaiting_user',
  'paused',
] as const satisfies readonly HistoryServerTaskStatus[];

export const historyStatusFilterOptions: ReadonlyArray<{
  readonly id: HistoryStatusFilter;
  readonly label: string;
}> = [
  { id: 'all', label: '全部' },
  { id: 'completed', label: '已完成' },
  { id: 'review', label: '需复核' },
  { id: 'failed', label: '失败' },
  { id: 'running', label: '进行中' },
];

export function historyStatusFilterToServerStatuses(
  status: HistoryStatusFilter,
): HistoryStatusServerFilter {
  if (status === 'all') return null;
  if (status === 'completed') return 'completed';
  if (status === 'review') return 'partial_success';
  if (status === 'failed') return 'failed';
  return [...historyRunningStatuses];
}

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

export function taskHubRowTitle(
  row: Pick<NormalizedTaskHubRow, 'intent' | 'title'>,
  maxLength = 60,
): string {
  return taskDisplayTitle(row, maxLength);
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

type TaskHubProductStateInput =
  | string
  | {
      readonly status: string;
      readonly awaitingKind?: AwaitingKind | null;
      readonly queuePosition?: number | null;
      readonly tickCount?: number | null;
    };

function toTaskHubProductState(input: TaskHubProductStateInput) {
  return typeof input === 'string'
    ? deriveTaskProductState({ status: input })
    : deriveTaskProductState({
        status: input.status,
        awaitingKind: input.awaitingKind ?? null,
        queuePosition: input.queuePosition ?? null,
        tickCount: input.tickCount ?? null,
      });
}

export function taskHubNeedsAttention(input: TaskHubProductStateInput): boolean {
  return toTaskHubProductState(input).lifecycle === 'waiting_user';
}

/**
 * Subtle resting tone (faint left border + tint) for failed / partial /
 * cancelled rows in the hub (history / starred) so they're scannable
 * without the strong awaiting highlight. Empty for awaiting (keeps its
 * own highlight) and completed / running (neutral). P2-B.
 */
export function taskHubRowTone(input: TaskHubProductStateInput): string {
  const state = toTaskHubProductState(input);
  if (state.lifecycle !== 'terminal') return '';
  if (state.outcome === 'failed') {
    return 'bg-[#EA1F59]/[0.035] shadow-[inset_3px_0_0_rgba(234,31,89,0.4)]';
  }
  if (state.outcome === 'partial_success') {
    return 'bg-[#FFC910]/[0.05] shadow-[inset_3px_0_0_rgba(255,201,16,0.5)]';
  }
  if (state.outcome === 'cancelled') {
    return 'shadow-[inset_3px_0_0_rgba(89,87,87,0.28)]';
  }
  return '';
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
  | 'paused'
  | 'cancelled'
  | 'running'
  | 'unknown';

export type TaskHubStatusIconKind =
  | 'success'
  | 'attention'
  | 'failed'
  | 'inactive'
  | 'running';

export function taskHubStatusTone(input: TaskHubProductStateInput): TaskHubStatusTone {
  const state = toTaskHubProductState(input);
  if (state.lifecycle === 'waiting_user') return 'awaiting';
  if (state.lifecycle === 'paused') return 'paused';
  if (state.lifecycle === 'unknown') return 'unknown';
  if (state.lifecycle !== 'terminal') return 'running';
  if (state.outcome === 'completed') return 'completed';
  if (state.outcome === 'partial_success') return 'partial_success';
  if (state.outcome === 'failed') return 'failed';
  if (state.outcome === 'cancelled') return 'cancelled';
  return 'running';
}

export function taskHubStatusIconKind(input: TaskHubProductStateInput): TaskHubStatusIconKind {
  const tone = taskHubStatusTone(input);
  if (tone === 'completed') return 'success';
  if (tone === 'partial_success' || tone === 'awaiting') return 'attention';
  if (tone === 'failed') return 'failed';
  if (tone === 'cancelled' || tone === 'paused' || tone === 'unknown') return 'inactive';
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
  const status = safeTaskHubText(value);
  return status || 'unknown';
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
    value === 'browser_action' ||
    value === 'video_quote'
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
