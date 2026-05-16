/**
 * Phase 26A — pure helpers that translate scheduled_tasks rows into
 * FullCalendar event shape and apply status-driven color coding.
 *
 * Split into its own module so the conversion logic is unit-testable
 * without spinning up React + FullCalendar's runtime.
 *
 * Status color mapping (per spec):
 *   active + paused=false   → magenta #E50B6B  ("waiting to fire")
 *   running                 → amber #F59E0B    ("in flight")
 *   completed               → green  #10B981
 *   failed                  → red    #EF4444
 *   paused                  → gray   #94A3B8
 *
 * Past completed events render at 60% opacity to recede visually
 * (the user cares about upcoming work). Past failed events stay
 * fully opaque — they're action items still.
 */

import type { EventInput } from '@fullcalendar/core';

/**
 * Wire shape returned by tRPC `scheduledTask.list`. Imported as a
 * type-only stub so this file doesn't need the tRPC client.
 */
export interface ScheduledTaskRow {
  scheduledTaskId: string;
  intent: string;
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
  /** Background of the event block. */
  background: string;
  /** Border + text contrast. */
  border: string;
  /** Visual opacity multiplier (0-1). */
  opacity: number;
};

const COLORS = {
  magenta: '#E50B6B',
  magentaBorder: '#9d174d',
  amber: '#F59E0B',
  amberBorder: '#B45309',
  green: '#10B981',
  greenBorder: '#047857',
  red: '#EF4444',
  redBorder: '#B91C1C',
  gray: '#94A3B8',
  grayBorder: '#475569',
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
    return { background: COLORS.amber, border: COLORS.amberBorder, opacity: 1 };
  }
  if (row.status === 'paused') {
    return { background: COLORS.gray, border: COLORS.grayBorder, opacity: 0.8 };
  }
  if (row.status === 'completed') {
    return {
      background: COLORS.green,
      border: COLORS.greenBorder,
      opacity: eventIsPast ? 0.6 : 1,
    };
  }
  if (row.status === 'failed') {
    // Failed stays fully opaque even in the past — it's an action
    // item, not a faded memory.
    return { background: COLORS.red, border: COLORS.redBorder, opacity: 1 };
  }
  // status === 'active'. If the last fire failed, show a red tint
  // even though the row is still active (the next fire is the user's
  // chance to recover).
  if (row.lastRunStatus === 'failed') {
    return { background: COLORS.red, border: COLORS.redBorder, opacity: 0.9 };
  }
  return {
    background: COLORS.magenta,
    border: COLORS.magentaBorder,
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
    backgroundColor: color.background,
    borderColor: color.border,
    textColor: '#ffffff',
    extendedProps: {
      scheduledTaskId: row.scheduledTaskId,
      intent: row.intent,
      repeatType: row.repeatType,
      rrule: row.rrule,
      durationMinutes: row.durationMinutes,
      timezone: row.timezone,
      status: row.status,
      lastRunStatus: row.lastRunStatus,
      lastError: row.lastError,
      lastRunAt: row.lastRunAt,
      opacity: color.opacity,
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
