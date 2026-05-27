export type QuickCreateRepeatType = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';

export const QUICK_CREATE_CUSTOM_RRULE_ERROR =
  '请填写 RRULE，或改用预设频率。';

export function quickCreateSubmitLabel(submitting: boolean): string {
  return submitting ? '创建中…' : '创建';
}

export function quickCreateRepeatLabel(repeatType: QuickCreateRepeatType): string {
  switch (repeatType) {
    case 'daily':
      return '每天重复';
    case 'weekly':
      return '每周重复';
    case 'monthly':
      return '每月重复';
    case 'custom':
      return '自定义重复';
    case 'once':
    default:
      return '只运行一次';
  }
}

export function quickCreateReminderLabel(minutes: number | null): string {
  if (minutes === null) return '不提醒';
  if (minutes === 0) return '执行时提醒';
  if (minutes === 60) return '提前 1 小时提醒';
  return `提前 ${minutes} 分钟提醒`;
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
