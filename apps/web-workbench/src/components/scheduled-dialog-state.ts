export type DialogRepeatType = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';

export const REPEAT_OPTIONS: ReadonlyArray<{ value: DialogRepeatType; label: string }> = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'once', label: '只运行一次' },
  { value: 'custom', label: '自定义' },
];

export const REMINDER_OPTIONS: ReadonlyArray<{
  value: string;
  minutes: number | null;
  label: string;
}> = [
  { value: 'off', minutes: null, label: '不提醒' },
  { value: '0', minutes: 0, label: '执行时' },
  { value: '5', minutes: 5, label: '5 分钟前' },
  { value: '15', minutes: 15, label: '15 分钟前' },
  { value: '30', minutes: 30, label: '30 分钟前' },
  { value: '60', minutes: 60, label: '1 小时前' },
];

export interface ScheduledCreatePayload {
  intent: string;
  repeatType: 'once' | 'daily' | 'weekly' | 'monthly';
  scheduledAt: string;
  reminderMinutes: number | null;
  rrule?: string;
  description?: string;
}

export function reminderMinutesForValue(value: string): number | null {
  return REMINDER_OPTIONS.find((o) => o.value === value)?.minutes ?? null;
}

export function buildScheduledCreatePayload(input: {
  intent: string;
  repeatType: DialogRepeatType;
  scheduledAt: Date;
  reminderValue: string;
  rrule: string;
  description: string;
}): ScheduledCreatePayload {
  const trimmedIntent = input.intent.trim();
  const trimmedRrule = input.rrule.trim();
  const trimmedDescription = input.description.trim();
  if (input.repeatType === 'custom' && !trimmedRrule) {
    throw new Error('请填写自定义重复规则');
  }
  return {
    intent: trimmedIntent,
    repeatType: input.repeatType === 'custom' ? 'once' : input.repeatType,
    scheduledAt: input.scheduledAt.toISOString(),
    reminderMinutes: reminderMinutesForValue(input.reminderValue),
    ...(input.repeatType === 'custom' ? { rrule: trimmedRrule } : {}),
    ...(trimmedDescription ? { description: trimmedDescription } : {}),
  };
}
