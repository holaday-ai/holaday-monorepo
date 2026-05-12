import {
  Check,
  ChevronRight,
  Clipboard,
  Clock,
  FolderOpen,
  FolderPlus,
  Layers,
  ListPlus,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Share2,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { QuotaIndicator } from '@/components/QuotaIndicator';
import {
  Sidebar as SidebarShell,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
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
  // Codex follow-up — onOpenBrowser entry removed; the BrowserPanel
  // now reveals itself only when a browser-mode task is selected
  // or a login / captcha park fires. No explicit user-driven entry.
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

// Optimization #4 — sidebar collapse state moved to shadcn's
// SidebarProvider (cookie-persisted under `sidebar:state`). The
// legacy `holaday.sidebar.collapsed` localStorage key is retired
// (shadcn writes to a cookie so HMR + new tab share the state).

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
  // Codex follow-up — onOpenSearch was previously used by the now-
  // deleted CollapsedRail's Search icon. The Cmd+K shortcut still
  // works via WorkbenchApp's keyboard handler, so we keep the prop
  // on the interface (back-compat with WorkbenchApp wiring) but
  // intentionally don't consume it in the new shadcn shell.
  onOpenSearch: _unusedOnOpenSearch,
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

  // Optimization #4 — shadcn SidebarProvider owns the open/collapse
  // state (cookie-persisted + Cmd+B shortcut + smooth transitions).
  // We just bind mobile open via setOpenMobile so the legacy
  // `mobileOpen` prop continues to drive the Sheet from
  // WorkbenchApp's hamburger button.
  const { setOpenMobile } = useSidebar();
  React.useEffect(() => {
    setOpenMobile(!!mobileOpen);
  }, [mobileOpen, setOpenMobile]);

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

  // Optimization #4 — outer shell is now `<SidebarShell>` from
  // shadcn. The provider above us handles open/collapse state +
  // smooth slide animations + automatic Sheet swap on mobile +
  // Cmd/Ctrl+B shortcut. We just render Header / Content / Footer
  // and keep all the inner business logic (task list, context
  // menu, batch mode, project filter) untouched.

  return (
    <>
      <SidebarShell collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border gap-2">
          {/* Brand row — text hides in icon mode via shadcn's
              `group-data-[collapsible=icon]` selector chain so only
              the mark remains visible at 48px width. */}
          <div className="flex items-center gap-2 px-1 py-1">
            <BrandMark />
            <span className="text-base font-semibold tracking-tight text-sidebar-foreground group-data-[collapsible=icon]:hidden">
              HOLA DAY
            </span>
          </div>
          {/* New-task — `SidebarMenuButton` so it collapses to a
              `Plus` icon when the sidebar is in icon mode. The
              `tooltip` prop wires the hover label. Brand magenta
              filled. */}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="新任务 (/)"
                onClick={() => {
                  onNewTask();
                  onMobileClose?.();
                }}
                className="bg-primary text-primary-foreground font-medium hover:bg-primary/90 hover:text-primary-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
              >
                <Plus />
                <span>新任务</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent className="px-0">
          <FeatureNav />

            {projectFilter && (
              <div className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-pink-300/40 bg-pink-50/40 px-2.5 py-1.5 text-[12px] dark:border-pink-500/30 dark:bg-pink-500/10 group-data-[collapsible=icon]:hidden">
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

            <div className="px-2 pb-4 group-data-[collapsible=icon]:hidden">
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

            </SidebarContent>

            <SidebarFooter className="border-t border-sidebar-border px-0 py-2 group-data-[collapsible=icon]:hidden">
              {/* O1 — batch action bar / batch entry. When batchMode
                  is on, render the count + 全选 / 删除选中 / 取消
                  controls; otherwise show a small "批量管理" entry
                  button alongside the quota indicator. */}
              {batchMode ? (
                <div className="mx-2 mb-2 flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 text-[11px] text-primary dark:border-primary/40 dark:bg-primary/15">
                  <span className="font-medium">已选 {batchSelected.size}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={selectAllVisible}
                      className="rounded px-2 py-0.5 hover:bg-primary/20"
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
                      className="rounded px-2 py-0.5 hover:bg-primary/20"
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
            </SidebarFooter>
        {/* SidebarRail — invisible hairline on the right edge that
            users can click to toggle expand/collapse. Lets the icon
            mode feel composable instead of "stuck" without users
            having to discover Cmd+B. */}
        <SidebarRail />
      </SidebarShell>

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

// Optimization #4 — CollapsedRail + RailIconButton retired. shadcn's
// `<Sidebar collapsible="offcanvas">` handles the collapse-to-hidden
// state with smooth slide animations + Cmd/Ctrl+B keyboard shortcut.
// A follow-up round will add `collapsible="icon"` mode and rewrap
// the FeatureNav items as `SidebarMenuButton` with hover tooltips so
// the icon rail returns as a proper composable surface.

interface GroupProps {
  title: string;
  children: React.ReactNode;
}

/**
 * Optimization #4 follow-up — task-history group uses the shadcn
 * `<SidebarGroup>` shell + `<SidebarGroupLabel>` so the section
 * heading picks up the canonical 11px uppercase grey label style.
 * In icon-mode the group hides via the standard
 * `group-data-[collapsible=icon]:hidden` selector inherited by the
 * shadcn `SidebarMenuSub` family — we apply it directly here so
 * the whole pinned / starred / time-bucket section disappears
 * when the rail collapses to icons.
 */
function TaskGroup({ title, children }: GroupProps): JSX.Element {
  return (
    <SidebarGroup className="py-0 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="px-3 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
        {title}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <div className="space-y-px">{children}</div>
      </SidebarGroupContent>
    </SidebarGroup>
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
}

const FEATURES: readonly FeatureItem[] = [
  { icon: Sparkles, label: '专家技能', href: '/skills' },
  // Phase 5a — 定时任务 promoted back to main nav now that the
  // scheduled-runner's dispatch is wired (was a logger stub in
  // Phase 16b). Cron triggers actually create + run tasks now.
  // P2.6 — MCP connectors stay demoted; the /connections page is
  // still a roadmap surface until OAuth lands.
  { icon: Clock, label: '定时任务', href: '/scheduled' },
  // Phase 5b — batch tasks (submit a list, run with concurrency cap).
  { icon: ListPlus, label: '批量任务', href: '/batch' },
  { icon: FolderOpen, label: '文件库', href: '/files' },
  // Codex follow-up — the '浏览器' entry is gone. The BrowserPanel
  // now auto-opens for browser-mode tasks AND auto-expands on
  // login / captcha / permission park; explicit entry was creating
  // empty-frame UX for users who clicked it without a task in flight.
  { icon: Layers, label: '项目', href: '/projects' },
  { icon: Star, label: '收藏', href: '/starred' },
];

/**
 * Feature nav between the "+ 新任务" CTA and the task list. Phase 16
 * graduates 收藏 / 项目 / 专家技能 from "即将推出" to live routes —
 * those rows render as clickable nav links; the rest stay disabled
 * with the tooltip. Compact density (32px row).
 */
function FeatureNav(): JSX.Element {
  const navigate = useNavigate();
  // Optimization #4 follow-up — feature nav is now a proper
  // shadcn `<SidebarMenu>` so:
  //   - hover gets the rounded `bg-sidebar-accent` highlight
  //   - active route gets `data-[active=true]` filled background
  //   - icon-mode shows ONLY the icon with a hover tooltip via
  //     `SidebarMenuButton tooltip="…"`
  // We read pathname directly so the active state updates without
  // a router subscription in the parent.
  const pathname =
    typeof window !== 'undefined' ? window.location.pathname : '';
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="px-3 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
        快捷入口
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {FEATURES.map(({ icon: Icon, label, href }) => {
            if (href) {
              const isActive = pathname === href;
              return (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    tooltip={label}
                    isActive={isActive}
                    onClick={() => navigate(href)}
                  >
                    <Icon aria-hidden />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            }
            return (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton
                  tooltip={`${label} · 即将推出`}
                  disabled
                  aria-disabled
                  className="cursor-not-allowed opacity-60"
                >
                  <Icon aria-hidden />
                  <span>{label}</span>
                  <span className="ml-auto text-[10px] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
                    即将推出
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
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
