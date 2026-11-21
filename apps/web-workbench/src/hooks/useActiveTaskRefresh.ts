import type { UiTask } from '@/types/task';
import { useEffect } from 'react';

/** Read-only fallback for missed live frames; one visible selected task at a time. */
export function useActiveTaskRefresh(
  task: UiTask | undefined,
  refresh: (taskId: string) => Promise<void>,
): void {
  const taskId = task?.taskId;
  const enabled =
    task?.status === 'executing' && task.executionObservation?.state !== 'unconfirmed';

  useEffect(() => {
    if (!taskId || !enabled) return;
    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!disposed && document.visibilityState !== 'hidden') timer = setTimeout(run, 5000);
    };
    const run = async () => {
      timer = undefined;
      if (disposed || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        await refresh(taskId);
      } catch {
        // A failed read supplies no lifecycle verdict and must not replay any task action.
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const visibilityChanged = () => {
      clearTimeout(timer);
      timer = undefined;
      if (!inFlight) schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [taskId, enabled, refresh]);
}
