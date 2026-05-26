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

import { Bell, BellOff, Calendar, CheckCircle2, Clock, Loader2, Pause, Play, Trash2, XCircle } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  describeScheduledEventReminder,
  describeScheduledEventRepeat,
  scheduledEventCanRunNow,
  scheduledEventCanToggle,
  scheduledEventToggleLabel,
} from './event-detail-state';
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
const POPOVER_HEIGHT_EST = 460;

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

  // Esc + outside-click dismissal. mousedown fires BEFORE FullCalendar's
  // own click handlers (eventClick / dateClick), so a click on a
  // different cell or event closes this popover first; the parent's
  // handler then opens the new one. Listeners on `document` per the
  // popover spec.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && busy === null) onClose();
    };
    const onClickOutside = (e: MouseEvent) => {
      if (busy === null && !rootRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [busy, onClose]);

  const wrap = async (kind: 'toggle' | 'run', fn: () => Promise<void>) => {
    if (busy !== null) return;
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
  const canToggle = scheduledEventCanToggle(row.status);
  const canRunNow = scheduledEventCanRunNow(row.status);
  const toggleLabel = scheduledEventToggleLabel(row.status);
  const ToggleIcon = row.status === 'paused' || row.status === 'failed' ? Play : Pause;

  return (
    <div
      ref={rootRef}
      aria-busy={busy !== null}
      className={cn(
        'hd-popover-enter fixed z-[75] max-h-[calc(100vh-1rem)] overflow-y-auto border border-[#DCDDDD] bg-white',
        mobile && 'left-2 right-2 bottom-2 mx-auto',
      )}
      style={{
        ...(mobile ? {} : position),
        borderRadius: 8,
        boxShadow: '0 16px 48px rgba(15,23,42,0.12)',
        padding: 20,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {statusIcon}
            {statusLabel}
            {row.lastRunStatus === 'failed' && row.status === 'active' && (
              <span className="ml-1 rounded bg-[#EA1F59]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#EA1F59]">
                上次失败
              </span>
            )}
          </div>
          <p className="mt-2 break-words text-sm text-foreground">
            {row.intent}
          </p>
        </div>
      </div>

      {row.description && row.description.trim().length > 0 && (
        <div
          className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground"
          style={{
            padding: '8px 10px',
            background: '#EFEFEF',
            borderRadius: 8,
            lineHeight: 1.5,
          }}
        >
          {row.description}
        </div>
      )}

      <div className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />下次</span>
        <span className="text-foreground">{formatDateTime(row.nextRunAt)}</span>
        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />重复</span>
        <span className="text-foreground">{describeScheduledEventRepeat(row)}</span>
        <span className="flex items-center gap-1">
          {row.reminderMinutes == null ? (
            <BellOff className="h-3 w-3" />
          ) : (
            <Bell className="h-3 w-3" style={{ color: '#EA1F59' }} />
          )}
          提醒
        </span>
        <span className="text-foreground">
          {describeScheduledEventReminder(row.reminderMinutes ?? null)}
        </span>
        {row.lastRunAt && (
          <>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              上次
            </span>
            <span className="flex items-center gap-1.5 text-foreground">
              {row.lastRunStatus === 'success' ? (
                <span className="inline-flex items-center gap-1 text-[#42C0EF]">
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  <span>成功</span>
                </span>
              ) : row.lastRunStatus === 'failed' ? (
                <span className="inline-flex items-center gap-1 text-[#EA1F59]">
                  <XCircle className="h-3 w-3" aria-hidden />
                  <span>失败</span>
                </span>
              ) : null}
              <span className="text-muted-foreground">
                · {formatDateTime(row.lastRunAt)}
              </span>
            </span>
          </>
        )}
      </div>

      {row.lastError && row.lastRunStatus === 'failed' && (
        <div className="mt-3 rounded-[8px] border border-[#EA1F59]/20 bg-[#EA1F59]/[0.06] px-3 py-2 text-xs text-[#EA1F59]">
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
            className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
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
            className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
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
          disabled={busy !== null}
          onClick={() => {
            if (busy !== null) return;
            onDeleteRequest(row.scheduledTaskId);
          }}
          className="text-[#EA1F59] hover:bg-[#EA1F59]/10 hover:text-[#D91B51] disabled:cursor-wait disabled:opacity-55"
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
  active: <Clock className="h-3 w-3" style={{ color: '#EA1F59' }} />,
  paused: <Pause className="h-3 w-3 text-[#ADADAD]" />,
  running: <Loader2 className="h-3 w-3 animate-spin text-[#FFC910]" />,
  completed: <CheckCircle2 className="h-3 w-3 text-[#42C0EF]" />,
  failed: <XCircle className="h-3 w-3 text-[#EA1F59]" />,
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
