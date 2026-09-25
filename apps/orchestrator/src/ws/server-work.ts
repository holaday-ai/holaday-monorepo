import { AsyncLocalStorage } from 'node:async_hooks';
import type { ExecutionAdmission } from '../execution/execution-admission.js';
import type { OrdinaryMaintenance } from '../execution/ordinary-maintenance.js';
import {
  type OperationLifetime,
  captureOperationScopeVeto,
  currentOperationLifetime,
  startOwnedOperation,
} from '../execution/owned-operation.js';

/** Own actual server entry promises, independently from the listening socket.
 * This does not claim that a socket close terminates remote extension actions. */
export function createWsWork(
  controller?: ExecutionAdmission,
  ordinaryMaintenance?: OrdinaryMaintenance,
) {
  if (ordinaryMaintenance && ordinaryMaintenance !== controller)
    throw new Error('MAINTENANCE_CONTROLLER_MISMATCH');
  const pending = new Set<Promise<unknown>>();
  const inside = new AsyncLocalStorage<boolean>();
  let stopping = false;
  let failed = false;
  let stopped: Promise<void> | undefined;
  function track<T>(acquire: () => Promise<T>): Promise<T> {
    let settle!: () => void;
    const acquired = new Promise<void>((resolve) => {
      settle = resolve;
    });
    pending.add(acquired);
    const finish = () => {
      pending.delete(acquired);
      settle();
    };
    let original: Promise<T>;
    try {
      original = acquire();
    } catch (error) {
      finish();
      throw error;
    }
    void original.then(finish, () => {
      failed = true;
      finish();
    });
    return original;
  }
  return {
    controller,
    ordinaryMaintenance,
    get stopping() {
      return stopping;
    },
    run(action: () => Promise<void>): Promise<void> | null {
      if (stopping) return null;
      try {
        // Defer application invocation, not admission: the exact original
        // promise is registered before the first action can call stop/reenter.
        const invoke = async () => {
          await Promise.resolve();
          if (stopping) return;
          await inside.run(true, action);
        };
        return track(() =>
          controller
            ? controller.runRoot(async (lifetime) => {
                await Promise.resolve();
                if (stopping) return;
                controller.drain.assertDispatch(lifetime.owner);
                if (stopping) return;
                await inside.run(true, action);
              }).result
            : invoke(),
        );
      } catch {
        return null;
      }
    },
    child<T>(
      parent: OperationLifetime,
      action: (originalVeto: () => void) => Promise<T>,
    ): Promise<T> | null {
      if (stopping || !controller) return null;
      try {
        if (parent.drain !== controller.drain || parent !== currentOperationLifetime()) return null;
        const originalVeto = captureOperationScopeVeto();
        return track(
          () =>
            startOwnedOperation(
              controller.drain,
              'execution',
              () => {
                originalVeto();
                if (stopping) throw new Error('WS_STOPPING');
                return inside.run(true, () => action(originalVeto));
              },
              {
                parent: parent.owner,
                errorOutcome: 'unknown',
                dispatch: 'deferred',
              },
            ).result,
        );
      } catch {
        return null;
      }
    },
    stop(): Promise<void> {
      if (inside.getStore()) throw new Error('WS_STOP_REENTRY');
      if (stopped) return stopped;
      stopping = true;
      stopped = Promise.allSettled([...pending]).then(() => {
        if (failed) throw new Error('WS_WORK_OUTCOME_UNKNOWN');
      });
      return stopped;
    },
  };
}

export type WsWork = ReturnType<typeof createWsWork>;
