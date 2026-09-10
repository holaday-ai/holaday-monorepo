import type {
  DrainOwner,
  DrainUncertainty,
  DrainWorkKind,
  ExecutionDrain,
} from './execution-drain.js';

export interface OwnedOperation<T> {
  readonly owner: DrainOwner;
  readonly result: Promise<T>;
  /** Internal reconciliation capability; never serialize or expose to a client. */
  uncertainty(): DrainUncertainty | null;
}

/** Reserve synchronously; only the original action owns its release. */
export function startOwnedOperation<T>(
  drain: ExecutionDrain,
  kind: DrainWorkKind,
  action: () => Promise<T>,
  options: { parent?: DrainOwner; errorOutcome: 'known' | 'unknown' },
): OwnedOperation<T> {
  const { parent, errorOutcome } = options;
  if (errorOutcome !== 'known' && errorOutcome !== 'unknown')
    throw new Error('EXECUTION_DRAIN_OUTCOME');
  if (typeof action !== 'function') throw new Error('EXECUTION_DRAIN_ACTION');
  const owner = parent === undefined ? drain.admit(kind) : drain.fork(parent, kind);
  const release = drain.pin(owner);
  let ticket: DrainUncertainty | null = null;
  let dispatched = false;
  const result = Promise.resolve()
    .then(() => {
      drain.assertDispatch(owner);
      dispatched = true;
      return action();
    })
    .catch((error: unknown) => {
      if (dispatched && errorOutcome === 'unknown') ticket = drain.markUnknown(owner);
      throw error;
    })
    .finally(release);
  return Object.freeze({ owner, result, uncertainty: () => ticket });
}
