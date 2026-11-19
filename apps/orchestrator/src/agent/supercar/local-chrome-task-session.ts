import type { SelectedChromeSessionCommand } from '@holaday/shared-types';
import {
  type BrowserCapabilities,
  browserCapabilities,
} from '../../config/browser-capabilities.js';
import type { ExtensionToolCallOptions, ExtensionToolCallOutcome } from '../../ws/server.js';
import { BrowserControl } from './browser-control.js';
import { SelectedChromeClient } from './selected-chrome-client.js';

export type LocalChromeSelection = Extract<
  SelectedChromeSessionCommand,
  { op: 'open' }
>['target'] & { extensionClientId: string };
type Send = (
  userId: string,
  options: ExtensionToolCallOptions,
) => Promise<ExtensionToolCallOutcome>;
export type LocalChromeReservation = Readonly<{ key: string; nonce: symbol }>;
export type LocalChromeExecutionObservation = {
  state: 'unconfirmed';
  reason: 'session_not_observed' | 'session_finishing' | 'control_closed' | 'input_outcome_unknown';
};
type Session = {
  reservation: LocalChromeReservation;
  userId: string;
  taskId: string;
  selection: LocalChromeSelection;
  capabilities: BrowserCapabilities;
  control: BrowserControl;
  client: SelectedChromeClient;
  cancellation: AbortController;
  finishing: boolean;
};

/** Runtime handles are never looked up by a caller-controlled task ID alone. */
export class LocalChromeTaskSessions {
  private readonly entries = new Map<string, Session>();
  private readonly reservations = new Map<
    string,
    { ticket: LocalChromeReservation; claimed: boolean }
  >();
  reserve(userId: string, selection: LocalChromeSelection): LocalChromeReservation {
    const key = JSON.stringify([userId, selection.extensionClientId]);
    if (this.reservations.has(key)) throw new Error('chrome_connection_busy');
    const ticket = Object.freeze({ key, nonce: Symbol('local-chrome-reservation') });
    this.reservations.set(key, { ticket, claimed: false });
    return ticket;
  }
  releaseReservation(ticket: LocalChromeReservation): void {
    const reservation = this.reservations.get(ticket.key);
    if (reservation?.ticket === ticket && !reservation.claimed)
      this.reservations.delete(ticket.key);
  }
  get(userId: string, taskId: string): Session | undefined {
    return this.entries.get(JSON.stringify([userId, taskId]));
  }
  /** Read-only evidence from this process, never a terminal verdict or permission to replay. */
  executionObservation(userId: string, taskId: string): LocalChromeExecutionObservation | null {
    const session = this.get(userId, taskId);
    if (!session) return { state: 'unconfirmed', reason: 'session_not_observed' };
    if (session.finishing) return { state: 'unconfirmed', reason: 'session_finishing' };
    const control = session.control.snapshot();
    if (control.phase === 'closed')
      return {
        state: 'unconfirmed',
        reason: control.error === 'input_outcome_unknown' ? control.error : 'control_closed',
      };
    return null;
  }
  start(
    userId: string,
    taskId: string,
    selection: LocalChromeSelection,
    send: Send,
    ticket?: LocalChromeReservation,
    capabilities: BrowserCapabilities = Object.freeze(browserCapabilities(userId)),
    options: { taskFilesV1?: boolean } = {},
  ): Session {
    if (this.get(userId, taskId)) throw new Error('chrome_task_exists');
    const reservation = ticket ?? this.reserve(userId, selection);
    const slot = this.reservations.get(reservation.key);
    if (
      reservation.key !== JSON.stringify([userId, selection.extensionClientId]) ||
      slot?.ticket !== reservation ||
      slot.claimed
    )
      throw new Error('chrome_reservation_invalid');
    slot.claimed = true;
    const control = new BrowserControl(Date.now, { collaborationV2: capabilities.collaborationV2 });
    const client = new SelectedChromeClient({
      userId,
      taskId,
      extensionClientId: selection.extensionClientId,
      control,
      routingV2: capabilities.routingV2,
      collaborationV2: capabilities.collaborationV2,
      taskFilesV1: options.taskFilesV1 === true,
      send,
    });
    const session = {
      reservation,
      userId,
      taskId,
      selection,
      capabilities,
      control,
      client,
      cancellation: new AbortController(),
      finishing: false,
    };
    this.entries.set(JSON.stringify([userId, taskId]), session);
    return session;
  }
  abort(userId: string, taskId: string): boolean {
    const session = this.get(userId, taskId);
    if (!session) return false;
    session.cancellation.abort();
    session.control.close();
    return true;
  }
  async finish(userId: string, taskId: string) {
    const session = this.get(userId, taskId);
    if (!session) return;
    session.finishing = true;
    const receipt = await session.client.close();
    // Unknown cleanup keeps this connection quarantined, not silently reusable.
    if (receipt.ok && receipt.closed) {
      this.entries.delete(JSON.stringify([userId, taskId]));
      this.reservations.delete(session.reservation.key);
    }
    return receipt;
  }
}
export const localChromeTaskSessions = new LocalChromeTaskSessions();

/** Call only after the persisted row has passed task/owner/origin authorization. */
export function localChromeExecutionObservation(
  userId: string,
  taskId: string,
  status: string,
  sourceContext: unknown,
): LocalChromeExecutionObservation | null {
  if (
    status !== 'executing' ||
    !sourceContext ||
    typeof sourceContext !== 'object' ||
    !('browserSource' in sourceContext) ||
    sourceContext.browserSource !== 'local-chrome'
  )
    return null;
  return localChromeTaskSessions.executionObservation(userId, taskId);
}
