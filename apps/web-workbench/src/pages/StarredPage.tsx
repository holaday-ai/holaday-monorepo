import { AlertCircle, Loader2, Pin, PinOff } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '@/stores/task-store';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { supportMailtoHref } from '@/lib/support-links';
import {
  formatTaskHubTime,
  mergeTaskHubRowsById,
  normalizeTaskHubCursor,
  normalizeTaskHubRows,
  starredPageSummary,
  taskHubErrorMessage,
  taskHubLoadMoreErrorCopy,
  taskHubNeedsAttention,
  type NormalizedTaskHubRow,
} from '@/lib/task-hub-state';
import { taskStatusLabel } from '@/lib/task-status-copy';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, PageLoadingPanel } from '@/pages/PageShell';

/**
 * 置顶任务 — pinned-task hub. Pin state is server-persisted (the
 * `tasks.star/unstar` RPC drives the per-row `starred` flag), so
 * this page just queries `tasks.list({ starred: true })` with cursor
 * pagination to reach pins older than the recent-50 sidebar window.
 * The /starred URL stays for deep links; the page no longer reaches
 * into a local Set.
 */

type PinnedRow = NormalizedTaskHubRow;

function pinnedTaskTitle(row: Pick<PinnedRow, 'title' | 'intent'>, maxLength = 60): string {
  const title = row.title?.trim() || row.intent;
  return title.length > maxLength ? `${title.slice(0, maxLength - 1)}…` : title;
}

