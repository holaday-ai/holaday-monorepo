import { Star, X } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '@/stores/task-store';
import { taskDisplayTitle } from '@/components/TaskListItem';
import { PageShell } from '@/pages/PageShell';

/**
 * Phase 16 — 收藏 list page. Reads the in-memory task list from
 * the store, filters to starred tasks, sorts by starredAt desc.
 * Click a row → open it in the workbench (router push to `/`
 * with the selectedTaskId set in the store).
 */
export function StarredPage(): JSX.Element {
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);
  const selectAndHydrateTask = useTaskStore((s) => s.selectAndHydrateTask);
  const toggleStarred = useTaskStore((s) => s.toggleStarred);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);

  // Refresh once on mount so a freshly-loaded /starred bookmark sees
  // the latest server state even if the store was cold-empty.
  React.useEffect(() => {
    if (tasks.length === 0) void refreshTasks();
  }, [tasks.length, refreshTasks]);

  const starred = React.useMemo(() => {
    return tasks
      .filter((t) => t.starred)
      .sort((a, b) => {
        const ta = a.starredAt ? new Date(a.starredAt).getTime() : 0;
        const tb = b.starredAt ? new Date(b.starredAt).getTime() : 0;
        return tb - ta;
      });
  }, [tasks]);

  function open(taskId: string): void {
    selectAndHydrateTask(taskId);
    navigate('/');
  }

  return (
    <PageShell title="收藏" subtitle="星标的任务，按收藏时间倒序排列" width="3xl">
      {starred.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <Star className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">还没有收藏的任务</div>
          <div className="text-xs text-muted-foreground">
            在任务列表里 hover 任意一行，点击右侧的星标即可收藏。
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {starred.map((t) => (
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
                {taskDisplayTitle(t, 60)}
              </button>
              <button
                type="button"
                onClick={() => void toggleStarred(t.taskId)}
                aria-label="取消收藏"
                className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
