import {
  ChevronLeft,
  ChevronRight,
  ListTree,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { TaskListItem } from '@/components/TaskListItem';
import { UserMenu } from '@/components/UserMenu';
import { cn } from '@/lib/utils';
import type { UiTask } from '@/types/task';
import { bucketByTime, isTaskDeletable } from '@/utils/time-buckets';

interface Props {
  tasks: UiTask[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onNewTask: () => void;
  onDeleteTask?(taskId: string): void | Promise<void>;
  onRetryTask?(intent: string): void | Promise<void>;
  onOpenSearch?(): void;
  userEmail: string | null;
  userDisplayName: string;
  userPlan: string;
  onLogout(): void;
  onOpenFeedback?(): void;
  /** Mobile drawer state — ignored at md+ breakpoints. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
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
  onRetryTask,
  onOpenSearch,
  userEmail,
  userDisplayName,
  userPlan,
  onLogout,
  onOpenFeedback,
  mobileOpen,
  onMobileClose,
}: Props): JSX.Element {
  const buckets = React.useMemo(() => bucketByTime(tasks), [tasks]);

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
    | { taskId: string; intent: string; x: number; y: number; deletable: boolean }
    | null
  >(null);

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
          desktopCollapsed ? 'md:w-16' : 'md:w-56',
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
            {...(onOpenFeedback ? { onOpenFeedback } : {})}
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

            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {buckets.map((bucket) => (
                <TaskGroup key={bucket.key} title={bucket.title}>
                  {bucket.tasks.map((t) => (
                    <TaskListItem
                      key={t.taskId}
                      task={t}
                      selected={t.taskId === selectedTaskId}
                      onSelect={(id) => {
                        onSelectTask(id);
                        onMobileClose?.();
                      }}
                      onContextMenu={(id, e) => {
                        e.preventDefault();
                        setMenu({
                          taskId: id,
                          intent: t.intent,
                          x: e.clientX,
                          y: e.clientY,
                          deletable: isTaskDeletable(t.status),
                        });
                      }}
                    />
                  ))}
                </TaskGroup>
              ))}
              {tasks.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  还没有任务，发一条试试看
                </div>
              )}
            </div>

            <footer className="border-t border-black/[0.06] px-2 py-2">
              <UserMenu
                displayName={userDisplayName}
                email={userEmail}
                plan={userPlan}
                onLogout={onLogout}
                {...(onOpenFeedback ? { onOpenFeedback } : {})}
              />
            </footer>
          </>
        )}
      </aside>

      {menu && (onDeleteTask || onRetryTask) && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[60] min-w-[160px] rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg animate-fade-in"
          style={{ top: menu.y, left: menu.x }}
        >
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
        </div>
      )}
    </>
  );
}

interface CollapsedRailProps {
  onNewTask: () => void;
  onExpand: () => void;
  onOpenSearch?: () => void;
  userDisplayName: string;
  userEmail: string | null;
  userPlan: string;
  onLogout: () => void;
  onOpenFeedback?: () => void;
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
  userDisplayName,
  userEmail,
  userPlan,
  onLogout,
  onOpenFeedback,
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
          {...(onOpenFeedback ? { onOpenFeedback } : {})}
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
      <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="mt-1 space-y-1">{children}</div>
    </section>
  );
}

function BrandMark(): JSX.Element {
  return (
    <span
      aria-hidden
      className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-pink-500 text-[12px] font-bold text-white"
    >
      H
    </span>
  );
}
