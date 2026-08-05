import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { tasks } from '../db/schema/tasks.js';

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
  const intervalMs = options.intervalMs ?? DEFAULT_TASK_HEARTBEAT_INTERVAL_MS;

  const timer = setInterval(() => {
    if (stopped || writeInFlight) return;
    writeInFlight = true;
    void db
      .update(tasks)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(tasks.externalId, taskExternalId),
          eq(tasks.status, 'executing'),
        ),
      )
      .catch((error: unknown) => {
        options.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
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
