import type { ServerMessage } from '@holaday/shared-types';

export type SupercarTaskOutcomeStatus =
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'handoff_to_generate'
  | 'awaiting_user';

export type SupercarTaskStateTransition =
  | { kind: 'terminal' }
  | {
      kind: 'waiting_user';
      awaitingKind: 'clarification';
      question: string;
    };

export function classifySupercarTaskStateTransition(input: {
  status: SupercarTaskOutcomeStatus;
  question?: string | null;
  summary?: string | null;
}): SupercarTaskStateTransition {
  if (input.status !== 'awaiting_user') return { kind: 'terminal' };
  return {
    kind: 'waiting_user',
    awaitingKind: 'clarification',
    question:
      normalizedText(input.question) ?? normalizedText(input.summary) ?? '请补充必要信息后继续。',
  };
}

export function shouldRunSupercarTerminalSideEffects(input: {
  transition: SupercarTaskStateTransition;
  persisted: boolean;
}): boolean {
  return input.persisted && input.transition.kind === 'terminal';
}

export function shouldPersistSupercarTerminalOutcome(status: SupercarTaskOutcomeStatus): boolean {
  return status !== 'awaiting_user';
}

export function buildSupercarWaitingUserMessage(input: {
  taskId: string;
  transition: Extract<SupercarTaskStateTransition, { kind: 'waiting_user' }>;
}): Extract<ServerMessage, { type: 'server.supercar.awaiting_user' }> {
  return {
    type: 'server.supercar.awaiting_user',
    taskId: input.taskId,
    question: input.transition.question,
    awaitingKind: input.transition.awaitingKind,
  };
}

function normalizedText(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
