import { cn } from '@/lib/utils';
import { type UiTask, isActive } from '@/types/task';

interface Props {
  task: UiTask;
  selected: boolean;
  onSelect: (taskId: string) => void;
}

/**
 * One row in the sidebar task list. Active tasks (executing / paused)
 * get a blue left border and a tick counter subtitle; terminal tasks
 * render the status label in a muted tone.
 */
export function TaskListItem({ task, selected, onSelect }: Props): JSX.Element {
  const active = isActive(task.status);
  return (
    <button
      type="button"
      onClick={() => onSelect(task.taskId)}
      className={cn(
        'group relative w-full rounded-md px-3 py-2 text-left transition-colors',
        'hover:bg-white/60',
        selected && 'bg-white shadow-sm',
        active && 'border-l-2 border-l-blue-500 pl-[10px]',
      )}
    >
      <div className="truncate text-sm font-medium text-foreground">{task.intent}</div>
      <div
        className={cn(
          'mt-0.5 truncate text-xs',
          task.status === 'completed' && 'text-emerald-600',
          task.status === 'failed' && 'text-red-500',
          (task.status === 'executing' || task.status === 'paused') && 'text-muted-foreground',
        )}
      >
        {subtitleFor(task)}
      </div>
    </button>
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
      return task.tickCount === 0 ? '准备中…' : `执行中 · 第 ${task.tickCount} 步`;
    case 'paused':
      return `已暂停 · ${task.tickCount} 步`;
    case 'completed':
      return `已完成 · ${task.tickCount} 步`;
    case 'failed':
      return `失败 · ${task.tickCount} 步`;
    case 'cancelled':
      return `已取消 · ${task.tickCount} 步`;
  }
}
