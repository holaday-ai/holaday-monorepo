import {
  Check,
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
  Search,
  Share2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { QuotaIndicator } from '@/components/QuotaIndicator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  projects: projectsProp,
  onMoveTaskToProject,
  onCreateProject,
  projectFilter,
  onClearProjectFilter,
  // Search button lives in SidebarHeader now. When this callback is
  // provided we render a 搜索任务 / ⌘K row under "新任务"; when
  // omitted we just don't render it (Cmd+K shortcut still works via
  // AppShell's keyboard handler regardless).
  onOpenSearch,
  userEmail,
  userDisplayName,
  userPlan,
  onLogout,
  onOpenFeedback,
  failedTaskCount = 0,
  onClearFailedTasks,
  mobileOpen,
  onMobileClose,
  hiddenTaskCount = 0,
  historyDays,
  pagerOverride,
}: Props): JSX.Element {
  const togglePin = useTaskStore((s) => s.togglePin);
  // Belt-and-braces: collapse any duplicate taskId rows the store may
  // hand us before partitioning. A single row can otherwise appear in
  // 置顶 AND a time bucket if a refresh / load-more merge let two
  // copies through (we treat the first occurrence as canonical).
  const uniqueTasks = React.useMemo(() => {
    const seen = new Set<string>();
    const out: UiTask[] = [];
    for (const t of tasks) {
      if (seen.has(t.taskId)) continue;
      seen.add(t.taskId);
      out.push(t);
    }
    return out;
  }, [tasks]);
  // Partition: pinned tasks show as their own top group; everything
  // else falls through to the time-bucketed list. Codex IA pass —
  // 收藏 was a duplicate save-state mental model, so this round drops
  // the starred bucket entirely; the row-level star toggle is also
  // hidden. Users have ONE save action: pin. /starred deep links
  // still resolve.
  const { pinnedTasks, unpinnedTasks } = React.useMemo(() => {
    const pinned: UiTask[] = [];
    const rest: UiTask[] = [];
    // Pin state now comes from the server-backed `starred` flag on
    // each row (toggled via `togglePin` → tasks.star). Persists
    // across refresh / device / logout-relogin.
    for (const t of uniqueTasks) {
      if (t.starred) pinned.push(t);
      else rest.push(t);
    }
    return { pinnedTasks: pinned, unpinnedTasks: rest };
  }, [uniqueTasks]);
  const buckets = React.useMemo(() => bucketByTime(unpinnedTasks), [unpinnedTasks]);
  // Number of tasks in any terminal state — feeds the QuotaIndicator
  // refresh key so the bar re-fetches the moment any in-flight task
  // hits completed / failed / cancelled, not just when a new task
  // gets created. Without this the displayed used count stayed at
  // task.length while server-side actual usage was incrementing.
  const quotaTerminalCount = React.useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.status === 'completed' ||
          t.status === 'failed' ||
          t.status === 'cancelled',
      ).length,
    [tasks],
  );

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
  // Radix DropdownMenu owns the outside-click / Escape / focus loop —
  // the previous hand-rolled mousedown + scroll + resize listeners are
  // gone. We just toggle `menu` state when the user right-clicks a row
  // and Radix anchors to an invisible 0×0 trigger at the cursor.

  // Optimization #4 — outer shell is now `<SidebarShell>` from
  // shadcn. The provider above us handles open/collapse state +
  // smooth slide animations + automatic Sheet swap on mobile +
  // Cmd/Ctrl+B shortcut. We just render Header / Content / Footer
  // and keep all the inner business logic (task list, context
  // menu, batch mode, project filter) untouched.

  return (
    <>
      <SidebarShell collapsible="icon">
        {/* Codex info-architecture rework: the Sidebar reads as four
            stable segments. Header / SidebarNav / SidebarFooter are
            pinned; only the task list scrolls. The visual centre of
            gravity sits on "新任务" + the feature shortcuts; task
            history is a scroll surface, not a status board. */}
        <SidebarHeader className="border-b border-sidebar-border gap-2">
          <div className="flex items-center gap-2 px-1 py-1">
            <BrandMark />
            <span className="text-base font-semibold tracking-tight text-sidebar-foreground group-data-[collapsible=icon]:hidden">
              HOLA DAY
            </span>
          </div>
          {/* Brand magenta only on the primary action. */}
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
            {onOpenSearch && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="搜索任务 (⌘K)"
                  onClick={() => onOpenSearch()}
                  className="text-sidebar-foreground/80"
                >
                  <Search />
                  <span className="flex flex-1 items-center justify-between">
                    搜索任务
                    <kbd className="rounded border border-sidebar-border/50 bg-sidebar-accent/40 px-1 py-0.5 text-[10px] font-sans text-sidebar-foreground/60">
                      ⌘K
                    </kbd>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarHeader>

        {/* SidebarNav — fixed feature shortcuts. Lives between
            SidebarHeader and SidebarContent so it stays put while
            the task list below scrolls. */}
        <FeatureNav />

        <SidebarContent className="px-0">
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
              {/* Quota strip first — the user's daily/monthly headroom
                  is the primary "what can I still do" signal. Refetch
                  key combines tasks.length (bumps on create/delete)
                  with the count of terminal tasks (bumps when any
                  in-flight task transitions to completed/failed —
                  that's when server-side quota actually changes).
                  Sweep P2 fix: length alone missed live updates;
                  the bar would stay stale at 57/100 until the next
                  create. */}
              <QuotaIndicator
                refreshKey={`${tasks.length}|${quotaTerminalCount}`}
              />
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
                />
              </div>
            </SidebarFooter>
        {/* SidebarRail — invisible hairline on the right edge that
            users can click to toggle expand/collapse. Lets the icon
            mode feel composable instead of "stuck" without users
            having to discover Cmd+B. */}
        <SidebarRail />
      </SidebarShell>

      <TaskContextMenu
        menu={menu}
        onClose={() => setMenu(null)}
        pinned={
          menu
            ? Boolean(uniqueTasks.find((t) => t.taskId === menu.taskId)?.starred)
            : false
        }
        onTogglePin={() => {
          if (!menu) return;
          void togglePin(menu.taskId);
        }}
        onRename={
          onRenameTask
            ? () => {
                if (!menu) return;
                setRenamingId(menu.taskId);
              }
            : undefined
        }
        onRetry={
          onRetryTask
            ? () => {
                if (!menu) return;
                void onRetryTask(menu.intent);
              }
            : undefined
        }
        onMoveToProject={
          onMoveTaskToProject
            ? (projectId) => {
                if (!menu) return;
                void onMoveTaskToProject(menu.taskId, projectId);
              }
            : undefined
        }
        projects={projectsProp}
        onCreateProject={onCreateProject}
        onCopyIntent={() => {
          if (!menu) return;
          try {
            void navigator.clipboard?.writeText(menu.intent);
          } catch (err) {
            console.warn('[TaskMenu] clipboard copy failed', err);
          }
        }}
        onDelete={
          onDeleteTask
            ? () => {
                if (!menu || !menu.deletable) return;
                void onDeleteTask(menu.taskId);
              }
            : undefined
        }
      />
    </>
  );
}

