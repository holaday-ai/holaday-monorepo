import { pageErrorMessage } from './page-error-copy';

export const MAX_FEEDBACK_MESSAGE_LENGTH = 4000;
export const FEEDBACK_AUTOCLOSE_MS = 1200;

export function normaliseFeedbackMessage(value: string): string {
  return value.trim();
}

export function feedbackMessageState(value: string): {
  trimmed: string;
  length: number;
  remaining: number;
  canSubmit: boolean;
} {
  const trimmed = normaliseFeedbackMessage(value);
  const length = value.length;
  return {
    trimmed,
    length,
    remaining: Math.max(0, MAX_FEEDBACK_MESSAGE_LENGTH - length),
    canSubmit: trimmed.length > 0 && length <= MAX_FEEDBACK_MESSAGE_LENGTH,
  };
}

export function feedbackCounterLabel(value: string): string {
  const state = feedbackMessageState(value);
  return `${state.length}/${MAX_FEEDBACK_MESSAGE_LENGTH}`;
}

export function feedbackSubmitError(err: unknown): string {
  return pageErrorMessage(err, '反馈发送失败，请稍后重试。');
}
