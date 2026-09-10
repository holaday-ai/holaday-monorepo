import {
  currentOperationLifetime,
  startOwnedOperation,
  withOperationDispatchScope,
} from '../execution/owned-operation.js';

export interface ModelOperation {
  run<T>(action: () => Promise<T>): Promise<T>;
  /** Only dispose resources already acquired by this operation; never dispatch new work. */
  cleanup(action: () => Promise<unknown>): void;
  markUnknown(): void;
}

/** Deliver the model result without waiting for physical stream disposal. */
export function runModelOperation<T>(
  action: (operation: ModelOperation) => Promise<T>,
): Promise<T> {
  const parent = currentOperationLifetime();
  if (!parent)
    return action({
      run: (work) => work(),
      cleanup: (work) => {
        try {
          void work().catch(() => undefined);
        } catch {
          /* disposal only */
        }
      },
      markUnknown: () => {},
    });
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  try {
    const operation = startOwnedOperation(
      parent.drain,
      'model',
      async (owner) =>
        withOperationDispatchScope(async (seal) => {
          const pending = new Set<Promise<unknown>>();
          let dispatched = false;
          let accepting = true;
          const markUnknown = () => {
            if (dispatched) parent.drain.markUnknown(owner);
          };
          const observe = <R>(work: () => Promise<R>): Promise<R> => {
            let raw: Promise<R>;
            try {
              raw = Promise.resolve(work());
            } catch (error) {
              raw = Promise.reject(error);
            }
            pending.add(raw);
            void raw.then(
              () => {
                pending.delete(raw);
              },
              () => {
                markUnknown();
                pending.delete(raw);
              },
            );
            return raw;
          };
          try {
            resolve(
              await action({
                run: (work) => {
                  if (!accepting) {
                    parent.drain.block();
                    throw new Error('MODEL_OPERATION_ENDED');
                  }
                  parent.drain.assertDispatch(owner);
                  dispatched = true;
                  return observe(work);
                },
                // Cleanup is already admitted physical work. It must still run after
                // permanent block, while this private pin keeps the operation alive.
                cleanup: (work) => {
                  if (!accepting) {
                    parent.drain.block();
                    return;
                  }
                  void observe(work);
                },
                markUnknown,
              }),
            );
          } catch (error) {
            markUnknown();
            reject(error);
          } finally {
            accepting = false;
            seal();
            while (pending.size > 0) await Promise.allSettled([...pending]);
          }
        }),
      { parent: parent.owner, errorOutcome: 'known', dispatch: 'immediate' },
    );
    void operation.result.catch(reject);
  } catch (error) {
    reject(error);
  }
  return result;
}
