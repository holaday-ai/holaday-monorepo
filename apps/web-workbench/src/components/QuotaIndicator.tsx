import { AlertCircle, ArrowUpRight, Loader2, RotateCw } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  normalizeQuotaSnapshot,
  quotaIndicatorHref,
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
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const nextSnap = normalizeQuotaSnapshot(await trpc.quota.status.query());
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      if (nextSnap) {
        setSnap(nextSnap);
        setError(null);
      } else {
        setError('额度暂时无法读取，请稍后重试。');
      }
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError(quotaRefreshErrorMessage(err));
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [refresh, refreshKey]);

  if (loading && !snap) {
    return compact ? null : (
      <div className="mb-2 px-2">
        <div className="rounded-[8px] border border-[#DCDDDD]/70 bg-white/55 px-2.5 py-2 text-[11px] text-[#ADADAD] shadow-[0_8px_22px_rgba(89,87,87,0.04)] dark:border-white/10 dark:bg-white/[0.04]">
          读取额度...
        </div>
      </div>
    );
  }
  if (!snap) {
    if (compact) return null;
    const copy = quotaRefreshStatusCopy({ error, hasSnapshot: false });
    return (
      <div className="mb-2 px-2">
        <div className="rounded-[8px] border border-[#DCDDDD]/75 bg-white/65 px-2.5 py-2 text-[11px] shadow-[0_1px_1px_rgba(17,24,39,0.02)] dark:border-white/10 dark:bg-white/5">
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
            <QuotaRetryButton loading={loading} onRetry={() => void refresh()} />
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
    const href = quotaIndicatorHref(snap);
    return (
      <button
        type="button"
        onClick={() => navigate(href)}
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
      <div
        className={cn(
          'rounded-[8px] border border-[#DCDDDD]/70 bg-white/72 p-2.5 text-left shadow-[0_8px_22px_rgba(89,87,87,0.04)] transition-colors dark:border-white/10 dark:bg-white/[0.04]',
          'hover:border-[#EA1F59]/22 hover:bg-[#EA1F59]/[0.035] dark:hover:border-[#EA1F59]/35 dark:hover:bg-[#EA1F59]/10',
        )}
      >
        <button
          type="button"
          onClick={() => navigate(quotaIndicatorHref(snap))}
          className="group flex w-full flex-col gap-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-[#EA1F59]/45"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-[#ADADAD]">{periodLabel}额度</div>
              <div className="mt-0.5 text-[13px] font-semibold leading-4 text-[#595757] dark:text-foreground">
                剩余 {remaining}
                <span className="ml-1 text-[11px] font-medium text-[#ADADAD]">/ {totalLimit}</span>
              </div>
            </div>
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border border-[#DCDDDD]/70 bg-white/65 text-[#ADADAD] transition-colors group-hover:border-[#EA1F59]/25 group-hover:text-[#EA1F59] dark:border-white/10 dark:bg-transparent">
              <ArrowUpRight className="h-3 w-3" />
            </span>
          </div>
          {/* Progress bar — neutral fill; switches to brand yellow/pink as remaining drops. */}
          <div className="h-1.5 overflow-hidden rounded-full bg-[#EFEFEF] dark:bg-white/10">
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
          <div className="flex items-center justify-between gap-2 text-[10px] text-[#595757]/75 dark:text-foreground/60">
            <span className="truncate">
              {snap.bonusTasks > 0 ? (
                <>
                  额度 {snap.tasksLimit} <span className="text-[#ADADAD]">+ {snap.bonusTasks} 加量</span>
                </>
              ) : (
                <>套餐：{planLabel(snap.plan)}</>
              )}
            </span>
            {snap.opusLimit != null && snap.opusRemaining != null && (
              <span className="shrink-0" title={`Opus 剩余 ${snap.opusRemaining}`}>
                Opus {snap.opusRemaining}
                {snap.bonusOpus > 0 ? ` (+${snap.bonusOpus})` : ''}
              </span>
            )}
          </div>
        </button>
        {outOfTasks && (
          <div className="mt-1.5 text-[10px] font-medium text-[#EA1F59]">
            {snap.plan === 'free' ? '今日额度已用完，明天再来或升级' : '本月额度已用完，购买加量包'}
          </div>
        )}
        {refreshCopy && (
          <div className="mt-1.5 flex items-center justify-between gap-2 rounded-[7px] bg-[#EA1F59]/8 px-2 py-1 text-[10px] text-[#EA1F59]">
            <span className="min-w-0 truncate" title={refreshCopy.body}>
              {refreshCopy.title}
            </span>
            <QuotaRetryButton loading={loading} onRetry={() => void refresh()} compact />
          </div>
        )}
      </div>
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
      title={loading ? '正在刷新额度' : '重试额度刷新'}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        compact
          ? 'h-5 w-5 hover:bg-[#EA1F59]/10'
          : 'h-7 w-7 rounded-[6px] border border-[#DCDDDD]/75 bg-white/65 text-[#595757] hover:border-[#EA1F59]/25 hover:bg-[#EA1F59]/5 hover:text-[#EA1F59] dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10',
      )}
      aria-label={loading ? '正在重试额度刷新' : '重试额度刷新'}
    >
      {loading ? (
        <Loader2 className={cn('animate-spin', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
      ) : (
        <RotateCw className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      )}
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
