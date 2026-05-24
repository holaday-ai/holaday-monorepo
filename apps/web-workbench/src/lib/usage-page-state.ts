export interface UsageSnapshotLike {
  readonly monthTasksTotal: number;
  readonly quotaLimit: number;
  readonly quotaUsed: number;
  readonly quotaBonus: number;
  readonly dailyCounts: ReadonlyArray<{ readonly date: string; readonly count: number }>;
}

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
  if (options.loading) return '用量加载中…';
  if (options.error) return '用量加载失败';
  if (!options.snapshot) return '暂无用量数据';
  const total = usageQuotaTotal(options.snapshot);
  const pct = usagePercent(options.snapshot.quotaUsed, total);
  return `本月 ${options.snapshot.monthTasksTotal} 次执行 · ${pct}% 已使用`;
}

export function formatUsageDay(date: Date, today = new Date()): string {
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
  return dailyCounts.map((day) => ({
    date: day.date,
    label: formatUsageDay(new Date(`${day.date}T00:00:00Z`), today),
    count: Math.max(0, day.count),
  }));
}

export function hasRecentUsage(bars: readonly Pick<UsageDayBar, 'count'>[]): boolean {
  return bars.some((bar) => bar.count > 0);
}
