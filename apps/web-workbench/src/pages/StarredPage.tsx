import { Loader2, Pin, PinOff } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '@/stores/task-store';
import { taskDisplayTitle } from '@/components/TaskListItem';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader } from '@/pages/PageShell';
import type { UiTask, UiTaskStatus } from '@/types/task';

/**
 * 置顶任务 (formerly /starred). After the Codex IA pass merged
 * "收藏" into "置顶" as the single save mental model in the
 * Sidebar, this page graduates with it: data source is
 * `pinnedTaskIds` from the store, not the server's starred flag.
 *
 * Pinned ids are persisted client-side (localStorage in the store).
 * To cover pins that point at tasks older than the loaded first
 * page, we fetch any missing rows via tasks.detail on mount.
 */

interface PinnedRow {
  taskId: string;
  intent: string;
  title: string | null;
  status: UiTaskStatus;
}

export function StarredPage(): JSX.Element {
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);
  const pinnedIds = useTaskStore((s) => s.pinnedTaskIds);
  const togglePin = useTaskStore((s) => s.togglePin);

  // Hydrate any pinned ids that aren't in the loaded recent slice.
  // We don't try to be clever — fire detail() for each missing id
  // once on mount; cache the result locally so re-renders don't
  // re-fetch.
  const [hydratedDetail, setHydratedDetail] = React.useState<
    Record<string, PinnedRow>
  >({});
  const [loading, setLoading] = React.useState(true);

  const pinnedIdList = React.useMemo(
    () => Array.from(pinnedIds),
    [pinnedIds],
  );

  React.useEffect(() => {
    const known = new Set(tasks.map((t) => t.taskId));
    const missing = pinnedIdList.filter(
      (id) => !known.has(id) && !hydratedDetail[id],
    );
    if (missing.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    Promise.allSettled(
      missing.map(async (id) => {
        const detail = await trpc.tasks.detail.query({ taskId: id });
        return {
          taskId: id,
          intent: detail.intent,
          title: typeof detail.title === 'string' ? detail.title : null,
          status: detail.status as UiTaskStatus,
        } satisfies PinnedRow;
      }),
    ).then((settled) => {
      if (cancelled) return;
      const next: Record<string, PinnedRow> = {};
      for (const r of settled) {
        if (r.status === 'fulfilled') next[r.value.taskId] = r.value;
      }
      setHydratedDetail((prev) => ({ ...prev, ...next }));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedIdList, tasks]);

  const rows = React.useMemo<PinnedRow[]>(() => {
    const fromStore: Record<string, UiTask> = {};
    for (const t of tasks) {
      if (pinnedIds.has(t.taskId)) fromStore[t.taskId] = t;
    }
    return pinnedIdList
      .map((id) => {
        const t = fromStore[id];
        if (t) {
          return {
            taskId: t.taskId,
            intent: t.intent,
            title: t.title ?? null,
            status: t.status,
          } satisfies PinnedRow;
        }
        return hydratedDetail[id] ?? null;
      })
      .filter((r): r is PinnedRow => r !== null);
  }, [tasks, pinnedIds, pinnedIdList, hydratedDetail]);

  function open(taskId: string): void {
    navigate(`/?task=${encodeURIComponent(taskId)}`);
  }

  function handleUnpin(taskId: string): void {
    togglePin(taskId);
  }

  return (
    <PageContainer width="form">
      <PageHeader
        title="置顶任务"
        description="置顶的任务会固定在侧边栏顶部"
      />
      {loading && rows.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <Pin className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">
            还没有置顶任务
          </div>
          <div className="text-xs text-muted-foreground">
            在任务列表里右键任意任务，选择「置顶」即可。
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((t) => (
            <div
              key={t.taskId}
              className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-foreground/[0.03]"
            >
              <Pin className="h-4 w-4 shrink-0 text-primary" />
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
                onClick={() => handleUnpin(t.taskId)}
                aria-label="取消置顶"
                title="取消置顶"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <PinOff className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
