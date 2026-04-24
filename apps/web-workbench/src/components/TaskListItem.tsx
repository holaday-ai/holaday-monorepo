import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type UiTask, isActive } from '@/types/task';
import { summariseIntent } from '@/utils/summarise-intent';

interface Props {
  task: UiTask;
  selected: boolean;
  onSelect: (taskId: string) => void;
  onContextMenu?(taskId: string, event: React.MouseEvent | React.PointerEvent): void;
}

/**
 * One row in the sidebar task list, Claude-style. Single-line intent
 * with a colour-coded status dot to its left; no subtitle row. A 2px
 * blue left-bar marks the selected row. Hover tints the background.
 */
export function TaskListItem({ task, selected, onSelect, onContextMenu }: Props): JSX.Element {
  const active = isActive(task.status);
  return (
    <button
      type="button"
      onClick={() => onSelect(task.taskId)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(task.taskId, e) : undefined}
      title={`${task.intent}\n${subtitleFor(task)}`}
      className={cn(
        'group relative flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors',
        'hover:bg-foreground/5',
        selected && 'bg-foreground/[0.06]',
      )}
    >
      {/* 2px left indicator bar for the selected row — Claude's
       *  selection affordance. Uses absolute positioning so the row
       *  content flow stays consistent with unselected rows. */}
      {selected && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-[2px] rounded-r bg-blue-500"
        />
      )}
      <StatusDot status={task.status} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px] leading-5',
          task.status === 'failed' ? 'text-muted-foreground' : 'text-foreground',
          selected && 'font-medium',
        )}
      >
        {summariseIntent(task.intent, 24)}
      </span>
      {/* Hover 3-dot menu — discoverable affordance for users who
       *  don't know about right-click. Opens the same context menu
       *  as right-click would. Hidden at rest (opacity-0), fades in
       *  on row hover; focus-visible shows it too for keyboard nav. */}
      {onContextMenu && (
        <span
          role="button"
          aria-label="任务菜单"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(task.taskId, e);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu(task.taskId, e as unknown as React.MouseEvent);
            }
          }}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </span>
      )}
      {active && <span className="sr-only">进行中 · {subtitleFor(task)}</span>}
    </button>
  );
}

function StatusDot({ status }: { status: UiTask['status'] }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        status === 'executing' && 'animate-pulse-dot bg-blue-500',
        status === 'paused' && 'bg-amber-500',
        // Completed: hollow grey dot — done is neutral, not
        // celebrated. Matches Claude's sidebar where completed tasks
        // fade into the background.
        status === 'completed' && 'border border-muted-foreground/40 bg-transparent',
        status === 'failed' && 'bg-red-500',
        status === 'cancelled' && 'bg-muted-foreground/30',
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
