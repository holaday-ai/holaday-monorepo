import { cn } from '@/lib/utils';
import { type UiTask, isActive } from '@/types/task';

interface Props {
  task: UiTask;
  selected: boolean;
  onSelect: (taskId: string) => void;
  onContextMenu?(taskId: string, event: React.MouseEvent): void;
}

/**
 * One row in the sidebar task list. Status is signalled by a small
 * colour dot on the left (blue=active, emerald=completed, red=failed,
 * grey=cancelled) — the long status text is pushed to the subtitle so
 * the intent stays legible.
 */
export function TaskListItem({ task, selected, onSelect, onContextMenu }: Props): JSX.Element {
  const active = isActive(task.status);
  return (
    <button
      type="button"
      onClick={() => onSelect(task.taskId)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(task.taskId, e) : undefined}
      className={cn(
        'group relative flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
        'hover:bg-foreground/5',
        selected && 'bg-accent shadow-sm',
      )}
    >
      <StatusDot status={task.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{task.intent}</div>
        <div
          className={cn(
            'mt-0.5 truncate text-xs',
            task.status === 'completed' && 'text-blue-600',
            task.status === 'failed' && 'text-red-500',
            (task.status === 'executing' || task.status === 'paused') && 'text-muted-foreground',
            task.status === 'cancelled' && 'text-muted-foreground',
          )}
        >
          {subtitleFor(task)}
        </div>
      </div>
      {active && <span className="sr-only">进行中</span>}
    </button>
  );
}

function StatusDot({ status }: { status: UiTask['status'] }): JSX.Element {
  return (
    <span
      className={cn(
        'mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full',
        status === 'executing' && 'animate-pulse-dot bg-blue-500',
        status === 'paused' && 'bg-amber-500',
        status === 'completed' && 'bg-blue-500',
        status === 'failed' && 'bg-red-500',
        status === 'cancelled' && 'bg-muted-foreground/40',
      )}
      aria-hidden
    />
  );
}

function subtitleFor(task: UiTask): string {
  // Queued tasks report a per-user FIFO slot until the first tick
  // arrives; once we observe real progress (tickCount > 0) we fall
  // through to the normal status line.
  if (task.queuePosition && task.queuePosition > 1 && task.tickCount === 0) {
    return `排队中 · 第 ${task.queuePosition} 位`;
  }
  switch (task.status) {
    case 'executing':
      return task.tickCount === 0 ? '正在启动…' : `执行中 · 第 ${task.tickCount} 步`;
    case 'paused':
      return task.tickCount === 0 ? '已暂停' : `已暂停 · ${task.tickCount} 步`;
    case 'completed':
      // Legacy rows seeded before we persisted per-tick step rows show
      // tickCount=0; rendering "已完成 · 0 步" looks broken. Summarise
      // with just "已完成" instead when we have no step data.
      return task.tickCount === 0 ? '已完成' : `已完成 · ${task.tickCount} 步`;
    case 'failed':
      return task.tickCount === 0 ? '失败' : `失败 · ${task.tickCount} 步`;
    case 'cancelled':
      return task.tickCount === 0 ? '已取消' : `已取消 · ${task.tickCount} 步`;
  }
}
