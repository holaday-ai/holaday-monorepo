import * as React from 'react';
import { trpc } from '@/lib/trpc';

type Ownership = Awaited<ReturnType<typeof trpc.tasks.browserControlState.query>>;

export function useBrowserOwnership(taskId: string | null, connected: boolean) {
  const [state, setState] = React.useState<{ value: Ownership; generation: number } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const sequence = React.useRef(0);
  const busy = React.useRef(false);
  const currentTask = React.useRef(taskId);
  currentTask.current = taskId;
  const connection = React.useRef({ taskId, connected, generation: 0 });
  if (connection.current.taskId !== taskId || connection.current.connected !== connected) {
    connection.current = { taskId, connected, generation: connection.current.generation + 1 };
  }
  const generation = connection.current.generation;
  const invalidate = React.useCallback(() => { sequence.current++; }, []);

  const refresh = React.useCallback(async () => {
    if (!taskId || busy.current) return;
    const requestId = ++sequence.current;
    try {
      const next = await trpc.tasks.browserControlState.query({ taskId });
      if (requestId !== sequence.current || currentTask.current !== taskId || generation !== connection.current.generation) return;
      setState({ value: next, generation });
      setError(next.error);
    } catch {
      if (requestId !== sequence.current || currentTask.current !== taskId || generation !== connection.current.generation) return;
      setState(null);
      setError('暂时无法确认浏览器控制权');
    }
  }, [taskId, generation]);

  React.useEffect(() => {
    sequence.current++;
    busy.current = false;
    setPending(false);
    setState(null);
    setError(null);
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 1000);
    return () => { window.clearInterval(timer); invalidate(); };
  }, [refresh, invalidate]);

  const valid = state?.value.taskId === taskId && state.generation === generation ? state.value : null;
  const lease = connected && !pending && (!error || error === 'observation_failed') && valid?.phase === 'human' ? valid.lease : null;
  const request = React.useCallback(async (action: 'takeover' | 'return') => {
    if (!taskId || busy.current || (action === 'return' && !lease)) return;
    const requestId = ++sequence.current;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const next = await trpc.tasks.browserControl.mutate({ taskId, action, ...(lease ? { controlLease: lease } : {}) });
      if (requestId !== sequence.current || currentTask.current !== taskId || generation !== connection.current.generation) return;
      setState({ value: next, generation });
      setError(next.error);
    } catch (cause) {
      if (requestId !== sequence.current || currentTask.current !== taskId || generation !== connection.current.generation) return;
      setState(null);
      setError(cause instanceof Error ? cause.message : '浏览器交接失败');
    } finally {
      if (requestId === sequence.current) { busy.current = false; setPending(false); }
    }
  }, [taskId, lease, generation]);
  return { lease, state: valid, supported: valid?.supported ?? false, pending, error, request, refresh };
}
