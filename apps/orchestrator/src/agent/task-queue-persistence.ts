import { currentOperationLifetime, startOwnedOperation } from '../execution/owned-operation.js';

/** Own raw queue SQL/transactions before caller catches; transaction Promise includes rollback. */
export async function runQueueDatabase<T>(action: () => PromiseLike<T>): Promise<T> {
  const lifetime = currentOperationLifetime();
  if (!lifetime) return action();
  if (lifetime.drain.snapshot().unknown > 0) throw new Error('QUEUE_PERSISTENCE_UNKNOWN');
  return startOwnedOperation(lifetime.drain, 'database', async () => action(), {
    parent: lifetime.owner,
    errorOutcome: 'unknown',
    dispatch: 'immediate',
  }).result;
}

/** Scope validation stays local to queue writes, not the repository's shared legacy extractor. */
export function runQueueWrite<T>(action: () => PromiseLike<T>, exactRows?: number): Promise<T> {
  return runQueueDatabase(async () => {
    const result = await action();
    if (!currentOperationLifetime()) return result;
    const head: unknown = Array.isArray(result) ? result[0] : result;
    const rows =
      head && typeof head === 'object' && 'affectedRows' in head ? head.affectedRows : undefined;
    if (
      typeof rows !== 'number' ||
      !Number.isSafeInteger(rows) ||
      rows < 0 ||
      rows > 1 ||
      (exactRows !== undefined && rows !== exactRows)
    )
      throw new Error('QUEUE_PERSISTENCE_UNPROVEN_WRITE');
    return result;
  });
}
