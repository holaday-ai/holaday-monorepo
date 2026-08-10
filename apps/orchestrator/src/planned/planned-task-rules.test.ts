import { describe, expect, it } from 'vitest';
import {
  buildOccurrenceEdit,
  expandPlannedOccurrences,
  normalizePlannedItems,
  plannedReminderIsDue,
  plannedTaskCanRunNow,
  resolveDuePlannedOccurrence,
} from './planned-task-rules.js';

describe('normalizePlannedItems', () => {
  it('keeps ordered unique tasks and trims whitespace', () => {
    expect(
      normalizePlannedItems([
        '  查询特斯拉股价  ',
        '生成日报',
        '查询特斯拉股价',
        '   ',
      ]),
    ).toEqual(['查询特斯拉股价', '生成日报']);
  });

  it('rejects more than 50 tasks', () => {
    expect(() => normalizePlannedItems(Array.from({ length: 51 }, (_, i) => `任务 ${i + 1}`)))
      .toThrow('最多可规划 50 个任务');
  });
});

describe('expandPlannedOccurrences', () => {
  it('renders recurring instances only inside the visible calendar range', () => {
    const occurrences = expandPlannedOccurrences({
      plannedTaskId: 'pln_weekly',
      firstRunAt: new Date('2026-08-03T09:00:00.000Z'),
      repeatType: 'weekly',
      rrule: null,
      rangeStart: new Date('2026-08-09T00:00:00.000Z'),
      rangeEnd: new Date('2026-08-24T00:00:00.000Z'),
      exceptions: [],
    });

    expect(occurrences.map((item) => item.scheduledFor.toISOString())).toEqual([
      '2026-08-10T09:00:00.000Z',
      '2026-08-17T09:00:00.000Z',
    ]);
  });

  it('applies a single-occurrence reschedule without moving the series', () => {
    const occurrences = expandPlannedOccurrences({
      plannedTaskId: 'pln_daily',
      firstRunAt: new Date('2026-08-10T09:00:00.000Z'),
      repeatType: 'daily',
      rrule: null,
      rangeStart: new Date('2026-08-10T00:00:00.000Z'),
      rangeEnd: new Date('2026-08-13T00:00:00.000Z'),
      exceptions: [
        {
          originalScheduledFor: new Date('2026-08-11T09:00:00.000Z'),
          action: 'rescheduled',
          scheduledFor: new Date('2026-08-11T14:30:00.000Z'),
        },
      ],
    });

    expect(occurrences.map((item) => item.scheduledFor.toISOString())).toEqual([
      '2026-08-10T09:00:00.000Z',
      '2026-08-11T14:30:00.000Z',
      '2026-08-12T09:00:00.000Z',
    ]);
  });

  it('removes only the skipped occurrence', () => {
    const occurrences = expandPlannedOccurrences({
      plannedTaskId: 'pln_daily',
      firstRunAt: new Date('2026-08-10T09:00:00.000Z'),
      repeatType: 'daily',
      rrule: null,
      rangeStart: new Date('2026-08-10T00:00:00.000Z'),
      rangeEnd: new Date('2026-08-13T00:00:00.000Z'),
      exceptions: [
        {
          originalScheduledFor: new Date('2026-08-11T09:00:00.000Z'),
          action: 'skipped',
          scheduledFor: null,
        },
      ],
    });

    expect(occurrences.map((item) => item.scheduledFor.toISOString())).toEqual([
      '2026-08-10T09:00:00.000Z',
      '2026-08-12T09:00:00.000Z',
    ]);
  });

  it('stops a series before its end boundary', () => {
    const occurrences = expandPlannedOccurrences({
      plannedTaskId: 'pln_daily',
      firstRunAt: new Date('2026-08-10T09:00:00.000Z'),
      endsAt: new Date('2026-08-12T09:00:00.000Z'),
      repeatType: 'daily',
      rrule: null,
      rangeStart: new Date('2026-08-10T00:00:00.000Z'),
      rangeEnd: new Date('2026-08-14T00:00:00.000Z'),
      exceptions: [],
    });

    expect(occurrences.map((item) => item.scheduledFor.toISOString())).toEqual([
      '2026-08-10T09:00:00.000Z',
      '2026-08-11T09:00:00.000Z',
    ]);
  });
});

