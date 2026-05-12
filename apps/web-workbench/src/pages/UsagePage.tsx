import { Activity, CheckCircle2, Clock } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader, Section } from '@/pages/PageShell';

interface DayBar {
  date: string;
  label: string;
  count: number;
}

/**
 * Usage dashboard. P1.3 — single data source: `usage.summary`. The
 * old version stitched together quota.status (本月任务) with a
 * tasks.list scan capped at 100 (成功/失败/进行中), and the two
 * answers didn't match. The new endpoint runs both queries in one
 * round-trip, server-side, scoped to the user's UTC current month,
 * so every counter on the page can be reconciled.
 */
export function UsagePage(): JSX.Element {
  const [snap, setSnap] = React.useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    void trpc.usage.summary
      .query()
      .then((res) => {
        if (!active) return;
        setSnap(res as UsageSnapshot);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const totalQuota =
    snap == null ? null : snap.quotaLimit + snap.quotaBonus;
  const pct =
    totalQuota == null || totalQuota === 0
      ? 0
      : Math.min(100, Math.round((snap?.quotaUsed ? snap.quotaUsed : 0) / totalQuota * 100));
  const bars: DayBar[] = React.useMemo(() => {
    if (!snap) return [];
    return snap.dailyCounts.map((d) => ({
      date: d.date,
      label: formatDay(new Date(`${d.date}T00:00:00Z`)),
      count: d.count,
    }));
  }, [snap]);
  const maxBar = Math.max(1, ...bars.map((b) => b.count));

  return (
    <PageContainer width="wide">
      <PageHeader title="用量" description="当月任务额度和执行统计" />
      <div className="space-y-6">
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700">
            读取用量失败：{error}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            icon={<Activity className="h-4 w-4" />}
            label="本月执行记录"
            value={loading ? '—' : String(snap?.monthTasksTotal ?? 0)}
            sub={
              snap == null
                ? '配额 — 个'
                : snap.quotaBonus > 0
                ? `配额 ${snap.quotaLimit} + 加量 ${snap.quotaBonus}`
                : `配额 ${snap.quotaLimit} 个`
            }
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            label="成功"
            value={loading ? '—' : String(snap?.monthCompleted ?? 0)}
            sub={
              snap == null
                ? '失败 — · 进行中 —'
                : `失败 ${snap.monthFailed} · 进行中 ${snap.monthExecuting}`
            }
          />
          <StatCard
            icon={<Clock className="h-4 w-4 text-pink-500" />}
            label="剩余额度"
            value={loading ? '—' : String(snap?.quotaRemaining ?? 0)}
            sub={totalQuota == null ? '加载中…' : `${pct}% 已使用`}
          />
        </div>

        <Section title="额度使用进度">
          <p className="mb-3 text-[11px] text-muted-foreground">
            额度仅计入成功消耗的任务，失败和系统任务不扣额度。
          </p>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full transition-all',
                  pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-primary',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {snap?.quotaUsed ?? 0} / {totalQuota ?? '—'}
            </span>
          </div>
          {pct >= 75 && (
            <div className="mt-3 flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <div>
                <div className="text-xs font-medium">额度即将用完</div>
                <div className="text-[11px] text-muted-foreground">
                  升级套餐后立即获得更多任务额度
                </div>
              </div>
              <Link to="/plan">
                <Button size="sm" variant="outline">
                  查看套餐
                </Button>
              </Link>
            </div>
          )}
        </Section>

        <Section title="最近 7 天">
          <div className="flex items-end justify-between gap-2 px-1 pb-4 pt-2">
            {bars.map((b) => {
              const h = b.count === 0 ? 4 : Math.max(6, Math.round((b.count / maxBar) * 120));
              return (
                <div key={b.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <div className="text-[10px] tabular-nums text-muted-foreground">
                    {b.count || ''}
                  </div>
                  <div
                    className={cn(
                      'w-full rounded-t-md transition-all',
                      b.count > 0 ? 'bg-primary/80' : 'bg-muted',
                    )}
                    style={{ height: h }}
                  />
                  <div className="text-[10px] text-muted-foreground">{b.label}</div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </PageContainer>
  );
}

interface UsageSnapshot {
  monthTasksTotal: number;
  monthCompleted: number;
  monthFailed: number;
  monthExecuting: number;
  quotaLimit: number;
  quotaUsed: number;
  quotaRemaining: number;
  quotaBonus: number;
  dailyCounts: Array<{ date: string; count: number }>;
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function formatDay(d: Date): string {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - copy.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
