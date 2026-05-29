import { describe, expect, it } from 'vitest';
import {
  MAX_FEEDBACK_MESSAGE_LENGTH,
  feedbackCounterLabel,
  feedbackMessageState,
  feedbackSubmitError,
  normaliseFeedbackMessage,
} from './feedback-dialog-state';

describe('feedback dialog state', () => {
  it('normalises whitespace before deciding submit readiness', () => {
    expect(normaliseFeedbackMessage('  hello  ')).toBe('hello');
    expect(feedbackMessageState('   ').canSubmit).toBe(false);
    expect(feedbackMessageState('  real feedback  ').canSubmit).toBe(true);
  });

  it('reports the exact character budget', () => {
    const value = 'a'.repeat(MAX_FEEDBACK_MESSAGE_LENGTH - 1);
    expect(feedbackMessageState(value)).toMatchObject({
      length: MAX_FEEDBACK_MESSAGE_LENGTH - 1,
      remaining: 1,
      canSubmit: true,
    });
    expect(feedbackCounterLabel(value)).toBe(`${MAX_FEEDBACK_MESSAGE_LENGTH - 1}/4000`);
  });

  it('blocks messages beyond the server limit', () => {
    const state = feedbackMessageState('a'.repeat(MAX_FEEDBACK_MESSAGE_LENGTH + 1));
    expect(state.remaining).toBe(0);
    expect(state.canSubmit).toBe(false);
  });

  it('formats thrown submit errors for inline display', () => {
    expect(feedbackSubmitError(new Error('network down'))).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
    expect(feedbackSubmitError('反馈内容过长')).toBe('反馈内容过长');
    expect(feedbackSubmitError(null)).toBe('反馈发送失败，请稍后重试。');
  });
});
