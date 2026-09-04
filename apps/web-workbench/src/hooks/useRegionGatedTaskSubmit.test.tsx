// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRegionGatedTaskSubmit } from './useRegionGatedTaskSubmit';

afterEach(cleanup);

const payload = {
  intent: '分析这份市场报告',
  fileIds: ['file_1'],
  mode: 'fast',
  expertMode: false,
  skillSelection: { skillId: 'research' },
};

describe('useRegionGatedTaskSubmit', () => {
  it('parks the exact draft until region selection succeeds, then replays it once', async () => {
    const assignRegion = vi.fn(async () => ({ region: 'intl' as const, changed: true }));
    const refreshMe = vi.fn(async () => ({ modelDataRegion: 'intl' as const }));
    const submit = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() =>
      useRegionGatedTaskSubmit({
        region: null,
        assignRegion,
        refreshMe,
        submit,
      }),
    );

    await act(async () => {
      await result.current.requestSubmit(payload);
    });
    expect(result.current.dialogOpen).toBe(true);
    expect(submit).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.confirmRegion('intl');
    });
    expect(assignRegion).toHaveBeenCalledWith('intl');
    expect(refreshMe).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(payload);
    expect(result.current.dialogOpen).toBe(false);
  });

  it('submits immediately when a valid region is already assigned', async () => {
    const submit = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() =>
      useRegionGatedTaskSubmit({
        region: 'cn',
        assignRegion: vi.fn(),
        refreshMe: vi.fn(),
        submit,
      }),
    );

    let decision: unknown;
    await act(async () => {
      decision = await result.current.requestSubmit(payload);
    });
    expect(decision).toEqual({ kind: 'submitted', result: { ok: true } });
    expect(submit).toHaveBeenCalledWith(payload);
    expect(result.current.dialogOpen).toBe(false);
  });

  it('ignores repeated confirmation while assignment is pending', async () => {
    let finishAssignment: (() => void) | undefined;
    const assignRegion = vi.fn(
      () =>
        new Promise<{ region: 'cn'; changed: true }>((resolve) => {
          finishAssignment = () => resolve({ region: 'cn', changed: true });
        }),
    );
    const submit = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() =>
      useRegionGatedTaskSubmit({
        region: null,
        assignRegion,
        refreshMe: vi.fn(async () => ({ modelDataRegion: 'cn' as const })),
        submit,
      }),
    );
    await act(async () => {
      await result.current.requestSubmit(payload);
    });

    let first: Promise<unknown> | undefined;
    await act(async () => {
      first = result.current.confirmRegion('cn');
      await result.current.confirmRegion('cn');
    });
    expect(assignRegion).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishAssignment?.();
      await first;
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('closing the dialog cancels the parked submit without mutating the payload', async () => {
    const submit = vi.fn();
    const { result } = renderHook(() =>
      useRegionGatedTaskSubmit({
        region: null,
        assignRegion: vi.fn(),
        refreshMe: vi.fn(),
        submit,
      }),
    );
    await act(async () => {
      await result.current.requestSubmit(payload);
      result.current.closeDialog();
    });

    expect(result.current.dialogOpen).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps the pending task parked when profile refresh cannot confirm the region', async () => {
    const submit = vi.fn();
    const { result } = renderHook(() =>
      useRegionGatedTaskSubmit({
        region: null,
        assignRegion: vi.fn(async () => ({ region: 'intl' as const, changed: true })),
        refreshMe: vi.fn(async () => null),
        submit,
      }),
    );
    await act(async () => {
      await result.current.requestSubmit(payload);
      await result.current.confirmRegion('intl');
    });

    expect(result.current.dialogOpen).toBe(true);
    expect(result.current.error).toBe('区域已保存，但暂时无法刷新账号状态，请重试。');
    expect(submit).not.toHaveBeenCalled();
  });
});
