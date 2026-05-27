import { describe, expect, it } from 'vitest';
import {
  QUICK_CREATE_CUSTOM_RRULE_ERROR,
  quickCreateCanSubmit,
  quickCreateReminderLabel,
  quickCreateRepeatLabel,
  quickCreateSubmitLabel,
  quickCreateValidationMessage,
} from './quick-create-state.js';

describe('quick create state helpers', () => {
  it('names the busy submit state', () => {
    expect(quickCreateSubmitLabel(false)).toBe('创建');
    expect(quickCreateSubmitLabel(true)).toBe('创建中…');
  });

  it('describes repeat and reminder selections for the compact summary', () => {
    expect(quickCreateRepeatLabel('once')).toBe('只运行一次');
    expect(quickCreateRepeatLabel('weekly')).toBe('每周重复');
    expect(quickCreateRepeatLabel('custom')).toBe('自定义重复');
    expect(quickCreateReminderLabel(null)).toBe('不提醒');
    expect(quickCreateReminderLabel(0)).toBe('执行时提醒');
    expect(quickCreateReminderLabel(60)).toBe('提前 1 小时提醒');
    expect(quickCreateReminderLabel(15)).toBe('提前 15 分钟提醒');
  });

  it('blocks empty intents and active submissions', () => {
    expect(
      quickCreateCanSubmit({
        intent: '   ',
        repeatType: 'once',
        rrule: '',
        submitting: false,
      }),
    ).toBe(false);
    expect(
      quickCreateCanSubmit({
        intent: '生成日报',
        repeatType: 'daily',
        rrule: '',
        submitting: true,
      }),
    ).toBe(false);
  });

  it('requires an RRULE for custom repeat', () => {
    expect(
      quickCreateValidationMessage({
        repeatType: 'custom',
        rrule: '   ',
      }),
    ).toBe(QUICK_CREATE_CUSTOM_RRULE_ERROR);
    expect(
      quickCreateCanSubmit({
        intent: '同步周报',
        repeatType: 'custom',
        rrule: '',
        submitting: false,
      }),
    ).toBe(false);
  });

  it('allows preset repeats without RRULE text', () => {
    expect(
      quickCreateValidationMessage({
        repeatType: 'weekly',
        rrule: '',
      }),
    ).toBeNull();
    expect(
      quickCreateCanSubmit({
        intent: '同步周报',
        repeatType: 'weekly',
        rrule: '',
        submitting: false,
      }),
    ).toBe(true);
  });
});
