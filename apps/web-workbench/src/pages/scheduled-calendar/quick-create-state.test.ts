import { describe, expect, it } from 'vitest';
import {
  QUICK_CREATE_CUSTOM_RRULE_ERROR,
  quickCreateCanSubmit,
  quickCreateSubmitLabel,
  quickCreateValidationMessage,
} from './quick-create-state.js';

describe('quick create state helpers', () => {
  it('names the busy submit state', () => {
    expect(quickCreateSubmitLabel(false)).toBe('创建');
    expect(quickCreateSubmitLabel(true)).toBe('创建中…');
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
