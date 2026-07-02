export type TaskTerminalStatus =
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'cancelled';

export const TASK_ACTIVE_STATUSES = [
  'pending',
  'planning',
  'queued',
  'executing',
  'awaiting_user',
  'paused',
] as const;

export type TaskActiveStatus = (typeof TASK_ACTIVE_STATUSES)[number];

export const TASK_QUEUE_DEPTH_STATUSES = [
  'pending',
  'planning',
  'queued',
  'executing',
] as const;

export type TaskQueueDepthStatus = (typeof TASK_QUEUE_DEPTH_STATUSES)[number];

export const TASK_RUNNER_OUTCOME_SOURCE_STATUSES = [
  'pending',
  'planning',
  'queued',
  'executing',
] as const;

export const TASK_RUNNER_CANCEL_SOURCE_STATUSES = [
  ...TASK_RUNNER_OUTCOME_SOURCE_STATUSES,
  'paused',
] as const;

export function taskRunnerOutcomeSourceStatuses(
  nextStatus: TaskTerminalStatus | 'paused',
): readonly TaskActiveStatus[] {
  return nextStatus === 'cancelled'
    ? TASK_RUNNER_CANCEL_SOURCE_STATUSES
    : TASK_RUNNER_OUTCOME_SOURCE_STATUSES;
}

const TASK_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'partial_success',
  'failed',
  'cancelled',
]);

export function isTaskTerminalStatus(
  status: string | null | undefined,
): status is TaskTerminalStatus {
  return typeof status === 'string' && TASK_TERMINAL_STATUSES.has(status);
}
