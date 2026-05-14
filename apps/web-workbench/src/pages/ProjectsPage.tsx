import { FolderOpen, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader } from '@/pages/PageShell';
import type { UiProject } from '@/types/task';

/**
 * Phase 16 — 项目 list page. Each card carries an always-visible
 * More menu (打开项目 / 删除) on the right; delete routes through
 * the product ConfirmDialog so users see what happens to the
 * project's tasks before they confirm. The old "hover to reveal
 * a trash icon + window.confirm" pattern made delete read as a
 * hidden hazard on touch + cheap on desktop.
 */
export function ProjectsPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = React.useState<UiProject[]>([]);
  const [loading, setLoading] = React.useState(true);
  // Auto-open the create form when arrived via Sidebar's
  // right-click "新建项目" submenu (passes ?create=1).
  const [creating, setCreating] = React.useState(searchParams.get('create') === '1');
  const [newName, setNewName] = React.useState('');
  const [creatingNow, setCreatingNow] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<UiProject | null>(null);

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

  async function performDelete(p: UiProject): Promise<void> {
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
    <PageContainer width="wide">
      <PageHeader
        title="项目"
        description="按项目分组管理你的任务"
        action={
          !creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              新建项目
            </button>
          ) : null
        }
      />
      <div className="mb-3 text-xs text-muted-foreground">
        共 {projects.length} 个项目
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
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-foreground/[0.02]"
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/?project=${p.projectId}`)}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground hover:underline">
                      {p.name}
                    </div>
                    {p.description && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {p.description}
                      </div>
                    )}
                  </div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`项目 ${p.name} 操作`}
                      title="更多"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem
                      onSelect={() => navigate(`/?project=${p.projectId}`)}
                    >
                      <FolderOpen className="text-muted-foreground" />
                      <span>打开项目</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setPendingDelete(p)}
                      className="text-red-600 focus:bg-red-500/10 focus:text-red-600 dark:text-red-400 dark:focus:text-red-300"
                    >
                      <Trash2 />
                      <span>删除项目</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {p.taskCount} 个任务
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这个项目？"
        description={
          pendingDelete
            ? `项目「${pendingDelete.name}」共 ${pendingDelete.taskCount} 个任务。\n项目下的任务会移回默认列表，任务本身不会被删除。`
            : ''
        }
        confirmLabel="删除项目"
        destructive
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          const p = pendingDelete;
          setPendingDelete(null);
          if (!p) return;
          await performDelete(p);
        }}
      />
    </PageContainer>
  );
}
