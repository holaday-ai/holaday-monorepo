export interface QuotaIndicatorSnapshotLike {
  readonly plan: string;
  readonly period: 'day' | 'month';
  readonly tasksLimit: number;
  readonly tasksRemaining: number;
  readonly bonusTasks: number;
}

export interface QuotaTaskState {
  readonly totalLimit: number;
  readonly remaining: number;
  readonly usedPct: number;
  readonly periodLabel: string;
  readonly lowOnTasks: boolean;
  readonly outOfTasks: boolean;
}

export function quotaTaskState(snap: QuotaIndicatorSnapshotLike): QuotaTaskState {
  const totalLimit = Math.max(0, snap.tasksLimit) + Math.max(0, snap.bonusTasks);
  const remaining =
    totalLimit > 0
      ? Math.min(totalLimit, Math.max(0, snap.tasksRemaining))
      : Math.max(0, snap.tasksRemaining);
  const usedPct =
    totalLimit > 0
      ? Math.min(100, Math.max(0, Math.round(((totalLimit - remaining) / totalLimit) * 100)))
      : 0;

  return {
    totalLimit,
    remaining,
    usedPct,
    periodLabel: snap.period === 'day' ? '今日' : '本月',
    lowOnTasks: totalLimit > 0 && remaining <= Math.max(1, Math.floor(totalLimit * 0.1)),
    outOfTasks: totalLimit > 0 && remaining === 0,
  };
}

export function quotaRefreshErrorMessage(
  err: unknown,
  fallback = '额度暂时无法刷新，请稍后重试。',
): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

export function quotaRefreshStatusCopy({
  error,
  hasSnapshot,
}: {
  readonly error: string | null;
  readonly hasSnapshot: boolean;
}): { readonly title: string; readonly body: string } | null {
  if (!error) return null;
  if (hasSnapshot) {
    return {
      title: '额度刷新失败，正在显示上次数据',
      body: error,
    };
  }
  return {
    title: '额度暂时不可用',
    body: error,
  };
}
