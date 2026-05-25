/**
 * Phase 27B — admin finance page.
 *
 * Structure:
 *   1. ProfitBar — three top cards (revenue / cost / profit). All
 *      cents-in-CNY (server already converted USD-denominated rows
 *      at the configured rate).
 *   2. Tab switcher — 营收 / 成本.
 *      Revenue tab:  plan PieChart + monthly BarChart + funnel +
 *                    LTV card.
 *      Cost tab:     summary chips + model PieChart + 30-day
 *                    LineChart + top-10 task table.
 *
 * All charts use recharts. Official HOLA DAY palette only:
 * magenta, yellow, cyan, purple, red, and neutrals.
 * accents matching the calendar palette.
 */

import { Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  asRecord,
  finiteNumber,
  formatDateTime,
  formatInteger,
  nonNegativeNumber,
  optionalText,
  safeArray,
  safeText,
  truncate,
} from './admin-shared';

type SummaryData = Awaited<ReturnType<typeof trpc.admin.finance.summary.query>>;
type PlanData = Awaited<ReturnType<typeof trpc.admin.finance.revenueByPlan.query>>;
type MonthData = Awaited<ReturnType<typeof trpc.admin.finance.revenueByMonth.query>>;
type FunnelData = Awaited<ReturnType<typeof trpc.admin.finance.conversionFunnel.query>>;
type CostBreakdownData = Awaited<ReturnType<typeof trpc.admin.finance.costBreakdown.query>>;
type CostByDayData = Awaited<ReturnType<typeof trpc.admin.finance.costByDay.query>>;
type TopCostlyData = Awaited<ReturnType<typeof trpc.admin.finance.topCostlyTasks.query>>;

const MAGENTA = '#EA1F59';
const PALETTE = ['#EA1F59', '#FFC910', '#42C0EF', '#57479C', '#EF4444', '#ADADAD', '#575757'];

