import {
  normalizeAwaitingKind,
  type AwaitingKind,
} from './awaiting-user-copy';

export type TaskProductLifecycle =
  | 'queued'
  | 'running'
  | 'waiting_user'
  | 'paused'
  | 'terminal'
  | 'unknown';

export type TaskProductPhase =
  | 'planning'
  | 'browsing'
  | 'extracting'
  | 'verifying'
  | 'generating'
  | 'generating_image';

export type TaskProductOutcome =
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'cancelled';

export type TaskProductBlocker =
  | AwaitingKind
  | 'max_steps'
  | 'retries_exhausted';

export type TaskProductState =
  | { lifecycle: 'queued'; queuePosition?: number }
  | { lifecycle: 'running'; phase?: TaskProductPhase }
  | { lifecycle: 'waiting_user'; blocker: TaskProductBlocker }
  | { lifecycle: 'paused'; blocker?: TaskProductBlocker }
  | { lifecycle: 'terminal'; outcome?: TaskProductOutcome }
  | { lifecycle: 'unknown' };

export interface TaskProductStateInput {
  status: string;
  subStatus?: TaskProductPhase | null;
  queuePosition?: number | null;
  tickCount?: number | null;
  awaitingKind?: AwaitingKind | null;
  hasAwaitingUser?: boolean;
  terminal?: boolean;
}

export function deriveTaskProductState(
  input: TaskProductStateInput,
): TaskProductState {
  if (input.status === 'paused') {
    return { lifecycle: 'paused' };
  }

  const outcome = terminalOutcome(input.status);
  if (input.terminal || outcome) {
    return outcome
      ? { lifecycle: 'terminal', outcome }
      : { lifecycle: 'terminal' };
  }

  if (input.status === 'awaiting_user' || input.hasAwaitingUser || input.awaitingKind) {
    return {
      lifecycle: 'waiting_user',
      blocker: normalizeAwaitingKind(input.awaitingKind ?? undefined),
    };
  }

  if (!isKnownProductStatus(input.status)) {
    return { lifecycle: 'unknown' };
  }

  if (isQueued(input)) {
    return {
      lifecycle: 'queued',
      ...(typeof input.queuePosition === 'number'
        ? { queuePosition: input.queuePosition }
        : {}),
    };
  }

  const phase = runningPhase(input);
  return phase ? { lifecycle: 'running', phase } : { lifecycle: 'running' };
}

function isKnownProductStatus(status: string): boolean {
  return (
    status === 'pending' ||
    status === 'planning' ||
    status === 'queued' ||
    status === 'executing' ||
    status === 'awaiting_user' ||
    status === 'paused' ||
    status === 'completed' ||
    status === 'partial_success' ||
    status === 'failed' ||
    status === 'cancelled'
  );
}

function terminalOutcome(status: string): TaskProductOutcome | null {
  switch (status) {
    case 'completed':
    case 'partial_success':
    case 'failed':
    case 'cancelled':
      return status;
    default:
      return null;
  }
}

function isQueued(input: TaskProductStateInput): boolean {
  if (input.status === 'queued') return true;
  return (
    typeof input.queuePosition === 'number' &&
    input.queuePosition > 1 &&
    (input.tickCount ?? 0) === 0
  );
}

function runningPhase(input: TaskProductStateInput): TaskProductPhase | null {
  if (input.subStatus) return input.subStatus;
  if (input.status === 'pending' || input.status === 'planning') return 'planning';
  return null;
}
