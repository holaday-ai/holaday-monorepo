import { useToast } from '@/components/ui/toast';
import {
  type ImageHistoryFilter,
  type ImageHistoryRow,
  filterImageHistoryRows,
  imageHistoryListInput,
  imageHistoryLoadReducer,
  toImageHistoryRow,
} from '@/lib/image-history-row';
import { trpc } from '@/lib/trpc';
import { normalizeTaskListCursor, normalizeTaskListRows, useTaskStore } from '@/stores/task-store';
import { Loader2, Pin, RotateCcw } from 'lucide-react';
import * as React from 'react';
import { ImageResultPanel } from './ImageResultPanel';
import type { ImageContinuationAction } from './image-studio-state';

const HISTORY_PAGE_SIZE = 6;
const HISTORY_SCAN_PAGE_LIMIT = 4;

interface ImageHistoryProps {
  refreshKey?: string;
  continuationDisabled?: boolean;
  onContinue(
    action: ImageContinuationAction,
    row: ImageHistoryRow,
    selectedFileId?: string,
  ): void | Promise<void>;
}

export function ImageHistory({
  refreshKey,
  continuationDisabled = false,
  onContinue,
}: ImageHistoryProps): JSX.Element {
  const toast = useToast();
  const togglePin = useTaskStore((state) => state.togglePin);
  const [{ rows, loading, error }, dispatch] = React.useReducer(imageHistoryLoadReducer, {
    rows: null,
    loading: false,
    error: false,
  });
  const [filter, setFilter] = React.useState<ImageHistoryFilter>('all');
  const [nextCursor, setNextCursor] = React.useState<number | null>(null);
  const [visibleCount, setVisibleCount] = React.useState(HISTORY_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [pinningTaskId, setPinningTaskId] = React.useState<string | null>(null);
  const mountedRef = React.useRef(true);
  const requestRef = React.useRef(0);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = React.useCallback(async () => {
    const requestId = ++requestRef.current;
    dispatch({ type: 'start' });
    try {
      let cursor: number | null = null;
      const collected: ImageHistoryRow[] = [];
      for (let page = 0; page < HISTORY_SCAN_PAGE_LIMIT; page += 1) {
        const result = await trpc.tasks.list.query(
          imageHistoryListInput(filter, cursor ?? undefined),
        );
        if (!mountedRef.current || requestId !== requestRef.current) return;
        collected.push(
          ...normalizeTaskListRows(result?.tasks)
            .map(toImageHistoryRow)
            .filter((row): row is ImageHistoryRow => row !== null),
        );
        cursor = normalizeTaskListCursor(result?.nextCursor);
        if (collected.length > 0 || cursor === null) break;
      }
      dispatch({ type: 'success', rows: collected });
      setNextCursor(cursor);
      setVisibleCount(HISTORY_PAGE_SIZE);
    } catch {
      if (mountedRef.current && requestId === requestRef.current) dispatch({ type: 'failure' });
    }
  }, [filter]);

  React.useEffect(() => {
    void refreshKey;
    void load();
  }, [load, refreshKey]);

  async function loadMore(): Promise<void> {
    if (loading || loadingMore) return;
    if (visibleCount < (rows?.length ?? 0)) {
      setVisibleCount((count) => count + HISTORY_PAGE_SIZE);
      return;
    }
    if (nextCursor === null) return;
    setLoadingMore(true);
    let cursor: number | null = nextCursor;
    const collected: ImageHistoryRow[] = [];
    try {
      for (let page = 0; page < HISTORY_SCAN_PAGE_LIMIT && cursor !== null; page += 1) {
        const result = await trpc.tasks.list.query(imageHistoryListInput(filter, cursor));
        collected.push(
          ...normalizeTaskListRows(result?.tasks)
            .map(toImageHistoryRow)
            .filter((row): row is ImageHistoryRow => row !== null),
        );
        cursor = normalizeTaskListCursor(result?.nextCursor);
        if (collected.length > 0) break;
      }
      if (!mountedRef.current) return;
      dispatch({ type: 'append', rows: collected });
      setNextCursor(cursor);
      setVisibleCount((count) => count + HISTORY_PAGE_SIZE);
    } catch {
      if (mountedRef.current) toast.show('加载更早作品失败，请重试', 'error');
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  }

  async function toggleRowPin(row: ImageHistoryRow): Promise<void> {
    if (pinningTaskId) return;
    const next = !row.starred;
    setPinningTaskId(row.taskId);
    dispatch({
      type: 'update_pin',
      taskId: row.taskId,
      starred: next,
      starredAt: next ? new Date() : null,
    });
    try {
      await togglePin(row.taskId, next);
      toast.show(next ? '已置顶作品' : '已取消置顶', 'info', 1_800);
    } catch {
      if (mountedRef.current) {
        dispatch({
          type: 'update_pin',
          taskId: row.taskId,
          starred: row.starred,
          starredAt: row.starredAt,
        });
        toast.show('置顶状态更新失败，请重试', 'error');
      }
    } finally {
      if (mountedRef.current) setPinningTaskId(null);
    }
  }

  const visible = rows ? filterImageHistoryRows(rows, filter).slice(0, visibleCount) : null;
  const hasMore = Boolean(
    visible && (visible.length < filterImageHistoryRows(rows ?? [], filter).length || nextCursor),
  );

  return (
    <section className="mt-8 rounded-[28px] border border-[#E8E0E8] bg-white/80 p-5 shadow-[0_16px_42px_rgba(62,48,69,0.045)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.08em] text-[#8A659F]">你的图片作品</p>
          <h2 className="mt-1 text-xl font-semibold text-[#3D3441]">继续上次的创作</h2>
        </div>
        <fieldset className="flex rounded-xl bg-[#F4EFF6] p-1">
          <legend className="sr-only">筛选图片历史</legend>
          {(
            [
              ['all', '全部'],
              ['recent', '最近'],
              ['pinned', '置顶'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className="min-h-11 rounded-lg px-3 text-xs font-semibold text-[#6D6370] transition-colors aria-pressed:bg-white aria-pressed:text-[#6F4D8B] aria-pressed:shadow-sm motion-reduce:transition-none"
            >
              {label}
            </button>
          ))}
        </fieldset>
      </div>

      {loading && !visible ? (
        <div className="mt-5 flex min-h-36 items-center justify-center gap-2 text-sm text-[#7D727F]">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          正在读取作品…
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#FFF1E5] px-4 py-3 text-xs text-[#8C5828]"
        >
          <span>历史读取失败，已保留上次成功内容。</span>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 font-semibold"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            重试
          </button>
        </div>
      ) : null}

      {visible && visible.length > 0 ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {visible.map((row) => (
            <div key={row.taskId} className="relative">
              <button
                type="button"
                aria-label={row.starred ? '取消置顶图片作品' : '置顶图片作品'}
                title={row.starred ? '取消置顶' : '置顶'}
                disabled={pinningTaskId !== null}
                onClick={() => void toggleRowPin(row)}
                className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-xl border border-[#E6DFE6] bg-white/90 text-[#7B6E7E] shadow-sm transition-colors hover:bg-white disabled:opacity-50 motion-reduce:transition-none"
              >
                <Pin className={row.starred ? 'h-4 w-4 fill-current' : 'h-4 w-4'} aria-hidden />
              </button>
              <ImageResultPanel
                row={row}
                compact
                continuationDisabled={continuationDisabled}
                onContinue={onContinue}
              />
            </div>
          ))}
        </div>
      ) : visible ? (
        <div className="mt-5 rounded-[20px] border border-dashed border-[#DDD3DF] bg-[#FCF9FC] px-5 py-10 text-center text-sm text-[#807482]">
          {filter === 'pinned'
            ? '暂无置顶图片作品。'
            : filter === 'recent'
              ? '最近 7 天暂无图片作品。'
              : '暂无图片作品，先在上方创建一张。'}
        </div>
      ) : null}

      {hasMore ? (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#DED4E2] bg-white px-5 text-sm font-semibold text-[#6F4D8B] disabled:opacity-50"
          >
            {loadingMore ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : null}
            加载更多
          </button>
        </div>
      ) : null}
    </section>
  );
}
