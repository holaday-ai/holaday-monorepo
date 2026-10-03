import { AsyncLocalStorage } from 'node:async_hooks';
import { currentOperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';

interface SettlementScope {
  readonly parent: SettlementScope | undefined;
  readonly pending: Set<Promise<void>>;
  sealed: boolean;
}
const settlements = new AsyncLocalStorage<SettlementScope>();

/** Read-only veto, including non-browser follow-on work such as pending-cookie deletion. */
export function assertBrowserSettlementOpen(): void {
  for (let scope = settlements.getStore(); scope; scope = scope.parent) {
    if (scope.sealed) throw new Error('BROWSER_SETTLEMENT_CLOSED');
  }
}

/** Observe physical operations; never creates, restores, or releases drain ownership. */
export async function withBrowserOperationSettlement<T>(
  action: (seal: () => void) => Promise<T>,
): Promise<T> {
  assertBrowserSettlementOpen();
  const scope: SettlementScope = {
    parent: settlements.getStore(),
    pending: new Set(),
    sealed: false,
  };
  return settlements.run(scope, async () => {
    const seal = () => {
      scope.sealed = true;
    };
    try {
      return await action(seal);
    } finally {
      seal();
      // Children already dispatched retain their actual result even after a caller timeout.
      while (scope.pending.size) await Promise.allSettled([...scope.pending]);
    }
  });
}

function observeRaw<T>(result: Promise<T>, scope: SettlementScope | undefined): Promise<T> {
  if (!scope) return result;
  const settled = result.then(
    () => {},
    () => {},
  );
  for (let current: SettlementScope | undefined = scope; current; current = current.parent) {
    const owner = current;
    owner.pending.add(settled);
    void settled.then(() => {
      owner.pending.delete(settled);
    });
  }
  return result;
}

/** Wrap the raw SDK promise, before any timeout or best-effort catch. */
export async function runBrowserOperation<T>(action: () => T | PromiseLike<T>): Promise<T> {
  assertBrowserSettlementOpen();
  const scope = settlements.getStore();
  const lifetime = currentOperationLifetime();
  if (!lifetime) return observeRaw(Promise.resolve(action()), scope);
  const { drain, owner: parent } = lifetime;
  if (drain.snapshot().unknown > 0) throw new Error('BROWSER_OPERATION_UNKNOWN');
  return observeRaw(
    startOwnedOperation(
      drain,
      'execution',
      async (owner) => {
        try {
          return action();
        } catch (error) {
          drain.markUnknown(owner);
          throw error;
        }
      },
      { parent, dispatch: 'immediate', errorOutcome: 'unknown' },
    ).result,
    scope,
  );
}
