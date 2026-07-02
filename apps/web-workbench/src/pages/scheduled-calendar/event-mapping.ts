/**
 * Phase 26B polish — Todoist-inspired event color treatment.
 *
 * Each event renders as a tinted block with a 3 px left accent bar.
 * `pickStatusColor` returns the (accent, soft-bg, hover-bg) triple
 * the calendar.css consumes via `--hd-event-*` CSS variables; the
 * UI never has to compute hover states.
 *
 * Status mapping:
 *   active + future        → magenta accent + 8% bg ("waiting to fire")
 *   running                → yellow accent
 *   completed              → cyan accent (60% opacity for past)
 *   failed                 → magenta accent (full opacity even in past)
 *   paused                 → neutral accent at 80% opacity
 *   active + lastFailed    → magenta tint to warn of recurring-failure
 *   unknown/unrecognized   → neutral, no active affordance
 *
 * Pure helpers — React-free + FullCalendar-free, fully unit-testable.
 */

import type { EventInput } from '@fullcalendar/core';

/**
 * Wire shape returned by tRPC `scheduledTask.list`. Imported as a
 * type-only stub so this file doesn't need the tRPC client.
 */
export interface ScheduledTaskRow {
  scheduledTaskInternalId?: number;
  scheduledTaskId: string;
  intent: string;
  /** Phase 26B polish — optional human annotation. */
  description?: string | null;
  /** Phase 26B follow-up — reminder lead time in minutes; null = off. */
  reminderMinutes?: number | null;
  repeatType: 'once' | 'daily' | 'weekly' | 'monthly';
  rrule: string | null;
  durationMinutes: number;
  timezone: string;
  nextRunAt: string | Date;
  lastRunAt: string | Date | null;
  status:
    | 'active'
    | 'paused'
    | 'running'
    | 'completed'
    | 'failed'
    | 'unknown'
    | (string & {});
  lastRunStatus: 'success' | 'failed' | 'skipped' | null;
  lastError: string | null;
  createdAt: string | Date;
}

export function normalizeScheduledTaskRows(value: unknown): ScheduledTaskRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = normalizeScheduledTaskRow(entry);
    return row ? [row] : [];
  });
}

export type StatusColor = {
  /** 3 px accent bar (left edge) + list-view dot. */
  accent: string;
  /** Tinted resting background (8 % opacity). */
  background: string;
  /** Hover background (15 % opacity). */
  backgroundHover: string;
  /** Visual opacity multiplier (0–1) applied to the whole block. */
  opacity: number;
};

const COLORS = {
  magenta: '#EA1F59',
  magentaBg: 'rgba(234, 31, 89, 0.08)',
  magentaBgHover: 'rgba(234, 31, 89, 0.15)',
  yellow: '#FFC910',
  yellowBg: 'rgba(255, 201, 16, 0.10)',
  yellowBgHover: 'rgba(255, 201, 16, 0.18)',
  cyan: '#42C0EF',
  cyanBg: 'rgba(66, 192, 239, 0.08)',
  cyanBgHover: 'rgba(66, 192, 239, 0.15)',
  neutral: '#ADADAD',
  neutralBg: 'rgba(173, 173, 173, 0.10)',
  neutralBgHover: 'rgba(173, 173, 173, 0.18)',
} as const;

/**
 * Pick visual treatment for a scheduled task row based on its status
 * and how the event time compares to `now`. Pure function — UI just
 * reads the return value.
 *
 * `now` is injected so tests can pin a reference time without
 * stubbing Date.now globally.
 */
export function pickStatusColor(
  row: Pick<ScheduledTaskRow, 'status' | 'lastRunStatus'>,
  eventTime: Date,
  now: Date,
): StatusColor {
  const eventIsPast = eventTime.getTime() < now.getTime();
  if (row.status === 'running') {
    return {
      accent: COLORS.yellow,
      background: COLORS.yellowBg,
      backgroundHover: COLORS.yellowBgHover,
      opacity: 1,
    };
  }
  if (row.status === 'paused') {
    return {
      accent: COLORS.neutral,
      background: COLORS.neutralBg,
      backgroundHover: COLORS.neutralBgHover,
      opacity: 0.8,
    };
  }
  if (row.status === 'completed') {
    return {
      accent: COLORS.cyan,
      background: COLORS.cyanBg,
      backgroundHover: COLORS.cyanBgHover,
      opacity: eventIsPast ? 0.6 : 1,
    };
  }
  if (row.status === 'failed') {
    // Failed stays fully opaque even in the past — it's an action
    // item, not a faded memory.
    return {
      accent: COLORS.magenta,
      background: COLORS.magentaBg,
      backgroundHover: COLORS.magentaBgHover,
      opacity: 1,
    };
  }
  if (row.status !== 'active') {
    return {
      accent: COLORS.neutral,
      background: COLORS.neutralBg,
      backgroundHover: COLORS.neutralBgHover,
      opacity: 0.75,
    };
  }
  // status === 'active'. If the last fire failed, keep a magenta
  // warning tint even though the row is still active. The next fire
  // is the user's chance to recover.
  if (row.lastRunStatus === 'failed') {
    return {
      accent: COLORS.magenta,
      background: COLORS.magentaBg,
      backgroundHover: COLORS.magentaBgHover,
      opacity: 0.9,
    };
  }
  return {
    accent: COLORS.magenta,
    background: COLORS.magentaBg,
    backgroundHover: COLORS.magentaBgHover,
    // Past pending events (e.g. paused-then-resumed without
    // rescheduling) dim slightly so they don't pretend to be future.
    opacity: eventIsPast ? 0.85 : 1,
  };
}

