import { MoreHorizontal, Star } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { type UiTask, isActive } from '@/types/task';
import { summariseIntent } from '@/utils/summarise-intent';

interface Props {
  task: UiTask;
  selected: boolean;
  /**
   * Inline-edit mode: when this matches task.taskId the row replaces
   * its label with a text input seeded from the current display title.
   * Enter commits (calls onRenameCommit), Escape cancels.
   */
  renaming?: boolean;
  onSelect: (taskId: string) => void;
  onContextMenu?(taskId: string, event: React.MouseEvent | React.PointerEvent): void;
  onRenameCommit?(taskId: string, title: string): void;
  onRenameCancel?(): void;
  /**
   * O1 — batch-select mode. When `true`, the row swaps its onClick
   * from "select task" to "toggle batch checkbox" and renders a
   * leading checkbox. Caller (Sidebar) owns the selection set.
   */
  batchMode?: boolean;
  batchChecked?: boolean;
  onBatchToggle?(taskId: string): void;
  /**
   * Active / executing tasks can't be batch-deleted — backend will
   * reject. With this flag set, the row dims its checkbox and
   * swallows clicks so users can't accumulate undeletable rows in
   * the selection set and then hit a wall on confirm.
   */
  batchDisabled?: boolean;
  /**
   * Phase 16 — when present, the row renders a Star icon on the
   * trailing edge that toggles the task's starred flag. The icon is
   * filled when task.starred = true (visible always), or outline +
   * group-hover-only when not starred (so unfilled rows don't
   * advertise themselves).
   */
  onToggleStarred?(taskId: string): void;
}

/**
 * Resolves the display label for a task row. Priority:
 *   1. user-set task.title (raw, no summarisation — respect the choice)
 *   2. summariseIntent(task.intent) — rule-based cleanup
 *   3. raw task.intent — ultimate fallback so the row is never empty
 */
export function taskDisplayTitle(task: UiTask, maxLen = 24): string {
  if (task.title && task.title.trim().length > 0) {
    const t = task.title.trim();
    return t.length <= maxLen ? t : `${t.slice(0, maxLen - 1)}…`;
  }
  const summary = summariseIntent(task.intent, maxLen);
  return summary || task.intent;
}

/**
 * One row in the sidebar task list, Claude-style. Single-line intent
 * with a colour-coded status dot to its left; no subtitle row. A 2px
 * blue left-bar marks the selected row. Hover tints the background.
 */
export function TaskListItem({
  task,
  selected,
  renaming,
  onSelect,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
  batchMode,
  batchChecked,
  onBatchToggle,
  batchDisabled,
  onToggleStarred,
}: Props): JSX.Element {
  const active = isActive(task.status);
  return (
    <button
      type="button"
      onClick={() => {
        if (renaming) return;
        if (batchMode) {
          if (batchDisabled) return;
          onBatchToggle?.(task.taskId);
          return;
        }
        onSelect(task.taskId);
      }}
      onContextMenu={onContextMenu ? (e) => onContextMenu(task.taskId, e) : undefined}
      title={
        renaming
          ? undefined
          : batchMode && batchDisabled
            ? '进行中的任务无法批量删除'
            : `${task.intent}\n${subtitleFor(task)}`
      }
      className={cn(
        'group relative flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors',
        'hover:bg-foreground/5',
        selected && !batchMode && 'bg-foreground/[0.06]',
        batchMode && batchChecked && 'bg-blue-50/50 dark:bg-blue-500/10',
        batchMode && batchDisabled && 'opacity-50',
      )}
    >
      {selected && !batchMode && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-[2px] rounded-r bg-blue-500"
        />
      )}
      {batchMode && (
        <span
          aria-hidden
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
            batchChecked
              ? 'border-foreground bg-foreground text-background'
              : 'border-muted-foreground/40',
            batchDisabled && 'border-dashed',
          )}
        >
          {batchChecked && <span className="text-[10px] leading-none">✓</span>}
        </span>
      )}
      <StatusDot status={task.status} />
      {renaming && onRenameCommit ? (
        <RenameInput
          initial={task.title ?? summariseIntent(task.intent, 40) ?? task.intent}
          onCommit={(next) => onRenameCommit(task.taskId, next)}
          onCancel={onRenameCancel ?? (() => {})}
        />
      ) : (
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px] leading-5',
            task.status === 'failed' ? 'text-muted-foreground' : 'text-foreground',
            selected && 'font-medium',
          )}
        >
          {taskDisplayTitle(task)}
        </span>
      )}
      {!renaming && onToggleStarred && (
        <span
          role="button"
          aria-label={task.starred ? '取消收藏' : '收藏'}
          aria-pressed={Boolean(task.starred)}
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStarred(task.taskId);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onToggleStarred(task.taskId);
            }
          }}
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-opacity hover:bg-foreground/10 focus-visible:opacity-100',
            task.starred
              ? 'text-amber-500 opacity-100'
              : 'text-muted-foreground opacity-0 group-hover:opacity-100',
          )}
        >
          <Star
            className="h-3.5 w-3.5"
            fill={task.starred ? 'currentColor' : 'none'}
          />
        </span>
      )}
      {!renaming && onContextMenu && (
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
      {active && !renaming && <span className="sr-only">进行中 · {subtitleFor(task)}</span>}
    </button>
  );
}

/**
 * Auto-focused, auto-selected text input. Enter commits the trimmed
 * value, Escape cancels, blur commits (matches common patterns like
 * Finder / VS Code file rename).
 */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit(next: string): void;
  onCancel(): void;
}): JSX.Element {
  const [value, setValue] = React.useState(initial);
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      maxLength={255}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onCommit(value)}
      className="min-w-0 flex-1 rounded border border-blue-500/40 bg-background px-1.5 py-0 text-[13px] leading-5 shadow-sm focus-visible:outline-none"
    />
  );
}

function StatusDot({ status }: { status: UiTask['status'] }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        // Phase 24 RC follow-up — queued is a slow-pulse amber so the
        // user can distinguish "waiting for a slot" from "actively
        // executing" (fast blue pulse).
        status === 'queued' && 'animate-pulse-dot bg-amber-400',
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
  if (task.queuePosition && task.queuePosition > 1 && task.tickCount === 0) {
    return `排队中 · 第 ${task.queuePosition} 位`;
  }
  switch (task.status) {
    case 'queued':
      return '排队中 · 等待空闲槽位';
    case 'executing':
      return task.tickCount === 0 ? '正在启动…' : `执行中 · 第 ${task.tickCount} 步`;
    case 'paused':
      return task.tickCount === 0 ? '已暂停' : `已暂停 · ${task.tickCount} 步`;
    case 'completed':
      return task.tickCount === 0 ? '已完成' : `已完成 · ${task.tickCount} 步`;
    case 'failed':
      return task.tickCount === 0 ? '失败' : `失败 · ${task.tickCount} 步`;
    case 'cancelled':
      return task.tickCount === 0 ? '已取消' : `已取消 · ${task.tickCount} 步`;
  }
}
