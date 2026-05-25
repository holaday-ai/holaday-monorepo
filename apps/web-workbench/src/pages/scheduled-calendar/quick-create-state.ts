export type QuickCreateRepeatType = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';

export const QUICK_CREATE_CUSTOM_RRULE_ERROR =
  '请填写 RRULE，或改用预设频率。';

export function quickCreateSubmitLabel(submitting: boolean): string {
  return submitting ? '创建中…' : '创建';
}

export function quickCreateValidationMessage(input: {
  repeatType: QuickCreateRepeatType;
  rrule: string;
}): string | null {
  if (input.repeatType === 'custom' && !input.rrule.trim()) {
    return QUICK_CREATE_CUSTOM_RRULE_ERROR;
  }
  return null;
}

export function quickCreateCanSubmit(input: {
  intent: string;
  repeatType: QuickCreateRepeatType;
  rrule: string;
  submitting: boolean;
}): boolean {
  if (input.submitting) return false;
  if (!input.intent.trim()) return false;
  return quickCreateValidationMessage(input) === null;
}
