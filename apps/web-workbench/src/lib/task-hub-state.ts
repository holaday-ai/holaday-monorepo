export type HistoryStatusFilter = 'all' | 'completed' | 'failed' | 'running';
export type HistoryRangeFilter = '7d' | '30d' | 'all';

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
  if (error) return '历史任务加载失败';
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
  if (error) return '置顶任务加载失败';
  return `已置顶 ${count}${hasMore ? '+' : ''} 个`;
}

export function taskHubErrorMessage(err: unknown, fallback = '请稍后重试'): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
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
