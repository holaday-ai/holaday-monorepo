import { ArrowUpRight } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

interface QuotaSnapshot {
  plan: string;
  period: 'day' | 'month';
  tasksUsed: number;
  tasksLimit: number;
  tasksRemaining: number;
  bonusTasks: number;
  opusUsed: number;
  opusLimit: number | null;
  opusRemaining: number | null;
  bonusOpus: number;
  concurrentCount: number;
  concurrencyLimit: number;
}

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

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    trpc.quota.status.query().then(
      (res) => {
        if (cancelled) return;
        setSnap(res as QuotaSnapshot);
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        setSnap(null);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (loading && !snap) {
    return compact ? null : (
      <div className="px-2 py-1.5 text-[10px] text-muted-foreground/60">读取额度…</div>
    );
  }
  if (!snap) return null;

  // Drive the bar straight off `remaining` so the percentage and the
  // displayed "剩余 X / Y" number can never disagree. The previous
  // formula divided `tasksUsed` by (limit + bonus), but `tasksUsed`
  // only counts regular-slot consumption — bonus tasks decrement
  // `bonusTasks` instead. With bonus-first consumption that meant
  // a user could burn through their entire add-on pack and the bar
  // still read 0%. Now the bar reflects whatever `tasksRemaining`
  // says, which the quota service already computes correctly.
  const totalLimit = snap.tasksLimit + snap.bonusTasks;
  const remaining = snap.tasksRemaining;
  const usedPct =
    totalLimit > 0
      ? Math.min(100, Math.max(0, Math.round(((totalLimit - remaining) / totalLimit) * 100)))
      : 0;
  const periodLabel = snap.period === 'day' ? '今日' : '本月';
  const lowOnTasks = remaining <= Math.max(1, Math.floor(totalLimit * 0.1));
  const outOfTasks = remaining === 0;

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
            ? 'bg-red-500/10 text-red-600 dark:text-red-400'
            : lowOnTasks
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
              : 'text-muted-foreground hover:bg-foreground/5',
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
          'group flex w-full flex-col gap-1 rounded-md border border-border bg-background/40 px-2.5 py-2 text-left transition-colors',
          'hover:bg-foreground/[0.04]',
        )}
      >
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-medium text-foreground">
            {periodLabel}剩余 {remaining}
            <span className="ml-1 text-muted-foreground/70">/ {totalLimit}</span>
          </span>
          <ArrowUpRight className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        {/* Progress bar — neutral fill; switches to amber/red as remaining drops. */}
        <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-300',
              outOfTasks
                ? 'bg-red-500/70'
                : lowOnTasks
                  ? 'bg-amber-500/70'
                  : 'bg-foreground/60',
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
          <div className="text-[10px] font-medium text-red-600 dark:text-red-400">
            {snap.plan === 'free' ? '今日额度已用完，明天再来或升级' : '本月额度已用完，购买加量包'}
          </div>
        )}
      </button>
    </div>
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