/** Format CNY cents → ¥123.45 with thousands separator. */
function formatYuan(cents: unknown): string {
  const yuan = finiteNumber(cents, 0) / 100;
  return `¥${yuan.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatYuanCompact(cents: unknown): string {
  const yuan = finiteNumber(cents, 0) / 100;
  return `¥${yuan.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

function formatTokens(tokens: unknown): string {
  const value = nonNegativeNumber(tokens);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return formatInteger(value);
}

type Tab = 'revenue' | 'cost';

export function AdminFinancePage(): JSX.Element {
  const [tab, setTab] = React.useState<Tab>('revenue');
  const [summary, setSummary] = React.useState<SummaryData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    trpc.admin.finance.summary
      .query()
      .then((r) => !cancelled && setSummary(r))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-xl font-semibold">营收与成本</h1>
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          加载失败：{error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">营收与成本</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          经营驾驶舱 · 本月数据 · USD→CNY 按 7.2 折算
        </p>
      </header>

      <ProfitBar summary={summary} />

      {/* Tab switcher */}
      <div className="mt-8 border-b border-border">
        <div className="flex gap-6">
          <TabButton active={tab === 'revenue'} onClick={() => setTab('revenue')}>
            营收明细
          </TabButton>
          <TabButton active={tab === 'cost'} onClick={() => setTab('cost')}>
            成本明细
          </TabButton>
        </div>
      </div>

      <div className="mt-6">
        {tab === 'revenue' ? <RevenueTab /> : <CostTab />}
      </div>
    </div>
  );
}

function ProfitBar({ summary }: { summary: SummaryData | null }): JSX.Element {
  if (!summary) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-card" />
        ))}
      </div>
    );
  }
  const profit = finiteNumber(summary.monthProfitCnyCents, 0);
  const profitPositive = profit >= 0;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <SummaryCard
        label="本月营收"
        value={formatYuan(summary.monthRevenueCnyCents)}
        tint="rgba(234,31,89,0.10)"
      />
      <SummaryCard
        label="本月成本"
        value={formatYuan(summary.monthCostCnyCents)}
        tint="rgba(245,158,11,0.10)"
        sub={`LLM ${formatYuanCompact(summary.monthLlmCostCnyCents)} · 服务器 ${formatYuanCompact(summary.monthServerCostCnyCents)}`}
      />
      <SummaryCard
        label={profitPositive ? '本月利润' : '本月亏损'}
        value={formatYuan(Math.abs(profit))}
        tint={profitPositive ? 'rgba(66,192,239,0.10)' : 'rgba(239,68,68,0.10)'}
        valueClass={profitPositive ? 'text-cyan-600 dark:text-cyan-300' : 'text-red-600 dark:text-red-400'}
        trend={profitPositive ? 'up' : 'down'}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tint,
  sub,
  valueClass,
  trend,
}: {
  label: string;
  value: string;
  tint: string;
  sub?: string;
  valueClass?: string;
  trend?: 'up' | 'down';
}): JSX.Element {
  return (
    <div
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      style={{ backgroundImage: `linear-gradient(135deg, ${tint} 0%, transparent 60%)` }}
    >
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-2 flex items-baseline gap-2', valueClass)}>
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        {trend === 'up' && <TrendingUp className="h-4 w-4 text-cyan-600" aria-hidden />}
        {trend === 'down' && <TrendingDown className="h-4 w-4 text-red-600" aria-hidden />}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 px-1 pb-3 text-[14px] font-medium transition-colors',
        active
          ? 'border-[#EA1F59] text-[#EA1F59]'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function RevenueTab(): JSX.Element {
  const [plan, setPlan] = React.useState<PlanData | null>(null);
  const [month, setMonth] = React.useState<MonthData | null>(null);
  const [funnel, setFunnel] = React.useState<FunnelData | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      trpc.admin.finance.revenueByPlan.query(),
      trpc.admin.finance.revenueByMonth.query(),
      trpc.admin.finance.conversionFunnel.query(),
    ])
      .then(([p, m, f]) => {
        if (cancelled) return;
        setPlan(p);
        setMonth(m);
        setFunnel(f);
      })
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return <ErrorPane msg={err} />;
  }
  if (!plan || !month || !funnel) return <LoadingPane />;

  const planRows = safeArray(plan.plans).map((item) => {
    const row = asRecord(item);
    return {
      plan: safeText(row.plan, 'unknown'),
      userCount: nonNegativeNumber(row.userCount),
      monthRevenueCnyCents: nonNegativeNumber(row.monthRevenueCnyCents),
    };
  });
  const monthSeries = safeArray(month.series).map((item) => {
    const row = asRecord(item);
    return {
      month: safeText(row.month, ''),
      revenueCnyCents: nonNegativeNumber(row.revenueCnyCents),
    };
  });
  const funnelStages = safeArray(funnel.stages).map((item) => {
    const row = asRecord(item);
    return {
      label: safeText(row.label, '—'),
      count: nonNegativeNumber(row.count),
    };
  });
  const ltvCnyCents = nonNegativeNumber(funnel.ltvCnyCents);
  const totalCnyPlan = planRows.reduce((sum, p) => sum + p.monthRevenueCnyCents, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Plan distribution */}
        <Section title="按套餐分布" hint="本月营收 + 当前用户数">
          {totalCnyPlan === 0 ? (
            <div className="flex h-44 items-center justify-center text-[12px] text-muted-foreground">
              本月暂无完成的订单
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="h-44 w-44 shrink-0">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={planRows.filter((p) => p.monthRevenueCnyCents > 0)}
                      dataKey="monthRevenueCnyCents"
                      nameKey="plan"
                      cx="50%"
                      cy="50%"
                      innerRadius={36}
                      outerRadius={68}
                      paddingAngle={2}
                    >
                      {planRows
                        .filter((p) => p.monthRevenueCnyCents > 0)
                        .map((_p, i) => (
                          <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                        ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12 }}
                      formatter={(value, _name, ctx) => {
                        const v = typeof value === 'number' ? value : Number(value ?? 0);
                        const p = (ctx as { payload?: { plan?: string } } | undefined)?.payload;
                        return [formatYuan(v), p?.plan ?? '套餐'];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 text-[12px]">
                {planRows.map((p, i) => (
                  <div key={p.plan} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                    />
                    <span className="min-w-0 flex-1 capitalize text-foreground">{p.plan}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatInteger(p.userCount)} 人 · {formatYuanCompact(p.monthRevenueCnyCents)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* Monthly revenue trend */}
        <Section title="月度营收（近 6 个月）">
          <div className="h-56 w-full">
            <ResponsiveContainer>
              <BarChart
                data={monthSeries}
                margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis
                  dataKey="month"
                  tickFormatter={(s: string) => s.slice(5)}
                  stroke="#999"
                  fontSize={12}
                />
                <YAxis
                  stroke="#999"
                  fontSize={12}
                  tickFormatter={(v: number) => formatYuanCompact(v)}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12 }}
                  formatter={(value) => {
                    const v = typeof value === 'number' ? value : Number(value ?? 0);
                    return [formatYuan(v), '营收'];
                  }}
                />
                <Bar dataKey="revenueCnyCents" fill={MAGENTA} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      {/* Funnel + LTV */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Section title="转化漏斗" hint="累计" className="lg:col-span-2">
          <div className="space-y-2.5">
            {funnelStages.map((stage, i) => {
              const top = funnelStages[0]?.count ?? 1;
              const widthPct = top > 0 ? (stage.count / top) * 100 : 0;
              const prevCount = i > 0 ? funnelStages[i - 1]?.count ?? 0 : null;
              const conv = prevCount && prevCount > 0 ? (stage.count / prevCount) * 100 : null;
              return (
                <div key={stage.label} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-[12px] text-muted-foreground">
                    {stage.label}
                  </div>
                  <div className="relative h-7 flex-1 rounded-md bg-foreground/[0.04]">
                    <div
                      className="h-full rounded-md transition-all"
                      style={{
                        width: `${Math.max(widthPct, 3)}%`,
                        backgroundColor: MAGENTA,
                        opacity: 0.85 - i * 0.15,
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-end px-2">
                      <span className="text-[12px] font-medium tabular-nums text-foreground">
                        {formatInteger(stage.count)}
                      </span>
                    </div>
                  </div>
                  <div className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
                    {conv == null ? '—' : `${conv.toFixed(1)}%`}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
        <Section title="付费用户 LTV" hint="累计订阅收入 / 付费人数">
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            {formatYuan(ltvCnyCents)}
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            含全部 subscription 类型订单（USD 已折算为 CNY）
          </div>
        </Section>
      </div>
    </div>
  );
}

function CostTab(): JSX.Element {
  const [breakdown, setBreakdown] = React.useState<CostBreakdownData | null>(null);
  const [byDay, setByDay] = React.useState<CostByDayData | null>(null);
  const [topCostly, setTopCostly] = React.useState<TopCostlyData | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      trpc.admin.finance.costBreakdown.query(),
      trpc.admin.finance.costByDay.query(),
      trpc.admin.finance.topCostlyTasks.query(),
    ])
      .then(([b, d, t]) => {
        if (cancelled) return;
        setBreakdown(b);
        setByDay(d);
        setTopCostly(t);
      })
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) return <ErrorPane msg={err} />;
  if (!breakdown || !byDay || !topCostly) return <LoadingPane />;

  const models = safeArray(breakdown.models).map((item) => {
    const row = asRecord(item);
    return {
      model: safeText(row.model, 'unknown'),
      costCnyCents: nonNegativeNumber(row.costCnyCents),
      callCount: nonNegativeNumber(row.callCount),
      totalTokens: nonNegativeNumber(row.totalTokens),
    };
  });
  const daySeries = safeArray(byDay.series).map((item) => {
    const row = asRecord(item);
    return {
      date: safeText(row.date, ''),
      costCnyCents: nonNegativeNumber(row.costCnyCents),
    };
  });
  const topCostlyTasks = safeArray(topCostly.tasks).map((item, index) => {
    const row = asRecord(item);
    const user = asRecord(row.user);
    return {
      taskId: optionalText(row.taskId) ?? `unknown-${index}`,
      title: optionalText(row.title),
      intent: optionalText(row.intent),
      model: optionalText(row.model),
      callCount: nonNegativeNumber(row.callCount),
      totalTokens: nonNegativeNumber(row.totalTokens),
      costCnyCents: nonNegativeNumber(row.costCnyCents),
      user: {
        displayName: optionalText(user.displayName),
        email: optionalText(user.email),
        userId: optionalText(user.userId),
      },
    };
  });
  const totalLlmCost = models.reduce((s, m) => s + m.costCnyCents, 0);
  const totalCalls = models.reduce((s, m) => s + m.callCount, 0);
  const totalTokens = models.reduce((s, m) => s + m.totalTokens, 0);

  return (
    <div className="space-y-6">
      {/* Cost summary chips */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ChipCard label="本月 LLM 成本" value={formatYuan(totalLlmCost)} />
        <ChipCard label="本月 LLM 调用" value={`${formatInteger(totalCalls)} 次`} />
        <ChipCard label="本月 Token 用量" value={formatTokens(totalTokens)} />
        <ChipCard
          label="单次调用均价"
          value={
            totalCalls > 0 ? formatYuan(Math.round(totalLlmCost / totalCalls)) : '—'
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Model breakdown */}
        <Section title="按模型成本分布">
          {models.length === 0 ? (
            <div className="flex h-44 items-center justify-center text-[12px] text-muted-foreground">
              本月暂无 LLM 调用
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="h-44 w-44 shrink-0">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={models}
                      dataKey="costCnyCents"
                      nameKey="model"
                      cx="50%"
                      cy="50%"
                      innerRadius={36}
                      outerRadius={68}
                      paddingAngle={2}
                    >
                      {models.map((_m, i) => (
                        <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12 }}
                      formatter={(value, _name, ctx) => {
                        const v = typeof value === 'number' ? value : Number(value ?? 0);
                        const p = (ctx as { payload?: { model?: string } } | undefined)?.payload;
                        return [formatYuan(v), p?.model ?? '模型'];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 text-[12px]">
                {models.slice(0, 8).map((m, i) => {
                  const pct = totalLlmCost > 0 ? (m.costCnyCents / totalLlmCost) * 100 : 0;
                  return (
                    <div key={m.model} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground">{m.model}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatYuanCompact(m.costCnyCents)} · {pct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Section>

        {/* Cost by day (30 days) */}
        <Section title="按日成本趋势（近 30 天）">
          <div className="h-56 w-full">
            <ResponsiveContainer>
              <LineChart
                data={daySeries}
                margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(s: string) => s.slice(5)}
                  stroke="#999"
                  fontSize={12}
                  interval="preserveStartEnd"
                />
                <YAxis
                  stroke="#999"
                  fontSize={12}
                  tickFormatter={(v: number) => formatYuanCompact(v)}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12 }}
                  formatter={(value) => {
                    const v = typeof value === 'number' ? value : Number(value ?? 0);
                    return [formatYuan(v), '成本'];
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="costCnyCents"
                  stroke={MAGENTA}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      {/* Top costly tasks */}
      <Section title="高成本任务 TOP 10" hint="本月">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">任务</th>
                <th className="py-2 pr-3 font-medium">用户</th>
                <th className="py-2 pr-3 font-medium">模型</th>
                <th className="py-2 pr-3 font-medium text-right">调用</th>
                <th className="py-2 pr-3 font-medium text-right">Tokens</th>
                <th className="py-2 pr-3 font-medium text-right">成本</th>
              </tr>
            </thead>
            <tbody>
              {topCostlyTasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    本月暂无任务
                  </td>
                </tr>
              ) : (
                topCostlyTasks.map((t) => (
                  <tr
                    key={t.taskId}
                    className="border-b border-border/60 last:border-b-0 hover:bg-foreground/[0.02]"
                  >
                    <td className="py-2 pr-3 text-foreground">
                      {truncate(t.title ?? t.intent ?? '—', 60)}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {truncate(
                        t.user?.displayName ?? t.user?.email ?? t.user?.userId ?? '—',
                        20,
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{t.model ?? '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {formatInteger(t.callCount)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {formatTokens(t.totalTokens)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                      {formatYuan(t.costCnyCents)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <p className="text-[11px] text-muted-foreground">
        最后更新：{formatDateTime(new Date())}
      </p>
    </div>
  );
}

function ChipCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-foreground">{value}</div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={cn('rounded-xl border border-border bg-card p-5 shadow-sm', className)}>
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {hint ? (
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function LoadingPane(): JSX.Element {
  return (
    <div className="flex h-40 items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      加载中…
    </div>
  );
}

function ErrorPane({ msg }: { msg: string }): JSX.Element {
  return (
    <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
      加载失败：{msg}
    </div>
  );
}
