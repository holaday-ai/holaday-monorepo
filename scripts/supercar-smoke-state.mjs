const TERMINAL_STATUSES = new Set([
  'completed',
  'partial_success',
  'failed',
  'cancelled',
]);

const ACTION_REQUIRED_STATUSES = new Set(['awaiting_user', 'paused']);

export function classifySmokePollStatus(status) {
  if (TERMINAL_STATUSES.has(status)) return 'terminal';
  if (ACTION_REQUIRED_STATUSES.has(status)) return 'action_required';
  return 'continue';
}

export function selectSmokeTasks(tasks, rawIds) {
  const requested = new Set(
    String(rawIds ?? '')
      .split(',')
      .map((id) => id.trim().toUpperCase())
      .filter(Boolean),
  );
  if (requested.size === 0) return tasks;

  const known = new Set(tasks.map((task) => task.id));
  const unknown = [...requested].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown smoke task ids: ${unknown.join(', ')}`);
  }

  return tasks.filter((task) => requested.has(task.id));
}
