import { Check, MoreHorizontal } from 'lucide-react';
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
      /* BOSS bug fix — in batch mode the entire row is the click
         target (was: only the inner title button, leaving the
         leading checkbox `<span>` dead because it sits OUTSIDE
         the button). Inner button still calls handleRowClick but
         stopPropagation so the toggle doesn't fire twice. */
      onClick={batchMode ? handleRowClick : undefined}
      role={batchMode ? 'button' : undefined}
      title={rowTitle}
      className={cn(
        'group relative flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors',
        'hover:bg-foreground/5',
        selected && !batchMode && 'bg-foreground/[0.06]',
        batchMode && batchChecked && 'bg-primary/10 dark:bg-primary/15',
        batchMode && batchDisabled && 'opacity-50',
        batchMode && !batchDisabled && 'cursor-pointer',
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
          {batchChecked && <Check className="h-3 w-3" strokeWidth={2.5} />}
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
          onClick={(e) => {
            handleRowClick(e);
            // BOSS bug fix — in batch mode the parent `<div>` ALSO
            // has onClick={handleRowClick} so the checkbox span (a
            // sibling, outside this button) becomes clickable.
            // Stop propagation here so a click on the title doesn't
            // also bubble to the parent and double-toggle.
            if (batchMode) e.stopPropagation();
          }}
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
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/35',
        status === 'queued' && 'animate-pulse-dot bg-amber-400',
        status === 'executing' && 'animate-pulse-dot bg-primary',
        // Awaiting-user + failed stand out — these are the rows the
        // user has to come back to. Everything else stays a muted 6px
        // grey dot so the sidebar reads as the workspace nav, not a
        // status board.
        status === 'awaiting_user' && 'h-2 w-2 bg-amber-500 ring-2 ring-amber-300/40',
        status === 'paused' && 'bg-amber-500/80',
        status === 'completed' && 'bg-muted-foreground/35',
        // Codex Pack A4 — partial_success uses amber to signal "look
        // again" without screaming red. Slightly smaller than failed.
        status === 'partial_success' && 'h-2 w-2 bg-amber-400',
        status === 'failed' && 'h-2 w-2 bg-red-500',
        status === 'cancelled' && 'bg-muted-foreground/25',
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
    case 'partial_success':
      // Codex Pack A4 — soft-failure subtitle. Sidebar row reads as
      // terminal-but-warning; the result panel renders the yellow
      // banner above the answer.
      return task.tickCount === 0 ? '结果可能不完整' : `结果可能不完整 · ${task.tickCount} 步`;
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
