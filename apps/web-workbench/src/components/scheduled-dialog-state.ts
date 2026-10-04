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

/**
 * Batch 10.3 — failure notification threshold. Failures always land in the
 * inbox + configured IM bots once the streak reaches N (then every N);
 * success stays silent unless `notifyOnSuccess`.
 */
export const FAILURE_NOTIFY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: '每次失败' },
  { value: 2, label: '连续 2 次' },
  { value: 3, label: '连续 3 次' },
  { value: 5, label: '连续 5 次' },
];

export function scheduledNotifySummary(input: {
  failureNotifyThreshold: number;
  notifyOnSuccess: boolean;
}): string {
  const failure =
    input.failureNotifyThreshold <= 1
      ? '失败即通知'
      : `连续失败 ${input.failureNotifyThreshold} 次通知`;
  return input.notifyOnSuccess ? `${failure}，成功也通知` : failure;
}

export interface ScheduledCreatePayload {
  intent: string;
  repeatType: 'once' | 'daily' | 'weekly' | 'monthly';
  scheduledAt: string;
  reminderMinutes: number | null;
  rrule?: string;
  description?: string;
  notifyOnSuccess?: boolean;
  failureNotifyThreshold?: number;
}

export function reminderMinutesForValue(value: string): number | null {
  return REMINDER_OPTIONS.find((o) => o.value === value)?.minutes ?? null;
}

export function scheduledCreateButtonLabel(submitting: boolean): string {
  return submitting ? '创建中…' : '创建';
}

export function scheduledDialogHasDraftChanges(input: {
  readonly initialIntent: string;
  readonly initialScheduledAt: string;
  readonly intent: string;
  readonly repeatType: DialogRepeatType;
  readonly reminderValue: string;
  readonly description: string;
  readonly rrule: string;
  readonly scheduledAt: string;
  readonly notifyOnSuccess?: boolean;
  readonly failureNotifyThreshold?: number;
}): boolean {
  return (
    input.notifyOnSuccess === true ||
    (input.failureNotifyThreshold ?? 1) !== 1 ||
    input.intent.trim() !== input.initialIntent.trim() ||
    input.scheduledAt !== input.initialScheduledAt ||
    input.repeatType !== 'daily' ||
    input.reminderValue !== 'off' ||
    input.description.trim().length > 0 ||
    input.rrule.trim().length > 0
  );
}

export function scheduledRepeatSummary(repeatType: DialogRepeatType): string {
  switch (repeatType) {
    case 'once':
      return '只运行一次';
    case 'weekly':
      return '每周重复';
    case 'monthly':
      return '每月重复';
    case 'custom':
      return '自定义重复';
    case 'daily':
    default:
      return '每天重复';
  }
}

export function scheduledReminderSummary(value: string): string {
  const minutes = reminderMinutesForValue(value);
  if (minutes === null) return '不提醒';
  if (minutes === 0) return '执行时提醒';
  if (minutes === 60) return '提前 1 小时提醒';
  return `提前 ${minutes} 分钟提醒`;
}

export function buildScheduledCreatePayload(input: {
  intent: string;
  repeatType: DialogRepeatType;
  scheduledAt: Date;
  reminderValue: string;
  rrule: string;
  description: string;
  notifyOnSuccess?: boolean;
  failureNotifyThreshold?: number;
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
    ...(input.notifyOnSuccess ? { notifyOnSuccess: true } : {}),
    ...(input.failureNotifyThreshold && input.failureNotifyThreshold !== 1
      ? { failureNotifyThreshold: input.failureNotifyThreshold }
      : {}),
  };
}
