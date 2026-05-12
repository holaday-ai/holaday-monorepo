import { Loader2, Star, X } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '@/stores/task-store';
import { taskDisplayTitle } from '@/components/TaskListItem';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader } from '@/pages/PageShell';
import type { UiTask } from '@/types/task';

interface ServerStarredTask {
  taskId: string;
  intent: string;
  title: string | null;
  status: UiTask['status'];
  starredAt: string | number | Date | null;
}

/**
 * Phase 16 — 收藏 list page. Pulls the user's starred tasks via
 * `tasks.list({ starred: true })` so older starred entries (past the
 * sidebar's first-50 window) still surface here. Cursor pagination
 * is independent from the store: the store keeps the live recent
 * task slice, this page maintains its own list scoped to the
 * starred-only view.
 *
 * Toggle off a star → optimistically drop the row + call the store's
 * `toggleStarred` so the sidebar's `task.starred` flag stays in sync
 * for any rows that overlap. The next page fetch picks up the
 * canonical server state.
 */
export function StarredPage(): JSX.Element {
  const navigate = useNavigate();
  const toggleStarred = useTaskStore((s) => s.toggleStarred);

  const [items, setItems] = React.useState<ServerStarredTask[]>([]);
  const [cursor, setCursor] = React.useState<number | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [initialLoad, setInitialLoad] = React.useState(true);

  const fetchToken = React.useRef(0);
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
        if (myToken !== fetchToken.current) return;
        const list = (res?.tasks ?? []) as ServerStarredTask[];
        setItems((prev) => (append ? [...prev, ...list] : list));
        setCursor(res?.nextCursor ?? null);
        setHasMore(Boolean(res?.nextCursor));
      } finally {
        if (myToken === fetchToken.current) {
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

  async function handleUnstar(taskId: string): Promise<void> {
    // Optimistic remove — the row vanishes immediately so the user
    // doesn't see their tap reflect after a round-trip. Store
    // toggle keeps the sidebar's task.starred flag in sync if the
    // task is also in the recent slice.
    setItems((prev) => prev.filter((t) => t.taskId !== taskId));
    try {
      await toggleStarred(taskId);
    } catch {
      // Revert: re-fetch from page top so any failure is visible.
      void fetchPage(null, false);
    }
  }

  return (
    <PageContainer width="form">
      <PageHeader title="收藏" description="星标的任务，按收藏时间倒序排列" />
      {initialLoad ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <Star className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">还没有收藏的任务</div>
          <div className="text-xs text-muted-foreground">
            在任务列表里 hover 任意一行，点击右侧的星标即可收藏。
          </div>
        </div>
      ) : (
        <>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {items.map((t) => (
              <div
                key={t.taskId}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-foreground/[0.03]"
              >
                <Star className="h-4 w-4 shrink-0 text-amber-500" fill="currentColor" />
                <button
                  type="button"
                  onClick={() => open(t.taskId)}
                  className="min-w-0 flex-1 truncate text-left text-sm text-foreground hover:underline"
                >
                  {taskDisplayTitle(
                    {
                      taskId: t.taskId,
                      intent: t.intent,
                      title: t.title,
                      status: t.status,
                      tickCount: 0,
                      createdAt: new Date(0),
                    },
                    60,
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleUnstar(t.taskId)}
                  aria-label="取消收藏"
                  className="rounded p-1 text-muted-foreground opacity-100 transition-opacity hover:bg-foreground/10 hover:text-foreground lg:opacity-0 lg:group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          {hasMore && (
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
        </>
      )}
    </PageContainer>
  );
}
