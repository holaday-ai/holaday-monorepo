import {
  type OperationLifetime,
  currentOperationLifetime,
  startOwnedOperation,
} from '../execution/owned-operation.js';

/** Reserve at the original call boundary, before business catches can swallow failure. */
export async function runScheduledOperation<T>(
  kind: 'scheduler' | 'database' | 'execution',
  action: () => Promise<T>,
): Promise<T> {
  const lifetime = currentOperationLifetime();
  if (!lifetime) return action();
  return startOwnedOperation(lifetime.drain, kind, action, {
    parent: lifetime.owner,
    errorOutcome: 'unknown',
    dispatch: 'immediate',
  }).result;
}

/** Server-only capability for hooks that must reserve detached children before their ACK. */
export function callScheduledHook<T, R>(
  hook: (input: T, lifetime?: OperationLifetime) => Promise<R>,
  input: T,
): Promise<R> {
  return runScheduledOperation('execution', async () => {
    const lifetime = currentOperationLifetime();
    return lifetime ? hook(input, lifetime) : hook(input);
  });
}

/** Ambiguous ACKs remain attached to the still-active pass, never a task ID. */
export function retainScheduledUncertainty(): boolean {
  const lifetime = currentOperationLifetime();
  if (!lifetime) return false;
  lifetime.drain.markUnknown(lifetime.owner);
  return true;
}
