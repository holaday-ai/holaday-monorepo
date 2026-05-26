/**
 * Phase 26A — quick-create popover.
 *
 * Triggered by clicking a date cell in the calendar. Minimal fields
 * for the fast path: intent + time + repeat preset. Press Enter in
 * the intent input to submit. An "高级" expander reveals an rrule
 * textarea for power users.
 *
 * Anchoring: takes a viewport (clientX, clientY) and positions the
 * popover near that point, flipping to the left/top when the anchor
 * is close to the viewport edge. On mobile, swaps to a bottom-sheet
 * layout (centred horizontally, anchored to the bottom).
 *
 * Dismissal: Esc, click outside, or pressing Cancel.
 */

import { Loader2, Plus } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  quickCreateCanSubmit,
  quickCreateSubmitLabel,
  quickCreateValidationMessage,
  type QuickCreateRepeatType,
} from './quick-create-state';

const REPEAT_PRESETS: ReadonlyArray<{
  value: QuickCreateRepeatType;
  label: string;
}> = [
  { value: 'once', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'custom', label: '自定义' },
];

/**
 * Phase 26B follow-up — reminder lead-time presets. `null` = "不提醒"
 * (default), 0 = at fire time, positive = minutes before. Cap at
 * 60 minutes for the popover; the full edit modal can offer more
 * granular options later.
 */
const REMINDER_PRESETS: ReadonlyArray<{
  value: number | null;
  label: string;
}> = [
  { value: null, label: '不提醒' },
  { value: 0, label: '执行时' },
  { value: 5, label: '5分钟前' },
  { value: 15, label: '15分钟前' },
  { value: 30, label: '30分钟前' },
  { value: 60, label: '1小时前' },
];

interface Props {
  anchor: { x: number; y: number };
  date: Date;
  mobile: boolean;
  onClose(): void;
  onCreate(input: {
    intent: string;
    scheduledAt: Date;
    repeatType: 'once' | 'daily' | 'weekly' | 'monthly';
    rrule?: string;
    description?: string;
    reminderMinutes?: number | null;
  }): Promise<void>;
}

const POPOVER_WIDTH = 360;
const POPOVER_HEIGHT_EST = 460;

