import { humaniseTaskError } from '@/lib/error-copy';
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

export function scheduledEventFailureDetail(error: string | null): string {
  return humaniseTaskError(error) || '上次执行失败，请检查任务配置后重试。';
}

export type ScheduledEventActionHint = {
  title: string;
  body: string;
  tone: 'neutral' | 'attention' | 'error';
};

export function scheduledEventActionHint(
  row: Pick<ScheduledTaskRow, 'status' | 'lastRunStatus'>,
): ScheduledEventActionHint | null {
  if (row.status === 'paused') {
    return {
      title: '计划已暂停',
      body: '恢复后会按下次执行时间继续；立即执行一次只会单独创建一条实际任务，不会改变原计划。',
      tone: 'neutral',
    };
  }
  if (row.status === 'failed') {
    return {
      title: '计划已停止',
      body: '重新启用会恢复后续计划；立即执行一次会新开任务，适合先验证问题是否已经解决。',
      tone: 'error',
    };
  }
  if (row.status === 'active' && row.lastRunStatus === 'failed') {
    return {
      title: '上次执行失败，计划仍在运行',
      body: '可以立即执行一次验证修复结果；如果外部网站仍需要登录或授权，先暂停计划会更稳妥。',
      tone: 'attention',
    };
  }
  if (row.status === 'active' && row.lastRunStatus === 'skipped') {
    return {
      title: '上次执行已跳过',
      body: '计划仍在运行；这通常表示本次条件不满足，例如非交易日、缺少可用窗口或外部来源暂不可用。',
      tone: 'neutral',
    };
  }
  if (row.status === 'running') {
    return {
      title: '正在执行',
      body: '这次运行结束前暂不能修改计划。完成后可以在任务详情查看结果。',
      tone: 'neutral',
    };
  }
  return null;
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
