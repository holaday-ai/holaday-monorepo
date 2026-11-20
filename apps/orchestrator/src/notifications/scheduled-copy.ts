import type { TaskOutcomeKind } from './task-outcome-policy.js';
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
  skipped?: boolean;
}): ScheduledDispatchNotification {
  const taskName = truncateIntent(input.intent);
  if (input.skipped) {
    return {
      type: 'task_skipped',
      title: '定时任务已跳过',
      message: `「${taskName}」本次未启动：${input.error ?? '本次条件不满足'}`,
      taskName,
    };
  }
  if (input.ok) {
    return {
      // Dispatch success means a real task was created; the task's
      // own terminal state will be visible in the task list later.
      type: 'task_started',
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

/**
 * Batch 10.3 — map a runner `notify` call (dispatch or task_terminal) to the
 * outcome kind used by `decideTaskOutcomeNotification`.
 */
export function scheduledOutcomeKind(input: {
  ok: boolean;
  skipped?: boolean;
  phase?: 'dispatch' | 'task_terminal';
  outcome?: 'success' | 'failed' | 'cancelled';
}): TaskOutcomeKind {
  if (input.skipped) return 'skipped';
  if (input.outcome) return input.outcome;
  if (input.phase === 'task_terminal') return input.ok ? 'success' : 'failed';
  return input.ok ? 'started' : 'failed';
}

/**
 * Batch 10.3 — copy for one scheduled/planned outcome. `label` is the
 * product noun ('定时任务' / '规划任务').
 */
export function buildTaskOutcomeNotification(input: {
  label: '定时任务' | '规划任务';
  name: string;
  kind: TaskOutcomeKind;
  phase: 'dispatch' | 'task_terminal';
  error: string | null;
  consecutiveFailures?: number;
}): ScheduledDispatchNotification {
  const taskName = truncateIntent(input.name);
  const streak =
    input.consecutiveFailures && input.consecutiveFailures > 1
      ? `（已连续失败 ${input.consecutiveFailures} 次）`
      : '';
  if (input.kind === 'failed') {
    const startup = input.phase === 'dispatch';
    return {
      type: 'task_failed',
      title: startup ? `${input.label}启动失败` : `${input.label}执行失败`,
      message: `「${taskName}」${startup ? '未能开始执行' : '执行失败'}：${input.error ?? '未知错误'}${streak}`,
      taskName,
    };
  }
  if (input.kind === 'success') {
    return {
      type: 'task_complete',
      title: `${input.label}已完成`,
      message: `「${taskName}」已执行完成，可在任务列表查看结果。`,
      taskName,
    };
  }
  if (input.kind === 'cancelled') {
    return {
      type: 'task_skipped',
      title: `${input.label}已取消`,
      message: `「${taskName}」本次执行已取消。`,
      taskName,
    };
  }
  return buildScheduledDispatchNotification({
    intent: input.name,
    ok: input.kind === 'started',
    error: input.error,
    skipped: input.kind === 'skipped',
  });
}

function truncateIntent(intent: string): string {
  return intent.length > 60 ? `${intent.slice(0, 60)}…` : intent;
}