describe('buildOccurrenceEdit', () => {
  it('creates an exception when editing only one recurring occurrence', () => {
    expect(
      buildOccurrenceEdit({
        scope: 'occurrence',
        originalScheduledFor: new Date('2026-08-10T09:00:00.000Z'),
        scheduledFor: new Date('2026-08-10T11:00:00.000Z'),
      }),
    ).toEqual({
      kind: 'exception',
      action: 'rescheduled',
      originalScheduledFor: new Date('2026-08-10T09:00:00.000Z'),
      scheduledFor: new Date('2026-08-10T11:00:00.000Z'),
    });
  });

  it('updates the series anchor when editing this and future occurrences', () => {
    expect(
      buildOccurrenceEdit({
        scope: 'future',
        originalScheduledFor: new Date('2026-08-10T09:00:00.000Z'),
        scheduledFor: new Date('2026-08-10T11:00:00.000Z'),
      }),
    ).toEqual({
      kind: 'series',
      effectiveFrom: new Date('2026-08-10T09:00:00.000Z'),
      nextRunAt: new Date('2026-08-10T11:00:00.000Z'),
    });
  });
});

describe('plannedTaskCanRunNow', () => {
  it('allows active and paused plans but not terminal plans', () => {
    expect(plannedTaskCanRunNow('active')).toBe(true);
    expect(plannedTaskCanRunNow('paused')).toBe(true);
    expect(plannedTaskCanRunNow('failed')).toBe(true);
    expect(plannedTaskCanRunNow('completed')).toBe(false);
    expect(plannedTaskCanRunNow('archived')).toBe(false);
  });
});

describe('plannedReminderIsDue', () => {
  const nextRunAt = new Date('2026-08-10T09:00:00.000Z');

  it('opens once the reminder lead-time window begins', () => {
    expect(
      plannedReminderIsDue({
        now: new Date('2026-08-10T08:30:00.000Z'),
        nextRunAt,
        reminderMinutes: 30,
        lastReminderRun: null,
      }),
    ).toBe(true);
  });

  it('does not repeat a reminder already claimed for this occurrence', () => {
    expect(
      plannedReminderIsDue({
        now: new Date('2026-08-10T08:45:00.000Z'),
        nextRunAt,
        reminderMinutes: 30,
        lastReminderRun: nextRunAt,
      }),
    ).toBe(false);
  });

  it('does not notify after the planned start time', () => {
    expect(
      plannedReminderIsDue({
        now: new Date('2026-08-10T09:01:00.000Z'),
        nextRunAt,
        reminderMinutes: 30,
        lastReminderRun: null,
      }),
    ).toBe(false);
  });
});

describe('resolveDuePlannedOccurrence', () => {
  const original = new Date('2026-08-10T09:00:00.000Z');

  it('dispatches an unchanged occurrence on its series cadence', () => {
    expect(
      resolveDuePlannedOccurrence({
        nextRunAt: original,
        now: new Date('2026-08-10T09:01:00.000Z'),
        override: null,
      }),
    ).toEqual({
      action: 'dispatch',
      scheduledFor: original,
      seriesScheduledFor: original,
    });
  });

  it('defers a rescheduled occurrence without shifting the series cadence', () => {
    const scheduledFor = new Date('2026-08-10T14:30:00.000Z');
    expect(
      resolveDuePlannedOccurrence({
        nextRunAt: original,
        now: new Date('2026-08-10T09:01:00.000Z'),
        override: {
          originalScheduledFor: original,
          action: 'rescheduled',
          scheduledFor,
        },
      }),
    ).toEqual({
      action: 'defer',
      nextRunAt: scheduledFor,
      seriesScheduledFor: original,
    });
  });

  it('dispatches a rescheduled occurrence at the new time but advances from the original time', () => {
    const scheduledFor = new Date('2026-08-10T14:30:00.000Z');
    expect(
      resolveDuePlannedOccurrence({
        nextRunAt: scheduledFor,
        now: new Date('2026-08-10T14:31:00.000Z'),
        override: {
          originalScheduledFor: original,
          action: 'rescheduled',
          scheduledFor,
        },
      }),
    ).toEqual({
      action: 'dispatch',
      scheduledFor,
      seriesScheduledFor: original,
    });
  });

  it('skips one occurrence while retaining its series cadence anchor', () => {
    expect(
      resolveDuePlannedOccurrence({
        nextRunAt: original,
        now: new Date('2026-08-10T09:01:00.000Z'),
        override: {
          originalScheduledFor: original,
          action: 'skipped',
          scheduledFor: null,
        },
      }),
    ).toEqual({ action: 'skip', seriesScheduledFor: original });
  });
});
