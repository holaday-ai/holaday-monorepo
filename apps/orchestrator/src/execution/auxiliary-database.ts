import { currentOperationLifetime, startOwnedOperation } from './owned-operation.js';

/** Observe the original repository call before an optional caller can swallow its error. */
export async function runAuxiliaryDatabase<T>(action: () => Promise<T>): Promise<T> {
  const parent = currentOperationLifetime();
  if (!parent) return action();
  return startOwnedOperation(parent.drain, 'database', action, {
    parent: parent.owner,
    errorOutcome: 'unknown',
    dispatch: 'immediate',
  }).result;
}

/** Repository compatibility catches still return false, but cannot erase an uncertain write. */
export function retainAuxiliaryDatabaseUncertainty(): void {
  const lifetime = currentOperationLifetime();
  if (lifetime) lifetime.drain.markUnknown(lifetime.owner);
}
