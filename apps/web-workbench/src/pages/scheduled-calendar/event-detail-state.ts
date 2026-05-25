import type { ScheduledTaskRow } from './event-mapping';

export type ScheduledEventStatus = ScheduledTaskRow['status'];

export function scheduledEventCanToggle(status: ScheduledEventStatus): boolean {
  return status === 'active' || status === 'paused' || status === 'failed';
}

export function scheduledEventCanRunNow(status: ScheduledEventStatus): boolean {
  return status === 'active' || status === 'paused' || status === 'failed';
}

export function scheduledEventToggleLabel(status: ScheduledEventStatus): string {
  if (status === 'paused') return '恢复';
  if (status === 'failed') return '重新启用';
  return '暂停';
}

export function scheduledEventToggleSuccessMessage(input: {
  previousStatus?: ScheduledEventStatus | string;
  nextStatus: ScheduledEventStatus | string;
}): string {
  if (input.nextStatus === 'paused') return '已暂停';
  if (input.previousStatus === 'failed' && input.nextStatus === 'active') {
    return '已重新启用';
  }
  if (input.nextStatus === 'active') return '已恢复';
  return '已更新';
}

export function describeScheduledEventReminder(minutes: number | null): string {
  if (minutes === null) return '不提醒';
  if (minutes === 0) return '执行时';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes === 60) return '1 小时前';
  const hours = Math.round(minutes / 60);
  return `${hours} 小时前`;
}

export function describeScheduledEventRepeat(row: Pick<ScheduledTaskRow, 'repeatType' | 'rrule'>): string {
  if (row.rrule && row.rrule.trim().length > 0) {
    return `自定义：${row.rrule.length > 40 ? `${row.rrule.slice(0, 40)}…` : row.rrule}`;
  }
  switch (row.repeatType) {
    case 'once':
      return '只运行一次';
    case 'daily':
      return '每天';
    case 'weekly':
      return '每周';
    case 'monthly':
      return '每月';
    default:
      return row.repeatType;
  }
}
