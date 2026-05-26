/**
 * Phase 27C — admin learning engine: per-domain detail page.
 *
 * Four regions:
 *   1. Identity card (domain + favicon + total / success rate +
 *      first / last task).
 *   2. Failure breakdown — horizontal bar chart of error category
 *      shares, with count + last-seen per category.
 *   3. Recent 20 tasks table (expandable error message).
 *   4. AI memories — execution_memory.site_state rows whose key or
 *      value mentions the domain. Empty state when none.
 *
 * The page accepts the domain via URL param. We use encoded
 * routes so dots in subdomains survive React Router.
 */

import { ArrowLeft, Brain, ChevronDown, ChevronRight, Globe, Loader2 } from 'lucide-react';
import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  ADMIN_DIVIDER,
  ADMIN_MAGENTA,
  asRecord,
  clampNumber,
  formatDate,
  formatDateTime,
  formatDurationMs,
  formatInteger,
  nullableFiniteNumber,
  nonNegativeNumber,
  optionalText,
  safeArray,
  safeText,
  statusToken,
  truncate,
} from './admin-shared';

type DomainDetail = Awaited<ReturnType<typeof trpc.admin.learning.domainDetail.query>>;

const CAT_COLORS: Record<string, string> = {
  dns_error: '#EA1F59',
  timeout: '#FFC910',
  auth_required: '#42C0EF',
  captcha: '#57479C',
  not_found: '#595757',
  page_structure: '#EA1F59',
  quality: '#8A6A00',
  unknown: '#ADADAD',
};

