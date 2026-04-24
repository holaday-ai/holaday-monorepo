import { Activity, CheckCircle2, Clock } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageShell, Section } from '@/pages/PageShell';

interface DayBar {
  date: string;
  label: string;
  count: number;
}

/**
 * Usage dashboard. Pulls tasks.list (via tRPC) so the counters and
 * daily histogram are real, even before a dedicated usage API
 * exists. Quota is derived from the plan tier using the same caps
 * PlanPage advertises — so the two screens stay consistent.
 */
export function UsagePage(): JSX.Element {
  const [plan, setPlan] = React.useState<string>('free');
  const [monthCount, setMonthCount] = React.useState(0);
  const [succeeded, setSucceeded] = React.useState(0);
  const [failed, setFailed] = React.useState(0);
  const [running, setRunning] = React.useState(0);
  const [bars, setBars] = React.useState<DayBar[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    void Promise.all([
      trpc.auth.me.query().catch(() => null),
      trpc.tasks.list.query({ limit: 200 }).catch(() => null),
    ]).then(([me, tasks]) => {
      if (!active) return;
      if (me) setPlan(me.plan);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      let mCount = 0;
      let sCount = 0;
      let fCount = 0;
      let rCount = 0;
      const byDay = new Map<string, number>();
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        byDay.set(dateKey(d), 0);
      }
      const list = Array.isArray(tasks) ? tasks : tasks && 'tasks' in tasks ? tasks.tasks : [];
      for (const t of (list as Array<{ createdAt: string | number; status: string }>) ?? []) {
        const ts = typeof t.createdAt === 'string' ? Date.parse(t.createdAt) : t.createdAt;
        if (!Number.isFinite(ts)) continue;
        if (ts >= monthStart) mCount += 1;
        if (t.status === 'succeeded') sCount += 1;
        else if (t.status === 'failed') fCount += 1;
        else if (t.status === 'running' || t.status === 'pending' || t.status === 'awaiting_user') rCount += 1;
        const k = dateKey(new Date(ts));
        if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + 1);
      }
      setMonthCount(mCount);
      setSucceeded(sCount);
      setFailed(fCount);
      setRunning(rCount);
      setBars(
        Array.from(byDay.entries()).map(([date, count]) => ({
          date,
          label: formatDay(new Date(date)),
          count,
        })),
      );
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const quota = plan === 'pro' ? 1000 : plan === 'basic' ? 200 : 20;
  const remaining = Math.max(0, quota - monthCount);
  const pct = Math.min(100, Math.round((monthCount / quota) * 100));
  const maxBar = Math.max(1, ...bars.map((b) => b.count));

  return (
    <PageShell title="用量" subtitle="当月任务额度和执行统计" width="5xl">
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            icon={<Activity className="h-4 w-4" />}
            label="本月任务"
            value={loading ? '—' : String(monthCount)}
            sub={`配额 ${quota} 个`}
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            label="成功"
            value={loading ? '—' : String(succeeded)}
            sub={`失败 ${failed} · 进行中 ${running}`}
          />
          <StatCard
            icon={<Clock className="h-4 w-4 text-indigo-500" />}
            label="剩余额度"
            value={loading ? '—' : String(remaining)}
            sub={`${pct}% 已使用`}
          />
        </div>

        <Section title="额度使用进度">
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
              {monthCount} / {quota}
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
    </PageShell>
  );
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

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDay(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - copy.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
