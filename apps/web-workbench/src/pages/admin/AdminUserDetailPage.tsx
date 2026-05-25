/**
 * Phase 27 — admin user detail.
 *
 * Three regions:
 *   1. User identity card (avatar, displayName, email, plan, role,
 *      member since, status).
 *   2. Usage card — month task count + model distribution PieChart
 *      from llm_calls.
 *   3. Recent task history table (last 50 rows for this user).
 *
 * Single `admin.userDetail` query backs everything.
 */

import { ArrowLeft, Loader2 } from 'lucide-react';
import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  asRecord,
  formatInteger,
  formatDate,
  formatDateTime,
  formatDurationMs,
  nullableFiniteNumber,
  nonNegativeNumber,
  optionalText,
  safeArray,
  safeText,
  statusToken,
  truncate,
} from './admin-shared';

type DetailData = Awaited<ReturnType<typeof trpc.admin.userDetail.query>>;

const PIE_COLORS = [
  '#EA1F59',
  '#FFC910',
  '#42C0EF',
  '#57479C',
  '#EF4444',
  '#ADADAD',
  '#575757',
];

export function AdminUserDetailPage(): JSX.Element {
  const { userId } = useParams<{ userId: string }>();
  const [data, setData] = React.useState<DetailData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setData(null);
    setError(null);
    trpc.admin.userDetail
      .query({ userId })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId) {
    return <div className="px-6 py-8 text-muted-foreground">缺少 userId 参数</div>;
  }
  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link
          to="/admin/users"
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          返回用户列表
        </Link>
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
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

  const { user, usage, recentTasks } = normalizeUserDetail(data);
  const totalCalls = usage.modelDistribution.reduce((sum, m) => sum + m.calls, 0);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link
        to="/admin/users"
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        返回用户列表
      </Link>

      <header className="mt-4 flex items-start gap-4">
        <Avatar url={user.avatarUrl} fallback={user.displayName ?? user.email ?? '?'} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {user.displayName ?? '—'}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {user.email ?? '无邮箱'} {user.phone ? `· ${user.phone}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
            <Badge>套餐 · {user.plan}</Badge>
            <Badge>状态 · {user.status}</Badge>
            {user.role === 'admin' && (
              <Badge highlight>管理员</Badge>
            )}
            <Badge>注册 · {formatDate(user.createdAt)}</Badge>
            {user.planExpiresAt && (
              <Badge>套餐到期 · {formatDate(user.planExpiresAt)}</Badge>
            )}
          </div>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            本月任务数
          </h2>
          <div className="mt-2 text-3xl font-semibold text-foreground">
            {formatInteger(usage.monthTasks)}
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            自然月窗口 · UTC
          </div>
        </section>
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            本月模型分布
          </h2>
          {totalCalls === 0 ? (
            <div className="flex h-40 items-center justify-center text-[12px] text-muted-foreground">
              本月暂无 LLM 调用记录
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="h-44 w-44 shrink-0">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={usage.modelDistribution}
                      dataKey="calls"
                      nameKey="model"
                      cx="50%"
                      cy="50%"
                      innerRadius={36}
                      outerRadius={68}
                      paddingAngle={2}
                    >
                      {usage.modelDistribution.map((_m, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: '1px solid rgba(0,0,0,0.08)',
                        fontSize: 12,
                      }}
                      formatter={(value, _name, ctx) => {
                        const v = typeof value === 'number' ? value : Number(value ?? 0);
                        const payload = (ctx as { payload?: { model?: string } } | undefined)
                          ?.payload;
                        const pct = totalCalls
                          ? ((v / totalCalls) * 100).toFixed(1)
                          : '0';
                        return [`${v} (${pct}%)`, payload?.model ?? '模型'];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {usage.modelDistribution.slice(0, 8).map((m, i) => {
                  const pct = totalCalls ? (m.calls / totalCalls) * 100 : 0;
                  return (
                    <div key={m.model} className="flex items-center gap-2 text-[12px]">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {m.model}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatInteger(m.calls)} · {pct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-sm">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="text-base font-semibold tracking-tight">任务历史</h2>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            最近 {recentTasks.length} 条
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">时间</th>
                <th className="py-2 pr-3 font-medium">任务</th>
                <th className="py-2 pr-3 font-medium">状态</th>
                <th className="py-2 pr-3 font-medium">耗时</th>
              </tr>
            </thead>
            <tbody>
              {recentTasks.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    此用户暂无任务
                  </td>
                </tr>
              ) : (
                recentTasks.map((row) => {
                  const tk = statusToken(row.status);
                  return (
                    <tr
                      key={row.taskId}
                      className="border-b border-border/60 last:border-b-0 hover:bg-foreground/[0.02]"
                    >
                      <td className="py-2 pr-3 text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="py-2 pr-3 text-foreground">
                        {truncate(row.title ?? row.intent, 70)}
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

function normalizeUserDetail(value: DetailData) {
  const root = asRecord(value);
  const user = asRecord(root.user);
  const usage = asRecord(root.usage);
  return {
    user: {
      userId: safeText(user.userId, ''),
      avatarUrl: optionalText(user.avatarUrl),
      displayName: optionalText(user.displayName),
      email: optionalText(user.email),
      phone: optionalText(user.phone),
      plan: safeText(user.plan),
      status: safeText(user.status, 'unknown'),
      role: safeText(user.role, 'user'),
      createdAt: optionalText(user.createdAt),
      planExpiresAt: optionalText(user.planExpiresAt),
    },
    usage: {
      monthTasks: nonNegativeNumber(usage.monthTasks),
      modelDistribution: safeArray(usage.modelDistribution)
        .map((item) => {
          const row = asRecord(item);
          return {
            model: safeText(row.model, 'unknown'),
            calls: nonNegativeNumber(row.calls),
          };
        })
        .filter((row) => row.calls > 0),
    },
    recentTasks: safeArray(root.recentTasks).map((item, index) => {
      const row = asRecord(item);
      return {
        taskId: safeText(row.taskId, `unknown-${index}`),
        createdAt: optionalText(row.createdAt),
        title: optionalText(row.title),
        intent: optionalText(row.intent),
        status: safeText(row.status, ''),
        durationMs: nullableFiniteNumber(row.durationMs),
      };
    }),
  };
}

function Badge({
  children,
  highlight,
}: {
  children: React.ReactNode;
  highlight?: boolean;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        highlight
          ? 'bg-[rgba(234,31,89,0.12)] text-[#EA1F59]'
          : 'border border-border bg-background text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function Avatar({
  url,
  fallback,
}: {
  url: string | null;
  fallback: string;
}): JSX.Element {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-14 w-14 shrink-0 rounded-full object-cover"
        loading="lazy"
      />
    );
  }
  const letter = (fallback || '?').charAt(0).toUpperCase();
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[rgba(234,31,89,0.12)] text-xl font-semibold text-[#EA1F59]">
      {letter}
    </div>
  );
}
