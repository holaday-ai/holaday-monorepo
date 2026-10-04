import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeNextRunFromInputs } from '../agent/scheduled-runner.js';
import { expandPlannedOccurrences } from '../planned/planned-task-rules.js';
import { advancePlannedSchedule } from '../planned/planned-executor.js';
import {
  instantOfWallClock,
  nextZonedRruleOccurrence,
  rebaseRruleDtstart,
  wallClockOf,
  zonedRruleOccurrencesBetween,
} from './rrule-zoned.js';

const SH = 'Asia/Shanghai';
const iso = (value: string) => new Date(value);

afterEach(() => {
  vi.useRealTimers();
});

describe('wall clock conversion', () => {
  it('round-trips Shanghai and a DST zone', () => {
    const instant = iso('2026-10-04T23:00:00.000Z');
    expect(wallClockOf(instant, SH).toISOString()).toBe('2026-10-05T07:00:00.000Z');
    expect(instantOfWallClock(wallClockOf(instant, SH), SH).toISOString()).toBe(
      instant.toISOString(),
    );
    const ny = iso('2026-11-02T14:00:00.000Z'); // 09:00 EST
    expect(instantOfWallClock(wallClockOf(ny, 'America/New_York'), 'America/New_York')).toEqual(ny);
  });
});

describe('nextZonedRruleOccurrence', () => {
  it('anchors a rule without DTSTART at the schedule, not the parse instant (no seconds drift)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(iso('2026-10-05T01:30:47.123Z'));
    const next = nextZonedRruleOccurrence({
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=30',
      anchor: iso('2026-10-05T01:30:00.000Z'),
      after: iso('2026-10-05T01:30:47.123Z'),
      timezone: SH,
    });
    // 09:30:00 Shanghai tomorrow — previously 09:30:47 in UTC (= 17:30 local).
    expect(next?.toISOString()).toBe('2026-10-06T01:30:00.000Z');
  });

  it('evaluates BYDAY on the local calendar for early-morning schedules', () => {
    // Planned editor output for "Mon + Wed 07:00" picked in Shanghai.
    const rule = 'DTSTART:20261004T230000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE';
    const next = nextZonedRruleOccurrence({
      rrule: rule,
      anchor: iso('2026-10-04T23:00:00.000Z'),
      after: iso('2026-10-04T23:00:00.000Z'),
      timezone: SH,
    });
    // Wed 07:00 Shanghai. The UTC evaluation picked Mon 23:00Z = Tue 07:00.
    expect(next?.toISOString()).toBe('2026-10-06T23:00:00.000Z');
  });

  it('keeps local time across a DST transition', () => {
    const next = nextZonedRruleOccurrence({
      rrule: 'FREQ=DAILY',
      anchor: iso('2026-10-31T13:00:00.000Z'), // 09:00 EDT
      after: iso('2026-11-01T12:00:00.000Z'),
      timezone: 'America/New_York',
    });
    expect(next?.toISOString()).toBe('2026-11-01T14:00:00.000Z'); // 09:00 EST
  });

  it('treats a floating DTSTART as wall time in the row zone and honours UNTIL', () => {
    const rule = 'DTSTART:20261005T090000\nRRULE:FREQ=DAILY;UNTIL=20261006T020000Z';
    const first = nextZonedRruleOccurrence({
      rrule: rule,
      anchor: iso('2026-01-01T00:00:00.000Z'),
      after: iso('2026-10-05T00:00:00.000Z'),
      timezone: SH,
    });
    expect(first?.toISOString()).toBe('2026-10-05T01:00:00.000Z');
    const second = nextZonedRruleOccurrence({
      rrule: rule,
      anchor: iso('2026-01-01T00:00:00.000Z'),
      after: first!,
      timezone: SH,
    });
    expect(second?.toISOString()).toBe('2026-10-06T01:00:00.000Z');
    const none = nextZonedRruleOccurrence({
      rrule: rule,
      anchor: iso('2026-01-01T00:00:00.000Z'),
      after: second!,
      timezone: SH,
    });
    expect(none).toBeNull();
  });

  it('falls back to an anchored rrulestr for rule sets with EXDATE', () => {
    const next = nextZonedRruleOccurrence({
      rrule:
        'DTSTART:20261005T010000Z\nRRULE:FREQ=DAILY\nEXDATE:20261006T010000Z',
      anchor: iso('2026-10-05T01:00:00.000Z'),
      after: iso('2026-10-05T01:00:00.000Z'),
      timezone: SH,
    });
    expect(next?.toISOString()).toBe('2026-10-07T01:00:00.000Z');
  });

  it('throws on garbage so callers can fall back', () => {
    expect(() =>
      nextZonedRruleOccurrence({
        rrule: 'FREQ=NOPE',
        anchor: iso('2026-10-05T01:00:00.000Z'),
        after: iso('2026-10-05T01:00:00.000Z'),
        timezone: SH,
      }),
    ).toThrow();
  });
});

