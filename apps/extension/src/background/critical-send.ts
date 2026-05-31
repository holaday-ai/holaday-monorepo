import type { ClientMessage } from '@holaday/shared-types';
import { send } from './ws-client.js';

const CRITICAL_SEND_RETRY_DELAYS_MS = [250, 1_000, 3_000, 7_000, 15_000] as const;

export function sendCriticalClientMessage(message: ClientMessage, label: string): boolean {
  const sent = send(message);
  if (!sent) {
    console.warn(`[holaday] ${label} send failed`, criticalMessageLogMeta(message));
    scheduleCriticalClientMessageRetry(message, label, 0);
  }
  return sent;
}

function scheduleCriticalClientMessageRetry(
  message: ClientMessage,
  label: string,
  attemptIndex: number,
): void {
  const delay = CRITICAL_SEND_RETRY_DELAYS_MS[attemptIndex];
  if (delay === undefined) {
    console.warn(`[holaday] ${label} retry exhausted`, criticalMessageLogMeta(message));
    return;
  }
  setTimeout(() => {
    if (send(message)) return;
    scheduleCriticalClientMessageRetry(message, label, attemptIndex + 1);
  }, delay);
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