export function StarredPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  // togglePin hits tasks.star/unstar over the wire and also flips the
  // store row, so any Sidebar copy of the same task updates its 置顶
  // group membership instantly.
  const togglePin = useTaskStore((s) => s.togglePin);

  const [items, setItems] = React.useState<PinnedRow[]>([]);
  const [cursor, setCursor] = React.useState<number | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [initialLoad, setInitialLoad] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null);
  const [unpinningIds, setUnpinningIds] = React.useState<ReadonlySet<string>>(() => new Set());

  const mountedRef = React.useRef(false);
  const fetchToken = React.useRef(0);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fetchToken.current += 1;
    };
  }, []);
  const fetchPage = React.useCallback(
    async (nextCursor: number | null, append: boolean): Promise<void> => {
      const myToken = ++fetchToken.current;
      setLoading(true);
      try {
        const res = await trpc.tasks.list.query({
          starred: true,
          limit: 50,
          ...(nextCursor ? { cursor: nextCursor } : {}),
        });
        if (!mountedRef.current || myToken !== fetchToken.current) return;
        const list = normalizeTaskHubRows(res?.tasks);
        setItems((prev) => (append ? mergeTaskHubRowsById(prev, list) : list));
        const responseCursor = normalizeTaskHubCursor(res?.nextCursor);
        setCursor(responseCursor);
        setHasMore(responseCursor !== null);
        if (append) setLoadMoreError(null);
        else {
          setLoadError(null);
          setLoadMoreError(null);
        }
      } catch (err) {
        if (!mountedRef.current || myToken !== fetchToken.current) return;
        const message = taskHubErrorMessage(err, '加载失败');
        if (append) {
          setLoadMoreError(message);
        } else {
          setItems([]);
          setCursor(null);
          setHasMore(false);
          setLoadError(message);
        }
      } finally {
        if (mountedRef.current && myToken === fetchToken.current) {
          setLoading(false);
          setInitialLoad(false);
        }
      }
    },
    [],
  );

  React.useEffect(() => {
    void fetchPage(null, false);
  }, [fetchPage]);

  function open(taskId: string): void {
    navigate(`/?task=${encodeURIComponent(taskId)}`);
  }

  async function handleUnpin(taskId: string): Promise<void> {
    const removed = items.find((t) => t.taskId === taskId);
    if (!removed || unpinningIds.has(taskId)) return;
    // Optimistic remove from this page's list. Pass desiredPinned=false
    // explicitly — older pinned tasks aren't in the store's recent-50
    // slice, so togglePin can't infer the target state from a missing
    // local row. Without this the unpin RPC would never fire and the
    // pin would re-appear after a refresh.
    setUnpinningIds((prev) => new Set(prev).add(taskId));
    setItems((prev) => prev.filter((t) => t.taskId !== taskId));
    try {
      await togglePin(taskId, false);
      if (!mountedRef.current) return;
      toast.show('已取消置顶');
    } catch {
      if (!mountedRef.current) return;
      setItems((prev) => (prev.some((t) => t.taskId === taskId) ? prev : [removed, ...prev]));
      toast.show('取消置顶失败，请重试。', 'error');
    } finally {
      if (mountedRef.current) {
        setUnpinningIds((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    }
  }

  const summary = starredPageSummary({
    loading,
    error: loadError,
    count: items.length,
    hasMore,
  });
  const loadMoreErrorCopy = taskHubLoadMoreErrorCopy(loadMoreError);

  return (
    <PageContainer width="form">
      <PageHeader
        title="置顶任务"
        description="置顶的任务会固定在侧边栏顶部"
        action={
          <div className="inline-flex items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            {summary}
          </div>
        }
      />
      {initialLoad ? (
        <PageLoadingPanel label="置顶任务加载中" description="正在同步固定任务" />
      ) : loadError ? (
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <AlertCircle className="h-8 w-8 text-[#EA1F59]" aria-hidden />
          <div className="text-sm font-medium text-foreground/80">置顶任务加载失败</div>
          <div className="max-w-md text-xs leading-5 text-muted-foreground">{loadError}</div>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" onClick={() => void fetchPage(null, false)} disabled={loading}>
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
                  subject: '置顶任务加载失败',
                  body: '置顶任务加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
                })}
              >
                联系支持
              </a>
            </Button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[8px] border border-dashed border-[#DCDDDD] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <Pin className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">
            还没有置顶任务
          </div>
          <div className="text-xs text-muted-foreground">
            在任务列表里右键任意任务，选择「置顶」即可。
          </div>
        </div>
      ) : (
        <>
          <div className="divide-y divide-[#EFEFEF] rounded-[8px] border border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            {items.map((t) => (
              <div
                key={t.taskId}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#EFEFEF]/35"
              >
                <PinnedStatusIcon status={t.status} />
                <button
                  type="button"
                  onClick={() => open(t.taskId)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm text-foreground group-hover:text-[#EA1F59]">
                    {pinnedTaskTitle(t)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {taskStatusLabel(t.status, t.awaitingKind)} · 置顶于{' '}
                    {formatTaskHubTime(t.starredAt)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void handleUnpin(t.taskId)}
                  aria-label="取消置顶"
                  title={unpinningIds.has(t.taskId) ? '取消置顶中…' : '取消置顶'}
                  disabled={unpinningIds.has(t.taskId)}
                  className="rounded-md p-1 text-[#595757] transition-colors hover:bg-[#EFEFEF]/70 hover:text-[#EA1F59] disabled:cursor-wait disabled:opacity-50"
                >
                  {unpinningIds.has(t.taskId) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PinOff className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
          {loadMoreError && (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-[8px] border border-[#DCDDDD] border-l-[#EA1F59] bg-white px-3 py-2 text-center text-xs text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] [border-left-width:3px]">
              <div className="font-medium">{loadMoreErrorCopy.title}</div>
              <div className="max-w-md text-muted-foreground">{loadMoreErrorCopy.body}</div>
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
          {hasMore && !loadMoreError && (
            <div className="mt-4 flex justify-center">
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
        </>
      )}
    </PageContainer>
  );
}

function PinnedStatusIcon({ status }: { status: string }): JSX.Element {
  if (taskHubNeedsAttention(status)) {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#FFC910]/55 bg-[#FFC910]/15 text-[#8A6A00]">
        <AlertCircle className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-[#EA1F59]">
      <Pin className="h-3.5 w-3.5" />
    </span>
  );
}
