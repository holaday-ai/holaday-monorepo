import { currentOperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';

/** Wrap the raw SDK promise, before any timeout or best-effort catch. */
export async function runBrowserOperation<T>(action: () => T | PromiseLike<T>): Promise<T> {
  const lifetime = currentOperationLifetime();
  if (!lifetime) return action();
  const { drain, owner: parent } = lifetime;
  if (drain.snapshot().unknown > 0) throw new Error('BROWSER_OPERATION_UNKNOWN');
  return startOwnedOperation(
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
  ).result;
}