interface TaskContextMenuProps {
  menu:
    | {
        taskId: string;
        intent: string;
        projectId: string | null;
        x: number;
        y: number;
        deletable: boolean;
      }
    | null;
  onClose(): void;
  pinned: boolean;
  onTogglePin(): void;
  onRename?(): void;
  onRetry?(): void;
  onMoveToProject?(projectId: string | null): void;
  projects?: readonly UiProject[];
  onCreateProject?(): void;
  onCopyIntent(): void;
  onDelete?(): void;
}

/**
 * Right-click task menu, anchored to an invisible 0×0 trigger at the
 * cursor coords. Radix DropdownMenu owns outside-click, Escape,
 * keyboard navigation, focus management, and portal layering — the
 * earlier hand-rolled ContextMenuShell + setMoveOpen / mousedown /
 * scroll / resize listeners are all gone. Submenu uses Radix
 * DropdownMenuSub so arrow keys + Esc work the same as in every other
 * shadcn menu in the app.
 */
function TaskContextMenu({
  menu,
  onClose,
  pinned,
  onTogglePin,
  onRename,
  onRetry,
  onMoveToProject,
  projects,
  onCreateProject,
  onCopyIntent,
  onDelete,
}: TaskContextMenuProps): JSX.Element | null {
  if (!menu) return null;
  const anchorStyle: React.CSSProperties = {
    position: 'fixed',
    left: menu.x,
    top: menu.y,
    width: 0,
    height: 0,
    pointerEvents: 'none',
  };
  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuTrigger asChild>
        <span style={anchorStyle} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        className="min-w-[180px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem onSelect={onTogglePin}>
          {pinned ? (
            <>
              <PinOff className="text-muted-foreground" />
              <span>取消置顶</span>
            </>
          ) : (
            <>
              <Pin className="text-muted-foreground" />
              <span>置顶</span>
            </>
          )}
        </DropdownMenuItem>
        {onRename && (
          <DropdownMenuItem onSelect={onRename}>
            <Pencil className="text-muted-foreground" />
            <span>重命名</span>
          </DropdownMenuItem>
        )}
        {onRetry && (
          <DropdownMenuItem onSelect={onRetry}>
            <RotateCcw className="text-muted-foreground" />
            <span>用相同意图重试</span>
          </DropdownMenuItem>
        )}
        {onMoveToProject && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderOpen className="text-muted-foreground" />
              <span>移到项目</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              <DropdownMenuItem onSelect={() => onMoveToProject(null)}>
                <Check
                  className={cn(
                    'opacity-0',
                    menu.projectId == null && 'opacity-100',
                  )}
                />
                <span className="text-muted-foreground">无项目</span>
              </DropdownMenuItem>
              {(projects ?? []).length > 0 && <DropdownMenuSeparator />}
              {(projects ?? []).map((p) => {
                const active = menu.projectId === p.projectId;
                return (
                  <DropdownMenuItem
                    key={p.projectId}
                    onSelect={() => onMoveToProject(p.projectId)}
                  >
                    <Check
                      className={cn('opacity-0', active && 'opacity-100')}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  </DropdownMenuItem>
                );
              })}
              {onCreateProject && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onCreateProject}>
                    <FolderPlus className="text-muted-foreground" />
                    <span>新建项目</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuItem onSelect={onCopyIntent}>
          <Clipboard className="text-muted-foreground" />
          <span>复制任务文本</span>
        </DropdownMenuItem>
        {onDelete && (
          <DropdownMenuItem
            disabled={!menu.deletable}
            onSelect={onDelete}
            className={cn(
              menu.deletable &&
                'text-red-600 focus:bg-red-500/10 focus:text-red-600 dark:text-red-400 dark:focus:text-red-300',
            )}
          >
            <Trash2 className={menu.deletable ? '' : 'text-muted-foreground'} />
            <span>删除任务</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
  { icon: Clock, label: '定时任务', href: '/scheduled' },
  { icon: ListPlus, label: '批量任务', href: '/batch' },
  { icon: FolderOpen, label: '文件库', href: '/files' },
  { icon: Layers, label: '项目', href: '/projects' },
  // 收藏 was a top-level nav row but it duplicated what the sidebar
  // already shows: starred tasks bubble to the top of SidebarTasks
  // as the "收藏" group. The /starred route still exists for direct
  // links; it's just not a primary entry point anymore.
];

/**
 * Feature nav between the "+ 新任务" CTA and the task list. Phase 16
 * graduates 收藏 / 项目 / 专家技能 from "即将推出" to live routes —
 * those rows render as clickable nav links; the rest stay disabled
 * with the tooltip. Compact density (32px row).
 */
function FeatureNav(): JSX.Element {
  const navigate = useNavigate();
  // Read pathname directly so the active highlight updates on route
  // switch without forcing a re-render through props. The shrink-0
  // wrapper keeps this segment pinned below SidebarHeader while
  // SidebarContent (the task list) takes the remaining height.
  const pathname =
    typeof window !== 'undefined' ? window.location.pathname : '';
  return (
    <SidebarGroup className="shrink-0 border-b border-sidebar-border/60">
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
