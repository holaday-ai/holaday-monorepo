import { Bell, Calendar, Clock, Loader2, Repeat2, X } from 'lucide-react';
import * as React from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/toast';
import { pageActionError } from '@/lib/page-error-copy';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import {
  defaultScheduledAtLocalInput,
  formatRollForward,
} from '@/pages/scheduled-calendar/time-helpers';
import {
  buildScheduledCreatePayload,
  REMINDER_OPTIONS,
  REPEAT_OPTIONS,
  scheduledDialogHasDraftChanges,
  scheduledCreateButtonLabel,
  scheduledReminderSummary,
  scheduledRepeatSummary,
  type DialogRepeatType,
} from './scheduled-dialog-state';

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

export function ScheduledTaskDialog({
  open,
  onClose,
  onCreated,
  initialIntent,
}: Props): JSX.Element | null {
  const toast = useToast();
  const [intent, setIntent] = React.useState(initialIntent ?? '');
  const [repeatType, setRepeatType] = React.useState<DialogRepeatType>('daily');
  const [reminderValue, setReminderValue] = React.useState('off');
  const [description, setDescription] = React.useState('');
  const [rrule, setRrule] = React.useState('');
  // Default: tomorrow morning 9:00 local. The datetime-local input
  // expects "YYYY-MM-DDTHH:mm" in local tz — never include seconds.
  const [scheduledAt, setScheduledAt] = React.useState(() =>
    defaultScheduledAtLocalInput(),
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = React.useState(false);
  const intentRef = React.useRef<HTMLTextAreaElement>(null);
  const initialScheduledAtRef = React.useRef(scheduledAt);

  // Reset whenever the dialog re-opens so a stale draft from a prior
  // open doesn't bleed into the new context (especially when the
  // dialog is opened with a different initialIntent each time).
  React.useEffect(() => {
    if (!open) return;
    setIntent(initialIntent ?? '');
    setRepeatType('daily');
    setReminderValue('off');
    setDescription('');
    setRrule('');
    const nextScheduledAt = defaultScheduledAtLocalInput();
    initialScheduledAtRef.current = nextScheduledAt;
    setScheduledAt(nextScheduledAt);
    setSubmitting(false);
    setConfirmDiscardOpen(false);
    const id = requestAnimationFrame(() => intentRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, initialIntent]);

  const hasDraftChanges = React.useMemo(
    () =>
      scheduledDialogHasDraftChanges({
        initialIntent: initialIntent ?? '',
        initialScheduledAt: initialScheduledAtRef.current,
        intent,
        repeatType,
        reminderValue,
        description,
        rrule,
        scheduledAt,
      }),
    [description, initialIntent, intent, reminderValue, repeatType, rrule, scheduledAt],
  );

  const requestClose = React.useCallback(() => {
    if (submitting) return;
    if (hasDraftChanges) {
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  }, [hasDraftChanges, onClose, submitting]);

  // Esc closes when the dialog is open.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, requestClose]);

  if (!open) return null;

  const trimmedIntent = intent.trim();
  const customRuleMissing = repeatType === 'custom' && !rrule.trim();
  const canSubmit = Boolean(trimmedIntent && scheduledAt && !customRuleMissing && !submitting);

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    if (!trimmedIntent) {
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
      const payload = buildScheduledCreatePayload({
        intent: trimmedIntent,
        repeatType,
        scheduledAt: localDate,
        reminderValue,
        rrule,
        description,
      });
      const res = await trpc.scheduledTasks.create.mutate(payload);
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
      toast.show(pageActionError('创建失败', err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="新建定时任务"
        onClick={requestClose}
        className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-black/30 p-3 py-6 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4"
      >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl overflow-hidden rounded-[8px] border border-[#DCDDDD] bg-white text-[#1f1f1f] shadow-[0_18px_56px_rgba(15,23,42,0.14)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#EFEFEF] px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 text-[#EA1F59]" />
              新建定时任务
            </div>
            <div className="mt-1 text-xs text-[#595757]">
              {scheduledRepeatSummary(repeatType)} · {scheduledReminderSummary(reminderValue)}
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            aria-label="关闭"
            title="关闭"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-[#EFEFEF] hover:text-[#EA1F59]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[calc(100vh-8rem)] space-y-4 overflow-y-auto p-5">
          <div className="rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2.5 focus-within:border-[#EA1F59]/50 focus-within:ring-2 focus-within:ring-[#EA1F59]/10">
            <label className="block text-[11px] font-medium text-[#595757]">
              任务内容
            </label>
            <textarea
              ref={intentRef}
              value={intent}
              disabled={submitting}
              onChange={(e) => setIntent(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="例如：复盘昨天的电商日报，对比上周表现并给出优化策略"
              className="mt-1 w-full resize-y border-none bg-transparent p-0 text-sm font-medium text-[#1f1f1f] outline-none placeholder:text-[#ADADAD]"
            />
          </div>
          <div className="rounded-[8px] border border-[#EFEFEF] bg-[#FAFAFA] p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#595757]">
                <Calendar className="h-3.5 w-3.5 text-[#57479C]" />
                首次执行时间
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                disabled={submitting}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2 text-sm font-medium text-[#1f1f1f] focus-visible:border-[#EA1F59]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/10 sm:w-auto"
              />
            </div>
            <div className="mt-2 text-[11px] text-[#595757]">
              执行时间使用你当前时区，到点会自动新建任务并交给 HOLA DAY 执行。
            </div>
          </div>
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#595757]">
              <Repeat2 className="h-3.5 w-3.5 text-[#42C0EF]" />
              重复频率
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {REPEAT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={submitting}
                  onClick={() => setRepeatType(o.value)}
                  className={cn(
                    'rounded-[8px] border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    repeatType === o.value
                      ? 'border-[#EA1F59]/30 bg-[#EA1F59]/10 text-[#EA1F59]'
                      : 'border-[#EFEFEF] bg-white text-[#595757] hover:border-[#DCDDDD] hover:bg-[#EFEFEF] hover:text-[#1f1f1f]',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#595757]">
              <Bell className="h-3.5 w-3.5 text-[#FFC910]" />
              提醒
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              {REMINDER_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={submitting}
                  onClick={() => setReminderValue(o.value)}
                  className={cn(
                    'rounded-[8px] border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    reminderValue === o.value
                      ? 'border-[#EA1F59]/30 bg-[#EA1F59]/10 text-[#EA1F59]'
                      : 'border-[#EFEFEF] bg-white text-[#595757] hover:border-[#DCDDDD] hover:bg-[#EFEFEF] hover:text-[#1f1f1f]',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#595757]">
              备注
            </label>
            <textarea
              value={description}
              disabled={submitting}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="补充上下文、输出要求或接收人"
              className="w-full resize-y rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2 text-sm placeholder:text-[#ADADAD] focus-visible:border-[#EA1F59]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/10"
            />
          </div>
          {repeatType === 'custom' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-[#595757]">
                自定义重复规则
              </label>
              <textarea
                value={rrule}
                disabled={submitting}
                onChange={(e) => setRrule(e.target.value)}
                rows={2}
                maxLength={255}
                placeholder={'DTSTART:20260523T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'}
                className="w-full resize-y rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2 font-mono text-xs placeholder:text-[#ADADAD] focus-visible:border-[#EA1F59]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/10"
              />
              {customRuleMissing && (
                <div className="mt-1 text-[11px] text-[#EA1F59]">
                  填写 RRULE 后才能创建，或切回预设频率。
                </div>
              )}
            </div>
          )}
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[#EFEFEF] bg-white px-5 py-3">
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            className="rounded-[8px] px-3 py-1.5 text-sm text-[#595757] transition-colors hover:bg-[#EFEFEF] hover:text-[#EA1F59]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#EA1F59] px-3 py-1.5 text-sm font-medium text-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:bg-[#D91B51] disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {scheduledCreateButtonLabel(submitting)}
          </button>
        </footer>
      </div>
      </div>
      <ConfirmDialog
        open={confirmDiscardOpen}
        title="放弃这个定时任务？"
        description="关闭后当前填写的任务内容、时间、重复规则和备注都会丢失。"
        confirmLabel="放弃草稿"
        cancelLabel="继续编辑"
        destructive
        overlayClassName="z-[110]"
        onClose={() => setConfirmDiscardOpen(false)}
        onConfirm={() => {
          setConfirmDiscardOpen(false);
          onClose();
        }}
      />
    </>
  );
}
