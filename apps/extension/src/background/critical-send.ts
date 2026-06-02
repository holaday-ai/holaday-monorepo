import type { ClientMessage } from '@holaday/shared-types';
import { getCurrentWsToken, send } from './ws-client.js';

const CRITICAL_SEND_RETRY_DELAYS_MS = [250, 1_000, 3_000, 7_000, 15_000] as const;
const MAX_ACTIVE_CRITICAL_SEND_KEYS = 100;
const activeCriticalSendGenerations = new Map<string, number>();

export function sendCriticalClientMessage(
  message: ClientMessage,
  label: string,
  options: { ownerToken?: string | null } = {},
): boolean {
  const ownerToken = options.ownerToken ?? getCurrentWsToken();
  const messageKey = criticalMessageKey(message);
  const generation = messageKey ? bumpCriticalSendGeneration(messageKey) : 0;
  if (isOwnerTokenChanged(ownerToken)) {
    console.warn(`[holaday] ${label} send cancelled after token change`, {
      ...criticalMessageLogMeta(message),
      attempt: 0,
    });
    if (messageKey) activeCriticalSendGenerations.delete(messageKey);
    return false;
  }
  const sent = send(message);
  if (sent && messageKey) activeCriticalSendGenerations.delete(messageKey);
  if (!sent) {
    console.warn(`[holaday] ${label} send failed`, criticalMessageLogMeta(message));
    scheduleCriticalClientMessageRetry(message, label, 0, ownerToken, messageKey, generation);
  }
  return sent;
}

function scheduleCriticalClientMessageRetry(
  message: ClientMessage,
  label: string,
  attemptIndex: number,
  ownerToken: string | null,
  messageKey: string | null,
  generation: number,
): void {
  const delay = CRITICAL_SEND_RETRY_DELAYS_MS[attemptIndex];
  if (delay === undefined) {
    console.warn(`[holaday] ${label} retry exhausted`, criticalMessageLogMeta(message));
    if (messageKey) activeCriticalSendGenerations.delete(messageKey);
    return;
  }
  setTimeout(() => {
    if (isCriticalSendGenerationStale(messageKey, generation)) return;
    if (isOwnerTokenChanged(ownerToken)) {
      console.warn(`[holaday] ${label} retry cancelled after token change`, {
        ...criticalMessageLogMeta(message),
        attempt: attemptIndex + 1,
      });
      if (messageKey) activeCriticalSendGenerations.delete(messageKey);
      return;
    }
    if (send(message)) {
      if (messageKey) activeCriticalSendGenerations.delete(messageKey);
      return;
    }
    scheduleCriticalClientMessageRetry(
      message,
      label,
      attemptIndex + 1,
      ownerToken,
      messageKey,
      generation,
    );
  }, delay);
}

function isOwnerTokenChanged(ownerToken: string | null): boolean {
  const currentToken = getCurrentWsToken();
  return Boolean(ownerToken && currentToken && currentToken !== ownerToken);
}

function bumpCriticalSendGeneration(messageKey: string): number {
  const next = (activeCriticalSendGenerations.get(messageKey) ?? 0) + 1;
  activeCriticalSendGenerations.set(messageKey, next);
  pruneActiveCriticalSendGenerations();
  return next;
}

function pruneActiveCriticalSendGenerations(): void {
  while (activeCriticalSendGenerations.size > MAX_ACTIVE_CRITICAL_SEND_KEYS) {
    const oldestKey = activeCriticalSendGenerations.keys().next().value;
    if (typeof oldestKey !== 'string') return;
    activeCriticalSendGenerations.delete(oldestKey);
  }
}

function isCriticalSendGenerationStale(messageKey: string | null, generation: number): boolean {
  return Boolean(messageKey && activeCriticalSendGenerations.get(messageKey) !== generation);
}

function criticalMessageKey(message: ClientMessage): string | null {
  if ('taskId' in message && 'requestId' in message) {
    return `${message.type}\u0000${message.taskId}\u0000${message.requestId}`;
  }
  if ('taskId' in message && 'stepId' in message) {
    return `${message.type}\u0000${message.taskId}\u0000${message.stepId}`;
  }
  if ('taskId' in message && 'tickIndex' in message) {
    return `${message.type}\u0000${message.taskId}\u0000${message.tickIndex}`;
  }
  return null;
}

function criticalMessageLogMeta(message: ClientMessage): Record<string, unknown> {
  return {
    type: message.type,
    ...('taskId' in message ? { taskId: message.taskId } : {}),
    ...('requestId' in message ? { requestId: message.requestId } : {}),
    ...('stepId' in message ? { stepId: message.stepId } : {}),
    ...('tickIndex' in message ? { tickIndex: message.tickIndex } : {}),
  };
}

export function _resetCriticalSendStateForTests(): void {
  activeCriticalSendGenerations.clear();
}
