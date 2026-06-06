import { AlertCircle, FolderOpen, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
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
import { useAppShellContext } from '@/components/AppShell';
import {
  PROJECT_NAME_MAX_LENGTH,
  projectCountSummary,
  projectLoadErrorCopy,
  projectNameState,
} from '@/lib/project-page-state';
import { pageActionError, pageErrorMessage } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader, PageLoadingPanel } from '@/pages/PageShell';
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
  const { projects: shellProjects, refreshProjects } = useAppShellContext();
  const mountedRef = React.useRef(false);
  const refreshRequestRef = React.useRef(0);
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = React.useState<UiProject[]>(() => [
    ...shellProjects,
  ]);
  const [loading, setLoading] = React.useState(shellProjects.length === 0);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  // Auto-open the create form when arrived via Sidebar's
  // right-click "新建项目" submenu (passes ?create=1).
  const [creating, setCreating] = React.useState(searchParams.get('create') === '1');
  const [newName, setNewName] = React.useState('');
  const [createTouched, setCreateTouched] = React.useState(false);
  const [creatingNow, setCreatingNow] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<UiProject | null>(null);
  const createState = projectNameState(
    newName,
    projects.map((project) => project.name),
  );
  const showCreateError = createTouched && createState.error !== null;
  const projectSummary = projectCountSummary({
    count: projects.length,
    loading,
    error: loadError,
  });
  const hasProjects = projects.length > 0;
  const initialLoading = loading && !hasProjects;
  const fullPageError = loadError && !hasProjects;
  const loadErrorCopy = projectLoadErrorCopy(loadError);

  const refresh = React.useCallback(async () => {
    const requestId = refreshRequestRef.current + 1;
    refreshRequestRef.current = requestId;
    setLoading(true);
    setLoadError(null);
    const res = await refreshProjects();
    if (!mountedRef.current || refreshRequestRef.current !== requestId) return null;
    if ('error' in res) {
      const message = pageErrorMessage(res.error);
      setLoadError(message);
      toast.show('项目暂时无法加载', 'error');
    } else {
      setProjects(res.projects);
      setLoading(false);
      return res.projects;
    }
    setLoading(false);
    return null;
  }, [refreshProjects, toast]);

  React.useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      refreshRequestRef.current += 1;
    };
  }, [refresh]);

  async function onCreate(): Promise<void> {
    setCreateTouched(true);
    if (!createState.canSubmit || creatingNow) return;
    setCreatingNow(true);
    try {
      await trpc.projects.create.mutate({ name: createState.name });
      if (!mountedRef.current) return;
      toast.show(`已创建项目「${createState.name}」`);
      setNewName('');
      setCreateTouched(false);
      setCreating(false);
      await refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      toast.show(pageActionError('创建失败', err), 'error');
    } finally {
      if (mountedRef.current) setCreatingNow(false);
    }
  }

  async function performDelete(p: UiProject): Promise<void> {
    try {
      await trpc.projects.delete.mutate({ projectId: p.projectId });
      if (!mountedRef.current) return;
      toast.show('项目已删除');
      await refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      toast.show(pageActionError('删除失败', err), 'error');
    }
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="项目"
        description="按项目分组管理你的任务"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="inline-flex items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              {projectSummary}
            </div>
            {!creating && (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setCreateTouched(false);
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#EA1F59] px-3 text-sm font-medium text-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition hover:bg-[#D91B51]"
              >
                <Plus className="h-4 w-4" />
                新建项目
              </button>
            )}
          </div>
        }
      />

      {creating && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate();
          }}
          className="mb-4 rounded-[8px] border border-[#DCDDDD] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <input
                autoFocus
                value={newName}
                onBlur={() => setCreateTouched(true)}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && !creatingNow) {
                    setCreating(false);
                    setNewName('');
                    setCreateTouched(false);
                  }
                }}
                placeholder="项目名称（≤100 字）"
                maxLength={PROJECT_NAME_MAX_LENGTH}
                aria-invalid={showCreateError}
                aria-describedby="project-name-help"
                className="w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-1.5 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)] focus-visible:border-[#ADADAD] focus-visible:outline-none"
              />
              <div
                id="project-name-help"
                className={cn(
                  'mt-1 flex items-center justify-between gap-3 text-xs',
                  showCreateError ? 'text-[#EA1F59]' : 'text-muted-foreground',
                )}
              >
                <span role={showCreateError ? 'alert' : undefined}>
                  {showCreateError ? createState.error : '创建后可把相关任务归到同一个项目。'}
                </span>
                <span className="shrink-0 tabular-nums">
                  {createState.length}/{PROJECT_NAME_MAX_LENGTH}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="submit"
                disabled={!createState.canSubmit || creatingNow}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:h-8',
                  createState.canSubmit && !creatingNow
                    ? 'bg-[#EA1F59] text-white hover:bg-[#D91B51]'
                    : 'cursor-not-allowed border border-[#DCDDDD] bg-[#EFEFEF]/60 text-muted-foreground',
                )}
              >
                {creatingNow ? '创建中…' : '创建'}
              </button>
              <button
                type="button"
                disabled={creatingNow}
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                  setCreateTouched(false);
                }}
                className={cn(
                  'rounded-md border border-transparent px-3 py-1.5 text-xs text-[#595757] transition-colors sm:h-8',
                  creatingNow
                    ? 'cursor-not-allowed opacity-60'
                    : 'hover:border-[#DCDDDD] hover:bg-white hover:text-foreground',
                )}
              >
                取消
              </button>
            </div>
          </div>
        </form>
      )}

      {loadError && hasProjects && (
        <div className="mb-4 flex flex-col gap-2 rounded-[8px] border border-[#DCDDDD] border-l-[#EA1F59] bg-white px-3 py-2 text-xs text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] [border-left-width:3px] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#EA1F59]" />
            <span className="min-w-0">
              {loadErrorCopy.title}，当前保留上次结果：{loadErrorCopy.body}
            </span>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
            className={cn(
              'h-7 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors',
              loading
                ? 'cursor-not-allowed border border-[#DCDDDD] bg-[#EFEFEF]/60 text-muted-foreground'
                : 'border border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:text-[#EA1F59]',
            )}
          >
            {loading ? '重试中…' : '重试'}
          </button>
        </div>
      )}

      {initialLoading ? (
        <PageLoadingPanel label="项目加载中" description="正在同步项目列表" />
      ) : fullPageError ? (
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <AlertCircle className="h-8 w-8 text-primary" />
          <div className="text-sm font-medium text-foreground/80">{loadErrorCopy.title}</div>
          <div className="max-w-md text-xs leading-5 text-muted-foreground">
            {loadErrorCopy.body}
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-1 inline-flex h-8 items-center rounded-md bg-[#EA1F59] px-3 text-xs font-medium text-white transition hover:bg-[#D91B51]"
          >
            重试
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-dashed border-[#DCDDDD] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <FolderOpen className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">还没有项目</div>
          <div className="text-xs text-muted-foreground">
            创建一个项目来分组管理你的任务。
          </div>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setCreateTouched(false);
            }}
            className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md bg-[#EA1F59] px-3 text-xs font-medium text-white transition hover:bg-[#D91B51]"
          >
            <Plus className="h-3.5 w-3.5" />
            新建项目
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.projectId}
              className="group flex flex-col gap-2 rounded-[8px] border border-[#DCDDDD] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-[transform,border-color,box-shadow] hover:-translate-y-px hover:border-[#ADADAD] hover:shadow-[0_5px_16px_rgba(15,23,42,0.055)]"
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/?project=${p.projectId}`)}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-[#595757] transition-colors group-hover:border-[#ADADAD]">
                    <FolderOpen className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground hover:text-[#EA1F59]">
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
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#595757] transition-colors hover:bg-[#EFEFEF]/60 hover:text-foreground"
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
                      className="text-[#EA1F59] focus:bg-[#EA1F59]/[0.06] focus:text-[#EA1F59]"
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
          if (!p) return;
          await performDelete(p);
          if (mountedRef.current) setPendingDelete(null);
        }}
      />
    </PageContainer>
  );
}
