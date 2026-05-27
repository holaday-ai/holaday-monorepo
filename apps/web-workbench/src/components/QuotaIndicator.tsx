import { AlertCircle, ArrowUpRight, Loader2, RotateCw } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  normalizeQuotaSnapshot,
  type QuotaSnapshot,
  quotaRefreshErrorMessage,
  quotaRefreshStatusCopy,
  quotaTaskState,
} from '@/lib/quota-indicator-state';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

interface Props {
  /** Compact rail variant — vertical icon strip can't fit the bar. */
  compact?: boolean;
  /** Refresh trigger — caller bumps when a task lands a terminal state. */
  refreshKey?: number | string;
}

/**
 * Sidebar quota strip. Renders the active period's usage as a small
 * progress bar plus a click target that goes to /plan for upgrades
 * or /addons (future) for top-ups. Refetches on mount + whenever
 * the parent bumps `refreshKey` — typical pattern is a counter that
 * the task store increments on terminal events.
 *
 * Compact variant (collapsed rail): just a tiny number under the
 * user avatar. The full bar costs too much space at 64px wide.
 */
export function QuotaIndicator({ compact = false, refreshKey }: Props): JSX.Element | null {
  const navigate = useNavigate();
  const [snap, setSnap] = React.useState<QuotaSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    setLoading(true);
    trpc.quota.status.query().then(
      (res) => {
        const nextSnap = normalizeQuotaSnapshot(res);
        if (nextSnap) {
          setSnap(nextSnap);
          setError(null);
        } else {
          setError('额度数据格式异常，请稍后重试。');
        }
        setLoading(false);
      },
      (err) => {
        setError(quotaRefreshErrorMessage(err));
        setLoading(false);
      },
    );
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    trpc.quota.status.query().then(
      (res) => {
        if (cancelled) return;
        const nextSnap = normalizeQuotaSnapshot(res);
        if (nextSnap) {
          setSnap(nextSnap);
          setError(null);
        } else {
          setError('额度数据格式异常，请稍后重试。');
        }
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(quotaRefreshErrorMessage(err));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (loading && !snap) {
    return compact ? null : (
      <div className="px-2 py-1.5 text-[10px] text-muted-foreground/60">读取额度...</div>
    );
  }
  if (!snap) {
    if (compact) return null;
    const copy = quotaRefreshStatusCopy({ error, hasSnapshot: false });
    return (
      <div className="mb-2 px-2">
        <div className="rounded-md border border-[#DCDDDD] bg-white px-2.5 py-2 text-[11px] shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/90">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#EA1F59]" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">
                {copy?.title ?? '额度暂时不可用'}
              </div>
              <div className="mt-0.5 leading-5 text-muted-foreground">
                {copy?.body ?? '请稍后重试。'}
              </div>
            </div>
            <QuotaRetryButton loading={loading} onRetry={refresh} />
          </div>
        </div>
      </div>
    );
  }

  // Drive the bar straight off `remaining` so the percentage and the
  // displayed "剩余 X / Y" number can never disagree. The previous
  // formula divided `tasksUsed` by (limit + bonus), but `tasksUsed`
  // only counts regular-slot consumption — bonus tasks decrement
  // `bonusTasks` instead. With bonus-first consumption that meant
  // a user could burn through their entire add-on pack and the bar
  // still read 0%. Now the bar reflects whatever `tasksRemaining`
  // says, which the quota service already computes correctly.
  const { totalLimit, remaining, usedPct, periodLabel, lowOnTasks, outOfTasks } =
    quotaTaskState(snap);
  const refreshCopy = quotaRefreshStatusCopy({ error, hasSnapshot: true });

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => navigate('/plan')}
        title={`${periodLabel}剩余 ${remaining} / ${totalLimit}`}
        aria-label={`${periodLabel}剩余 ${remaining} / ${totalLimit}`}
        className={cn(
          'mt-1 inline-flex h-6 w-10 items-center justify-center rounded text-[10px] font-medium',
          outOfTasks
            ? 'bg-[#EA1F59]/10 text-[#EA1F59]'
            : lowOnTasks
              ? 'bg-[#FFC910]/15 text-[#595757]'
              : 'text-muted-foreground hover:bg-[#EFEFEF]/60 dark:hover:bg-white/10',
        )}
      >
        {remaining}
      </button>
    );
  }

  return (
    <div className="mb-2 px-2">
      <button
        type="button"
        onClick={() => navigate('/plan')}
        className={cn(
          'group flex w-full flex-col gap-1 rounded-md border border-[#DCDDDD] bg-white px-2.5 py-2 text-left shadow-[0_1px_3px_rgba(17,24,39,0.05)] transition-colors dark:border-white/10 dark:bg-card/90',
          'hover:border-[#ADADAD] hover:bg-[#EFEFEF]/50 dark:hover:bg-white/10',
        )}
      >
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-medium text-foreground">
            {periodLabel}剩余 {remaining}
            <span className="ml-1 text-muted-foreground/70">/ {totalLimit}</span>
          </span>
          <ArrowUpRight className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        {/* Progress bar — neutral fill; switches to brand yellow/pink as remaining drops. */}
        <div className="h-1 overflow-hidden rounded-full bg-[#EFEFEF] dark:bg-white/10">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-300',
              outOfTasks
                ? 'bg-[#EA1F59]/75'
                : lowOnTasks
                  ? 'bg-[#FFC910]'
                  : 'bg-[#42C0EF]',
            )}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {snap.bonusTasks > 0 ? (
              <>
                额度 {snap.tasksLimit} <span className="text-muted-foreground/70">+ {snap.bonusTasks} 加量</span>
              </>
            ) : (
              <>套餐：{planLabel(snap.plan)}</>
            )}
          </span>
          {snap.opusLimit != null && snap.opusRemaining != null && (
            <span title={`Opus 剩余 ${snap.opusRemaining}`}>
              Opus {snap.opusRemaining}
              {snap.bonusOpus > 0 ? ` (+${snap.bonusOpus})` : ''}
            </span>
          )}
        </div>
        {outOfTasks && (
          <div className="text-[10px] font-medium text-[#EA1F59]">
            {snap.plan === 'free' ? '今日额度已用完，明天再来或升级' : '本月额度已用完，购买加量包'}
          </div>
        )}
        {refreshCopy && (
          <div className="flex items-center justify-between gap-2 rounded bg-[#EA1F59]/10 px-2 py-1 text-[10px] text-[#EA1F59]">
            <span className="min-w-0 truncate" title={refreshCopy.body}>
              {refreshCopy.title}
            </span>
            <QuotaRetryButton loading={loading} onRetry={refresh} compact />
          </div>
        )}
      </button>
    </div>
  );
}

function QuotaRetryButton({
  loading,
  onRetry,
  compact = false,
}: {
  loading: boolean;
  onRetry(): void;
  compact?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRetry();
      }}
      disabled={loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        compact
          ? 'h-5 w-5 hover:bg-[#EA1F59]/10'
          : 'h-7 gap-1 border border-[#DCDDDD] bg-white px-2 text-[11px] text-foreground hover:bg-[#EFEFEF]/50 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10',
      )}
      aria-label={loading ? '正在重试额度刷新' : '重试额度刷新'}
    >
      {loading ? (
        <Loader2 className={cn('animate-spin', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
      ) : (
        <RotateCw className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      )}
      {!compact && <span>{loading ? '重试中' : '重试'}</span>}
    </button>
  );
}

function planLabel(plan: string): string {
  switch (plan) {
    case 'pro':
      return '专业版';
    case 'basic':
      return '基础版';
    default:
      return '体验版';
  }
}
