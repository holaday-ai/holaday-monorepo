import { Button } from '@/components/ui/button';
import { supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import {
  usageOutcomeLoadingSubcopy,
  usageOutcomeSubcopy,
  usageQuotaPolicyCopy,
} from '@/lib/usage-copy';
import {
  type NormalizedUsageSnapshot,
  type UsageDayBar,
  hasRecentUsage,
  normalizeUsageSnapshot,
  usageDayBars,
  usageErrorMessage,
  usagePageSummary,
  usagePercent,
  usageQuotaTotal,
  usageStatusCopy,
} from '@/lib/usage-page-state';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader, Section } from '@/pages/PageShell';
import { Activity, AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';

/**
 * Usage dashboard. P1.3 — single data source: `usage.summary`. The
 * old version stitched together quota.status (本月任务) with a
 * tasks.list scan capped at 100 (成功/失败/进行中), and the two
 * answers didn't match. The new endpoint runs both queries in one
 * round-trip, server-side, scoped to the user's UTC current month,
 * so every counter on the page can be reconciled.
 */
export function UsagePage(): JSX.Element {
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const [snap, setSnap] = React.useState<NormalizedUsageSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const res = await trpc.usage.summary.query();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setSnap(normalizeUsageSnapshot(res));
      setError(null);
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError(usageErrorMessage(err));
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
  }, [refresh]);

  const totalQuota = snap == null ? null : usageQuotaTotal(snap);
  const pct = totalQuota == null ? 0 : usagePercent(snap?.quotaUsed ?? 0, totalQuota);
  const bars: readonly UsageDayBar[] = React.useMemo(() => {
    if (!snap) return [];
    return usageDayBars(snap.dailyCounts);
  }, [snap]);
  const maxBar = Math.max(1, ...bars.map((b) => b.count));
  const summary = usagePageSummary({ loading, error, snapshot: snap });
  const statusCopy = usageStatusCopy({ loading, error, snapshot: snap });

  return (
    <PageContainer width="wide">
      <PageHeader
        title="用量"
        description="当月任务额度和执行统计"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="hidden items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:inline-flex">
              {summary}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label={loading ? '正在刷新用量' : '刷新用量'}
              title={loading ? '刷新中' : '刷新'}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          </div>
        }
      />
      <div className="space-y-6">
        {statusCopy && (loading || snap != null) && (
          <div className="rounded-[8px] border border-[#DCDDDD] border-l-[#EA1F59] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] [border-left-width:3px]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2">
                {error ? (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EA1F59]" aria-hidden />
                ) : (
                  <Loader2
                    className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#EA1F59]"
                    aria-hidden
                  />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground/85">{statusCopy.title}</div>
                  <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {statusCopy.body}
                  </div>
                </div>
              </div>
              {error && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                    onClick={() => void refresh()}
                    disabled={loading}
                  >
                    {loading ? '重试中…' : '重试'}
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                  >
                    <a
                      href={supportMailtoHref({
                        subject: '用量统计加载失败',
                        body: '用量统计加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
                      })}
                    >
                      联系支持
                    </a>
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
        {loading && snap == null ? (
          <div className="grid gap-4 md:grid-cols-3">
            {['本月执行记录', '成功', '额度状态'].map((label) => (
              <div
                key={label}
                className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              >
                <div className="mb-3 h-3 w-24 rounded bg-[#EFEFEF]" />
                <div className="h-8 w-16 rounded bg-[#EFEFEF]" />
                <div className="mt-3 h-3 w-32 rounded bg-[#EFEFEF]" />
              </div>
            ))}
          </div>
        ) : error && snap == null ? (
          <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <AlertCircle className="h-8 w-8 text-[#EA1F59]" aria-hidden />
            <div className="text-sm font-medium text-foreground/80">
              {statusCopy?.title ?? '用量暂时无法加载'}
            </div>
            <div className="max-w-md text-xs leading-5 text-muted-foreground">
              {statusCopy?.body ?? error}
            </div>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" onClick={() => void refresh()}>
                重试
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
              >
                <a
                  href={supportMailtoHref({
                    subject: '用量统计加载失败',
                    body: '用量统计加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
                  })}
                >
                  联系支持
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard
                icon={<Activity className="h-4 w-4" />}
                label="本月执行记录"
                value={snap == null ? '—' : String(snap.monthTasksTotal)}
                sub={
                  snap == null
                    ? '配额 — 个'
                    : snap.quotaMode === 'unmetered_test'
                      ? '执行记录正常统计'
                      : snap.quotaBonus > 0
                        ? `配额 ${snap.quotaLimit} + 加量 ${snap.quotaBonus}`
                        : `配额 ${snap.quotaLimit} 个`
                }
              />
              <StatCard
                icon={<CheckCircle2 className="h-4 w-4 text-[#42C0EF]" />}
                label="成功"
                value={snap == null ? '—' : String(snap.monthCompleted)}
                sub={
                  snap == null
                    ? usageOutcomeLoadingSubcopy()
                    : usageOutcomeSubcopy({
                        partialSuccess: snap.monthPartialSuccess,
                        failed: snap.monthFailed,
                        cancelled: snap.monthCancelled,
                        executing: snap.monthExecuting,
                      })
                }
              />
              <StatCard
                icon={
                  snap?.quotaMode === 'unmetered_test' ? (
                    <CheckCircle2 className="h-4 w-4 text-[#42C0EF]" />
                  ) : (
                    <Clock className="h-4 w-4 text-[#EA1F59]" />
                  )
                }
                label={snap?.quotaMode === 'unmetered_test' ? '额度状态' : '剩余额度'}
                value={
                  snap?.quotaMode === 'unmetered_test'
                    ? '不扣减'
                    : snap == null
                      ? '—'
                      : String(snap.quotaRemaining)
                }
                sub={
                  snap?.quotaMode === 'unmetered_test'
                    ? '生产测试账号'
                    : totalQuota == null
                      ? '加载中…'
                      : `${pct}% 已使用`
                }
              />
            </div>

            <Section
              title={snap?.quotaMode === 'unmetered_test' ? '额度规则' : '额度使用进度'}
              className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
            >
              <p className="mb-3 text-[11px] text-muted-foreground">
                {usageQuotaPolicyCopy(snap?.quotaMode)}
              </p>
              {snap?.quotaMode === 'unmetered_test' ? (
                <div className="flex items-center gap-3 rounded-[8px] border border-[#42C0EF]/25 bg-[#42C0EF]/[0.06] px-4 py-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#42C0EF]" aria-hidden />
                  <span className="text-xs font-medium text-[#595757]">
                    执行记录正常统计 · 套餐额度保持不变
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#EFEFEF]">
                    <div
                      className={cn(
                        'h-full transition-all',
                        pct >= 90 ? 'bg-[#EA1F59]' : pct >= 75 ? 'bg-[#FFC910]' : 'bg-[#EA1F59]',
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {snap?.quotaUsed ?? 0} / {totalQuota ?? '—'}
                  </span>
                </div>
              )}
              {snap?.quotaMode !== 'unmetered_test' && pct >= 75 && (
                <div className="mt-3 flex items-center justify-between rounded-[8px] border border-[#DCDDDD] border-l-[#FFC910] bg-white p-3 [border-left-width:3px]">
                  <div>
                    <div className="text-xs font-medium">额度即将用完</div>
                    <div className="text-[11px] text-muted-foreground">
                      升级套餐后立即获得更多任务额度
                    </div>
                  </div>
                  <Link to="/plan">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                    >
                      查看套餐
                    </Button>
                  </Link>
                </div>
              )}
            </Section>

            <Section
              title="最近 7 天"
              className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
            >
              {hasRecentUsage(bars) ? (
                <div className="flex items-end justify-between gap-2 px-1 pb-4 pt-2">
                  {bars.map((b) => {
                    const h = b.count === 0 ? 4 : Math.max(6, Math.round((b.count / maxBar) * 120));
                    return (
                      <div
                        key={b.date}
                        className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
                      >
                        <div className="text-[10px] tabular-nums text-muted-foreground">
                          {b.count || ''}
                        </div>
                        <div
                          className={cn(
                            'w-full rounded-t-md transition-all',
                            b.count > 0 ? 'bg-[#EA1F59]/80' : 'bg-[#EFEFEF]',
                          )}
                          style={{ height: h }}
                        />
                        <div className="text-[10px] text-muted-foreground">{b.label}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[8px] border border-dashed border-[#DCDDDD] bg-white px-6 py-10 text-center">
                  <div className="text-sm font-medium text-foreground/80">
                    最近 7 天暂无执行记录
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    创建任务后，这里会显示每天的执行次数。
                  </div>
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </PageContainer>
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
    <div className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[#595757]">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-[#595757]">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
