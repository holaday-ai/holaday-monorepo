/**
 * Phase 27 — admin dashboard.
 *
 * Three regions stacked vertically:
 *   1. 4 metric cards (today vs yesterday compare)
 *   2. 7-day trend ComposedChart (bar=total / line=success rate)
 *   3. Recent 20 tasks table
 *
 * Single trpc.admin.dashboard query backs everything — the SQL on
 * the server is already shaped to return the three regions together
 * so there's no round-trip per region.
 */

import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { pageErrorMessage } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  ADMIN_MAGENTA,
  ADMIN_MAGENTA_SOFT,
  ADMIN_BORDER,
  asRecord,
  clampNumber,
  dayDelta,
  finiteNumber,
  formatDateTime,
  formatDurationMs,
  formatInteger,
  indexedFallback,
  nullableFiniteNumber,
  optionalText,
  safeArray,
  safeText,
  statusToken,
  truncate,
  useMountedRef,
} from './admin-shared';

type DashboardData = Awaited<ReturnType<typeof trpc.admin.dashboard.query>>;

export function AdminDashboardPage(): JSX.Element {
  const mountedRef = useMountedRef();
  const requestIdRef = React.useRef(0);
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const chartFrameRef = React.useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    trpc.admin.dashboard
      .query()
      .then((res) => {
        if (mountedRef.current && requestIdRef.current === requestId) setData(res);
      })
      .catch((err) => {
        if (mountedRef.current && requestIdRef.current === requestId) {
          setError(pageErrorMessage(err));
        }
      });
    return () => {
      requestIdRef.current += 1;
    };
  }, [mountedRef]);

  React.useEffect(() => {
    const element = chartFrameRef.current;
    if (!element) return undefined;

    const updateSize = () => {
      if (!mountedRef.current) return;
      const rect = element.getBoundingClientRect();
      setChartSize({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [data, mountedRef]);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-xl font-semibold">仪表盘</h1>
        <div className="mt-4 rounded-[8px] border border-[#EA1F59]/25 border-l-[#EA1F59] bg-white px-4 py-3 text-sm text-[#EA1F59] shadow-[0_1px_2px_rgba(15,23,42,0.03)] [border-left-width:3px]">
          加载失败：{error}
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中…
      </div>
    );
  }

  const metricsRecord = asRecord(data.metrics);
  const metrics = {
    todayTasks: normalizeMetric(metricsRecord.todayTasks),
    successRate: normalizeMetric(metricsRecord.successRate, { percentage: true }),
    activeUsers: normalizeMetric(metricsRecord.activeUsers),
    totalUsers: normalizeMetric(metricsRecord.totalUsers),
  };
  const trend = safeArray(data.trend).map((item) => {
    const row = asRecord(item);
    return {
      date: safeText(row.date, ''),
      total: finiteNumber(row.total, 0),
      successRate: clampNumber(row.successRate, 0, 100),
    };
  });
  const recent = safeArray(data.recent).map(normalizeRecentTask);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">仪表盘</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          今日运行情况一览 · 按北京时间统计
        </p>
      </header>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="今日任务"
          value={formatInteger(metrics.todayTasks.value)}
          prev={metrics.todayTasks.prev}
          current={metrics.todayTasks.value}
          unit=""
        />
        <MetricCard
          label="执行成功率"
          value={`${metrics.successRate.value.toFixed(1)}%`}
          prev={metrics.successRate.prev}
          current={metrics.successRate.value}
          unit="pp"
          isPercentage
        />
        <MetricCard
          label="今日活跃用户"
          value={formatInteger(metrics.activeUsers.value)}
          prev={metrics.activeUsers.prev}
          current={metrics.activeUsers.value}
          unit=""
        />
        <MetricCard
          label="总注册用户"
          value={formatInteger(metrics.totalUsers.value)}
          prev={null}
          current={metrics.totalUsers.value}
          unit=""
        />
      </div>

      {/* Trend */}
      <section className="mt-8 rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">过去 7 天趋势</h2>
          <span className="text-[11px] uppercase text-muted-foreground">
            任务量 · 成功率
          </span>
        </header>
        <div ref={chartFrameRef} className="h-72 w-full min-w-0">
          {chartSize.width > 0 && chartSize.height > 0 ? (
            <ComposedChart
              data={trend}
              width={chartSize.width}
              height={chartSize.height}
              margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(s: string) => s.slice(5)}
                stroke="#999"
                fontSize={12}
              />
              <YAxis
                yAxisId="left"
                stroke="#999"
                fontSize={12}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 100]}
                stroke="#999"
                fontSize={12}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: `1px solid ${ADMIN_BORDER}`,
                  fontSize: 12,
                }}
                formatter={(value, name) => {
                  const n = typeof value === 'number' ? value : Number(value ?? 0);
                  const label = String(name ?? '');
                  if (label === '成功率') return [`${n.toFixed(1)}%`, label];
                  return [n, label];
                }}
              />
              <Bar
                yAxisId="left"
                dataKey="total"
                name="任务量"
                fill={ADMIN_MAGENTA}
                radius={[4, 4, 0, 0]}
                barSize={28}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="successRate"
                name="成功率"
                stroke="#444"
                strokeWidth={2}
                dot={{ r: 3, stroke: '#444', strokeWidth: 1, fill: '#fff' }}
              />
            </ComposedChart>
          ) : (
            <div className="h-full rounded-[8px] bg-[#EFEFEF]/45" />
          )}
        </div>
      </section>

      {/* Recent tasks */}
      <section className="mt-8 rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">最近任务</h2>
          <span className="text-[11px] uppercase text-muted-foreground">
            最新 20 条
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#EFEFEF] text-left text-[11px] uppercase text-muted-foreground">
                <th className="py-2 pr-3 font-medium">时间</th>
                <th className="py-2 pr-3 font-medium">用户</th>
                <th className="py-2 pr-3 font-medium">任务</th>
                <th className="py-2 pr-3 font-medium">状态</th>
                <th className="py-2 pr-3 font-medium">耗时</th>
                <th className="py-2 pr-3 font-medium">模型</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    暂无任务
                  </td>
                </tr>
              ) : (
                recent.map((row) => {
                  const tk = statusToken(row.status);
                  const userLabel =
                    row.user.displayName ??
                    (row.user.email ?? row.user.userId ?? '—');
                  return (
                    <tr
                      key={row.taskId}
                      className="border-b border-[#EFEFEF] last:border-b-0 hover:bg-[#EFEFEF]/35"
                    >
                      <td className="py-2 pr-3 text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="py-2 pr-3">
                        {row.user.userId ? (
                          <Link
                            to={`/admin/users/${row.user.userId}`}
                            className="text-foreground hover:text-[#EA1F59] hover:underline"
                          >
                            {truncate(userLabel, 20)}
                          </Link>
                        ) : (
                          <span className="text-foreground">
                            {truncate(userLabel, 20)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-foreground">
                        {truncate(row.title ?? row.intent, 50)}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                            tk.textClass,
                            tk.bgClass,
                          )}
                        >
                          {tk.label}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {formatDurationMs(row.durationMs)}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {row.model ?? '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

interface AdminMetricValue {
  value: number;
  prev: number | null;
}

function normalizeMetric(
  metric: unknown,
  options?: { percentage?: boolean },
): AdminMetricValue {
  const row = asRecord(metric);
  const value = options?.percentage
    ? clampNumber(row.value, 0, 100)
    : finiteNumber(row.value, 0);
  return {
    value,
    prev: nullableFiniteNumber(row.prev),
  };
}

function normalizeRecentTask(value: unknown, index: number) {
  const row = asRecord(value);
  const user = asRecord(row.user);
  return {
    taskId: safeText(row.taskId, indexedFallback('未知任务', index)),
    createdAt: optionalText(row.createdAt),
    title: optionalText(row.title),
    intent: optionalText(row.intent),
    status: safeText(row.status, ''),
    durationMs: nullableFiniteNumber(row.durationMs),
    model: optionalText(row.model),
    user: {
      userId: optionalText(user.userId),
      displayName: optionalText(user.displayName),
      email: optionalText(user.email),
    },
  };
}

function MetricCard({
  label,
  value,
  prev,
  current,
  unit,
  isPercentage,
}: {
  label: string;
  value: string;
  prev: number | null;
  current: number;
  unit: string;
  isPercentage?: boolean;
}): JSX.Element {
  // Percentage points (pp) for success-rate compares; relative %
  // for raw counts. Direction (positive vs negative) drives color
  // regardless of which mode is in play.
  let deltaLabel: string | null = null;
  let positive = true;
  if (prev != null) {
    if (isPercentage) {
      const diff = current - prev;
      positive = diff >= 0;
      deltaLabel = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} ${unit}`;
    } else {
      const pct = dayDelta(current, prev);
      if (pct != null) {
        positive = pct >= 0;
        deltaLabel = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
      } else if (current > 0) {
        deltaLabel = '新增';
        positive = true;
      }
    }
  }
  return (
    <div
      className="rounded-[8px] border border-[#DCDDDD] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      style={{ backgroundImage: `linear-gradient(135deg, ${ADMIN_MAGENTA_SOFT} 0%, transparent 60%)` }}
    >
      <div className="text-[11px] uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">
        {value}
      </div>
      {deltaLabel ? (
        <div
          className={cn(
            'mt-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
            positive
              ? 'bg-[#42C0EF]/10 text-[#1688AA]'
              : 'bg-[#EA1F59]/10 text-[#EA1F59]',
          )}
        >
          {positive ? (
            <ArrowUp className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden />
          )}
          {deltaLabel}
        </div>
      ) : (
        <div className="mt-1 text-[11px] text-muted-foreground">—</div>
      )}
    </div>
  );
}
