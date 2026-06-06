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
  mergeTaskHubRowsById,
  normalizeTaskHubCursor,
  normalizeTaskHubRows,
  shouldApplyHistoryResponse,
  taskHubErrorMessage,
  type HistoryRangeFilter,
  type HistoryStatusFilter,
  type NormalizedTaskHubRow,
} from '@/lib/task-hub-state';
import { historyEmptyCopy, taskStatusLabel } from '@/lib/task-status-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  PageContainer,
  PageHeader,
  PageLoadingPanel,
  Section,
} from '@/pages/PageShell';

// Filter values use the same vocabulary as the orchestrator's
// `tasks.status` column ('completed' / 'failed' / 'executing' / …)
// so a single string compares against the raw API row without
// translation. The earlier 'succeeded' value never matched anything
// because the DB has no such status.
type StatusFilter = HistoryStatusFilter;
type RangeFilter = HistoryRangeFilter;

type HistoryTask = NormalizedTaskHubRow;

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
  const mountedRef = React.useRef(false);
  const fetchToken = React.useRef(0);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fetchToken.current += 1;
    };
  }, []);

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
          !mountedRef.current ||
          !shouldApplyHistoryResponse({
            requestKey,
            activeKey: activeFilterKeyRef.current,
          }) ||
          myToken !== fetchToken.current
        ) {
          return;
        }
        const list = normalizeTaskHubRows(res?.tasks);
        setTasks((prev) => (append ? mergeTaskHubRowsById(prev, list) : list));
        const responseCursor = normalizeTaskHubCursor(res?.nextCursor);
        setCursor(responseCursor);
        setHasMore(responseCursor !== null);
        if (append) setLoadMoreError(null);
        else setError(null);
      } catch (err) {
        if (
          !mountedRef.current ||
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
          mountedRef.current &&
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
          !mountedRef.current ||
          myToken !== fetchToken.current ||
          !shouldApplyHistoryResponse({
            requestKey: filterRequestKey,
            activeKey: activeFilterKeyRef.current,
          })
        ) {
          return;
        }
        const list = normalizeTaskHubRows(res?.tasks);
        setTasks(list);
        const responseCursor = normalizeTaskHubCursor(res?.nextCursor);
        setCursor(responseCursor);
        setHasMore(responseCursor !== null);
        setError(null);
      })
      .catch((err) => {
        if (
          !mountedRef.current ||
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
          !mountedRef.current ||
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
          <div className="inline-flex items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            {summary}
          </div>
        }
      />
      <div className="space-y-4">
        <Section className="rounded-[8px] border-[#DCDDDD] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
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
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-[#DCDDDD] bg-white px-2 text-xs text-[#595757] transition-colors hover:border-[#ADADAD] hover:text-[#EA1F59]"
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
                className="w-full rounded-[8px] border border-[#DCDDDD] bg-white py-2 pl-8 pr-3 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)] focus-visible:border-[#ADADAD] focus-visible:outline-none"
              />
            </div>
          </div>
        </Section>

        <Section className="rounded-[8px] border-[#DCDDDD] bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          {loadingWithoutRows ? (
            <div className="p-4">
              <PageLoadingPanel label="任务历史加载中" description="正在同步历史任务" />
            </div>
          ) : error ? (
            <div className="flex h-56 flex-col items-center justify-center text-center">
              <AlertCircle className="h-8 w-8 text-[#EA1F59]" aria-hidden />
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
                  className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                  onClick={() => void fetchPage(null, false)}
                  disabled={loading}
                >
                  {loading ? '重试中…' : '重试'}
                </Button>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                >
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
                  className="mt-3 border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                  onClick={resetFilters}
                >
                  重置筛选
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-[#EFEFEF]">
              {tasks.map((t) => (
                <li key={t.taskId}>
                  <button
                    type="button"
                    onClick={() => navigate(`/?task=${encodeURIComponent(t.taskId)}`)}
                    className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#EFEFEF]/35"
                  >
                    <StatusIcon status={t.status} />
                    <div className="min-w-0 flex-1 px-1">
                      <div className="truncate text-sm font-medium group-hover:text-[#EA1F59]">
                        {t.intent || '未命名任务'}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatTaskHubTime(t.createdAt)} ·{' '}
                        {taskStatusLabel(t.status, t.awaitingKind)}
                      </div>
                    </div>
                    <span className="shrink-0 self-center pr-2 text-[11px] text-[#595757] opacity-0 group-hover:text-[#EA1F59] group-hover:opacity-100">
                      查看 →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {loadMoreError && !error && (
            <div className="mx-4 mb-4 mt-4 flex flex-col items-center gap-2 rounded-[8px] border border-[#DCDDDD] border-l-[#EA1F59] bg-white px-3 py-2 text-center text-xs text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] [border-left-width:3px]">
              <div>加载更多失败：{loadMoreError}</div>
              <Button
                variant="outline"
                size="sm"
                className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                onClick={() => void fetchPage(cursor, true)}
                disabled={loading}
              >
                {loading ? '重试中…' : '重试加载更多'}
              </Button>
            </div>
          )}

          {hasMore && !initialLoad && !error && !loadMoreError && (
            <div className="mt-4 flex justify-center pb-4">
              <Button
                variant="outline"
                size="sm"
                className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
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
    <div className="inline-flex gap-0.5 rounded-[8px] border border-[#DCDDDD] bg-[#EFEFEF]/55 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-md px-2.5 py-1 transition-colors',
            value === o.id
              ? 'bg-white text-[#EA1F59] shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
              : 'text-[#595757] hover:text-foreground',
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
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#42C0EF]" />;
  }
  if (status === 'partial_success') {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#FFC910]" />;
  }
  if (status === 'failed') {
    return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EA1F59]" />;
  }
  if (status === 'cancelled') {
    return (
      <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
    );
  }
  return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#EA1F59]" />;
}
