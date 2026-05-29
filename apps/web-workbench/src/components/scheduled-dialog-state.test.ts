import { describe, expect, it } from 'vitest';
import {
  buildScheduledCreatePayload,
  reminderMinutesForValue,
  scheduledCreateButtonLabel,
  scheduledDialogHasDraftChanges,
  scheduledReminderSummary,
  scheduledRepeatSummary,
} from './scheduled-dialog-state.js';

describe('scheduled dialog state helpers', () => {
  it('maps reminder select values to nullable minutes', () => {
    expect(reminderMinutesForValue('off')).toBeNull();
    expect(reminderMinutesForValue('15')).toBe(15);
    expect(reminderMinutesForValue('unknown')).toBeNull();
  });

  it('names the busy submit state', () => {
    expect(scheduledCreateButtonLabel(false)).toBe('创建');
    expect(scheduledCreateButtonLabel(true)).toBe('创建中…');
  });

  it('describes repeat and reminder selections', () => {
    expect(scheduledRepeatSummary('daily')).toBe('每天重复');
    expect(scheduledRepeatSummary('once')).toBe('只运行一次');
    expect(scheduledRepeatSummary('custom')).toBe('自定义重复');
    expect(scheduledReminderSummary('off')).toBe('不提醒');
    expect(scheduledReminderSummary('0')).toBe('执行时提醒');
    expect(scheduledReminderSummary('15')).toBe('提前 15 分钟提醒');
    expect(scheduledReminderSummary('60')).toBe('提前 1 小时提醒');
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

  it('keeps an unchanged scheduled dialog draft clean', () => {
    expect(
      scheduledDialogHasDraftChanges({
        initialIntent: '同步周报',
        initialScheduledAt: '2026-05-23T09:00',
        intent: '  同步周报  ',
        scheduledAt: '2026-05-23T09:00',
        repeatType: 'daily',
        reminderValue: 'off',
        description: '',
        rrule: '',
      }),
    ).toBe(false);
  });

  it('detects scheduled dialog draft edits', () => {
    const base = {
      initialIntent: '',
      initialScheduledAt: '2026-05-23T09:00',
      intent: '',
      scheduledAt: '2026-05-23T09:00',
      repeatType: 'daily' as const,
      reminderValue: 'off',
      description: '',
      rrule: '',
    };

    expect(scheduledDialogHasDraftChanges({ ...base, intent: '生成日报' })).toBe(true);
    expect(
      scheduledDialogHasDraftChanges({
        ...base,
        scheduledAt: '2026-05-23T10:00',
      }),
    ).toBe(true);
    expect(scheduledDialogHasDraftChanges({ ...base, repeatType: 'weekly' })).toBe(true);
    expect(scheduledDialogHasDraftChanges({ ...base, reminderValue: '15' })).toBe(true);
    expect(scheduledDialogHasDraftChanges({ ...base, description: '发给产品群' })).toBe(true);
    expect(scheduledDialogHasDraftChanges({ ...base, rrule: 'FREQ=WEEKLY' })).toBe(true);
  });
});