/**
 * Convert a scheduled_tasks row to a FullCalendar `EventInput`. For
 * recurring rows with an rrule, we attach `rrule` so the
 * @fullcalendar/rrule plugin renders every occurrence in the visible
 * range; one-shot rows (rrule=null) render a single event at
 * nextRunAt.
 *
 * Title is the first 60 chars of the intent — fits a calendar block
 * without wrapping in most views. The full intent travels in
 * `extendedProps` so popovers can show it untruncated.
 *
 * Returns an empty array for rows whose nextRunAt is missing (defensive;
 * shouldn't happen given the DB NOT NULL constraint).
 */
export function rowToEventInput(
  row: ScheduledTaskRow,
  opts: { now: Date },
): EventInput[] {
  const nextRunAt = row.nextRunAt instanceof Date ? row.nextRunAt : new Date(row.nextRunAt);
  if (Number.isNaN(nextRunAt.getTime())) return [];
  const color = pickStatusColor(row, nextRunAt, opts.now);
  const durationMinutes = Math.max(1, row.durationMinutes);
  const durationMs = durationMinutes * 60_000;

  const baseProps = {
    id: row.scheduledTaskId,
    title: row.intent.length > 60 ? `${row.intent.slice(0, 60)}…` : row.intent,
    // FullCalendar's default backgroundColor / borderColor sets the
    // outer event wrapper. We override with TRANSPARENT so the
    // inner .fc-event-main can use the calendar-styles.css tinted
    // background + 3 px accent bar instead.
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    textColor: 'inherit',
    extendedProps: {
      scheduledTaskInternalId: row.scheduledTaskInternalId,
      scheduledTaskId: row.scheduledTaskId,
      intent: row.intent,
      description: row.description ?? null,
      reminderMinutes: row.reminderMinutes ?? null,
      repeatType: row.repeatType,
      rrule: row.rrule,
      durationMinutes,
      timezone: row.timezone,
      status: row.status,
      lastRunStatus: row.lastRunStatus,
      lastError: row.lastError,
      lastRunAt: row.lastRunAt,
      opacity: color.opacity,
      /** CSS-var inputs the eventDidMount handler writes onto
       *  the .fc-event-main element. The CSS reads them via
       *  `var(--hd-event-accent)` / `--hd-event-bg` / `--hd-event-bg-hover`. */
      accentColor: color.accent,
      backgroundTint: color.background,
      backgroundTintHover: color.backgroundHover,
    },
  };

  // Recurring path — the rrule plugin expands occurrences in the
  // visible range. We pass `duration` separately so each occurrence
  // gets the configured block height.
  if (row.rrule && row.rrule.trim().length > 0) {
    return [
      {
        ...baseProps,
        rrule: row.rrule,
        duration: { minutes: durationMinutes },
      },
    ];
  }

  // Non-rrule rows: legacy repeat_type or one-shot. We render only
  // the next occurrence; once it fires the runner advances nextRunAt
  // and a subsequent list call picks up the new time. (Don't try to
  // back-fill all historical fires here — the calendar would be
  // cluttered with stale data the runner has already advanced past.)
  return [
    {
      ...baseProps,
      start: nextRunAt,
      end: new Date(nextRunAt.getTime() + durationMs),
    },
  ];
}

function normalizeScheduledTaskRow(value: unknown): ScheduledTaskRow | null {
  if (!isRecord(value)) return null;
  const scheduledTaskId = safeText(value.scheduledTaskId);
  if (!scheduledTaskId) return null;
  const nextRunAt = safeDateValue(value.nextRunAt);
  if (!nextRunAt) return null;
  return {
    scheduledTaskId,
    scheduledTaskInternalId: safePositiveInteger(value.scheduledTaskInternalId),
    intent: safeText(value.intent) || '未命名任务',
    description: safeNullableText(value.description),
    reminderMinutes: safeNonNegativeInteger(value.reminderMinutes),
    repeatType: normalizeRepeatType(value.repeatType),
    rrule: safeNullableText(value.rrule),
    durationMinutes: safePositiveInteger(value.durationMinutes) ?? 30,
    timezone: safeText(value.timezone) || 'Asia/Shanghai',
    nextRunAt,
    lastRunAt: safeNullableDateValue(value.lastRunAt),
    status: normalizeStatus(value.status),
    lastRunStatus: normalizeLastRunStatus(value.lastRunStatus),
    lastError: safeNullableText(value.lastError),
    createdAt: safeDateValue(value.createdAt) ?? '',
  };
}

function normalizeRepeatType(value: unknown): ScheduledTaskRow['repeatType'] {
  return value === 'daily' ||
    value === 'weekly' ||
    value === 'monthly' ||
    value === 'once'
    ? value
    : 'once';
}

function normalizeStatus(value: unknown): ScheduledTaskRow['status'] {
  const status = safeText(value);
  return status || 'unknown';
}

function normalizeLastRunStatus(value: unknown): ScheduledTaskRow['lastRunStatus'] {
  return value === 'success' || value === 'failed' || value === 'skipped' ? value : null;
}

function safeNullableText(value: unknown): string | null {
  const text = safeText(value);
  return text || null;
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safePositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function safeNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function safeDateValue(value: unknown): string | Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : trimmed;
}

function safeNullableDateValue(value: unknown): string | Date | null {
  return value === null || value === undefined ? null : safeDateValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
