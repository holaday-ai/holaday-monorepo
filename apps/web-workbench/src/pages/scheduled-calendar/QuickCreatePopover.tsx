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

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const REPEAT_PRESETS: ReadonlyArray<{
  value: 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';
  label: string;
}> = [
  { value: 'once', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'custom', label: '自定义' },
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
  }): Promise<void>;
}

const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT_EST = 280;

export function QuickCreatePopover({
  anchor,
  date,
  mobile,
  onClose,
  onCreate,
}: Props): JSX.Element {
  const [intent, setIntent] = React.useState('');
  const [timeStr, setTimeStr] = React.useState(() => formatLocalTime(date));
  const [repeatType, setRepeatType] = React.useState<
    'once' | 'daily' | 'weekly' | 'monthly' | 'custom'
  >('once');
  const [rrule, setRrule] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const intentRef = React.useRef<HTMLInputElement | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    intentRef.current?.focus();
  }, []);

  // Esc + outside-click dismissal
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClickOutside = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // mousedown so the focus loss doesn't fire before the click handler
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || submitting) return;
    setSubmitting(true);
    try {
      const scheduledAt = combineDateAndTime(date, timeStr);
      const finalRepeatType =
        repeatType === 'custom' ? 'once' : repeatType;
      await onCreate({
        intent: intent.trim(),
        scheduledAt,
        repeatType: finalRepeatType,
        ...(repeatType === 'custom' && rrule.trim() ? { rrule: rrule.trim() } : {}),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const position = computePosition(anchor, mobile);

  return (
    <div
      ref={rootRef}
      className={cn(
        'hd-popover-enter fixed z-50 rounded-lg border border-border bg-popover p-4 shadow-2xl',
        mobile && 'left-2 right-2 bottom-2 mx-auto',
      )}
      style={mobile ? undefined : position}
    >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          新建定时任务 · {formatLocalDate(date)}
        </div>
        <input
          ref={intentRef}
          type="text"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="描述要做的事情…"
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#E50B6B]"
          maxLength={2000}
        />
        <div className="mt-2 flex items-center gap-2">
          <label className="text-xs text-muted-foreground">时间</label>
          <input
            type="time"
            value={timeStr}
            onChange={(e) => setTimeStr(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-[#E50B6B]"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {REPEAT_PRESETS.map((p) => (
            <button
              type="button"
              key={p.value}
              onClick={() => setRepeatType(p.value)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors',
                repeatType === p.value
                  ? 'border-[#E50B6B] bg-[#E50B6B]/10 text-[#E50B6B]'
                  : 'border-border bg-card text-muted-foreground hover:border-[#E50B6B]/50',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {repeatType === 'custom' && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? '收起 ▴' : '展开 RRULE 高级 ▾'}
            </button>
            {showAdvanced && (
              <textarea
                value={rrule}
                onChange={(e) => setRrule(e.target.value)}
                placeholder={'FREQ=WEEKLY;BYDAY=MO,WE,FR'}
                rows={2}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-[#E50B6B]"
              />
            )}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            type="submit"
            disabled={!intent.trim() || submitting}
            style={{ backgroundColor: '#E50B6B', borderColor: '#E50B6B' }}
            className="text-white hover:opacity-90"
          >
            {submitting ? '创建中…' : '创建'}
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
