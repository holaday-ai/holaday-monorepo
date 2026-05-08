import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  FolderOpen,
  FolderPlus,
  Globe,
  Layers,
  ListTree,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { QuotaIndicator } from '@/components/QuotaIndicator';
import { TaskListItem } from '@/components/TaskListItem';
import { useToast } from '@/components/ui/toast';
import { UserMenu } from '@/components/UserMenu';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/task-store';
import type { UiProject, UiTask } from '@/types/task';
import { bucketByTime, isTaskDeletable } from '@/utils/time-buckets';

interface Props {
  tasks: UiTask[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onNewTask: () => void;
  onDeleteTask?(taskId: string): void | Promise<void>;
  /**
   * Batch delete entry — opens a single bulk-confirm modal upstream.
   * Replaces the old loop over `onDeleteTask`, which only opened the
   * single-task confirm modal repeatedly (last id wins, only one
   * task ever got deleted).
   */
  onDeleteTasks?(taskIds: string[]): void;
  onRenameTask?(taskId: string, title: string): void | Promise<void>;
  onRetryTask?(intent: string): void | Promise<void>;
  /** Phase 16 — toggle a task's starred flag. Wires through to the store. */
  onToggleStarred?(taskId: string): void | Promise<void>;
  /**
   * Phase 16b — projects available for the right-click "移到项目"
   * submenu. Empty array hides the menu item; absent prop also hides
   * it. Loaded once at App level via projects.list and refreshed when
   * the user creates a new project.
   */
  projects?: readonly UiProject[];
  /**
   * Phase 16b — fired when the user picks a destination project (or
   * clears with projectId=null). Optimistic move happens in the
   * store; the prop just lets the App refresh the projects list
   * task counts.
   */
  onMoveTaskToProject?(taskId: string, projectId: string | null): void | Promise<void>;
  /**
   * Phase 16b — open the "+ 新建项目" inline form. The form is in
   * /projects; this just navigates there with `?create=1` so the
   * page auto-opens the form.
   */
  onCreateProject?(): void;
  /**
   * Phase 16b — when set, the sidebar shows a project-filter chip
   * above the task list (the WorkbenchApp has already filtered
   * the tasks array down to that project).
   */
  projectFilter?: { projectId: string; name: string } | null;
  onClearProjectFilter?(): void;
  /**
   * Phase 18 — invoked when the 浏览器 feature entry is clicked.
   * Caller (WorkbenchApp) wakes the user's Brave instance and
   * surfaces the BrowserPanel (slide-in sheet on mobile, focuses
   * the existing right-rail on desktop).
   */
  onOpenBrowser?(): void;
  onOpenSearch?(): void;
  userEmail: string | null;
  userDisplayName: string;
  userPlan: string;
  onLogout(): void;
  onOpenFeedback?(): void;
  /** O12 — open the in-app settings modal instead of navigating. */
  onOpenSettings?(): void;
  /** Count of tasks in status='failed' — feeds UserMenu badge. */
  failedTaskCount?: number;
  /** "清除所有失败任务" handler; hidden when count=0 or handler absent. */
  onClearFailedTasks?(): void;
  /** Mobile drawer state — ignored at md+ breakpoints. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  /**
   * Phase 10 polish — number of tasks the SPA hid because they're
   * older than the user's plan retention window. Drives the
   * "升级查看更早的任务" hint at the bottom of the task list. 0 = no
   * hint rendered.
   */
  hiddenTaskCount?: number;
  /** Plan retention window in days — used in the hint copy. */
  historyDays?: number;
  /**
   * Override the LoadMoreTasksButton's pagination source. When set
   * (project-filter mode), the button uses these instead of the
   * store's `tasksHasMore` / `loadingMore` / `loadMoreTasks`. When
   * absent, the button reads straight from the store as before.
   */
  pagerOverride?: {
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
  };
}

const COLLAPSED_KEY = 'holaday.sidebar.collapsed';

/**
 * Left rail. Two desktop modes:
 *
 *   - **Collapsed (Codex-style, default)**: 64px-wide icon strip with
 *     brand / new-task / task-list-toggle / search / user. Task list
 *     hidden; users jump via Cmd+K or by expanding.
 *   - **Expanded**: 224px-wide, task list grouped 今天/本周/更早.
 *
 * State persists in localStorage so the layout choice survives a
 * reload. Mobile gets the existing fixed-overlay drawer (always
 * expanded when open) — the collapsed rail isn't useful on a touch
 * viewport that's already narrow.
 */
export function Sidebar({
  tasks,
  selectedTaskId,
  onSelectTask,
  onNewTask,
  onDeleteTask,
  onDeleteTasks,
  onRenameTask,
  onRetryTask,
  onToggleStarred,
  projects: projectsProp,
  onMoveTaskToProject,
  onCreateProject,
  projectFilter,
  onClearProjectFilter,
  onOpenBrowser,
  onOpenSearch,
  userEmail,
  userDisplayName,
  userPlan,
  onLogout,
  onOpenFeedback,
  onOpenSettings,
  failedTaskCount = 0,
  onClearFailedTasks,
  mobileOpen,
  onMobileClose,
  hiddenTaskCount = 0,
  historyDays,
  pagerOverride,
}: Props): JSX.Element {
  const pinnedIds = useTaskStore((s) => s.pinnedTaskIds);
  const togglePin = useTaskStore((s) => s.togglePin);
  // Partition: pinned tasks show as their own top group; unpinned
  // tasks get the normal time-bucketed grouping. Pinned group keeps
  // pin order (most-recently-pinned first by tasks array position).
  const { pinnedTasks, starredTasks, unpinnedTasks } = React.useMemo(() => {
    const pinned: UiTask[] = [];
    const starred: UiTask[] = [];
    const rest: UiTask[] = [];
    for (const t of tasks) {
      if (pinnedIds.has(t.taskId)) pinned.push(t);
      else if (t.starred) starred.push(t);
      else rest.push(t);
    }
    // Sort starred by starredAt desc (most-recently-starred first).
    // null starredAt sinks to the bottom.
    starred.sort((a, b) => {
      const ta = a.starredAt ? new Date(a.starredAt).getTime() : 0;
      const tb = b.starredAt ? new Date(b.starredAt).getTime() : 0;
      return tb - ta;
    });
    return { pinnedTasks: pinned, starredTasks: starred, unpinnedTasks: rest };
  }, [tasks, pinnedIds]);
  const buckets = React.useMemo(() => bucketByTime(unpinnedTasks), [unpinnedTasks]);

  // O1 — batch select + bulk delete. Toggle entered via the
  // "批量管理" footer button; while on, every deletable task row
  // swaps from "click to open" to "click to toggle checkbox", and a
  // sticky bottom bar shows the count + 全选 / 删除选中 / 取消.
  // Active / executing tasks are disabled (greyed checkbox, click
  // swallowed) — backend rejects deletes on them anyway, so showing
  // a user-actionable selection that always fails would be a lie.
  // The actual delete fans out through the parent's onDeleteTasks
  // entry which opens a single bulk-confirm modal and uses
  // Promise.allSettled for the network calls.
  const [batchMode, setBatchMode] = React.useState(false);
  const [batchSelected, setBatchSelected] = React.useState<Set<string>>(new Set());
  const toggleBatchSelect = React.useCallback(
    (id: string) => {
      const status = tasks.find((t) => t.taskId === id)?.status;
      if (status && !isTaskDeletable(status)) return;
      setBatchSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [tasks],
  );
  const exitBatchMode = React.useCallback(() => {
    setBatchMode(false);
    setBatchSelected(new Set());
  }, []);
  const selectAllVisible = React.useCallback(() => {
    setBatchSelected(
      new Set(
        tasks.filter((t) => isTaskDeletable(t.status)).map((t) => t.taskId),
      ),
    );
  }, [tasks]);
  const deleteSelected = React.useCallback(() => {
    if (batchSelected.size === 0 || !onDeleteTasks) return;
    onDeleteTasks(Array.from(batchSelected));
    exitBatchMode();
  }, [batchSelected, onDeleteTasks, exitBatchMode]);

  const [collapsed, setCollapsed] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(COLLAPSED_KEY);
    return stored === null ? true : stored === '1';
  });
  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      }
      return next;
    });
  }, []);

  const [menu, setMenu] = React.useState<
    | {
        taskId: string;
        intent: string;
        projectId: string | null;
        x: number;
        y: number;
        deletable: boolean;
      }
    | null
  >(null);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  // Phase 16b — when set, the right-click menu's "移到项目" item has
  // been hovered and the submenu is showing the project list. Resets
  // when the user clicks an option or the outer menu closes.
  const [moveOpen, setMoveOpen] = React.useState(false);

  React.useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  // Mobile drawer always renders full width regardless of the desktop
  // collapsed state — a touch viewport with a 64px icon strip is
  // useless. `desktopCollapsed` is the only thing that changes layout
  // on md+.
  const desktopCollapsed = collapsed;

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="关闭侧边栏"
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm md:hidden"
        />
      )}
      <aside
        className={cn(
          'flex h-full max-w-[90vw] shrink-0 flex-col border-r border-border backdrop-blur-xl transition-[width] duration-200',
          // Mobile: always full-width drawer when open.
          'w-72',
          // Desktop: icon rail (collapsed) or task list (expanded).
          // Expanded width bumped 64 → 72 (256px → 288px) so longer
          // Chinese task titles stop truncating at the 8-char mark;
          // still comfortably narrower than Codex's 320px.
          desktopCollapsed ? 'md:w-16' : 'md:w-72',
          'md:static md:translate-x-0',
          'fixed inset-y-0 left-0 z-50',
          mobileOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full md:shadow-none',
        )}
        style={{ backgroundColor: 'hsl(var(--card) / 0.85)' }}
      >
        {desktopCollapsed ? (
          <CollapsedRail
            onNewTask={() => {
              onNewTask();
              onMobileClose?.();
            }}
            onExpand={toggleCollapsed}
            onOpenSearch={onOpenSearch}
            userDisplayName={userDisplayName}
            userEmail={userEmail}
            userPlan={userPlan}
            onLogout={onLogout}
            failedTaskCount={failedTaskCount}
            {...(onClearFailedTasks ? { onClearFailedTasks } : {})}
            {...(onOpenSettings ? { onOpenSettings } : {})}
            {...(onOpenFeedback ? { onOpenFeedback } : {})}
            {...(onOpenBrowser
              ? {
                  onOpenBrowser: () => {
                    onOpenBrowser();
                    onMobileClose?.();
                  },
                }
              : {})}
          />
        ) : (
          <>
            <header className="flex items-start justify-between px-4 pb-3 pt-5">
              <div className="flex-1">
                <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
                  <BrandMark />
                  <span>HOLA DAY</span>
                </h1>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    onNewTask();
                    onMobileClose?.();
                  }}
                  className="mt-3 w-full justify-start"
                >
                  <Plus className="h-4 w-4" />
                  新任务
                </Button>
              </div>
              {mobileOpen ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onMobileClose}
                  aria-label="关闭"
                  className="md:hidden"
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleCollapsed}
                  aria-label="收起侧边栏"
                  title="收起侧边栏 (节省空间)"
                  className="hidden md:inline-flex"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
            </header>

            <FeatureNav
              onOpenBrowser={
                onOpenBrowser
                  ? () => {
                      onMobileClose?.();
                      onOpenBrowser();
                    }
                  : undefined
              }
            />

            {projectFilter && (
              <div className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-pink-300/40 bg-pink-50/40 px-2.5 py-1.5 text-[12px] dark:border-pink-500/30 dark:bg-pink-500/10">
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-pink-600 dark:text-pink-300" />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  项目：{projectFilter.name}
                </span>
                <button
                  type="button"
                  onClick={() => onClearProjectFilter?.()}
                  aria-label="清除项目筛选"
                  className="rounded p-0.5 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {pinnedTasks.length > 0 && (
                <TaskGroup title="置顶">
                  {pinnedTasks.map((t) => (
                    <TaskListItem
                      key={t.taskId}
                      task={t}
                      selected={t.taskId === selectedTaskId}
                      renaming={renamingId === t.taskId}
                      onSelect={(id) => {
                        onSelectTask(id);
                        onMobileClose?.();
                      }}
                      onContextMenu={(id, e) => {
                        e.preventDefault();
                        setMoveOpen(false);
                        setMenu({
                          taskId: id,
                          intent: t.intent,
                          projectId: t.projectId ?? null,
                          x: e.clientX,
                          y: e.clientY,
                          deletable: isTaskDeletable(t.status),
                        });
                      }}
                      onRenameCommit={(id, title) => {
                        setRenamingId(null);
                        if (onRenameTask && (title.trim() !== (t.title ?? '').trim())) {
                          void onRenameTask(id, title);
                        }
                      }}
                      onRenameCancel={() => setRenamingId(null)}
                      batchMode={batchMode}
                      batchChecked={batchSelected.has(t.taskId)}
                      batchDisabled={!isTaskDeletable(t.status)}
                      onBatchToggle={toggleBatchSelect}
                      onToggleStarred={onToggleStarred}
                    />
                  ))}
                </TaskGroup>
              )}
              {starredTasks.length > 0 && (
                <TaskGroup title={`收藏 (${starredTasks.length})`}>
                  {starredTasks.map((t) => (
                    <TaskListItem
                      key={t.taskId}
                      task={t}
                      selected={t.taskId === selectedTaskId}
                      renaming={renamingId === t.taskId}
                      onSelect={(id) => {
                        onSelectTask(id);
                        onMobileClose?.();
                      }}
                      onContextMenu={(id, e) => {
                        e.preventDefault();
                        setMoveOpen(false);
                        setMenu({
                          taskId: id,
                          intent: t.intent,
                          projectId: t.projectId ?? null,
                          x: e.clientX,
                          y: e.clientY,
                          deletable: isTaskDeletable(t.status),
                        });
                      }}
                      onRenameCommit={(id, title) => {
                        setRenamingId(null);
                        if (onRenameTask && (title.trim() !== (t.title ?? '').trim())) {
                          void onRenameTask(id, title);
                        }
                      }}
                      onRenameCancel={() => setRenamingId(null)}
                      batchMode={batchMode}
                      batchChecked={batchSelected.has(t.taskId)}
                      batchDisabled={!isTaskDeletable(t.status)}
                      onBatchToggle={toggleBatchSelect}
                      onToggleStarred={onToggleStarred}
                    />
                  ))}
                </TaskGroup>
              )}
              {buckets.map((bucket) => (
                <TaskGroup key={bucket.key} title={bucket.title}>
                  {bucket.tasks.map((t) => (
                    <TaskListItem
                      key={t.taskId}
                      task={t}
                      selected={t.taskId === selectedTaskId}
                      renaming={renamingId === t.taskId}
                      onSelect={(id) => {
                        onSelectTask(id);
                        onMobileClose?.();
                      }}
                      onContextMenu={(id, e) => {
                        e.preventDefault();
                        setMoveOpen(false);
                        setMenu({
                          taskId: id,
                          intent: t.intent,
                          projectId: t.projectId ?? null,
                          x: e.clientX,
                          y: e.clientY,
                          deletable: isTaskDeletable(t.status),
                        });
                      }}
                      onRenameCommit={(id, title) => {
                        setRenamingId(null);
                        if (onRenameTask && (title.trim() !== (t.title ?? '').trim())) {
                          void onRenameTask(id, title);
                        }
                      }}
                      onRenameCancel={() => setRenamingId(null)}
                      batchMode={batchMode}
                      batchChecked={batchSelected.has(t.taskId)}
                      batchDisabled={!isTaskDeletable(t.status)}
                      onBatchToggle={toggleBatchSelect}
                      onToggleStarred={onToggleStarred}
                    />
                  ))}
                </TaskGroup>
              ))}
              {tasks.length === 0 && hiddenTaskCount === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  还没有任务，发一条试试看
                </div>
              )}
              {/* Phase 24 RC follow-up — load-more pager so users can
                  page past the first 50 tasks. Hidden until the first
                  refresh sets tasksHasMore=true; once the cursor is
                  exhausted the button hides itself again. */}
              <LoadMoreTasksButton override={pagerOverride} />
              {hiddenTaskCount > 0 && (
                <RetentionHint
                  hiddenCount={hiddenTaskCount}
                  historyDays={historyDays ?? null}
                  plan={userPlan}
                />
              )}
            </div>

            <footer className="border-t border-black/[0.06] px-0 py-2">
              {/* O1 — batch action bar / batch entry. When batchMode
                  is on, render the count + 全选 / 删除选中 / 取消
                  controls; otherwise show a small "批量管理" entry
                  button alongside the quota indicator. */}
              {batchMode ? (
                <div className="mx-2 mb-2 flex items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50/60 px-2 py-1.5 text-[11px] text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-100">
                  <span className="font-medium">已选 {batchSelected.size}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={selectAllVisible}
                      className="rounded px-2 py-0.5 hover:bg-blue-200/50 dark:hover:bg-blue-500/25"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      onClick={deleteSelected}
                      disabled={batchSelected.size === 0}
                      className={cn(
                        'rounded px-2 py-0.5 font-medium',
                        batchSelected.size === 0
                          ? 'cursor-not-allowed opacity-50'
                          : 'bg-red-600 text-white hover:bg-red-700',
                      )}
                    >
                      删除选中
                    </button>
                    <button
                      type="button"
                      onClick={exitBatchMode}
                      className="rounded px-2 py-0.5 hover:bg-blue-200/50 dark:hover:bg-blue-500/25"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                onDeleteTasks && (
                  <div className="mb-1 flex items-center justify-end px-2">
                    <button
                      type="button"
                      onClick={() => setBatchMode(true)}
                      className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                    >
                      批量管理
                    </button>
                  </div>
                )
              )}
              {/* Quota strip first — the user's daily/monthly headroom */}
              {/* is the primary "what can I still do" signal. Refetches  */}
              {/* keyed off the task list length: every create/terminal  */}
              {/* event changes the array, which is good enough to keep  */}
              {/* the bar live without subscribing to WS task events.    */}
              <QuotaIndicator refreshKey={tasks.length} />
              <div className="px-2 pb-1 pt-1">
                <ShareInviteRow />
              </div>
              <div className="px-2">
                <UserMenu
                  displayName={userDisplayName}
                  email={userEmail}
                  plan={userPlan}
                  onLogout={onLogout}
                  failedTaskCount={failedTaskCount}
                  {...(onClearFailedTasks ? { onClearFailedTasks } : {})}
                  {...(onOpenFeedback ? { onOpenFeedback } : {})}
                  {...(onOpenSettings ? { onOpenSettings } : {})}
                />
              </div>
            </footer>
          </>
        )}
      </aside>

      {menu && (onDeleteTask || onRetryTask || onRenameTask) && (
        <ContextMenuShell anchorX={menu.x} anchorY={menu.y}><div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="min-w-[160px] rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg animate-fade-in"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const { taskId } = menu;
              setMenu(null);
              togglePin(taskId);
            }}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-foreground/5"
          >
            {pinnedIds.has(menu.taskId) ? (
              <>
                <PinOff className="h-3.5 w-3.5" />
                取消置顶
              </>
            ) : (
              <>
                <Pin className="h-3.5 w-3.5" />
                置顶
              </>
            )}
          </button>
          {onRenameTask && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const { taskId } = menu;
                setMenu(null);
                setRenamingId(taskId);
              }}
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-foreground/5"
            >
              <Pencil className="h-3.5 w-3.5" />
              重命名
            </button>
          )}
          {onRetryTask && (
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                const { intent } = menu;
                setMenu(null);
                await onRetryTask(intent);
              }}
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-foreground/5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              用相同意图重试
            </button>
          )}
          {onMoveTaskToProject && (
            <div className="relative">
              <button
                type="button"
                role="menuitem"
                onClick={() => setMoveOpen((v) => !v)}
                aria-expanded={moveOpen}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-foreground/5"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="flex-1">移到项目</span>
                <ChevronRight className="h-3 w-3 opacity-60" />
              </button>
              {moveOpen && (
                <div
                  role="menu"
                  // Phase 18b — submenu positioning: mobile (<sm) stacks
                  // below the parent menu item (full width of the
                  // outer context menu) so it can't overflow off the
                  // right edge on a 390px viewport. Desktop (≥sm)
                  // keeps the original adjacent-right placement.
                  className="absolute z-[61] inset-x-0 top-full mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg animate-fade-in sm:inset-x-auto sm:left-full sm:top-0 sm:ml-1 sm:mt-0 sm:min-w-[180px]"
                >
                  {/* "无项目" — clear assignment */}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      const { taskId } = menu;
                      setMenu(null);
                      setMoveOpen(false);
                      await onMoveTaskToProject(taskId, null);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left transition-colors hover:bg-foreground/5"
                  >
                    <Check
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        menu.projectId == null ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="text-muted-foreground">无项目</span>
                  </button>
                  {(projectsProp ?? []).length > 0 && (
                    <div className="my-1 border-t border-border" />
                  )}
                  {(projectsProp ?? []).map((p) => {
                    const active = menu.projectId === p.projectId;
                    return (
                      <button
                        key={p.projectId}
                        type="button"
                        role="menuitem"
                        onClick={async () => {
                          const { taskId } = menu;
                          setMenu(null);
                          setMoveOpen(false);
                          await onMoveTaskToProject(taskId, p.projectId);
                        }}
                        className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left transition-colors hover:bg-foreground/5"
                      >
                        <Check
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            active ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {p.name}
                        </span>
                      </button>
                    );
                  })}
                  {onCreateProject && (
                    <>
                      <div className="my-1 border-t border-border" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenu(null);
                          setMoveOpen(false);
                          onCreateProject();
                        }}
                        className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-foreground/5"
                      >
                        <FolderPlus className="h-3.5 w-3.5" />
                        新建项目
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              const { intent } = menu;
              setMenu(null);
              try {
                // navigator.clipboard is async and gated on secure
                // context — wrap so a rejected promise doesn't
                // crash the component. Users on http:// dev get a
                // console warning but nothing user-visible.
                await navigator.clipboard?.writeText(intent);
              } catch (err) {
                console.warn('[TaskMenu] clipboard copy failed', err);
              }
            }}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-foreground/5"
          >
            <Clipboard className="h-3.5 w-3.5" />
            复制任务文本
          </button>
          {onDeleteTask && (
            <button
              type="button"
              role="menuitem"
              disabled={!menu.deletable}
              onClick={async () => {
                const { taskId } = menu;
                setMenu(null);
                if (!menu.deletable) return;
                await onDeleteTask(taskId);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left transition-colors',
                menu.deletable
                  ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400'
                  : 'cursor-not-allowed text-muted-foreground',
              )}
              title={menu.deletable ? '' : '任务进行中，不能删除'}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除任务
            </button>
          )}
        </div></ContextMenuShell>
      )}
    </>
  );
}

