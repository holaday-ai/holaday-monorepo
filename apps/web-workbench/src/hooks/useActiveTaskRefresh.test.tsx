// @vitest-environment happy-dom

import type { UiTask } from '@/types/task';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useActiveTaskRefresh } from './useActiveTaskRefresh';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const task = (patch: Partial<UiTask> = {}): UiTask => ({
  taskId: 'saved_file_task',
  intent: '仅处理附件',
  title: null,
  status: 'executing',
  tickCount: 1,
  createdAt: new Date(),
  ...patch,
});

describe('selected task progress fallback', () => {
  it.each([undefined, 'local-chrome'] as const)(
    'refreshes actual progress for source %s',
    async (browserSource) => {
      vi.useFakeTimers();
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const refresh = vi.fn(async () => {});
      renderHook(() => useActiveTaskRefresh(task({ browserSource }), refresh));
      await act(() => vi.advanceTimersByTimeAsync(5000));
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledWith('saved_file_task');
    },
  );

  it('keeps a slow read serial and stops after a terminal or unconfirmed observation', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let finish!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<void>((done) => {
          finish = done;
        }),
    );
    const hook = renderHook(({ current }) => useActiveTaskRefresh(current, refresh), {
      initialProps: { current: task() },
    });
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(refresh).toHaveBeenCalledTimes(1);
    hook.rerender({ current: task({ status: 'completed' }) });
    await act(async () => {
      finish();
    });
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(refresh).toHaveBeenCalledTimes(1);
    hook.rerender({
      current: task({
        executionObservation: { state: 'unconfirmed', reason: 'session_not_observed' },
      }),
    });
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not query a hidden page and resumes one selected read after visibility returns', async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const refresh = vi.fn(async () => {});
    renderHook(() => useActiveTaskRefresh(task(), refresh));
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(refresh).not.toHaveBeenCalled();
    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
