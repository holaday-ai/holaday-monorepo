import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { tasks } from '../db/schema/tasks.js';
import { currentOperationLifetime, startOwnedOperation } from '../execution/owned-operation.js';

const DEFAULT_TASK_HEARTBEAT_INTERVAL_MS = 60_000;

export function startTaskHeartbeat(
  db: DB,
  taskExternalId: string,
  options: {
    intervalMs?: number;
    onError?: (error: Error) => void;
  } = {},
): { stop: () => void } {
  let stopped = false;
  let writeInFlight = false;
  const lifetime = currentOperationLifetime();
  const intervalMs = options.intervalMs ?? DEFAULT_TASK_HEARTBEAT_INTERVAL_MS;

  const timer = setInterval(() => {
    if (stopped || writeInFlight) return;
    writeInFlight = true;
    const write = async () => {
      await db
        .update(tasks)
        .set({ updatedAt: new Date() })
        .where(and(eq(tasks.externalId, taskExternalId), eq(tasks.status, 'executing')));
    };
    let original: Promise<void>;
    try {
      original = lifetime
        ? startOwnedOperation(lifetime.drain, 'database', write, {
            parent: lifetime.owner,
            errorOutcome: 'unknown',
            dispatch: 'immediate',
          }).result
        : write();
    } catch (error) {
      // An expired parent must not dispatch another heartbeat write.
      original = Promise.reject(error);
    }
    void original
      .catch((error: unknown) => {
        try {
          options.onError?.(error instanceof Error ? error : new Error(String(error)));
        } catch {
          /* Reporting must not create an unhandled timer rejection. */
        }
      })
      .finally(() => {
        writeInFlight = false;
      });
  }, intervalMs);
  timer.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export { DEFAULT_TASK_HEARTBEAT_INTERVAL_MS };