/**
 * Context-menu positioner that flips direction when the anchor is
 * close to the viewport's bottom / right edge. Measures its own
 * size via ref in a layout effect, then re-anchors via `bottom` /
 * `right` so the menu always lands on-screen. Keeps the anchor
 * pixel (the raw click point) in the same place — only the menu's
 * extent direction changes.
 */
function ContextMenuShell({
  anchorX,
  anchorY,
  children,
}: {
  anchorX: number;
  anchorY: number;
  children: React.ReactNode;
}): JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<React.CSSProperties>({
    top: anchorY,
    left: anchorX,
    visibility: 'hidden',
  });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const style: React.CSSProperties = { position: 'fixed', visibility: 'visible' };
    if (anchorY + h + margin > vh) {
      // Too close to the bottom — anchor by `bottom` so the menu
      // grows upward from the cursor.
      style.bottom = Math.max(margin, vh - anchorY);
    } else {
      style.top = anchorY;
    }
    if (anchorX + w + margin > vw) {
      style.right = Math.max(margin, vw - anchorX);
    } else {
      style.left = anchorX;
    }
    setPos(style);
  }, [anchorX, anchorY]);
  return (
    <div ref={ref} className="z-[60]" style={pos}>
      {children}
    </div>
  );
}

interface CollapsedRailProps {
  onNewTask: () => void;
  onExpand: () => void;
  onOpenSearch?: () => void;
  /**
   * F7 — opens the BrowserPanel directly without expanding the
   * sidebar. Mirrors the expanded sidebar's 浏览器 entry. Optional
   * because not every page wires it (e.g. onboarding flows that
   * suppress the panel).
   */
  onOpenBrowser?: () => void;
  userDisplayName: string;
  userEmail: string | null;
  userPlan: string;
  onLogout: () => void;
  onOpenFeedback?: () => void;
  onOpenSettings?: () => void;
  failedTaskCount?: number;
  onClearFailedTasks?: () => void;
}

