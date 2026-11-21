import type { UiTask } from '@/types/task';

export function normalizeExecutionObservation(value: unknown): UiTask['executionObservation'] {
  if (!value || typeof value !== 'object' || !('state' in value) || value.state !== 'unconfirmed')
    return null;
  if (!('reason' in value)) return null;
  const reason = value.reason;
  if (
    reason !== 'session_not_observed' &&
    reason !== 'session_finishing' &&
    reason !== 'control_closed' &&
    reason !== 'input_outcome_unknown'
  )
    return null;
  return { state: 'unconfirmed', reason };
}

export function isExecutionUnconfirmed(task: {
  status: string;
  browserSource?: UiTask['browserSource'];
  executionObservation?: UiTask['executionObservation'];
}): boolean {
  return (
    task.status === 'executing' &&
    task.browserSource === 'local-chrome' &&
    normalizeExecutionObservation(task.executionObservation) != null
  );
}