export function QuickCreatePopover({
  anchor,
  date,
  mobile,
  onClose,
  onCreate,
}: Props): JSX.Element {
  const [intent, setIntent] = React.useState('');
  const [timeStr, setTimeStr] = React.useState(() => formatLocalTime(date));
  const [repeatType, setRepeatType] = React.useState<QuickCreateRepeatType>('once');
  const [rrule, setRrule] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [showDescription, setShowDescription] = React.useState(false);
  const [reminderMinutes, setReminderMinutes] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const intentRef = React.useRef<HTMLInputElement | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    intentRef.current?.focus();
  }, []);

  // Esc + outside-click dismissal. The mousedown listener fires
  // BEFORE the click handler that FullCalendar binds for dateClick,
  // so when the user clicks another date while this popover is open,
  // we close first; the parent's dateClick handler then opens the
  // new popover. Listeners go on `document` (not `window`) to match
  // the popover spec literally + match where most outside-click
  // libraries hook in.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    const onClickOutside = (e: MouseEvent) => {
      if (!submitting && !rootRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [onClose, submitting]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || submitting) return;
    const validationMessage = quickCreateValidationMessage({ repeatType, rrule });
    if (validationMessage) {
      setShowAdvanced(true);
      setSubmitError(validationMessage);
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const scheduledAt = combineDateAndTime(date, timeStr);
      const finalRepeatType =
        repeatType === 'custom' ? 'once' : repeatType;
      const trimmedDescription = description.trim();
      await onCreate({
        intent: intent.trim(),
        scheduledAt,
        repeatType: finalRepeatType,
        ...(repeatType === 'custom' && rrule.trim() ? { rrule: rrule.trim() } : {}),
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
        // Always pass the reminder field so an explicit "不提醒"
        // (null) survives the round-trip.
        reminderMinutes,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRepeatSelect = (value: QuickCreateRepeatType) => {
    setRepeatType(value);
    setSubmitError(null);
    if (value === 'custom') setShowAdvanced(true);
  };

  const position = computePosition(anchor, mobile);
  const canCreate = quickCreateCanSubmit({
    intent,
    repeatType,
    rrule,
    submitting,
  });

  return (
    <div
      ref={rootRef}
      aria-busy={submitting}
      className={cn(
        'hd-popover-enter hd-quick-create fixed z-[85] max-h-[calc(100vh-1rem)] overflow-y-auto border border-[#DCDDDD] bg-white',
        mobile && 'left-2 right-2 bottom-2 mx-auto',
      )}
      style={{
        ...(mobile ? {} : position),
        borderRadius: 8,
        boxShadow: '0 16px 48px rgba(15,23,42,0.12)',
        padding: 20,
      }}
    >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="text-xs font-medium text-muted-foreground">
          {formatLocalDate(date)}
        </div>
        <input
          ref={intentRef}
          type="text"
          value={intent}
          onChange={(e) => {
            setIntent(e.target.value);
            setSubmitError(null);
          }}
          placeholder="描述要做的事情…"
          className="hd-quick-create__input mt-3 w-full bg-transparent text-base font-medium outline-none"
          style={{
            border: 'none',
            borderBottom: '1px solid #DCDDDD',
            padding: '6px 0',
            color: 'inherit',
          }}
          maxLength={2000}
          disabled={submitting}
        />
        {!showDescription ? (
          <button
            type="button"
            onClick={() => {
              setShowDescription(true);
              setSubmitError(null);
            }}
            disabled={submitting}
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Plus className="h-3 w-3" />
            添加备注
          </button>
        ) : (
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="补充说明…"
            rows={2}
            className="hd-quick-create__input mt-2 w-full resize-y bg-transparent text-sm outline-none"
            style={{
              border: 'none',
              borderBottom: '1px solid #DCDDDD',
              padding: '6px 0',
              minHeight: 48,
              color: 'inherit',
            }}
            maxLength={2000}
            disabled={submitting}
          />
        )}
        <div className="mt-4 flex items-center gap-3">
          <label className="text-xs text-muted-foreground">时间</label>
          <input
            type="time"
            value={timeStr}
            onChange={(e) => {
              setTimeStr(e.target.value);
              setSubmitError(null);
            }}
            className="hd-quick-create__time bg-transparent text-sm outline-none"
            style={{
              border: 'none',
              borderBottom: '1px solid #DCDDDD',
              padding: '4px 0',
              color: 'inherit',
            }}
            disabled={submitting}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {REPEAT_PRESETS.map((p) => (
            <button
              type="button"
              key={p.value}
              onClick={() => handleRepeatSelect(p.value)}
              disabled={submitting}
              className={cn(
                'rounded-full px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                repeatType === p.value
                  ? 'bg-[#EA1F59]/10 text-[#EA1F59]'
                  : 'text-muted-foreground hover:bg-[#EFEFEF] hover:text-[#595757]',
              )}
              style={
                repeatType === p.value
                  ? { backgroundColor: 'rgba(234,31,89,0.10)', color: '#EA1F59' }
                  : undefined
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            提醒
          </div>
          <div className="flex flex-wrap gap-1.5">
            {REMINDER_PRESETS.map((p) => (
              <button
                type="button"
                key={p.value === null ? 'off' : String(p.value)}
                onClick={() => setReminderMinutes(p.value)}
                disabled={submitting}
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  reminderMinutes === p.value
                    ? 'bg-[#EA1F59]/10 text-[#EA1F59]'
                    : 'text-muted-foreground hover:bg-[#EFEFEF] hover:text-[#595757]',
                )}
                style={
                  reminderMinutes === p.value
                    ? { backgroundColor: 'rgba(234,31,89,0.10)', color: '#EA1F59' }
                    : undefined
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {repeatType === 'custom' && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              disabled={submitting}
              className="text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55"
            >
              {showAdvanced ? '收起 ▴' : '展开 RRULE 高级 ▾'}
            </button>
            {showAdvanced && (
              <textarea
                value={rrule}
                onChange={(e) => {
                  setRrule(e.target.value);
                  setSubmitError(null);
                }}
                placeholder={'FREQ=WEEKLY;BYDAY=MO,WE,FR'}
                rows={2}
                className="mt-2 w-full bg-transparent font-mono text-xs outline-none"
                style={{
                  border: 'none',
                  borderBottom: '1px solid #DCDDDD',
                  padding: '6px 0',
                  color: 'inherit',
                }}
                disabled={submitting}
              />
            )}
          </div>
        )}
        {submitError && (
          <div className="mt-3 rounded-md border border-[#EA1F59]/20 bg-[#EA1F59]/[0.06] px-3 py-2 text-xs text-[#EA1F59]">
            {submitError}
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            className="text-[#595757] hover:bg-[#EFEFEF] hover:text-[#EA1F59]"
            style={{ borderRadius: 8 }}
          >
            取消
          </Button>
          <Button
            type="submit"
            data-can-create={canCreate ? 'true' : 'false'}
            disabled={!intent.trim() || submitting}
            style={{
              backgroundColor: '#EA1F59',
              borderColor: '#EA1F59',
              borderRadius: 8,
            }}
            className="text-white hover:opacity-90"
          >
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {quickCreateSubmitLabel(submitting)}
          </Button>
        </div>
      </form>
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

function formatLocalTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatLocalDate(d: Date): string {
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
}

function combineDateAndTime(date: Date, timeStr: string): Date {
  const [hh, mm] = timeStr.split(':').map((s) => parseInt(s, 10));
  const out = new Date(date);
  out.setHours(Number.isFinite(hh) ? hh! : 9, Number.isFinite(mm) ? mm! : 0, 0, 0);
  return out;
}
