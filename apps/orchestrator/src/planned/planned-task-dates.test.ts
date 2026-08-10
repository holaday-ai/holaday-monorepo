import { describe, expect, it } from 'vitest';
import {
  assertPlannedEndsOnScope,
  endDateToExclusiveUtc,
  exclusiveUtcToEndDate,
  resolvePlannedEndsAt,
} from './planned-task-dates.js';

describe('planned task end dates', () => {
  it('stores an inclusive Shanghai end date as next-day local midnight', () => {
    expect(endDateToExclusiveUtc('2026-08-31', 'Asia/Shanghai')).toEqual(
      new Date('2026-08-31T16:00:00.000Z'),
    );
  });

  it('handles the daylight-saving fallback boundary in New York', () => {
    expect(endDateToExclusiveUtc('2026-11-01', 'America/New_York')).toEqual(
      new Date('2026-11-02T05:00:00.000Z'),
    );
    expect(
      exclusiveUtcToEndDate(
        new Date('2026-11-02T05:00:00.000Z'),
        'America/New_York',
      ),
    ).toBe('2026-11-01');
  });

  it('rejects malformed calendar dates and unknown timezones', () => {
    expect(() => endDateToExclusiveUtc('2026-02-30', 'Asia/Shanghai')).toThrow(
      '结束日期无效',
    );
    expect(() => endDateToExclusiveUtc('2026-08-31', 'Mars/Base')).toThrow(
      '时区无效',
    );
  });
});

describe('resolvePlannedEndsAt', () => {
  it('accepts an occurrence on the selected inclusive day', () => {
    expect(
      resolvePlannedEndsAt({
        repeatType: 'daily',
        endsOn: '2026-08-10',
        timezone: 'Asia/Shanghai',
        firstEligibleRunAt: new Date('2026-08-10T01:00:00.000Z'),
      }),
    ).toEqual(new Date('2026-08-10T16:00:00.000Z'));
  });

  it('rejects an end date before the next eligible occurrence', () => {
    expect(() =>
      resolvePlannedEndsAt({
        repeatType: 'daily',
        endsOn: '2026-08-09',
        timezone: 'Asia/Shanghai',
        firstEligibleRunAt: new Date('2026-08-10T01:00:00.000Z'),
      }),
    ).toThrow('结束日期早于下一次执行');
  });

  it('clears one-time and explicitly unbounded plans', () => {
    expect(
      resolvePlannedEndsAt({
        repeatType: 'once',
        endsOn: '2026-08-31',
        timezone: 'Asia/Shanghai',
        firstEligibleRunAt: new Date('2026-08-10T01:00:00.000Z'),
      }),
    ).toBeNull();
    expect(
      resolvePlannedEndsAt({
        repeatType: 'daily',
        endsOn: null,
        timezone: 'Asia/Shanghai',
        firstEligibleRunAt: new Date('2026-08-10T01:00:00.000Z'),
      }),
    ).toBeNull();
  });

  it('preserves a stored boundary when the timezone is unchanged', () => {
    const existingEndsAt = new Date('2026-08-31T16:00:00.000Z');
    expect(
      resolvePlannedEndsAt({
        repeatType: 'daily',
        endsOn: undefined,
        existingEndsAt,
        existingTimezone: 'Asia/Shanghai',
        timezone: 'Asia/Shanghai',
        firstEligibleRunAt: new Date('2026-08-20T01:00:00.000Z'),
      }),
    ).toEqual(existingEndsAt);
  });

  it('preserves the visible end date when the timezone changes', () => {
    expect(
      resolvePlannedEndsAt({
        repeatType: 'daily',
        endsOn: undefined,
        existingEndsAt: new Date('2026-08-31T16:00:00.000Z'),
        existingTimezone: 'Asia/Shanghai',
        timezone: 'Asia/Tokyo',
        firstEligibleRunAt: new Date('2026-08-20T01:00:00.000Z'),
      }),
    ).toEqual(new Date('2026-08-31T15:00:00.000Z'));
  });
});

describe('assertPlannedEndsOnScope', () => {
  it('allows occurrence edits only when they omit the series ending', () => {
    expect(() => assertPlannedEndsOnScope('occurrence', undefined)).not.toThrow();
    expect(() => assertPlannedEndsOnScope('occurrence', null)).toThrow(
      '单次日程不能修改系列结束日期',
    );
    expect(() => assertPlannedEndsOnScope('occurrence', '2026-08-31')).toThrow(
      '单次日程不能修改系列结束日期',
    );
    expect(() => assertPlannedEndsOnScope('future', '2026-08-31')).not.toThrow();
  });
});
