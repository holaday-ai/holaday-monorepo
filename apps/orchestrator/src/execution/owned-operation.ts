import { AsyncLocalStorage } from 'node:async_hooks';
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

/** Server-only ownership inherited from an already admitted operation. */
export type OperationLifetime = Readonly<{ drain: ExecutionDrain; owner: DrainOwner }>;

const lifetimeContext = new AsyncLocalStorage<{ lifetime: OperationLifetime; sealed: boolean }>();

/** Read at dispatch, never capture on a cached adapter or parse from client data. */
export function currentOperationLifetime(): OperationLifetime | undefined {
  const context = lifetimeContext.getStore();
  if (context?.sealed) throw new Error('EXECUTION_DRAIN_SCOPE_CLOSED');
  return context?.lifetime;
}

/** Separate logical dispatch permission from a still-pinned physical cleanup. */
export function withOperationDispatchScope<T>(action: (seal: () => void) => T): T {
  const lifetime = currentOperationLifetime();
  if (!lifetime) return action(() => {});
  const context = { lifetime, sealed: false };
  return lifetimeContext.run(context, () =>
    action(() => {
      context.sealed = true;
    }),
  );
}

/** Reserve synchronously; only the original action owns its release. */
export function startOwnedOperation<T>(
  drain: ExecutionDrain,
  kind: DrainWorkKind,
  action: (owner: DrainOwner) => Promise<T>,
  options: {
    parent?: DrainOwner;
    errorOutcome: 'known' | 'unknown';
    dispatch?: 'immediate' | 'deferred';
  },
): OwnedOperation<T> {
  const { parent, errorOutcome } = options;
  const inherited = lifetimeContext.getStore();
  if (inherited?.sealed && parent === inherited.lifetime.owner)
    throw new Error('EXECUTION_DRAIN_SCOPE_CLOSED');
  if (errorOutcome !== 'known' && errorOutcome !== 'unknown')
    throw new Error('EXECUTION_DRAIN_OUTCOME');
  if (typeof action !== 'function') throw new Error('EXECUTION_DRAIN_ACTION');
  const dispatch = options.dispatch ?? 'deferred';
  if (dispatch !== 'immediate' && dispatch !== 'deferred')
    throw new Error('EXECUTION_DRAIN_DISPATCH');
  const owner = parent === undefined ? drain.admit(kind) : drain.fork(parent, kind);
  const release = drain.pin(owner);
  let ticket: DrainUncertainty | null = null;
  let dispatched = false;
  const invoke = async () => {
    drain.assertDispatch(owner);
    dispatched = true;
    return lifetimeContext.run({ lifetime: Object.freeze({ drain, owner }), sealed: false }, () =>
      action(owner),
    );
  };
  const pending = dispatch === 'immediate' ? invoke() : Promise.resolve().then(invoke);
  const result = pending
    .catch((error: unknown) => {
      if (dispatched && errorOutcome === 'unknown') ticket = drain.markUnknown(owner);
      throw error;
    })
    .finally(release);
  return Object.freeze({ owner, result, uncertainty: () => ticket });
}