/**
 * Codex-style icon rail. Five slots top-to-bottom:
 *
 *   - Brand (doubles as "expand sidebar")
 *   - New task (+)
 *   - Task list toggle (ListTree icon → expand sidebar)
 *   - Search (Search icon → Cmd+K overlay)
 *   - Spacer
 *   - User (UserMenu anchored at bottom)
 *
 * Each icon has a tooltip via the native title attr so the UI is
 * explorable without copy.
 */
function CollapsedRail({
  onNewTask,
  onExpand,
  onOpenSearch,
  onOpenBrowser,
  userDisplayName,
  userEmail,
  userPlan,
  onLogout,
  onOpenFeedback,
  onOpenSettings,
  failedTaskCount = 0,
  onClearFailedTasks,
}: CollapsedRailProps): JSX.Element {
  return (
    <div className="hidden h-full flex-col items-center gap-1 py-3 md:flex">
      <button
        type="button"
        onClick={onExpand}
        title="展开侧边栏"
        aria-label="展开侧边栏"
        className="mb-1 inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-foreground/5"
      >
        <BrandMark />
      </button>

      <RailIconButton onClick={onNewTask} title="新任务 (/)" aria-label="新任务">
        <Plus className="h-4 w-4" />
      </RailIconButton>

      {onOpenBrowser && (
        <RailIconButton
          onClick={onOpenBrowser}
          title="打开浏览器面板"
          aria-label="打开浏览器面板"
        >
          <Globe className="h-4 w-4" />
        </RailIconButton>
      )}

      <RailIconButton onClick={onExpand} title="任务列表" aria-label="任务列表">
        <ListTree className="h-4 w-4" />
      </RailIconButton>

      {onOpenSearch && (
        <RailIconButton onClick={onOpenSearch} title="搜索任务 (⌘K)" aria-label="搜索任务">
          <Search className="h-4 w-4" />
        </RailIconButton>
      )}

      <RailIconButton
        onClick={onExpand}
        title="展开"
        aria-label="展开"
        className="mt-auto"
      >
        <ChevronRight className="h-4 w-4" />
      </RailIconButton>

      <div className="border-t border-black/[0.06] pt-2">
        <UserMenu
          displayName={userDisplayName}
          email={userEmail}
          plan={userPlan}
          onLogout={onLogout}
          compact
          failedTaskCount={failedTaskCount}
          {...(onClearFailedTasks ? { onClearFailedTasks } : {})}
          {...(onOpenFeedback ? { onOpenFeedback } : {})}
          {...(onOpenSettings ? { onOpenSettings } : {})}
        />
      </div>
    </div>
  );
}

function RailIconButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

interface GroupProps {
  title: string;
  children: React.ReactNode;
}

function TaskGroup({ title, children }: GroupProps): JSX.Element {
  return (
    <section className="mt-3 first:mt-1">
      <div className="px-3 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground/60">
        {title}
      </div>
      <div className="mt-0.5 space-y-px">{children}</div>
    </section>
  );
}

/**
 * Footer-of-list hint shown when the plan's retention window has
 * hidden some tasks. Click → /plan. The historyDays + plan combo
 * tells the user exactly what their cutoff is and what upgrading
 * would buy ("基础版可看 30 天 / 专业版可看 90 天").
 */
/**
 * Phase 24 RC follow-up — sidebar pager. Hidden when the first page
 * already loaded everything (`tasksHasMore=false`). The button stays
 * visible while loading so users can see progress; the store throttles
 * concurrent calls via its `loadingMore` flag.
 */
function LoadMoreTasksButton({
  override,
}: {
  override?: {
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
  };
}): JSX.Element | null {
  // Hooks always run — even when an override is provided — so we
  // don't violate the hooks rules. Cheap reads when unused.
  const storeHasMore = useTaskStore((s) => s.tasksHasMore);
  const storeLoadingMore = useTaskStore((s) => s.loadingMore);
  const storeLoadMore = useTaskStore((s) => s.loadMoreTasks);
  const hasMore = override ? override.hasMore : storeHasMore;
  const loadingMore = override ? override.loadingMore : storeLoadingMore;
  const onLoadMore = override
    ? override.onLoadMore
    : (): void => {
        void storeLoadMore();
      };
  if (!hasMore) return null;
  return (
    <button
      type="button"
      onClick={onLoadMore}
      disabled={loadingMore}
      className="mx-3 my-2 block w-[calc(100%-1.5rem)] rounded-md border border-black/[0.06] px-2 py-1.5 text-center text-xs text-muted-foreground hover:bg-muted/40 disabled:opacity-60"
    >
      {loadingMore ? '加载中…' : '加载更多任务'}
    </button>
  );
}

