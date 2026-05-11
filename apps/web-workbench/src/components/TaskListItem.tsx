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
 *
 * Root is a non-interactive `<div>` so the star + menu can be real
 * `<button>` elements without a nested-button DOM warning. The label
 * area is the click target — a transparent, full-width `<button>`
 * sized over the row's content. Star + menu sit above it (z-10) and
 * stop propagation, so clicking them never accidentally selects the
 * task.
 *
 * Touch parity: star + menu render at full opacity on viewports
 * narrower than `lg` (the breakpoint our sidebar collapses to a
 * sheet at). On desktop they keep the existing hover-reveal
 * behaviour so the row stays clean at rest.
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
  const handleRowClick = (
    e: React.MouseEvent | React.KeyboardEvent,
  ): void => {
    if (renaming) return;
    if (batchMode) {
      if (batchDisabled) return;
      onBatchToggle?.(task.taskId);
      return;
    }
    void e;
    onSelect(task.taskId);
  };
  const rowTitle = renaming
    ? undefined
    : batchMode && batchDisabled
      ? '进行中的任务无法批量删除'
      : `${task.intent}\n${subtitleFor(task)}`;
  return (
    <div
      onContextMenu={
        onContextMenu ? (e) => onContextMenu(task.taskId, e) : undefined
      }
      title={rowTitle}
      className={cn(
        'group relative flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors',
        'hover:bg-foreground/5',
        selected && !batchMode && 'bg-foreground/[0.06]',
        batchMode && batchChecked && 'bg-primary/10 dark:bg-primary/15',
        batchMode && batchDisabled && 'opacity-50',
      )}
    >
      {selected && !batchMode && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-[2px] rounded-r bg-primary"
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
        <button
          type="button"
          onClick={handleRowClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleRowClick(e);
            }
          }}
          aria-pressed={selected && !batchMode ? true : undefined}
          className={cn(
            'min-w-0 flex-1 truncate bg-transparent text-left text-[13px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring',
            task.status === 'failed' ? 'text-muted-foreground' : 'text-foreground',
            selected && 'font-medium',
          )}
        >
          {taskDisplayTitle(task)}
        </button>
      )}
      {!renaming && onToggleStarred && (
        <button
          type="button"
          aria-label={task.starred ? '取消收藏' : '收藏'}
          aria-pressed={Boolean(task.starred)}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStarred(task.taskId);
          }}
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-opacity hover:bg-foreground/10 focus-visible:opacity-100',
            task.starred
              ? 'text-amber-500 opacity-100'
              : 'text-muted-foreground opacity-100 lg:opacity-0 lg:group-hover:opacity-100',
          )}
        >
          <Star
            className="h-3.5 w-3.5"
            fill={task.starred ? 'currentColor' : 'none'}
          />
        </button>
      )}
      {!renaming && onContextMenu && (
        <button
          type="button"
          aria-label="任务菜单"
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(task.taskId, e);
          }}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-100 transition-opacity hover:bg-foreground/10 focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      )}
      {active && !renaming && <span className="sr-only">进行中 · {subtitleFor(task)}</span>}
    </div>
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
        // Phase 4 R2 4c — composing-Enter guard. Without it the IME
        // commit on Enter would also commit the rename, truncating
        // multi-char Chinese / Japanese input mid-stream.
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onCommit(value)}
      className="min-w-0 flex-1 rounded border border-primary/40 bg-background px-1.5 py-0 text-[13px] leading-5 shadow-sm focus-visible:outline-none"
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
        status === 'executing' && 'animate-pulse-dot bg-primary',
        // Awaiting-user gets a non-pulsing solid amber so the row
        // reads as "stopped, waiting on you" — distinct from queued
        // (pulsing amber: waiting on the system) and paused (also
        // amber but no incoming question). The user can scan the
        // sidebar and immediately spot which tasks need action.
        status === 'awaiting_user' && 'bg-amber-500 ring-2 ring-amber-300/50',
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
    case 'awaiting_user':
      // F3 — explicit awaiting-user copy. Previously this fell through
      // to the default branch and rendered `undefined` in the row's
      // tooltip / aria-label, both visually wrong and a screen-reader
      // hole.
      return '等待你回复';
    case 'paused':
      return task.tickCount === 0 ? '已暂停' : `已暂停 · ${task.tickCount} 步`;
    case 'completed':
      return task.tickCount === 0 ? '已完成' : `已完成 · ${task.tickCount} 步`;
    case 'failed':
      return task.tickCount === 0 ? '失败' : `失败 · ${task.tickCount} 步`;
    case 'cancelled':
      return task.tickCount === 0 ? '已取消' : `已取消 · ${task.tickCount} 步`;
    default:
      // Defence-in-depth: never let `undefined` reach the DOM if a
      // future status sneaks past TS narrowing.
      return '';
  }
}
