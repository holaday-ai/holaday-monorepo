export interface QuotaIndicatorSnapshotLike {
  readonly plan: string;
  readonly period: 'day' | 'month';
  readonly tasksLimit: number;
  readonly tasksRemaining: number;
  readonly bonusTasks: number;
}

export interface QuotaSnapshot extends QuotaIndicatorSnapshotLike {
  readonly tasksUsed: number;
  readonly opusUsed: number;
  readonly opusLimit: number | null;
  readonly opusRemaining: number | null;
  readonly bonusOpus: number;
  readonly concurrentCount: number;
  readonly concurrencyLimit: number;
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
  const tasksLimit = finiteNumberOrZero(snap.tasksLimit);
  const bonusTasks = finiteNumberOrZero(snap.bonusTasks);
  const tasksRemaining = finiteNumberOrZero(snap.tasksRemaining);
  const totalLimit = Math.max(0, tasksLimit) + Math.max(0, bonusTasks);
  const remaining =
    totalLimit > 0
      ? Math.min(totalLimit, Math.max(0, tasksRemaining))
      : Math.max(0, tasksRemaining);
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

export function normalizeQuotaSnapshot(value: unknown): QuotaSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const period = raw.period === 'day' || raw.period === 'month' ? raw.period : null;
  if (!period) return null;

  const tasksUsed = finiteNumber(raw.tasksUsed);
  const tasksLimit = finiteNumber(raw.tasksLimit);
  const tasksRemaining = finiteNumber(raw.tasksRemaining);
  const bonusTasks = finiteNumber(raw.bonusTasks);
  const opusUsed = finiteNumber(raw.opusUsed);
  const bonusOpus = finiteNumber(raw.bonusOpus);
  const concurrentCount = finiteNumber(raw.concurrentCount);
  const concurrencyLimit = finiteNumber(raw.concurrencyLimit);
  if (
    tasksUsed == null ||
    tasksLimit == null ||
    tasksRemaining == null ||
    bonusTasks == null ||
    opusUsed == null ||
    bonusOpus == null ||
    concurrentCount == null ||
    concurrencyLimit == null
  ) {
    return null;
  }

  return {
    plan: typeof raw.plan === 'string' && raw.plan.trim() ? raw.plan : 'free',
    period,
    tasksUsed,
    tasksLimit,
    tasksRemaining,
    bonusTasks,
    opusUsed,
    opusLimit: nullableFiniteNumber(raw.opusLimit),
    opusRemaining: nullableFiniteNumber(raw.opusRemaining),
    bonusOpus,
    concurrentCount,
    concurrencyLimit,
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

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  return finiteNumber(value);
}

function finiteNumberOrZero(value: unknown): number {
  return finiteNumber(value) ?? 0;
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
