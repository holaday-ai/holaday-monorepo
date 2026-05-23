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
 *   running                → amber accent
 *   completed              → cyan accent (60% opacity for past)
 *   failed                 → red accent (full opacity even in past)
 *   paused                 → gray accent at 80% opacity
 *   active + lastFailed    → red tint to warn of recurring-failure
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
  status: 'active' | 'paused' | 'running' | 'completed' | 'failed';
  lastRunStatus: 'success' | 'failed' | null;
  lastError: string | null;
  createdAt: string | Date;
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
  amber: '#FFC910',
  amberBg: 'rgba(255, 201, 16, 0.10)',
  amberBgHover: 'rgba(255, 201, 16, 0.18)',
  cyan: '#42C0EF',
  cyanBg: 'rgba(66, 192, 239, 0.08)',
  cyanBgHover: 'rgba(66, 192, 239, 0.15)',
  red: '#EF4444',
  redBg: 'rgba(239, 68, 68, 0.08)',
  redBgHover: 'rgba(239, 68, 68, 0.15)',
  gray: '#9CA3AF',
  grayBg: 'rgba(156, 163, 175, 0.08)',
  grayBgHover: 'rgba(156, 163, 175, 0.15)',
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
      accent: COLORS.amber,
      background: COLORS.amberBg,
      backgroundHover: COLORS.amberBgHover,
      opacity: 1,
    };
  }
  if (row.status === 'paused') {
    return {
      accent: COLORS.gray,
      background: COLORS.grayBg,
      backgroundHover: COLORS.grayBgHover,
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
      accent: COLORS.red,
      background: COLORS.redBg,
      backgroundHover: COLORS.redBgHover,
      opacity: 1,
    };
  }
  // status === 'active'. If the last fire failed, show a red tint
  // even though the row is still active (the next fire is the user's
  // chance to recover).
  if (row.lastRunStatus === 'failed') {
    return {
      accent: COLORS.red,
      background: COLORS.redBg,
      backgroundHover: COLORS.redBgHover,
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
  const durationMs = Math.max(1, row.durationMinutes) * 60_000;

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
      durationMinutes: row.durationMinutes,
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
        duration: { minutes: row.durationMinutes },
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
