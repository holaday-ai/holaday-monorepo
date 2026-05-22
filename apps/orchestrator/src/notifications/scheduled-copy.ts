import type { NotificationType } from './webhook-sender.js';

export interface ScheduledDispatchNotification {
  type: NotificationType;
  title: string;
  message: string;
  taskName: string;
}

export function buildScheduledDispatchNotification(input: {
  intent: string;
  ok: boolean;
  error: string | null;
}): ScheduledDispatchNotification {
  const taskName = truncateIntent(input.intent);
  if (input.ok) {
    return {
      // Keep the existing success channel/type for inbox and webhook
      // compatibility; the title/message now describe dispatch truth.
      type: 'task_complete',
      title: '定时任务已启动',
      message: `「${taskName}」已按计划开始执行。完成后可在任务列表查看结果。`,
      taskName,
    };
  }
  return {
    type: 'task_failed',
    title: '定时任务启动失败',
    message: `「${taskName}」未能开始执行：${input.error ?? '未知错误'}`,
    taskName,
  };
}

function truncateIntent(intent: string): string {
  return intent.length > 60 ? `${intent.slice(0, 60)}…` : intent;
}
