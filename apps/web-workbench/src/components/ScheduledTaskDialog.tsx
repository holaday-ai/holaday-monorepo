import { Calendar, Clock, Loader2, X } from 'lucide-react';
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import {
  defaultScheduledAtLocalInput,
  formatRollForward,
} from '@/pages/scheduled-calendar/time-helpers';

/**
 * Phase 5a — create-schedule modal. Reachable from:
 *   1. ScheduledPage's "新建定时任务" button (intent unset → user types)
 *   2. TerminalSummary's "设为定时" link (intent pre-filled with the
 *      finished task's intent so the user can re-run on a cadence)
 *
 * Form layout: intent textarea + repeat type select + datetime picker.
 * Server stores UTC; the picker is `datetime-local` so the user picks
 * in their local tz, and we convert before sending.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Pre-fill the intent field (e.g. from a finished task's intent). */
  initialIntent?: string;
}

const REPEAT_OPTIONS: ReadonlyArray<{ value: 'once' | 'daily' | 'weekly' | 'monthly'; label: string }> = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'once', label: '只运行一次' },
];

const REMINDER_OPTIONS: ReadonlyArray<{ value: string; minutes: number | null; label: string }> = [
  { value: 'off', minutes: null, label: '不提醒' },
  { value: '0', minutes: 0, label: '执行时' },
  { value: '5', minutes: 5, label: '5 分钟前' },
  { value: '15', minutes: 15, label: '15 分钟前' },
  { value: '30', minutes: 30, label: '30 分钟前' },
  { value: '60', minutes: 60, label: '1 小时前' },
];

export function ScheduledTaskDialog({
  open,
  onClose,
  onCreated,
  initialIntent,
}: Props): JSX.Element | null {
  const toast = useToast();
  const [intent, setIntent] = React.useState(initialIntent ?? '');
  const [repeatType, setRepeatType] =
    React.useState<'once' | 'daily' | 'weekly' | 'monthly'>('daily');
  const [reminderValue, setReminderValue] = React.useState('off');
  // Default: tomorrow morning 9:00 local. The datetime-local input
  // expects "YYYY-MM-DDTHH:mm" in local tz — never include seconds.
  const [scheduledAt, setScheduledAt] = React.useState(() =>
    defaultScheduledAtLocalInput(),
  );
  const [submitting, setSubmitting] = React.useState(false);

  // Reset whenever the dialog re-opens so a stale draft from a prior
  // open doesn't bleed into the new context (especially when the
  // dialog is opened with a different initialIntent each time).
  React.useEffect(() => {
    if (!open) return;
    setIntent(initialIntent ?? '');
    setRepeatType('daily');
    setReminderValue('off');
    setScheduledAt(defaultScheduledAtLocalInput());
  }, [open, initialIntent]);

  // Esc closes when the dialog is open.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    const trimmed = intent.trim();
    if (!trimmed) {
      toast.show('请填写任务内容', 'error');
      return;
    }
    if (!scheduledAt) {
      toast.show('请选择执行时间', 'error');
      return;
    }
    // datetime-local emits a string without timezone — interpret as
    // local tz, convert to ISO 8601 UTC for the server.
    const localDate = new Date(scheduledAt);
    if (Number.isNaN(localDate.getTime())) {
      toast.show('时间格式无效', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const reminderMinutes =
        REMINDER_OPTIONS.find((o) => o.value === reminderValue)?.minutes ?? null;
      const res = await trpc.scheduledTasks.create.mutate({
        intent: trimmed,
        repeatType,
        scheduledAt: localDate.toISOString(),
        reminderMinutes,
      });
      if (res.adjusted) {
        toast.show(
          `定时任务已创建，首次执行时间调整为 ${formatRollForward(new Date(res.nextRunAt))}`,
          'info',
        );
      } else {
        toast.show('定时任务已创建');
      }
      onCreated();
    } catch (err) {
      toast.show(
        err instanceof Error ? err.message : '创建失败',
        'error',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 text-primary" />
            新建定时任务
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/80">
              任务内容
            </label>
            <textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="例如：复盘昨天的电商日报，对比上周表现并给出优化策略"
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/80">
                重复频率
              </label>
              <select
                value={repeatType}
                onChange={(e) =>
                  setRepeatType(e.target.value as 'once' | 'daily' | 'weekly' | 'monthly')
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {REPEAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/80">
                <Calendar className="mr-1 inline-block h-3 w-3" />
                首次执行
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/80">
                提醒
              </label>
              <select
                value={reminderValue}
                onChange={(e) => setReminderValue(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {REMINDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            执行时间使用你当前时区。每次到时间会自动新建一个任务并交给 agent 执行。
          </p>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            创建
          </button>
        </footer>
      </div>
    </div>
  );
}