function RetentionHint({
  hiddenCount,
  historyDays,
  plan,
}: {
  hiddenCount: number;
  historyDays: number | null;
  plan: string;
}): JSX.Element {
  const navigate = useNavigate();
  const upgradeCopy =
    plan === 'free'
      ? '升级到基础版查看 30 天 / 专业版查看 90 天'
      : plan === 'basic'
        ? '升级到专业版查看 90 天历史'
        : '升级查看更早的任务';
  return (
    <button
      type="button"
      onClick={() => navigate('/plan')}
      className="mx-2 mt-3 block w-[calc(100%-1rem)] rounded-md border border-dashed border-border bg-card/40 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[0.03]"
    >
      <div className="font-medium text-foreground/80">
        {hiddenCount} 个更早的任务已隐藏
      </div>
      <div className="mt-0.5">
        当前套餐保留 {historyDays ?? '?'} 天 · {upgradeCopy}
      </div>
    </button>
  );
}

function BrandMark(): JSX.Element {
  return (
    <span
      aria-hidden
      className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-pink-500 to-pink-700 text-[12px] font-bold text-white"
    >
      H
    </span>
  );
}

interface FeatureItem {
  icon: typeof Sparkles;
  label: string;
  /** When set the row is clickable and routes here. */
  href?: string;
  /**
   * Phase 18 — when set, click invokes the parent-supplied
   * `onOpenBrowser` instead of navigating. Used by 浏览器 entry to
   * open the live BrowserPanel (wakeBrowser + slide in the sheet
   * on mobile / expand panel on desktop) rather than a route.
   */
  action?: 'openBrowser';
}

