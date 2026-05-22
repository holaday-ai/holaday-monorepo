import { describe, expect, it } from 'vitest';
import {
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

  it('running → amber accent, full opacity', () => {
    const c = pickStatusColor(
      { status: 'running', lastRunStatus: null },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#F59E0B');
    expect(c.background).toContain('245, 158, 11');
    expect(c.opacity).toBe(1);
  });

  it('paused → gray accent at 80% opacity', () => {
    const c = pickStatusColor(
      { status: 'paused', lastRunStatus: null },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#9CA3AF');
    expect(c.opacity).toBe(0.8);
  });

  it('completed in the future → green full opacity', () => {
    const c = pickStatusColor(
      { status: 'completed', lastRunStatus: 'success' },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#10B981');
    expect(c.opacity).toBe(1);
  });

  it('completed in the past → green at 60% opacity (recedes visually)', () => {
    const c = pickStatusColor(
      { status: 'completed', lastRunStatus: 'success' },
      new Date('2026-05-16T08:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#10B981');
    expect(c.opacity).toBe(0.6);
  });

  it('failed in the past → red full opacity (still actionable)', () => {
    const c = pickStatusColor(
      { status: 'failed', lastRunStatus: 'failed' },
      new Date('2026-05-16T08:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#EF4444');
    expect(c.opacity).toBe(1);
  });

  it('active + last fire failed → red tint (recurring-failure warning)', () => {
    const c = pickStatusColor(
      { status: 'active', lastRunStatus: 'failed' },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#EF4444');
  });

  it('active in the future → magenta brand color, full opacity', () => {
    const c = pickStatusColor(
      { status: 'active', lastRunStatus: null },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.accent).toBe('#E50B6B');
    expect(c.background).toContain('229, 11, 107');
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
    expect(ext.accentColor).toBe('#E50B6B');
    expect(ext.backgroundTint).toContain('229, 11, 107');
    expect(ext.backgroundTintHover).toContain('229, 11, 107');
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
});
