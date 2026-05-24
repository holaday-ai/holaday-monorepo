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
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
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
