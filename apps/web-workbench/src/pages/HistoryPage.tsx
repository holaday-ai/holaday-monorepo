import { AlertCircle, CheckCircle2, CircleSlash, Loader2, RotateCcw, Search, XCircle } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { supportMailtoHref } from '@/lib/support-links';
import {
  formatTaskHubTime,
  hasHistoryFilters,
  historyFilterRequestKey,
  historyPageSummary,
  shouldApplyHistoryResponse,
  taskHubErrorMessage,
  type HistoryRangeFilter,
  type HistoryStatusFilter,
} from '@/lib/task-hub-state';
import { historyEmptyCopy, taskStatusLabel } from '@/lib/task-status-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader, Section } from '@/pages/PageShell';

// Filter values use the same vocabulary as the orchestrator's
// `tasks.status` column ('completed' / 'failed' / 'executing' / …)
// so a single string compares against the raw API row without
// translation. The earlier 'succeeded' value never matched anything
// because the DB has no such status.
type StatusFilter = HistoryStatusFilter;
type RangeFilter = HistoryRangeFilter;

interface HistoryTask {
  taskId: string;
  intent: string;
  status: string;
  createdAt: string | number | Date;
  completedAt: string | number | Date | null;
}

// "进行中" maps to all non-terminal DB statuses — the chip is a UX
// shortcut, the server still receives the explicit list so the WHERE
// clause is `status IN (…)` instead of five round-trips.
const RUNNING_STATUSES = [
  'pending',
  'planning',
  'queued',
  'executing',
  'awaiting_user',
  'paused',
] as const;

const FAILED_STATUSES = ['failed', 'partial_success'] as const;

type ServerTaskStatus =
  | 'pending'
  | 'planning'
  | 'queued'
  | 'executing'
  | 'awaiting_user'
  | 'paused'
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'cancelled';

/**
 * Full historical task list. Filters (status / date range / query)
 * are sent to the server via `tasks.list` so the search reaches past
 * the in-memory first-50 sidebar window. Cursor pagination is
 * scoped per filter set — any filter change resets cursor + tasks
 * and refetches from the top. Clicking a row deep-links to the
 * workbench with the task id so the main panel selects it.
 */
