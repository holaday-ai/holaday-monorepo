/**
 * Phase 26A — event detail popover.
 *
 * Opened on calendar event click. Shows full intent, next/last run
 * times, status, repeat rule, last error (when failed), and action
 * buttons: 编辑 / 暂停-继续 / 立即执行一次 / 删除.
 *
 * Edit currently routes through the full ScheduledTaskDialog (the
 * parent passes onEdit which opens the modal pre-filled). Quick
 * edits would need an inline form; deferred to Phase 26A polish
 * round once the popover is in real use.
 */

import { Calendar, CheckCircle2, Clock, Loader2, Pause, Play, Trash2, XCircle } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ScheduledTaskRow } from './event-mapping';

interface Props {
  anchor: { x: number; y: number };
  row: ScheduledTaskRow;
  mobile: boolean;
  onClose(): void;
  onToggle(scheduledTaskId: string): Promise<void>;
  onRunNow(scheduledTaskId: string): Promise<void>;
  onDeleteRequest(scheduledTaskId: string): void;
}

const POPOVER_WIDTH = 360;
const POPOVER_HEIGHT_EST = 320;

export function EventDetailPopover({
  anchor,
  row,
  mobile,
  onClose,
  onToggle,
  onRunNow,
  onDeleteRequest,
}: Props): JSX.Element {
  const [busy, setBusy] = React.useState<'toggle' | 'run' | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClickOutside = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [onClose]);

  const wrap = async (kind: 'toggle' | 'run', fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const position = computePosition(anchor, mobile);
  const statusLabel = STATUS_LABEL[row.status] ?? row.status;
  const statusIcon = STATUS_ICON[row.status];
  const canToggle = row.status === 'active' || row.status === 'paused' || row.status === 'failed';
  const canRunNow = row.status === 'active' || row.status === 'paused' || row.status === 'failed';
  const toggleLabel =
    row.status === 'paused' ? '恢复' : row.status === 'failed' ? '重新启用' : '暂停';
  const ToggleIcon = row.status === 'paused' || row.status === 'failed' ? Play : Pause;

  return (
    <div
      ref={rootRef}
      className={cn(
        'hd-popover-enter fixed z-50 rounded-lg border border-border bg-popover p-4 shadow-2xl',
        mobile && 'left-2 right-2 bottom-2 mx-auto',
      )}
      style={mobile ? undefined : position}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {statusIcon}
            {statusLabel}
            {row.lastRunStatus === 'failed' && row.status === 'active' && (
              <span className="ml-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
                上次失败
              </span>
            )}
          </div>
          <p className="mt-2 break-words text-sm text-foreground">
            {row.intent}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />下次</span>
        <span className="text-foreground">{formatDateTime(row.nextRunAt)}</span>
        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />重复</span>
        <span className="text-foreground">{describeRepeat(row)}</span>
        {row.lastRunAt && (
          <>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />上次</span>
            <span className="text-foreground">{formatDateTime(row.lastRunAt)}</span>
          </>
        )}
      </div>

      {row.lastError && row.lastRunStatus === 'failed' && (
        <div className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <div className="mb-0.5 font-semibold">上次错误</div>
          <div className="break-words font-mono text-[11px]">{row.lastError}</div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {canToggle && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void wrap('toggle', async () => {
                await onToggle(row.scheduledTaskId);
              })
            }
          >
            {busy === 'toggle' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ToggleIcon className="mr-1 h-3 w-3" />}
            {toggleLabel}
          </Button>
        )}
        {canRunNow && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void wrap('run', async () => {
                await onRunNow(row.scheduledTaskId);
              })
            }
          >
            {busy === 'run' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
            立即执行一次
          </Button>
        )}
        <div className="grow" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onDeleteRequest(row.scheduledTaskId)}
          className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
        >
          <Trash2 className="mr-1 h-3 w-3" />
          删除
        </Button>
      </div>
    </div>
  );
}

function computePosition(
  anchor: { x: number; y: number },
  mobile: boolean,
): React.CSSProperties {
  if (mobile) return {};
  const margin = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.x + 8;
  let top = anchor.y + 8;
  if (left + POPOVER_WIDTH + margin > vw) {
    left = Math.max(margin, anchor.x - POPOVER_WIDTH - 8);
  }
  if (top + POPOVER_HEIGHT_EST + margin > vh) {
    top = Math.max(margin, anchor.y - POPOVER_HEIGHT_EST - 8);
  }
  return { left, top, width: POPOVER_WIDTH };
}

const STATUS_LABEL: Record<ScheduledTaskRow['status'], string> = {
  active: '已启用',
  paused: '已暂停',
  running: '执行中',
  completed: '已完成',
  failed: '已失败',
};

const STATUS_ICON: Record<ScheduledTaskRow['status'], React.ReactNode> = {
  active: <Clock className="h-3 w-3" style={{ color: '#E50B6B' }} />,
  paused: <Pause className="h-3 w-3 text-slate-500" />,
  running: <Loader2 className="h-3 w-3 animate-spin text-amber-500" />,
  completed: <CheckCircle2 className="h-3 w-3 text-emerald-500" />,
  failed: <XCircle className="h-3 w-3 text-red-500" />,
};

function formatDateTime(d: Date | string | null): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describeRepeat(row: ScheduledTaskRow): string {
  if (row.rrule && row.rrule.trim().length > 0) {
    return `自定义：${row.rrule.length > 40 ? `${row.rrule.slice(0, 40)}…` : row.rrule}`;
  }
  switch (row.repeatType) {
    case 'once':
      return '只运行一次';
    case 'daily':
      return '每天';
    case 'weekly':
      return '每周';
    case 'monthly':
      return '每月';
    default:
      return row.repeatType;
  }
}