const FEATURES: readonly FeatureItem[] = [
  { icon: Sparkles, label: '专家技能', href: '/skills' },
  // 定时任务 demoted off the main nav until the orchestrator's
  // dispatch path is wired (today the cron handler only logs).
  // Page kept reachable via direct URL but rendered as a roadmap
  // placeholder so users can't create tasks that won't fire.
  // P2.6 — MCP connectors demoted off the main nav. The roadmap
  // page lives at /connections but isn't worth a top-level slot
  // until OAuth actually lands. Reachable from /settings or via
  // direct URL.
  { icon: FolderOpen, label: '文件库', href: '/files' },
  { icon: Globe, label: '浏览器', action: 'openBrowser' },
  { icon: Layers, label: '项目', href: '/projects' },
  { icon: Star, label: '收藏', href: '/starred' },
];

/**
 * Feature nav between the "+ 新任务" CTA and the task list. Phase 16
 * graduates 收藏 / 项目 / 专家技能 from "即将推出" to live routes —
 * those rows render as clickable nav links; the rest stay disabled
 * with the tooltip. Compact density (32px row).
 */
function FeatureNav({
  onOpenBrowser,
}: {
  /** Phase 18 — invoked when the 浏览器 entry is clicked. */
  onOpenBrowser?: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  return (
    <nav className="px-2 pb-2">
      {FEATURES.map(({ icon: Icon, label, href, action }) => {
        if (href || action) {
          return (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (action === 'openBrowser') {
                  onOpenBrowser?.();
                } else if (href) {
                  navigate(href);
                }
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </button>
          );
        }
        return (
          <button
            key={label}
            type="button"
            disabled
            aria-disabled
            title={`${label} · 即将推出`}
            className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground/70 opacity-60 transition-colors"
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
            <span className="ml-auto text-[10px] text-muted-foreground/50">即将推出</span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * "与好友分享 HOLA DAY" row above the user card. Click copies the
 * invite link (current origin) to clipboard + flashes a toast.
 * Falls back silently when navigator.clipboard is unavailable
 * (insecure context / rare browser).
 */
function ShareInviteRow(): JSX.Element {
  const toast = useToast();
  const onShare = React.useCallback(async () => {
    const url = typeof window !== 'undefined' ? window.location.origin : '';
    try {
      await navigator.clipboard?.writeText(url);
      toast.show('邀请链接已复制');
    } catch {
      toast.show('复制失败，请手动复制地址栏链接');
    }
  }, [toast]);
  return (
    <button
      type="button"
      onClick={() => void onShare()}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
    >
      <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>与好友分享 HOLA DAY</span>
    </button>
  );
}
