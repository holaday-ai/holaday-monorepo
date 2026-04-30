import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageShell } from '@/pages/PageShell';
import type { UiProject } from '@/types/task';

/**
 * Phase 16 — 项目 list page. Shows the user's projects with task
 * counts and a name-only inline create input. Click a card → details
 * not yet implemented (Phase 16.1); for now a click toasts the
 * project id. Delete is gated behind a window.confirm to keep the
 * action surface minimal.
 */
export function ProjectsPage(): JSX.Element {
  const toast = useToast();
  const _navigate = useNavigate();
  void _navigate;
  const [projects, setProjects] = React.useState<UiProject[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [creatingNow, setCreatingNow] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await trpc.projects.list.query();
      setProjects(list as UiProject[]);
    } catch (err) {
      toast.show(
        err instanceof Error ? `加载失败：${err.message}` : '加载失败',
        'error',
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(): Promise<void> {
    const name = newName.trim();
    if (!name || creatingNow) return;
    setCreatingNow(true);
    try {
      await trpc.projects.create.mutate({ name });
      toast.show(`已创建项目「${name}」`);
      setNewName('');
      setCreating(false);
      await refresh();
    } catch (err) {
      toast.show(
        err instanceof Error ? `创建失败：${err.message}` : '创建失败',
        'error',
      );
    } finally {
      setCreatingNow(false);
    }
  }

  async function onDelete(p: UiProject): Promise<void> {
    if (!window.confirm(`删除项目「${p.name}」？项目下的任务会被移到默认列表。`)) {
      return;
    }
    try {
      await trpc.projects.delete.mutate({ projectId: p.projectId });
      toast.show('项目已删除');
      await refresh();
    } catch (err) {
      toast.show(
        err instanceof Error ? `删除失败：${err.message}` : '删除失败',
        'error',
      );
    }
  }

  return (
    <PageShell title="项目" subtitle="按项目分组管理你的任务" width="5xl">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          共 {projects.length} 个项目
        </span>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/85"
          >
            <Plus className="h-3.5 w-3.5" />
            新建项目
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate();
          }}
          className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card p-3"
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setCreating(false);
                setNewName('');
              }
            }}
            placeholder="项目名称（≤100 字）"
            maxLength={100}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:border-foreground/30 focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={!newName.trim() || creatingNow}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              newName.trim() && !creatingNow
                ? 'bg-foreground text-background hover:bg-foreground/85'
                : 'cursor-not-allowed bg-muted text-muted-foreground',
            )}
          >
            创建
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setNewName('');
            }}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/[0.05]"
          >
            取消
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <FolderOpen className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">还没有项目</div>
          <div className="text-xs text-muted-foreground">
            创建一个项目来分组管理你的任务。
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.projectId}
              className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-foreground/[0.02]"
            >
              <div className="flex items-start gap-2">
                <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {p.name}
                  </div>
                  {p.description && (
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {p.description}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void onDelete(p)}
                  aria-label={`删除项目 ${p.name}`}
                  className="rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="text-[11px] text-muted-foreground">{p.taskCount} 个任务</div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
