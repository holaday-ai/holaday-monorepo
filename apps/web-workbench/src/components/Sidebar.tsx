import { Plus, RotateCcw, Trash2, X } from 'lucide-react';
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
  userEmail: string | null;
  userDisplayName: string;
  userPlan: string;
  onLogout(): void;
  onOpenFeedback?(): void;
  /** Mobile drawer state — ignored at md+ breakpoints. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

/**
 * 240px fixed-width left rail. Header: brand mark + 新任务. Middle:
 * task list, grouped by 今天 / 本周 / 更早. Footer: user chip that
 * expands into a popover (设置 / 登出). Mobile flips this to a
 * fixed-overlay drawer with a dimmed backdrop.
 */
export function Sidebar({
  tasks,
  selectedTaskId,
  onSelectTask,
  onNewTask,
  onDeleteTask,
  onRetryTask,
  userEmail,
  userDisplayName,
  userPlan,
  onLogout,
  onOpenFeedback,
  mobileOpen,
  onMobileClose,
}: Props): JSX.Element {
  const buckets = React.useMemo(() => bucketByTime(tasks), [tasks]);
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
          'flex h-full w-72 max-w-[90vw] shrink-0 flex-col border-r border-border backdrop-blur-xl transition-transform duration-200 md:w-60',
          'md:static md:translate-x-0',
          'fixed inset-y-0 left-0 z-50',
          mobileOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full md:shadow-none',
        )}
        style={{ backgroundColor: 'hsl(var(--card) / 0.85)' }}
      >
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
          {mobileOpen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onMobileClose}
              aria-label="关闭"
              className="md:hidden"
            >
              <X className="h-4 w-4" />
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
      className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-pink-500 text-[11px] font-bold text-white"
    >
      H
    </span>
  );
}