export function AdminLearningDomainPage(): JSX.Element {
  const { domain: rawDomain } = useParams<{ domain: string }>();
  const domain = rawDomain ? decodeURIComponent(rawDomain) : '';

  const [data, setData] = React.useState<DomainDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!domain) return;
    let cancelled = false;
    setData(null);
    setError(null);
    trpc.admin.learning.domainDetail
      .query({ domain })
      .then((r) => !cancelled && setData(r))
      .catch((err) =>
        !cancelled && setError(err instanceof Error ? err.message : String(err)),
      );
    return () => {
      cancelled = true;
    };
  }, [domain]);

  if (!domain) {
    return (
      <div className="px-6 py-8 text-muted-foreground">缺少 domain 参数</div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <BackLink />
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

  const view = normalizeDomainDetail(data, domain);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <BackLink />

      {/* Identity */}
      <header className="mt-4 flex items-start gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[8px] text-[#EA1F59]"
          style={{
            backgroundImage: `linear-gradient(135deg, ${ADMIN_MAGENTA}18 0%, ${ADMIN_DIVIDER} 100%)`,
          }}
        >
          {/* Try the favicon service; fall back to a globe icon. */}
          <FaviconOrIcon domain={view.domain} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">
            {view.domain}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
            <span>
              总任务{' '}
              <span className="tabular-nums text-foreground">
                {formatInteger(view.stats.total)}
              </span>
            </span>
            <span>
              成功率{' '}
              <span className="tabular-nums text-foreground">
                {view.stats.successRate.toFixed(1)}%
              </span>
            </span>
            <span>
              已取消{' '}
              <span className="tabular-nums text-foreground">
                {formatInteger(view.stats.cancelled)}
              </span>
            </span>
            <span>
              首次{' '}
              <span className="text-foreground">{formatDate(view.stats.firstTaskAt)}</span>
            </span>
            <span>
              最近{' '}
              <span className="text-foreground">{formatDate(view.stats.lastTaskAt)}</span>
            </span>
          </div>
        </div>
      </header>

      {/* Failure breakdown */}
      <Section
        title="失败模式分析"
        hint={
          view.stats.failed === 0
            ? '本期无失败'
            : `${formatInteger(view.stats.failed)} 次失败 · 按类型分组`
        }
        className="mt-6"
      >
        {view.failureBreakdown.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-[12px] text-muted-foreground">
            本期无失败任务
          </div>
        ) : (
          <div className="space-y-2.5">
            {view.failureBreakdown.map((b) => (
              <div key={b.category} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-[12px] text-foreground">
                  {b.label}
                </div>
                <div className="relative h-7 flex-1 rounded-[8px] bg-[#EFEFEF]">
                  <div
                    className="h-full rounded-[8px] transition-all"
                    style={{
                      width: `${Math.max(b.share, 3)}%`,
                      backgroundColor: CAT_COLORS[b.category] ?? '#ADADAD',
                      opacity: 0.85,
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-end px-2">
                    <span className="text-[12px] font-medium tabular-nums text-foreground">
                      {formatInteger(b.count)} ({b.share.toFixed(1)}%)
                    </span>
                  </div>
                </div>
                <div className="w-32 shrink-0 text-right text-[11px] text-muted-foreground">
                  {b.lastAt ? `最近 ${formatDateTime(b.lastAt)}` : '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Recent tasks */}
      <Section
        title="最近任务"
        hint={`显示 ${view.recentTasks.length} 条`}
        className="mt-6"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#EFEFEF] text-left text-[11px] uppercase text-muted-foreground">
                <th className="py-2 pr-3 font-medium">时间</th>
                <th className="py-2 pr-3 font-medium">任务</th>
                <th className="py-2 pr-3 font-medium">状态</th>
                <th className="py-2 pr-3 font-medium text-right">耗时</th>
                <th className="py-2 pr-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {view.recentTasks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    本期无任务
                  </td>
                </tr>
              ) : (
                view.recentTasks.map((t) => {
                  const tk = statusToken(t.status);
                  const isExpanded = expandedTaskId === t.taskId;
                  const failedChecks =
                    Array.isArray(t.failedChecks) ? t.failedChecks : [];
                  const hasDiagnostics =
                    (t.status === 'failed' || t.status === 'partial_success') &&
                    (Boolean(t.errorMessage) || failedChecks.length > 0);
                  return (
                    <React.Fragment key={t.taskId}>
                      <tr className="border-b border-[#EFEFEF] last:border-b-0 hover:bg-[#EFEFEF]/35">
                        <td className="py-2 pr-3 text-muted-foreground">
                          {formatDateTime(t.createdAt)}
                        </td>
                        <td className="py-2 pr-3 text-foreground">
                          {truncate(t.title ?? t.intent, 60)}
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
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {formatDurationMs(t.durationMs)}
                        </td>
                        <td className="py-2 pr-3">
                          {hasDiagnostics && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedTaskId(isExpanded ? null : t.taskId)
                              }
                              className="inline-flex items-center gap-0.5 rounded-[8px] px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-[#EFEFEF] hover:text-[#EA1F59]"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                              )}
                              诊断
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && hasDiagnostics && (
                        <tr className="border-b border-[#EFEFEF] bg-[#EFEFEF]/30">
                          <td colSpan={5} className="px-3 py-2">
                            <div className="space-y-2 text-[11px] text-muted-foreground">
                              {failedChecks.length > 0 && (
                                <ul className="space-y-1">
                                  {failedChecks.map((check, index) => (
                                    <li
                                      key={`${check.type}-${index}`}
                                      className="flex gap-2"
                                    >
                                      <span className="shrink-0 rounded-[6px] bg-[#FFC910]/20 px-1.5 py-0.5 font-medium text-[#8A6A00]">
                                        {check.type}
                                      </span>
                                      <span className="min-w-0 break-words">
                                        {check.detail}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {t.errorMessage && (
                                <pre className="whitespace-pre-wrap break-all rounded-[8px] border border-[#DCDDDD] bg-white p-2">
                                  {t.errorMessage}
                                </pre>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* AI memories */}
      <Section
        title="AI 记忆"
        hint={
          view.memories.length > 0
            ? `${view.memories.length} 条 site_state`
            : '尚未记录'
        }
        className="mt-6"
      >
        {view.memories.length === 0 ? (
          <div className="flex h-24 items-center justify-center gap-2 text-[12px] text-muted-foreground">
            <Brain className="h-4 w-4" aria-hidden />
            暂无该网站的学习记录
          </div>
        ) : (
          <div className="space-y-3">
            {view.memories.map((m) => (
              <div
                key={m.externalId}
                className="rounded-[8px] border border-[#DCDDDD] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.02)]"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] font-medium text-foreground">
                    {m.keyName}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    更新于 {formatDateTime(m.updatedAt)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[12px] text-muted-foreground">
                  {m.value}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function normalizeDomainDetail(value: DomainDetail, fallbackDomain: string) {
  const root = asRecord(value);
  const stats = asRecord(root.stats);
  return {
    domain: safeText(root.domain, fallbackDomain),
    stats: {
      total: nonNegativeNumber(stats.total),
      successRate: clampNumber(stats.successRate, 0, 100),
      cancelled: nonNegativeNumber(stats.cancelled),
      failed: nonNegativeNumber(stats.failed),
      firstTaskAt: optionalText(stats.firstTaskAt),
      lastTaskAt: optionalText(stats.lastTaskAt),
    },
    failureBreakdown: safeArray(root.failureBreakdown).map((item, index) => {
      const row = asRecord(item);
      return {
        category: safeText(row.category, `unknown-${index}`),
        label: safeText(row.label, '未知'),
        count: nonNegativeNumber(row.count),
        share: clampNumber(row.share, 0, 100),
        lastAt: optionalText(row.lastAt),
      };
    }),
    recentTasks: safeArray(root.recentTasks).map((item, index) => {
      const row = asRecord(item);
      return {
        taskId: safeText(row.taskId, `unknown-${index}`),
        createdAt: optionalText(row.createdAt),
        title: optionalText(row.title),
        intent: optionalText(row.intent),
        status: safeText(row.status, ''),
        durationMs: nullableFiniteNumber(row.durationMs),
        errorMessage: optionalText(row.errorMessage),
        failedChecks: safeArray(row.failedChecks).map((checkItem, checkIndex) => {
          const check = asRecord(checkItem);
          return {
            type: safeText(check.type, `check-${checkIndex}`),
            detail: safeText(check.detail),
          };
        }),
      };
    }),
    memories: safeArray(root.memories).map((item, index) => {
      const row = asRecord(item);
      return {
        externalId: safeText(row.externalId, `unknown-${index}`),
        keyName: safeText(row.keyName),
        value: safeText(row.value, ''),
        updatedAt: optionalText(row.updatedAt),
      };
    }),
  };
}

function BackLink(): JSX.Element {
  return (
    <Link
      to="/admin/learning"
      className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-[#EFEFEF] hover:text-[#EA1F59]"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      返回学习引擎
    </Link>
  );
}

function FaviconOrIcon({ domain }: { domain: string }): JSX.Element {
  const [errored, setErrored] = React.useState(false);
  if (errored) {
    return <Globe className="h-6 w-6" aria-hidden />;
  }
  // Google's public favicon service — best-effort. If it 404s or
  // the user's network blocks it, we fall back to the lucide icon.
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
      alt=""
      className="h-6 w-6"
      onError={() => setErrored(true)}
    />
  );
}

function Section({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section
      className={cn('rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]', className)}
    >
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? (
          <span className="text-[11px] uppercase text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}
