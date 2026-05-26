import { describe, expect, it } from 'vitest';
import {
  normalizeScheduledTaskRows,
  pickStatusColor,
  rowToEventInput,
  type ScheduledTaskRow,
} from './event-mapping.js';

function makeRow(over: Partial<ScheduledTaskRow>): ScheduledTaskRow {
  return {
    scheduledTaskId: 'sch_1',
    scheduledTaskInternalId: 101,
    intent: 'test intent',
    description: null,
    reminderMinutes: null,
    repeatType: 'once',
    rrule: null,
    durationMinutes: 30,
    timezone: 'Asia/Shanghai',
    nextRunAt: new Date('2026-05-16T09:00:00Z'),
    lastRunAt: null,
    status: 'active',
    lastRunStatus: null,
    lastError: null,
    createdAt: new Date('2026-05-15T00:00:00Z'),
    ...over,
  };
}

describe('pickStatusColor', () => {
  const now = new Date('2026-05-16T12:00:00Z');

  it('running → yellow accent, full opacity', () => {
    const c = pickStatusColor(
      { status: 'running', lastRunStatus: null },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#FFC910');
    expect(c.background).toContain('255, 201, 16');
    expect(c.opacity).toBe(1);
  });

  it('paused → gray accent at 80% opacity', () => {
    const c = pickStatusColor(
      { status: 'paused', lastRunStatus: null },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#ADADAD');
    expect(c.opacity).toBe(0.8);
  });

  it('completed in the future → cyan full opacity', () => {
    const c = pickStatusColor(
      { status: 'completed', lastRunStatus: 'success' },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#42C0EF');
    expect(c.opacity).toBe(1);
  });

  it('completed in the past → cyan at 60% opacity (recedes visually)', () => {
    const c = pickStatusColor(
      { status: 'completed', lastRunStatus: 'success' },
      new Date('2026-05-16T08:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#42C0EF');
    expect(c.opacity).toBe(0.6);
  });

  it('failed in the past → magenta full opacity (still actionable)', () => {
    const c = pickStatusColor(
      { status: 'failed', lastRunStatus: 'failed' },
      new Date('2026-05-16T08:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#EA1F59');
    expect(c.opacity).toBe(1);
  });

  it('active + last fire failed → magenta tint (recurring-failure warning)', () => {
    const c = pickStatusColor(
      { status: 'active', lastRunStatus: 'failed' },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#EA1F59');
  });

  it('active in the future → magenta brand color, full opacity', () => {
    const c = pickStatusColor(
      { status: 'active', lastRunStatus: null },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#EA1F59');
    expect(c.background).toContain('234, 31, 89');
    expect(c.opacity).toBe(1);
  });

  it('every status returns the three-field color triple', () => {
    const c = pickStatusColor(
      { status: 'active', lastRunStatus: null },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.accent).toBeTruthy();
    expect(c.background).toBeTruthy();
    expect(c.backgroundHover).toBeTruthy();
    expect(c.backgroundHover).not.toBe(c.background);
  });
});

describe('rowToEventInput', () => {
  const now = new Date('2026-05-16T12:00:00Z');

  it('one-shot row → single event with start + end + transparent FC bg', () => {
    const events = rowToEventInput(makeRow({}), { now });
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.id).toBe('sch_1');
    expect(ev.title).toBe('test intent');
    expect(ev.rrule).toBeUndefined();
    // FC default background is transparent so calendar.css tints win
    expect(ev.backgroundColor).toBe('transparent');
    expect(ev.borderColor).toBe('transparent');
    expect(ev.start).toBeInstanceOf(Date);
    expect(ev.end).toBeInstanceOf(Date);
    expect((ev.end as Date).getTime() - (ev.start as Date).getTime()).toBe(30 * 60_000);
  });

  it('rrule row → emits rrule field + duration object', () => {
    const events = rowToEventInput(
      makeRow({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' }),
      { now },
    );
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(ev.duration).toEqual({ minutes: 30 });
    expect(ev.start).toBeUndefined();
  });

  it('extendedProps carries the full color triple + description + reminder', () => {
    const events = rowToEventInput(
      makeRow({
        description: '产品同事每周看的报告',
        reminderMinutes: 15,
      }),
      { now },
    );
    const ext = events[0]?.extendedProps as Record<string, unknown>;
    expect(ext.accentColor).toBe('#EA1F59');
    expect(ext.backgroundTint).toContain('234, 31, 89');
    expect(ext.backgroundTintHover).toContain('234, 31, 89');
    expect(ext.description).toBe('产品同事每周看的报告');
    expect(ext.reminderMinutes).toBe(15);
    expect(ext.scheduledTaskInternalId).toBe(101);
  });

  it('reminderMinutes is null when not set on the row', () => {
    const events = rowToEventInput(makeRow({}), { now });
    const ext = events[0]?.extendedProps as Record<string, unknown>;
    expect(ext.reminderMinutes).toBeNull();
  });

  it('title truncates at 60 chars with ellipsis', () => {
    const long = 'a'.repeat(80);
    const events = rowToEventInput(makeRow({ intent: long }), { now });
    expect(events[0]?.title).toBe(`${'a'.repeat(60)}…`);
  });

  it('invalid nextRunAt → empty array (defensive)', () => {
    const events = rowToEventInput(
      makeRow({ nextRunAt: 'not-a-date' }),
      { now },
    );
    expect(events).toEqual([]);
  });

  it('custom durationMinutes flows into end-time calc', () => {
    const events = rowToEventInput(makeRow({ durationMinutes: 90 }), { now });
    expect(
      (events[0]?.end as Date).getTime() - (events[0]?.start as Date).getTime(),
    ).toBe(90 * 60_000);
  });

  it('clamps recurring event duration before passing it to FullCalendar', () => {
    const events = rowToEventInput(
      makeRow({ durationMinutes: 0, rrule: 'FREQ=DAILY' }),
      { now },
    );
    expect(events[0]?.duration).toEqual({ minutes: 1 });
    expect((events[0]?.extendedProps as Record<string, unknown>).durationMinutes).toBe(1);
  });
});

describe('normalizeScheduledTaskRows', () => {
  it('normalizes scheduled task rows before calendar rendering', () => {
    expect(
      normalizeScheduledTaskRows([
        {
          scheduledTaskId: ' sch_1 ',
          scheduledTaskInternalId: 123,
          intent: ' Weekly report ',
          description: '  Product update ',
          reminderMinutes: 15,
          repeatType: 'weekly',
          rrule: ' FREQ=WEEKLY ',
          durationMinutes: 45,
          timezone: ' Asia/Tokyo ',
          nextRunAt: ' 2026-05-25T10:00:00.000Z ',
          lastRunAt: ' 2026-05-24T10:00:00.000Z ',
          status: 'paused',
          lastRunStatus: 'success',
          lastError: ' previous warning ',
          createdAt: ' 2026-05-20T00:00:00.000Z ',
        },
      ]),
    ).toEqual([
      {
        scheduledTaskId: 'sch_1',
        scheduledTaskInternalId: 123,
        intent: 'Weekly report',
        description: 'Product update',
        reminderMinutes: 15,
        repeatType: 'weekly',
        rrule: 'FREQ=WEEKLY',
        durationMinutes: 45,
        timezone: 'Asia/Tokyo',
        nextRunAt: '2026-05-25T10:00:00.000Z',
        lastRunAt: '2026-05-24T10:00:00.000Z',
        status: 'paused',
        lastRunStatus: 'success',
        lastError: 'previous warning',
        createdAt: '2026-05-20T00:00:00.000Z',
      },
    ]);
  });

  it('drops rows without stable identity or schedule time', () => {
    expect(
      normalizeScheduledTaskRows([
        null,
        { scheduledTaskId: '', nextRunAt: '2026-05-25T10:00:00.000Z' },
        { scheduledTaskId: 'sch_bad', nextRunAt: 'not-a-date' },
      ]),
    ).toEqual([]);
  });

  it('falls back from malformed optional fields safely', () => {
    expect(
      normalizeScheduledTaskRows([
        {
          scheduledTaskId: 'sch_2',
          scheduledTaskInternalId: -1,
          intent: { unsafe: true },
          description: { unsafe: true },
          reminderMinutes: -5,
          repeatType: 'yearly',
          rrule: { unsafe: true },
          durationMinutes: 0,
          timezone: { unsafe: true },
          nextRunAt: '2026-05-25T10:00:00.000Z',
          lastRunAt: { unsafe: true },
          status: 'unknown',
          lastRunStatus: 'almost',
          lastError: { unsafe: true },
          createdAt: { unsafe: true },
        },
      ]),
    ).toEqual([
      {
        scheduledTaskId: 'sch_2',
        scheduledTaskInternalId: undefined,
        intent: '未命名任务',
        description: null,
        reminderMinutes: null,
        repeatType: 'once',
        rrule: null,
        durationMinutes: 30,
        timezone: 'Asia/Shanghai',
        nextRunAt: '2026-05-25T10:00:00.000Z',
        lastRunAt: null,
        status: 'active',
        lastRunStatus: null,
        lastError: null,
        createdAt: '',
      },
    ]);
  });
});
