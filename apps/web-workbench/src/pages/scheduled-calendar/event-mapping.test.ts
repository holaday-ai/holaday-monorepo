import { describe, expect, it } from 'vitest';
import {
  pickStatusColor,
  rowToEventInput,
  type ScheduledTaskRow,
} from './event-mapping.js';

function makeRow(over: Partial<ScheduledTaskRow>): ScheduledTaskRow {
  return {
    scheduledTaskId: 'sch_1',
    intent: 'test intent',
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

  it('running → amber, full opacity', () => {
    const c = pickStatusColor(
      { status: 'running', lastRunStatus: null },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.background).toBe('#F59E0B');
    expect(c.opacity).toBe(1);
  });

  it('paused → gray', () => {
    const c = pickStatusColor(
      { status: 'paused', lastRunStatus: null },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.background).toBe('#94A3B8');
  });

  it('completed in the future → green full opacity', () => {
    const c = pickStatusColor(
      { status: 'completed', lastRunStatus: 'success' },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.background).toBe('#10B981');
    expect(c.opacity).toBe(1);
  });

  it('completed in the past → green at 60% opacity (recede)', () => {
    const c = pickStatusColor(
      { status: 'completed', lastRunStatus: 'success' },
      new Date('2026-05-16T08:00:00Z'),
      now,
    );
    expect(c.background).toBe('#10B981');
    expect(c.opacity).toBe(0.6);
  });

  it('failed in the past → red full opacity (still actionable)', () => {
    const c = pickStatusColor(
      { status: 'failed', lastRunStatus: 'failed' },
      new Date('2026-05-16T08:00:00Z'),
      now,
    );
    expect(c.background).toBe('#EF4444');
    expect(c.opacity).toBe(1);
  });

  it('active + last fire failed → red tint (warns of recurring failure)', () => {
    const c = pickStatusColor(
      { status: 'active', lastRunStatus: 'failed' },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.background).toBe('#EF4444');
  });

  it('active in the future → magenta full opacity (default ready state)', () => {
    const c = pickStatusColor(
      { status: 'active', lastRunStatus: null },
      new Date('2026-05-16T13:00:00Z'),
      now,
    );
    expect(c.background).toBe('#E50B6B');
    expect(c.opacity).toBe(1);
  });
});

describe('rowToEventInput', () => {
  const now = new Date('2026-05-16T12:00:00Z');

  it('one-shot row → single event with start + end', () => {
    const events = rowToEventInput(makeRow({}), { now });
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.id).toBe('sch_1');
    expect(ev.title).toBe('test intent');
    expect(ev.rrule).toBeUndefined();
    expect(ev.start).toBeInstanceOf(Date);
    expect(ev.end).toBeInstanceOf(Date);
    // end = start + 30 minutes (default durationMinutes)
    expect((ev.end as Date).getTime() - (ev.start as Date).getTime()).toBe(30 * 60_000);
  });

  it('rrule row → emits rrule field + duration object (rrule plugin expands occurrences)', () => {
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

  it('extendedProps carries the full intent + status metadata for popovers', () => {
    const long = 'a'.repeat(80);
    const events = rowToEventInput(
      makeRow({ intent: long, status: 'failed', lastError: 'boom' }),
      { now },
    );
    const ext = events[0]?.extendedProps as Record<string, unknown>;
    expect(ext.intent).toBe(long);
    expect(ext.status).toBe('failed');
    expect(ext.lastError).toBe('boom');
  });

  it('custom durationMinutes flows into end-time calc', () => {
    const events = rowToEventInput(makeRow({ durationMinutes: 90 }), { now });
    expect(
      (events[0]?.end as Date).getTime() - (events[0]?.start as Date).getTime(),
    ).toBe(90 * 60_000);
  });
});
