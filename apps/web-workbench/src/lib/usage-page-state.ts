import { pageErrorMessage } from './page-error-copy';

export interface UsageSnapshotLike {
  readonly monthTasksTotal: number;
  readonly monthCompleted: number;
  readonly monthPartialSuccess: number;
  readonly monthFailed: number;
  readonly monthCancelled: number;
  readonly monthExecuting: number;
  readonly quotaLimit: number;
  readonly quotaUsed: number;
  readonly quotaRemaining: number;
  readonly quotaBonus: number;
  readonly dailyCounts: ReadonlyArray<{ readonly date: string; readonly count: number }>;
}

export type NormalizedUsageSnapshot = UsageSnapshotLike;

export interface UsageDayBar {
  readonly date: string;
  readonly label: string;
  readonly count: number;
}

export function usageQuotaTotal(snapshot: Pick<UsageSnapshotLike, 'quotaLimit' | 'quotaBonus'>): number {
  return Math.max(0, snapshot.quotaLimit) + Math.max(0, snapshot.quotaBonus);
}

export function usagePercent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((Math.max(0, used) / total) * 100)));
}

export function usagePageSummary(options: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly snapshot: UsageSnapshotLike | null;
}): string {
  if (options.loading && !options.snapshot) return '用量加载中…';
  if (options.error && options.snapshot) return '刷新失败 · 显示上次用量';
  if (options.error) return '用量加载失败';
  if (!options.snapshot) return '暂无用量数据';
  const total = usageQuotaTotal(options.snapshot);
  const pct = usagePercent(options.snapshot.quotaUsed, total);
  return `本月 ${options.snapshot.monthTasksTotal} 次执行 · ${pct}% 已使用`;
}

export function usageStatusCopy(options: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly snapshot: UsageSnapshotLike | null;
}): { readonly title: string; readonly body: string } | null {
  if (options.error && options.snapshot) {
    return {
      title: '刷新失败，正在显示上次成功加载的用量',
      body: options.error,
    };
  }
  if (options.error) {
    return {
      title: '用量加载失败',
      body: options.error,
    };
  }
  if (options.loading && !options.snapshot) {
    return {
      title: '用量加载中…',
      body: '正在读取当月任务额度和执行统计。',
    };
  }
  if (!options.snapshot) {
    return {
      title: '暂无用量数据',
      body: '当前账号还没有可展示的用量统计。',
    };
  }
  return null;
}

export function usageErrorMessage(err: unknown, fallback = '请稍后重试'): string {
  return pageErrorMessage(err, fallback);
}

export function normalizeUsageSnapshot(value: unknown): NormalizedUsageSnapshot {
  const root = isRecord(value) ? value : {};
  const quotaLimit = safeUsageCount(root.quotaLimit);
  const quotaBonus = safeUsageCount(root.quotaBonus);
  const quotaUsed = safeUsageCount(root.quotaUsed);
  const fallbackRemaining = Math.max(0, quotaLimit + quotaBonus - quotaUsed);
  return {
    monthTasksTotal: safeUsageCount(root.monthTasksTotal),
    monthCompleted: safeUsageCount(root.monthCompleted),
    monthPartialSuccess: safeUsageCount(root.monthPartialSuccess),
    monthFailed: safeUsageCount(root.monthFailed),
    monthCancelled: safeUsageCount(root.monthCancelled),
    monthExecuting: safeUsageCount(root.monthExecuting),
    quotaLimit,
    quotaUsed,
    quotaRemaining:
      root.quotaRemaining == null
        ? fallbackRemaining
        : safeUsageCount(root.quotaRemaining),
    quotaBonus,
    dailyCounts: normalizeUsageDailyCounts(root.dailyCounts),
  };
}

export function formatUsageDay(date: Date, today = new Date()): string {
  if (Number.isNaN(date.getTime())) return '—';
  const todayCopy = new Date(today);
  todayCopy.setUTCHours(0, 0, 0, 0);
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  const diff = Math.round((todayCopy.getTime() - copy.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

export function usageDayBars(
  dailyCounts: UsageSnapshotLike['dailyCounts'],
  today = new Date(),
): readonly UsageDayBar[] {
  return dailyCounts.map((day) => {
    const date = typeof day.date === 'string' ? day.date : '';
    return {
      date,
      label: formatUsageDay(new Date(`${date}T00:00:00Z`), today),
      count: safeUsageCount(day.count),
    };
  });
}

export function hasRecentUsage(bars: readonly Pick<UsageDayBar, 'count'>[]): boolean {
  return bars.some((bar) => bar.count > 0);
}

function normalizeUsageDailyCounts(value: unknown): NormalizedUsageSnapshot['dailyCounts'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const date = safeUsageDate(entry.date);
    if (!date) return [];
    return [{ date, count: safeUsageCount(entry.count) }];
  });
}

function safeUsageDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return '';
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? '' : trimmed;
}

function safeUsageCount(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
