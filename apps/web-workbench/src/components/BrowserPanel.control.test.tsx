// @vitest-environment happy-dom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), nav: vi.fn(), refresh: vi.fn(), abort: vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc: { tasks: {
  browserControlState: { query: api.query }, browserControl: { mutate: api.mutate }, browserNav: { mutate: api.nav },
  abort: { mutate: api.abort },
} } }));
vi.mock('@/lib/use-stream-token', () => ({ useStreamToken: () => ({ token: 'test', refresh: api.refresh }) }));
vi.mock('@/lib/ws', () => ({ send: vi.fn() }));
vi.mock('@/lib/hd-debug', () => ({ hdDebug: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('@/components/CdpScreencastViewport', () => ({ CdpScreencastViewport: (props: {
  onStatusChange: (status: string) => void; controlLease: string | null; viewOnly: boolean;
}) => {
  const onStatus = React.useRef(props.onStatusChange);
  React.useEffect(() => { queueMicrotask(() => onStatus.current('connected')); }, []);
  return <div data-testid="viewport" data-lease={props.controlLease ?? ''} data-readonly={String(props.viewOnly)} />;
} }));
import { useTaskStore } from '@/stores/task-store';
import { BrowserPanel, summariseAction } from './BrowserPanel';
const control = (phase = 'agent', lease: string | null = null) => ({ taskId: 'tsk_one', phase, lease, supported: true, error: null, mode: 'running' });
const base = { activeTaskId: 'tsk_one', taskStatus: 'executing' as const, poolUserId: 'usr_one', onToggleFullscreen: vi.fn() };
beforeEach(() => {
  useTaskStore.setState({ browserInteractive: false, tasks: [{ taskId: 'tsk_one', intent: '浏览测试网页', title: null, tickCount: 0, status: 'executing', executionMode: 'browser', createdAt: new Date() }] });
  api.query.mockResolvedValue(control());
  api.nav.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('local Chrome uses real ownership controls without mounting a cloud viewport', async () => {
  useTaskStore.setState(state => ({ tasks: state.tasks.map(task => ({ ...task, browserSource: 'local-chrome' as const })) }));
  api.mutate.mockResolvedValueOnce(control('human', 'local-lease')).mockResolvedValueOnce(control('agent'));
  api.abort.mockResolvedValue({ ok: true, state: 'aborting' });
  render(<BrowserPanel {...base} />);
  expect(screen.getByText('在你的 Chrome 中执行')).toBeTruthy();
  expect(screen.queryByTestId('viewport')).toBeNull();
  await waitFor(() => expect((screen.getByRole('button', { name: '接管' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '接管' }));
  await screen.findByRole('button', { name: '交还 AI' });
  fireEvent.click(screen.getByRole('button', { name: '交还 AI' }));
  await waitFor(() => expect(api.mutate).toHaveBeenLastCalledWith({ taskId: 'tsk_one', action: 'return', controlLease: 'local-lease' }));
  fireEvent.click(screen.getByRole('button', { name: '停止任务' }));
  await waitFor(() => expect(api.abort).toHaveBeenCalledWith({ taskId: 'tsk_one' }));
  expect(api.nav).not.toHaveBeenCalled();
});

it('keeps the local panel in the mobile sheet layer', () => {
  useTaskStore.setState(state => ({ tasks: state.tasks.map(task => ({ ...task, browserSource: 'local-chrome' as const })) }));
  render(<BrowserPanel {...base} layout="sheet" />);
  expect(screen.getByLabelText('本地 Chrome 任务').parentElement?.className).toContain('fixed');
});

it('honors a task-stream takeover request made before the panel mounts', async () => {
  useTaskStore.setState({ browserInteractive: true });
  api.mutate.mockResolvedValue(control('human', 'from-chat'));
  render(<BrowserPanel {...base} />);
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith({ taskId: 'tsk_one', action: 'takeover' }));
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.lease).toBe('from-chat'));
});

it('uses confirmed ownership for both normal and fullscreen controls', async () => {
  let confirm!: (value: unknown) => void;
  api.mutate.mockImplementation(() => new Promise((resolve) => { confirm = resolve; }));
  const { rerender } = render(<BrowserPanel {...base} />);
  const takeover = await screen.findByRole('button', { name: '接管浏览器' });
  await waitFor(() => expect(takeover.hasAttribute('disabled')).toBe(false));
  fireEvent.click(takeover);
  expect(screen.getByTestId('viewport').dataset.lease).toBe('');
  await act(async () => { confirm(control('human', 'confirmed')); });
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.lease).toBe('confirmed'));
  expect(screen.getByTestId('viewport').dataset.readonly).toBe('false');
  rerender(<BrowserPanel {...base} fullscreen />);
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(api.nav).toHaveBeenCalledWith({ direction: 'reload', taskId: 'tsk_one', controlLease: 'confirmed' });
  fireEvent.click(screen.getByRole('button', { name: '退出浏览器接管' }));
  expect(screen.getByTestId('viewport').dataset.lease).toBe('');
  await act(async () => { confirm(control('resuming')); });
  expect(api.mutate).toHaveBeenLastCalledWith({ taskId: 'tsk_one', action: 'return', controlLease: 'confirmed' });
});

it('does not automatically retake control while the login banner awaits its status update', async () => {
  api.mutate.mockImplementation(async ({ action }: { action: string }) => action === 'takeover' ? control('human', 'login') : control('agent'));
  render(<BrowserPanel {...base} awaitingUser awaitingKind="login" />);
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.lease).toBe('login'));
  fireEvent.click(screen.getByRole('button', { name: '退出浏览器接管' }));
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith({ taskId: 'tsk_one', action: 'return', controlLease: 'login' }));
  await act(async () => { await Promise.resolve(); });
  expect(api.mutate.mock.calls.filter(([args]) => args.action === 'takeover')).toHaveLength(1);
  expect(screen.getByTestId('viewport').dataset.lease).toBe('');
});

it('V2 portrait sheet owns only the visible width and defaults to contain', async () => {
  vi.stubEnv('VITE_BROWSER_VIEWPORT_V2','true');
  try {
    render(<BrowserPanel {...base} layout="sheet" />);
    const viewport=await screen.findByTestId('viewport');
    expect(viewport.parentElement?.style.width).toBe('');
    expect(viewport.parentElement?.className).toContain('w-full');
    expect(viewport.parentElement?.className).not.toContain('shrink-0');
  } finally {vi.unstubAllEnvs();}
});


it('does not retain processing text in terminal browser activity', () => {
  const step = { tickIndex: 2, status: 'running' as const, actionSummary: '正在处理…' };
  expect(summariseAction(step as Parameters<typeof summariseAction>[0], true)).toBe('步骤 3 · 已结束');
});
