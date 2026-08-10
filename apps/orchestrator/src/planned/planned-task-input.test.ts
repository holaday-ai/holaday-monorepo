import { describe, expect, it } from 'vitest';
import {
  plannedCalendarInputSchema,
  plannedMutationResult,
  plannedTaskCreateInputSchema,
  resolveRequestedSchedule,
  validatePlannedRepeatRule,
} from './planned-task-input.js';

describe('plannedTaskCreateInputSchema', () => {
  it('accepts one-time and multi-item plans', () => {
    expect(
      plannedTaskCreateInputSchema.parse({
        title: '竞品巡检',
        instruction: '附上来源链接',
        items: ['产品 A', '产品 B'],
        repeatType: 'weekly',
        scheduledAt: '2026-08-17T09:00:00.000Z',
        timezone: 'Asia/Shanghai',
      }).items,
    ).toEqual(['产品 A', '产品 B']);
  });

  it('requires an RRULE for custom recurrence', () => {
    expect(() =>
      plannedTaskCreateInputSchema.parse({
        instruction: '工作日生成日报',
        repeatType: 'custom',
        scheduledAt: '2026-08-17T09:00:00.000Z',
      }),
    ).toThrow();
  });

  it('accepts a date-only inclusive ending', () => {
    expect(
      plannedTaskCreateInputSchema.parse({
        instruction: '每日巡检',
        repeatType: 'daily',
        scheduledAt: '2026-08-10T01:00:00.000Z',
        endsOn: '2026-08-31',
      }).endsOn,
    ).toBe('2026-08-31');
  });

  it('rejects a non-ISO ending date', () => {
    expect(() =>
      plannedTaskCreateInputSchema.parse({
        instruction: '每日巡检',
        repeatType: 'daily',
        scheduledAt: '2026-08-10T01:00:00.000Z',
        endsOn: '08/31/2026',
      }),
    ).toThrow();
  });

  it('rejects an ending date for a one-time plan', () => {
    expect(() =>
      plannedTaskCreateInputSchema.parse({
        instruction: '仅执行一次',
        repeatType: 'once',
        scheduledAt: '2026-08-10T01:00:00.000Z',
        endsOn: '2026-08-31',
      }),
    ).toThrow('单次任务不能设置结束日期');
  });
});

describe('resolveRequestedSchedule', () => {
  const now = new Date('2026-08-10T10:00:00.000Z');

  it('rejects a one-time plan in the past', () => {
    expect(() =>
      resolveRequestedSchedule({
        scheduledAt: '2026-08-10T08:00:00.000Z',
        repeatType: 'once',
        rrule: null,
        now,
      }),
    ).toThrow('执行时间已过去');
  });

  it('rolls a recurring plan forward while preserving its anchor', () => {
    expect(
      resolveRequestedSchedule({
        scheduledAt: '2026-08-09T09:00:00.000Z',
        repeatType: 'daily',
        rrule: null,
        now,
      }),
    ).toEqual({
      firstRunAt: new Date('2026-08-09T09:00:00.000Z'),
      nextRunAt: new Date('2026-08-11T09:00:00.000Z'),
      adjusted: true,
    });
  });

  it('normalizes mutation feedback around the effective next run', () => {
    expect(
      plannedMutationResult('pln_adjusted', {
        nextRunAt: new Date('2026-08-11T09:00:00.000Z'),
        adjusted: true,
      }),
    ).toEqual({
      ok: true,
      plannedTaskId: 'pln_adjusted',
      nextRunAt: new Date('2026-08-11T09:00:00.000Z'),
      adjusted: true,
    });
    expect(plannedMutationResult('pln_unchanged', null)).toEqual({
      ok: true,
      plannedTaskId: 'pln_unchanged',
      nextRunAt: null,
      adjusted: false,
    });
  });
});

describe('plannedCalendarInputSchema', () => {
  it('limits one request to a bounded calendar range', () => {
    expect(() =>
      plannedCalendarInputSchema.parse({
        rangeStart: '2026-01-01T00:00:00.000Z',
        rangeEnd: '2028-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('validatePlannedRepeatRule', () => {
  it('rejects custom repetition without a valid rule during edits', () => {
    expect(() => validatePlannedRepeatRule('custom', null)).toThrow('自定义重复需要重复规则');
    expect(() => validatePlannedRepeatRule('custom', 'not-an-rrule')).toThrow('重复规则格式错误');
  });

  it('accepts the simplified weekday rule emitted by the UI', () => {
    expect(() =>
      validatePlannedRepeatRule('custom', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'),
    ).not.toThrow();
  });
});
