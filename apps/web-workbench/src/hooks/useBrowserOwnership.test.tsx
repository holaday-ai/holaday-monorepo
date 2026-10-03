// @vitest-environment happy-dom
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { query, mutate } = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc: { tasks: { browserControlState: { query }, browserControl: { mutate } } } }));
import { useBrowserOwnership } from './useBrowserOwnership';
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const state = (taskId: string, phase = 'agent', lease: string | null = null) => ({ taskId, phase, lease, supported: true, error: null, mode: 'running' });

describe('browser ownership UI', () => {
  it('never exposes an offline lease for even one render when reconnecting', async () => {
    query.mockResolvedValue(state('one', 'human', 'offline'));
    const rendered: Array<string | null> = [];
    const { rerender } = renderHook(({ connected }) => {
      const value = useBrowserOwnership('one', connected);
      rendered.push(value.lease);
      return value;
    }, { initialProps: { connected: false } });
    await waitFor(() => expect(query).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    query.mockImplementation(() => new Promise(() => {}));
    rendered.length = 0;
    rerender({ connected: true });
    expect(rendered.every((lease) => lease === null)).toBe(true);
  });

  it('ignores a takeover mutation from the previous task', async () => {
    query.mockImplementation(({ taskId }: { taskId: string }) => Promise.resolve(state(taskId)));
    let oldReply!: (value: unknown) => void;
    mutate.mockImplementation(() => new Promise((resolve) => { oldReply = resolve; }));
    const { result, rerender } = renderHook(({ task }) => useBrowserOwnership(task, true), { initialProps: { task: 'one' } });
    await waitFor(() => expect(result.current.supported).toBe(true));
    let request!: Promise<void>;
    act(() => { request = result.current.request('takeover'); });
    rerender({ task: 'two' });
    await act(async () => { oldReply(state('one', 'human', 'stale')); await request; });
    expect(result.current.lease).toBeNull();
    expect(result.current.state?.taskId).toBe('two');
  });
  it('opens input only after server confirmation and closes it immediately on handback', async () => {
    query.mockResolvedValue(state('one'));
    let confirm!: (value: unknown) => void;
    mutate.mockImplementation(() => new Promise((resolve) => { confirm = resolve; }));
    const { result } = renderHook(() => useBrowserOwnership('one', true));
    await waitFor(() => expect(result.current.supported).toBe(true));
    let request!: Promise<void>;
    act(() => { request = result.current.request('takeover'); });
    expect(result.current.lease).toBeNull();
    await act(async () => { confirm(state('one', 'human', 'lease')); await request; });
    expect(result.current.lease).toBe('lease');
    act(() => { request = result.current.request('return'); });
    expect(result.current.lease).toBeNull();
    await act(async () => { confirm(state('one', 'resuming')); await request; });
    expect(result.current.lease).toBeNull();
  });

  it('ignores a previous task response and revokes input when disconnected', async () => {
    let oldReply!: (value: unknown) => void;
    query.mockImplementation(({ taskId }: { taskId: string }) => taskId === 'one'
      ? new Promise((resolve) => { oldReply = resolve; }) : Promise.resolve(state('two', 'human', 'new')));
    const { result, rerender } = renderHook(({ task, connected }) => useBrowserOwnership(task, connected), { initialProps: { task: 'one', connected: true } });
    rerender({ task: 'two', connected: true });
    await waitFor(() => expect(result.current.lease).toBe('new'));
    await act(async () => { oldReply(state('one', 'human', 'old')); });
    expect(result.current.lease).toBe('new');
    rerender({ task: 'two', connected: false });
    expect(result.current.lease).toBeNull();
  });

  it('does not restore old input permission after an unsuccessful return', async () => {
    query.mockResolvedValue(state('one', 'human', 'old'));
    mutate.mockRejectedValue(new Error('network lost'));
    const { result } = renderHook(() => useBrowserOwnership('one', true));
    await waitFor(() => expect(result.current.lease).toBe('old'));
    await act(async () => { await result.current.request('return'); });
    expect(result.current.lease).toBeNull();
    expect(result.current.error).toBeTruthy();
  });
});
