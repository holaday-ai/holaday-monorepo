export type TaskTerminalStatus =
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'cancelled';

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