export function HistoryPage(): JSX.Element {
  const navigate = useNavigate();
  const [tasks, setTasks] = React.useState<HistoryTask[]>([]);
  const [cursor, setCursor] = React.useState<number | null>(null);
  const [hasMore, setHasMore] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [initialLoad, setInitialLoad] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<StatusFilter>('all');
  const [range, setRange] = React.useState<RangeFilter>('30d');
  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const fetchToken = React.useRef(0);

  // Debounce the search input by 300 ms — keystrokes shouldn't each
  // trigger a fresh paged query.
  React.useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Build the input shape from the active filters. Fed to fetchPage
  // and used as the deps key to reset pagination when the filter set
  // changes. `cursor` lives outside this memo so a "load more" can
  // append to the existing tasks list.
  const baseInput = React.useMemo(() => {
    const out: {
      limit: number;
      query?: string;
      status?: ServerTaskStatus | ServerTaskStatus[];
      dateFrom?: Date;
    } = { limit: 50 };
    if (debouncedQuery.length > 0) out.query = debouncedQuery;
    if (status === 'completed') out.status = 'completed';
    else if (status === 'failed') out.status = [...FAILED_STATUSES];
    else if (status === 'running') out.status = [...RUNNING_STATUSES];
    if (range === '7d') out.dateFrom = new Date(Date.now() - 7 * 86400000);
    else if (range === '30d') out.dateFrom = new Date(Date.now() - 30 * 86400000);
    return out;
  }, [debouncedQuery, status, range]);
  const filterRequestKey = React.useMemo(
    () => historyFilterRequestKey({ query: debouncedQuery, status, range }),
    [debouncedQuery, range, status],
  );
  const activeFilterKeyRef = React.useRef(filterRequestKey);

  const fetchPage = React.useCallback(
    async (nextCursor: number | null, append: boolean): Promise<void> => {
      const requestKey = filterRequestKey;
      const myToken = append ? fetchToken.current : ++fetchToken.current;
      setLoading(true);
      try {
        const input = {
          ...baseInput,
          ...(nextCursor ? { cursor: nextCursor } : {}),
        };
        const res = await trpc.tasks.list.query(input);
        if (
          !shouldApplyHistoryResponse({
            requestKey,
            activeKey: activeFilterKeyRef.current,
          }) ||
          myToken !== fetchToken.current
        ) {
          return;
        }
        const list = (res?.tasks ?? []) as HistoryTask[];
        setTasks((prev) => (append ? [...prev, ...list] : list));
        setCursor(res?.nextCursor ?? null);
        setHasMore(Boolean(res?.nextCursor));
        if (append) setLoadMoreError(null);
        else setError(null);
      } catch (err) {
        if (
          !shouldApplyHistoryResponse({
            requestKey,
            activeKey: activeFilterKeyRef.current,
          }) ||
          myToken !== fetchToken.current
        ) {
          return;
        }
        const message = taskHubErrorMessage(err, '加载失败');
        if (append) setLoadMoreError(message);
        else setError(message);
      } finally {
        if (
          shouldApplyHistoryResponse({
            requestKey,
            activeKey: activeFilterKeyRef.current,
          }) &&
          myToken === fetchToken.current
        ) {
          setLoading(false);
          setInitialLoad(false);
        }
      }
    },
    [baseInput, filterRequestKey],
  );

  // Filter set changed → drop the existing list + refetch from the
  // top. Token guard so a stale response from the previous filter
  // doesn't overwrite the new one.
  React.useEffect(() => {
    const myToken = ++fetchToken.current;
    activeFilterKeyRef.current = filterRequestKey;
    setTasks([]);
    setCursor(null);
    setHasMore(true);
    setLoading(true);
    setError(null);
    setLoadMoreError(null);
    void trpc.tasks.list
      .query(baseInput)
      .then((res) => {
        if (
          myToken !== fetchToken.current ||
          !shouldApplyHistoryResponse({
            requestKey: filterRequestKey,
            activeKey: activeFilterKeyRef.current,
          })
        ) {
          return;
        }
        const list = (res?.tasks ?? []) as HistoryTask[];
        setTasks(list);
        setCursor(res?.nextCursor ?? null);
        setHasMore(Boolean(res?.nextCursor));
        setError(null);
      })
      .catch((err) => {
        if (
          myToken !== fetchToken.current ||
          !shouldApplyHistoryResponse({
            requestKey: filterRequestKey,
            activeKey: activeFilterKeyRef.current,
          })
        ) {
          return;
        }
        setTasks([]);
        setCursor(null);
        setHasMore(false);
        setError(taskHubErrorMessage(err, '加载失败'));
      })
      .finally(() => {
        if (
          myToken !== fetchToken.current ||
          !shouldApplyHistoryResponse({
            requestKey: filterRequestKey,
            activeKey: activeFilterKeyRef.current,
          })
        ) {
          return;
        }
        setLoading(false);
        setInitialLoad(false);
      });
  }, [baseInput, filterRequestKey]);
  const filtered = hasHistoryFilters({ query: debouncedQuery, status, range });
  const emptyCopy = historyEmptyCopy({
    query: debouncedQuery,
    status,
    range: filtered ? range : 'all',
  });
  const summary = historyPageSummary({
    loading,
    error,
    count: tasks.length,
    hasMore,
    query: debouncedQuery,
    status,
    range,
  });
  const loadingWithoutRows = loading && tasks.length === 0;

  function resetFilters(): void {
    setStatus('all');
    setRange('30d');
    setQuery('');
    setDebouncedQuery('');
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="任务历史"
        description="全部历史记录"
        action={
          <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[12px] font-medium text-foreground">
            {summary}
          </div>
        }
      />
      <div className="space-y-4">
        <Section>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <FilterGroup<StatusFilter>
                value={status}
                onChange={setStatus}
                options={[
                  { id: 'all', label: '全部' },
                  { id: 'completed', label: '已完成' },
                  { id: 'failed', label: '异常' },
                  { id: 'running', label: '进行中' },
                ]}
              />
              <FilterGroup<RangeFilter>
                value={range}
                onChange={setRange}
                options={[
                  { id: '7d', label: '近 7 天' },
                  { id: '30d', label: '近 30 天' },
                  { id: 'all', label: '全部' },
                ]}
              />
              {filtered && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition hover:bg-foreground/[0.05] hover:text-foreground"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  重置筛选
                </button>
              )}
            </div>
            <div className="relative md:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder="搜索任务内容"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>
        </Section>

        <Section>
          {loadingWithoutRows ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              任务历史加载中…
            </div>
          ) : error ? (
            <div className="flex h-56 flex-col items-center justify-center text-center">
              <AlertCircle className="h-8 w-8 text-primary" aria-hidden />
              <div className="mt-3 text-sm font-medium text-foreground/80">
                历史任务加载失败
              </div>
              <div className="mt-1 max-w-md text-xs text-muted-foreground">
                {error}
              </div>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void fetchPage(null, false)}
                  disabled={loading}
                >
                  {loading ? '重试中…' : '重试'}
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a
                    href={supportMailtoHref({
                      subject: '任务历史加载失败',
                      body: '任务历史加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
                    })}
                  >
                    联系支持
                  </a>
                </Button>
              </div>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-center">
              <div className="text-sm font-medium text-foreground/80">
                {emptyCopy.title}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {emptyCopy.body}
              </div>
              {filtered && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={resetFilters}
                >
                  重置筛选
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {tasks.map((t) => (
                <li key={t.taskId}>
                  <button
                    type="button"
                    onClick={() => navigate(`/?task=${encodeURIComponent(t.taskId)}`)}
                    className="group flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <StatusIcon status={t.status} />
                    <div className="min-w-0 flex-1 px-1">
                      <div className="truncate text-sm font-medium group-hover:underline">
                        {t.intent || '未命名任务'}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatTaskHubTime(t.createdAt)} · {taskStatusLabel(t.status)}
                      </div>
                    </div>
                    <span className="shrink-0 self-center pr-2 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100">
                      查看 →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {loadMoreError && !error && (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-red-200/70 bg-red-50/70 px-3 py-2 text-center text-xs text-red-700 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
              <div>加载更多失败：{loadMoreError}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchPage(cursor, true)}
                disabled={loading}
              >
                {loading ? '重试中…' : '重试加载更多'}
              </Button>
            </div>
          )}

          {hasMore && !initialLoad && !error && !loadMoreError && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchPage(cursor, true)}
                disabled={loading}
              >
                {loading ? '加载中…' : '加载更多'}
              </Button>
            </div>
          )}
        </Section>
      </div>
    </PageContainer>
  );
}

function FilterGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange(v: T): void;
  options: Array<{ id: T; label: string }>;
}): JSX.Element {
  return (
    <div className="inline-flex gap-0.5 rounded-md bg-muted p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded px-2.5 py-1 transition-colors',
            value === o.id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatusIcon({ status }: { status: string }): JSX.Element {
  if (status === 'completed') {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />;
  }
  if (status === 'partial_success') {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />;
  }
  if (status === 'failed') {
    return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />;
  }
  if (status === 'cancelled') {
    return (
      <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
    );
  }
  return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-pink-400" />;
}
