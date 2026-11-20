import { type TaskFailureContext, canLoadFailureContext } from '@/lib/task-failure-recovery';
import { trpc } from '@/lib/trpc';
import * as React from 'react';

/**
 * Loads refund status + original inputs for a failed / cancelled task.
 * Failures are swallowed into `null`: the card still renders its friendly
 * reason; retry must stop when the original inputs cannot be recovered.
 */
export function useTaskFailureContext(
  taskId: string | undefined,
  status: string,
): {
  context: TaskFailureContext | null;
  /** Returns the loaded context, fetching it now if the first load has not landed. */
  ensure(): Promise<TaskFailureContext | null>;
} {
  const enabled = canLoadFailureContext(taskId, status);
  const [context, setContext] = React.useState<TaskFailureContext | null>(null);
  const contextRef = React.useRef<TaskFailureContext | null>(null);
  const inflightRef = React.useRef<Promise<TaskFailureContext | null> | null>(null);
  const keyRef = React.useRef<string | null>(null);

  const fetchContext = React.useCallback((): Promise<TaskFailureContext | null> => {
    if (!enabled || !taskId) return Promise.resolve(null);
    const key = `${taskId}|${status}`;
    if (keyRef.current === key && contextRef.current) return Promise.resolve(contextRef.current);
    if (keyRef.current === key && inflightRef.current) return inflightRef.current;
    keyRef.current = key;
    const request = trpc.taskRecovery.failureContext
      .query({ taskId })
      .then((result) => {
        const loaded = result as TaskFailureContext;
        if (keyRef.current === key) {
          contextRef.current = loaded;
          setContext(loaded);
        }
        return loaded;
      })
      .catch(() => null)
      .finally(() => {
        if (keyRef.current === key) inflightRef.current = null;
      });
    inflightRef.current = request;
    return request;
  }, [enabled, status, taskId]);

  React.useEffect(() => {
    contextRef.current = null;
    inflightRef.current = null;
    keyRef.current = null;
    setContext(null);
    if (enabled) void fetchContext();
  }, [enabled, fetchContext]);

  return { context, ensure: fetchContext };
}