describe('zonedRruleOccurrencesBetween', () => {
  it('returns the same stable instants regardless of when it is called', () => {
    const input = {
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      anchor: iso('2026-09-01T01:00:00.000Z'), // 09:00 Shanghai
      start: iso('2026-09-28T00:00:00.000Z'),
      end: iso('2026-10-04T00:00:00.000Z'),
      timezone: SH,
    };
    vi.useFakeTimers();
    vi.setSystemTime(iso('2026-10-04T03:17:59.000Z'));
    const first = zonedRruleOccurrencesBetween(input).map((d) => d.toISOString());
    vi.setSystemTime(iso('2026-12-24T22:01:13.000Z'));
    const second = zonedRruleOccurrencesBetween(input).map((d) => d.toISOString());
    expect(first).toEqual([
      '2026-09-28T01:00:00.000Z',
      '2026-09-30T01:00:00.000Z',
      '2026-10-02T01:00:00.000Z',
    ]);
    expect(second).toEqual(first);
  });
});

describe('computeNextRunFromInputs — anchoring', () => {
  it('legacy daily cadence steps from the due occurrence, not the poll instant', () => {
    expect(
      computeNextRunFromInputs({
        from: iso('2026-10-05T01:00:47.000Z'),
        rrule: null,
        repeatType: 'daily',
        anchor: iso('2026-10-05T01:00:00.000Z'),
      })?.toISOString(),
    ).toBe('2026-10-06T01:00:00.000Z');
  });

  it('after downtime it lands on the next future slot at the same time of day', () => {
    expect(
      computeNextRunFromInputs({
        from: iso('2026-10-08T05:00:00.000Z'),
        rrule: null,
        repeatType: 'daily',
        anchor: iso('2026-10-05T01:00:00.000Z'),
      })?.toISOString(),
    ).toBe('2026-10-09T01:00:00.000Z');
  });

  it('without an anchor keeps the legacy +1 unit from `from`', () => {
    expect(
      computeNextRunFromInputs({
        from: iso('2026-10-05T01:00:00.000Z'),
        rrule: null,
        repeatType: 'weekly',
      })?.toISOString(),
    ).toBe('2026-10-12T01:00:00.000Z');
  });

  it('rrule path uses the row timezone', () => {
    expect(
      computeNextRunFromInputs({
        from: iso('2026-10-05T02:00:00.000Z'),
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
        repeatType: 'custom',
        anchor: iso('2026-10-05T01:00:00.000Z'),
        timezone: SH,
      })?.toISOString(),
    ).toBe('2026-10-06T01:00:00.000Z');
  });
});

describe('planned tasks use the plan timezone', () => {
  const rule = 'DTSTART:20261004T230000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE';

  it('calendar occurrences land on the chosen local weekdays', () => {
    const occurrences = expandPlannedOccurrences({
      plannedTaskId: 'pln_1',
      firstRunAt: iso('2026-10-04T23:00:00.000Z'),
      repeatType: 'custom',
      rrule: rule,
      rangeStart: iso('2026-10-04T16:00:00.000Z'), // Mon 00:00 Shanghai
      rangeEnd: iso('2026-10-11T16:00:00.000Z'),
      exceptions: [],
      timezone: SH,
    });
    expect(occurrences.map((o) => o.scheduledFor.toISOString())).toEqual([
      '2026-10-04T23:00:00.000Z', // Mon 07:00
      '2026-10-06T23:00:00.000Z', // Wed 07:00
    ]);
  });

  it('advancing after a fire picks the next local weekday', () => {
    expect(
      advancePlannedSchedule({
        firedAt: iso('2026-10-04T23:00:00.000Z'),
        repeatType: 'custom',
        rrule: rule,
        dispatchSucceeded: true,
        timezone: SH,
      }).nextRunAt?.toISOString(),
    ).toBe('2026-10-06T23:00:00.000Z');
  });
});

describe('rebaseRruleDtstart', () => {
  it('moves an embedded DTSTART so a dragged series keeps the new time of day', () => {
    const rule = 'DTSTART:20261004T230000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE';
    const moved = rebaseRruleDtstart(rule, iso('2026-10-05T02:30:00.000Z')); // Mon 10:30 SH
    expect(moved).toBe('DTSTART:20261005T023000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE');
    const next = nextZonedRruleOccurrence({
      rrule: moved!,
      anchor: iso('2026-10-05T02:30:00.000Z'),
      after: iso('2026-10-05T02:30:00.000Z'),
      timezone: SH,
    });
    expect(next?.toISOString()).toBe('2026-10-07T02:30:00.000Z'); // Wed 10:30 SH
  });

  it('leaves rules without DTSTART and null untouched', () => {
    expect(rebaseRruleDtstart('FREQ=DAILY', iso('2026-10-05T02:30:00.000Z'))).toBe('FREQ=DAILY');
    expect(rebaseRruleDtstart(null, iso('2026-10-05T02:30:00.000Z'))).toBeNull();
  });
});
