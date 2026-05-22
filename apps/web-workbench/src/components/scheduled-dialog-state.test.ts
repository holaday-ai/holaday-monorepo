import { describe, expect, it } from 'vitest';
import {
  buildScheduledCreatePayload,
  reminderMinutesForValue,
} from './scheduled-dialog-state.js';

describe('scheduled dialog state helpers', () => {
  it('maps reminder select values to nullable minutes', () => {
    expect(reminderMinutesForValue('off')).toBeNull();
    expect(reminderMinutesForValue('15')).toBe(15);
    expect(reminderMinutesForValue('unknown')).toBeNull();
  });

  it('builds a normal daily create payload with description and reminder', () => {
    const scheduledAt = new Date('2026-05-23T09:00:00Z');
    expect(
      buildScheduledCreatePayload({
        intent: '  生成日报  ',
        repeatType: 'daily',
        scheduledAt,
        reminderValue: '30',
        rrule: '',
        description: '  发给产品群  ',
      }),
    ).toEqual({
      intent: '生成日报',
      repeatType: 'daily',
      scheduledAt: scheduledAt.toISOString(),
      reminderMinutes: 30,
      description: '发给产品群',
    });
  });

  it('encodes custom RRULE schedules using repeatType once plus rrule', () => {
    const scheduledAt = new Date('2026-05-23T09:00:00Z');
    expect(
      buildScheduledCreatePayload({
        intent: '同步周报',
        repeatType: 'custom',
        scheduledAt,
        reminderValue: 'off',
        rrule: ' DTSTART:20260523T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO ',
        description: '',
      }),
    ).toEqual({
      intent: '同步周报',
      repeatType: 'once',
      scheduledAt: scheduledAt.toISOString(),
      reminderMinutes: null,
      rrule: 'DTSTART:20260523T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO',
    });
  });

  it('requires an RRULE when custom repeat is selected', () => {
    expect(() =>
      buildScheduledCreatePayload({
        intent: '同步周报',
        repeatType: 'custom',
        scheduledAt: new Date('2026-05-23T09:00:00Z'),
        reminderValue: 'off',
        rrule: '   ',
        description: '',
      }),
    ).toThrow('请填写自定义重复规则');
  });
});
