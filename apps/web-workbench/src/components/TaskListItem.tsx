import { Check, MoreHorizontal } from 'lucide-react';
import * as React from 'react';
import { awaitingUserCopy } from '@/lib/awaiting-user-copy';
import {
  taskDisplaySource,
  taskDisplayTitle,
} from '@/lib/task-display-copy';
import { deriveTaskProductState } from '@/lib/task-product-state';
import { cn } from '@/lib/utils';
import { type UiTask, isActive } from '@/types/task';

export { taskDisplaySource, taskDisplayTitle } from '@/lib/task-display-copy';

interface Props {
  task: UiTask;
  selected: boolean;
  liveSubStatus?: TaskLiveSubStatusEntry | null;
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

type TaskLiveSubStatus =
  | 'planning'
  | 'browsing'
  | 'extracting'
  | 'verifying'
  | 'generating'
  | 'generating_image';
type TaskLiveSubStatusEntry =
  | TaskLiveSubStatus
  | { subStatus: TaskLiveSubStatus; since: number };

const LIVE_SUB_STATUS_LABELS: Record<TaskLiveSubStatus, string> = {
  planning: '正在规划任务',
  browsing: '正在操作浏览器',
  extracting: '正在提取数据',
  verifying: '正在验证结果',
  generating: '正在生成回答',
  generating_image: '正在生成图片',
};

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
  liveSubStatus,
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
  const elapsedNow = useTaskListElapsedNow(active && Boolean(liveSubStatus));
  const elapsedLabel = active
    ? taskListElapsedLabel(liveSubStatus, elapsedNow)
    : null;
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
      : `${taskDisplaySource(task)}\n${taskListItemSubtitle(task, liveSubStatus, elapsedNow)}`;
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
        'group relative flex w-full items-center gap-2 rounded-[8px] border border-transparent px-2.5 py-0.5 text-left transition-colors',
        'hover:border-[#EA1F59]/14 hover:bg-[#EA1F59]/[0.035] dark:hover:border-[#EA1F59]/30 dark:hover:bg-[#EA1F59]/10',
        selected && !batchMode && 'border-[#EA1F59]/22 bg-white/70 shadow-[0_8px_22px_rgba(234,31,89,0.06)] dark:bg-white/[0.05]',
        batchMode && batchChecked && 'border-[#57479C]/22 bg-[#57479C]/10 dark:bg-[#57479C]/20',
        batchMode && batchDisabled && 'opacity-50',
        batchMode && !batchDisabled && 'cursor-pointer',
      )}
    >
      {selected && !batchMode && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-[2px] rounded-r bg-[#EA1F59]"
        />
      )}
      {batchMode && (
        <span
          aria-hidden
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
            batchChecked
              ? 'border-[#57479C] bg-[#57479C] text-white shadow-[0_2px_8px_rgba(87,71,156,0.14)]'
              : 'border-[#DCDDDD] bg-white/65 dark:border-white/15 dark:bg-transparent',
            batchDisabled && 'border-dashed',
          )}
        >
          {batchChecked && <Check className="h-3 w-3" strokeWidth={2.5} />}
        </span>
      )}
      <StatusDot status={task.status} />
      {renaming && onRenameCommit ? (
        <RenameInput
          initial={taskDisplaySource(task)}
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
          aria-pressed={selected && !batchMode ? true : undefined}
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center truncate bg-transparent text-left text-[13px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-[#EA1F59]/45',
            task.status === 'failed' ? 'text-[#ADADAD]' : 'text-[#595757] dark:text-foreground/85',
            selected && 'font-medium text-[#EA1F59] dark:text-[#EA1F59]',
          )}
        >
          {taskDisplayTitle(task)}
        </button>
      )}
      {!renaming && onContextMenu && (
        <>
          {elapsedLabel && (
            <span
              className="shrink-0 rounded-[5px] bg-[#42C0EF]/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[#268AAF] dark:bg-[#42C0EF]/15 dark:text-[#8EDAF2]"
              title={`任务仍在运行：${elapsedLabel}`}
            >
              {elapsedLabel}
            </span>
          )}
        <button
          type="button"
          aria-label="任务菜单"
          title="更多"
          onClick={(e) => {
          e.stopPropagation();
          onContextMenu(task.taskId, e);
        }}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[#ADADAD] opacity-100 transition-opacity hover:bg-white hover:text-[#EA1F59] focus-visible:opacity-100 dark:hover:bg-white/10 lg:opacity-0 lg:group-hover:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        </>
      )}
      {active && !renaming && (
        <span className="sr-only">进行中 · {taskListItemSubtitle(task, liveSubStatus, elapsedNow)}</span>
      )}
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
      className="min-w-0 flex-1 rounded border border-[#EA1F59]/40 bg-white px-1.5 py-0 text-[13px] leading-5 shadow-sm focus-visible:outline-none dark:bg-card"
    />
  );
}

