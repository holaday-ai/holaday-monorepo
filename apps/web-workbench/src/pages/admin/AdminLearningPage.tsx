/**
 * Phase 27C — admin learning engine: per-domain health ranking.
 *
 * Layout:
 *   1. 3 metric cards (analyzed domains / high-risk / AI memories)
 *   2. Filter bar (search + filter tabs)
 *   3. Ranking table — domain, total, success/fail counts, success
 *      bar (green→red gradient), last-failed-at, top failure reason,
 *      action column linking to /admin/learning/:domain.
 *
 * No charts on the overview — the ranking is the story. The detail
 * page is where the charts live.
 */

import { Loader2, Search } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { formatDateTime, truncate } from './admin-shared';

type OverviewData = Awaited<ReturnType<typeof trpc.admin.learning.overview.query>>;
type DomainRow = OverviewData['domains'][number];
type Filter = 'all' | 'highRisk' | 'recentFail';

const PAGE_SIZE = 50;

export function AdminLearningPage(): JSX.Element {
  const [search, setSearch] = React.useState('');
  const [searchDebounced, setSearchDebounced] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [offset, setOffset] = React.useState(0);
  const [data, setData] = React.useState<OverviewData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setSearchDebounced(search);
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    trpc.admin.learning.overview
      .query({
        search: searchDebounced || undefined,
        filter,
        sort: 'failureRate',
        offset,
        limit: PAGE_SIZE,
      })
      .then((res) => !cancelled && setData(res))
      .catch((err) =>
        !cancelled && setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchDebounced, filter, offset]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">学习引擎</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          按域名分组的执行健康度 · 取消任务单独统计 · 数据窗口：最近 90 天
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label="已分析域名"
          value={data ? data.metrics.analyzedDomainsCount : null}
          hint="至少出现过一次"
        />
        <MetricCard
          label="高风险域名"
          value={data ? data.metrics.highRiskCount : null}
          hint="失败 / (成功 + 失败) > 50%"
          highlight
        />
        <MetricCard
          label="AI 记忆条数"
          value={data ? data.metrics.aiMemoriesCount : null}
          hint="site_state 类型"
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索域名…"
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-[13px] outline-none transition-colors focus:border-[#E50B6B]"
          />
        </div>
        <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>
          全部
        </FilterPill>
        <FilterPill
          active={filter === 'highRisk'}
          onClick={() => setFilter('highRisk')}
        >
          仅高风险
        </FilterPill>
        <FilterPill
          active={filter === 'recentFail'}
          onClick={() => setFilter('recentFail')}
        >
          本周有失败
        </FilterPill>
      </div>

      <section className="mt-4 rounded-xl border border-border bg-card p-0 shadow-sm">
        {error && (
          <div className="px-5 py-3 text-sm text-red-700">加载失败：{error}</div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-medium">域名</th>
                <th className="px-3 py-3 font-medium text-right">总任务</th>
                <th className="px-3 py-3 font-medium text-right">成功 / 失败 / 取消</th>
                <th className="px-3 py-3 font-medium">成功率</th>
                <th className="px-3 py-3 font-medium">最近失败</th>
                <th className="px-3 py-3 font-medium">主要失败原因</th>
                <th className="px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    加载中…
                  </td>
                </tr>
              ) : !data || data.domains.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    {searchDebounced
                      ? '没有匹配的域名'
                      : filter === 'highRisk'
                        ? '本期无高风险域名（≥ 3 次任务且失败 / 成功+失败 > 50%）'
                        : '本周无失败任务'}
                  </td>
                </tr>
              ) : (
                data.domains.map((d) => <DomainRowEl key={d.domain} row={d} />)
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
            <div>
              显示 {offset + 1} – {Math.min(offset + PAGE_SIZE, data.total)}（共{' '}
              {data.total.toLocaleString('zh-CN')} 个域名）
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                className={cn(
                  'inline-flex h-7 items-center rounded-md border border-border px-2',
                  offset === 0
                    ? 'cursor-not-allowed opacity-40'
                    : 'hover:bg-foreground/[0.04]',
                )}
              >
                上一页
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                className={cn(
                  'inline-flex h-7 items-center rounded-md border border-border px-2',
                  offset + PAGE_SIZE >= data.total
                    ? 'cursor-not-allowed opacity-40'
                    : 'hover:bg-foreground/[0.04]',
                )}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function DomainRowEl({ row }: { row: DomainRow }): JSX.Element {
  return (
    <tr className="border-b border-border/60 last:border-b-0 hover:bg-foreground/[0.02]">
      <td className="px-5 py-3 font-medium text-foreground">
        <span className="truncate">{truncate(row.domain, 40)}</span>
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
        {row.total.toLocaleString('zh-CN')}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <span className="text-emerald-600">{row.success}</span>
        <span className="text-muted-foreground"> / </span>
        <span className="text-red-600">{row.failed}</span>
        <span className="text-muted-foreground"> / </span>
        <span className="text-muted-foreground">{row.cancelled ?? 0}</span>
      </td>
      <td className="px-3 py-3">
        <SuccessRateBar successRate={row.successRate} />
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        {row.lastFailedAt ? formatDateTime(row.lastFailedAt) : '—'}
      </td>
      <td className="px-3 py-3">
        {row.topFailureLabel ? (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            {row.topFailureLabel}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-5 py-3">
        <Link
          to={`/admin/learning/${encodeURIComponent(row.domain)}`}
          className="text-[#E50B6B] hover:underline"
        >
          查看详情
        </Link>
      </td>
    </tr>
  );
}

function SuccessRateBar({ successRate }: { successRate: number }): JSX.Element {
  // Interpolate red (0%) → amber (50%) → green (100%).
  const r = successRate < 50 ? 239 : Math.round(239 - ((successRate - 50) / 50) * (239 - 16));
  const g = successRate < 50 ? Math.round((successRate / 50) * 158) : Math.round(158 + ((successRate - 50) / 50) * (185 - 158));
  const b = successRate < 50 ? 68 : Math.round(68 + ((successRate - 50) / 50) * (129 - 68));
  const color = `rgb(${r}, ${g}, ${b})`;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-24 overflow-hidden rounded-full bg-foreground/[0.06]">
        <div
          className="h-full transition-all"
          style={{ width: `${successRate}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-12 tabular-nums text-[12px] text-foreground">
        {successRate.toFixed(1)}%
      </span>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: number | null;
  hint: string;
  highlight?: boolean;
}): JSX.Element {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-4 shadow-sm',
        highlight && 'border-[#E50B6B]/30',
      )}
      style={
        highlight
          ? { backgroundImage: 'linear-gradient(135deg, rgba(229,11,107,0.10) 0%, transparent 60%)' }
          : undefined
      }
    >
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        {value == null ? '—' : value.toLocaleString('zh-CN')}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function FilterPill({
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
        'inline-flex h-7 items-center rounded-full border px-3 text-[12px] transition-colors',
        active
          ? 'border-[#E50B6B] bg-[rgba(229,11,107,0.10)] text-[#E50B6B]'
          : 'border-border bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
