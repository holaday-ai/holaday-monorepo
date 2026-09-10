import type { DrainController } from '../execution/drain-controller.js';
import {
  type OperationLifetime,
  currentOperationLifetime,
  startOwnedOperation,
} from '../execution/owned-operation.js';

/** Private to the queue: only completion of its original callbacks releases this reservation. */
export interface QueueReservation {
  readonly lifetime: OperationLifetime;
  finish(): Promise<void>;
}

export function reserveQueueLifetime(
  controller: DrainController | undefined,
  inherited: OperationLifetime | undefined,
): QueueReservation | undefined {
  const ambient = currentOperationLifetime();
  if (!controller) {
    if (ambient || inherited) throw new Error('QUEUE_DRAIN_CONTROLLER_REQUIRED');
    return undefined;
  }
  if (
    (inherited && inherited.drain !== controller.drain) ||
    (ambient && (ambient.drain !== inherited?.drain || ambient.owner !== inherited?.owner))
  ) {
    controller.drain.block();
    throw new Error('QUEUE_DRAIN_CONTEXT_MISMATCH');
  }
  if (controller.drain.snapshot().unknown > 0) throw new Error('QUEUE_DRAIN_UNKNOWN');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let lifetime: OperationLifetime | undefined;
  const hold = (life: OperationLifetime) => {
    lifetime = life;
    return pending;
  };
  const operation = inherited
    ? startOwnedOperation(
        controller.drain,
        'execution',
        (owner) => hold(Object.freeze({ drain: controller.drain, owner })),
        { parent: inherited.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
      )
    : controller.runRoot(hold);
  // A dispatch guard can reject before invoking hold. Never acknowledge an unreserved entry.
  void operation.result.catch(() => {});
  if (!lifetime) throw new Error('QUEUE_DRAIN_ADMISSION_REJECTED');
  return Object.freeze({
    lifetime,
    finish: () => {
      release();
      return operation.result;
    },
  });
}

export function assertQueueDispatch(reservation: QueueReservation): void {
  const { drain, owner } = reservation.lifetime;
  if (drain.snapshot().unknown > 0) throw new Error('QUEUE_DRAIN_UNKNOWN');
  drain.assertDispatch(owner);
}

export function callQueueCallback(
  reservation: QueueReservation,
  callback: (lifetime: OperationLifetime) => Promise<void> | void,
): Promise<void> {
  assertQueueDispatch(reservation);
  const { drain, owner: parent } = reservation.lifetime;
  return startOwnedOperation(
    drain,
    'execution',
    async () => {
      const lifetime = currentOperationLifetime();
      if (!lifetime) throw new Error('QUEUE_DRAIN_LIFETIME_REQUIRED');
      try {
        return callback(lifetime);
      } catch (error) {
        // A synchronous failure is already known in this dispatch turn. Do not
        // wait for the outer Promise catch while another queued microtask starts.
        drain.markUnknown(lifetime.owner);
        throw error;
      }
    },
    { parent, errorOutcome: 'unknown', dispatch: 'immediate' },
  ).result;
}