function StatusDot({ status }: { status: UiTask['status'] }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/35',
        status === 'queued' && 'animate-pulse-dot bg-[#FFC910]',
        status === 'executing' && 'animate-pulse-dot bg-[#42C0EF]',
        // Awaiting-user + failed stand out — these are the rows the
        // user has to come back to. Everything else stays a muted 6px
        // grey dot so the sidebar reads as the workspace nav, not a
        // status board.
        status === 'awaiting_user' && 'h-2 w-2 bg-[#FFC910] ring-2 ring-[#FFC910]/35',
        status === 'paused' && 'bg-[#FFC910]/80',
        status === 'completed' && 'bg-muted-foreground/35',
        // Codex Pack A4 — partial_success uses the brand yellow to
        // signal "look again" without reading as destructive.
        status === 'partial_success' && 'h-2 w-2 bg-[#FFC910]',
        status === 'failed' && 'h-2 w-2 bg-[#EA1F59]',
        status === 'cancelled' && 'bg-muted-foreground/25',
      )}
      aria-hidden
    />
  );
}

export function taskListItemSubtitle(
  task: Pick<UiTask, 'awaitingKind' | 'queuePosition' | 'status' | 'tickCount'>,
  liveSubStatus?: TaskLiveSubStatusEntry | null,
  now = Date.now(),
): string {
  const productState = deriveTaskProductState({
    status: task.status,
    queuePosition: task.queuePosition ?? null,
    tickCount: task.tickCount,
    awaitingKind: task.awaitingKind ?? null,
    subStatus: liveSubStatus ? liveSubStatusValue(liveSubStatus) : null,
  });
  switch (productState.lifecycle) {
    case 'queued':
      return productState.queuePosition && productState.queuePosition > 1
        ? `排队中 · 第 ${productState.queuePosition} 位`
        : '排队中 · 等待空闲槽位';
    case 'running':
      if (liveSubStatus) {
        const subStatus = liveSubStatusValue(liveSubStatus);
        const elapsed = taskListElapsedLabel(liveSubStatus, now);
        return elapsed
          ? `${LIVE_SUB_STATUS_LABELS[subStatus]} · 已运行 ${elapsed}`
          : LIVE_SUB_STATUS_LABELS[subStatus];
      }
      return task.tickCount === 0 ? '正在启动…' : `执行中 · 第 ${task.tickCount} 步`;
    case 'waiting_user':
      // F3 — explicit awaiting-user copy. Previously this fell through
      // to the default branch and rendered `undefined` in the row's
      // tooltip / aria-label, both visually wrong and a screen-reader
      // hole.
      return awaitingUserCopy(
        productState.blocker === 'max_steps' ||
          productState.blocker === 'retries_exhausted'
          ? undefined
          : productState.blocker,
      ).toolbarLabel;
    case 'paused':
      return task.tickCount === 0 ? '已暂停' : `已暂停 · ${task.tickCount} 步`;
    case 'terminal':
      switch (productState.outcome) {
        case 'completed':
          return task.tickCount === 0 ? '已完成' : `已完成 · ${task.tickCount} 步`;
        case 'partial_success':
          return task.tickCount === 0
            ? '需复核'
            : `需复核 · ${task.tickCount} 步`;
        case 'failed':
          return task.tickCount === 0 ? '失败' : `失败 · ${task.tickCount} 步`;
        case 'cancelled':
          return task.tickCount === 0 ? '已取消' : `已取消 · ${task.tickCount} 步`;
        default:
          return '';
      }
    case 'unknown':
      return '未知状态';
    default:
      // Defence-in-depth: never let `undefined` reach the DOM if a
      // future status sneaks past TS narrowing.
      return '';
  }
}

function liveSubStatusValue(entry: TaskLiveSubStatusEntry): TaskLiveSubStatus {
  return typeof entry === 'string' ? entry : entry.subStatus;
}

export function taskListElapsedLabel(
  liveSubStatus: TaskLiveSubStatusEntry | null | undefined,
  now = Date.now(),
): string | null {
  if (!liveSubStatus || typeof liveSubStatus === 'string') return null;
  const elapsedSec = Math.max(0, Math.floor((now - liveSubStatus.since) / 1000));
  if (elapsedSec < 120) return null;
  const minutes = Math.max(2, Math.floor(elapsedSec / 60));
  return `${minutes}分+`;
}

function useTaskListElapsedNow(enabled: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [enabled]);
  return now;
}
