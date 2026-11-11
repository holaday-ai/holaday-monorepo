import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  query: vi.fn(),
  capabilities: vi.fn(),
  mutate: vi.fn(),
  nav: vi.fn(),
  ensure: vi.fn(),
  refresh: vi.fn(),
  abort: vi.fn(),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    browserReplay: {
      capabilities: { query: api.capabilities },
    },
    tasks: {
      browserControlState: { query: api.query },
      browserControl: { mutate: api.mutate },
      browserNav: { mutate: api.nav },
      ensureBrowserSession: { mutate: api.ensure },
      abort: { mutate: api.abort },
    },
  },
}));
vi.mock('@/lib/use-stream-token', () => ({
  useStreamToken: () => ({ token: 'test', refresh: api.refresh }),
}));
vi.mock('@/lib/ws', () => ({ send: vi.fn() }));
vi.mock('@/lib/hd-debug', () => ({ hdDebug: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), show: vi.fn() }),
}));
vi.mock('@/components/CdpScreencastViewport', () => ({
  CdpScreencastViewport: (props: {
    onStatusChange: (status: string) => void;
    controlLease: string | null;
    viewOnly: boolean;
    onRequestControl?: () => void;
  }) => {
    const onStatus = React.useRef(props.onStatusChange);
    React.useEffect(() => {
      queueMicrotask(() => onStatus.current('connected'));
    }, []);
    return (
      <div
        data-testid="viewport"
        data-lease={props.controlLease ?? ''}
        data-readonly={String(props.viewOnly)}
        data-can-request={String(Boolean(props.onRequestControl))}
      >
        <button type="button" data-testid="screen" onClick={() => props.onRequestControl?.()}>
          screen
        </button>
      </div>
    );
  },
}));
import { useTaskStore } from '@/stores/task-store';
import { BrowserPanel, recentActivitySteps, summariseAction } from './BrowserPanel';
const control = (phase = 'agent', lease: string | null = null) => ({
  taskId: 'tsk_one',
  phase,
  lease,
  supported: true,
  error: null,
  mode: 'running',
});
const base = {
  activeTaskId: 'tsk_one',
  taskStatus: 'executing' as const,
  poolUserId: 'usr_one',
  onToggleFullscreen: vi.fn(),
};
beforeEach(() => {
  api.capabilities.mockResolvedValue({
    viewportV2: false,
    observationV2: false,
    replayV1: false,
    routingV2: false,
  });
  useTaskStore.setState({
    browserInteractive: false,
    tasks: [
      {
        taskId: 'tsk_one',
        intent: '浏览测试网页',
        title: null,
        tickCount: 0,
        status: 'executing',
        executionMode: 'browser',
        createdAt: new Date(),
      },
    ],
  });
  api.query.mockResolvedValue(control());
  api.nav.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('local Chrome uses real ownership controls without mounting a cloud viewport', async () => {
  useTaskStore.setState((state) => ({
    tasks: state.tasks.map((task) => ({ ...task, browserSource: 'local-chrome' as const })),
  }));
  api.mutate
    .mockResolvedValueOnce(control('human', 'local-lease'))
    .mockResolvedValueOnce(control('agent'));
  api.abort.mockResolvedValue({ ok: true, state: 'aborting' });
  render(<BrowserPanel {...base} />);
  expect(screen.getByText('在你的 Chrome 中执行')).toBeTruthy();
  expect(screen.queryByTestId('viewport')).toBeNull();
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '我来操作' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '我来操作' }));
  await screen.findByRole('button', { name: '交还给我' });
  fireEvent.click(screen.getByRole('button', { name: '交还给我' }));
  await waitFor(() =>
    expect(api.mutate).toHaveBeenLastCalledWith({
      taskId: 'tsk_one',
      action: 'return',
      controlLease: 'local-lease',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '停止任务' }));
  await waitFor(() => expect(api.abort).toHaveBeenCalledWith({ taskId: 'tsk_one' }));
  expect(api.nav).not.toHaveBeenCalled();
});

it('keeps the local panel in the mobile sheet layer', () => {
  useTaskStore.setState((state) => ({
    tasks: state.tasks.map((task) => ({ ...task, browserSource: 'local-chrome' as const })),
  }));
  render(<BrowserPanel {...base} layout="sheet" />);
  expect(screen.getByLabelText('本地 Chrome 任务').parentElement?.className).toContain('fixed');
});

it('honors a task-stream takeover request made before the panel mounts', async () => {
  useTaskStore.setState({ browserInteractive: true });
  api.mutate.mockResolvedValue(control('human', 'from-chat'));
  render(<BrowserPanel {...base} />);
  await waitFor(() =>
    expect(api.mutate).toHaveBeenCalledWith({ taskId: 'tsk_one', action: 'takeover' }),
  );
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.lease).toBe('from-chat'));
});

it('uses confirmed ownership for both normal and fullscreen controls', async () => {
  let confirm!: (value: unknown) => void;
  api.mutate.mockImplementation(
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      }),
  );
  const { rerender } = render(<BrowserPanel {...base} />);
  const takeover = await screen.findByRole('button', { name: '我来操作' });
  await waitFor(() => expect(takeover.hasAttribute('disabled')).toBe(false));
  fireEvent.click(takeover);
  expect(screen.getByTestId('viewport').dataset.lease).toBe('');
  await act(async () => {
    confirm(control('human', 'confirmed'));
  });
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.lease).toBe('confirmed'));
  expect(screen.getByTestId('viewport').dataset.readonly).toBe('false');
  rerender(<BrowserPanel {...base} fullscreen />);
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(api.nav).toHaveBeenCalledWith({
    direction: 'reload',
    taskId: 'tsk_one',
    controlLease: 'confirmed',
  });
  fireEvent.click(screen.getByRole('button', { name: '交还给我' }));
  expect(screen.getByTestId('viewport').dataset.lease).toBe('');
  await act(async () => {
    confirm(control('resuming'));
  });
  expect(api.mutate).toHaveBeenLastCalledWith({
    taskId: 'tsk_one',
    action: 'return',
    controlLease: 'confirmed',
  });
});

it('FIX-61 DEPLOY-61 P0-2: a login wait does not take control by itself; 「我来操作」 does, once', async () => {
  api.mutate.mockImplementation(async ({ action }: { action: string }) =>
    action === 'takeover' ? control('human', 'login') : control('agent'),
  );
  render(<BrowserPanel {...base} awaitingUser awaitingKind="login" />);
  const takeover = await screen.findByRole('button', { name: '我来操作' });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(api.mutate.mock.calls.filter(([args]) => args.action === 'takeover')).toHaveLength(0);
  await waitFor(() => expect(takeover.hasAttribute('disabled')).toBe(false));
  fireEvent.click(takeover);
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.lease).toBe('login'));
  fireEvent.click(screen.getByRole('button', { name: '交还给我' }));
  await waitFor(() =>
    expect(api.mutate).toHaveBeenCalledWith({
      taskId: 'tsk_one',
      action: 'return',
      controlLease: 'login',
    }),
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(api.mutate.mock.calls.filter(([args]) => args.action === 'takeover')).toHaveLength(1);
  expect(screen.getByTestId('viewport').dataset.lease).toBe('');
});

it('FIX-61 DEPLOY-61 P0-2: the assistant asking 「确认继续执行吗？」 never takes control for the person', async () => {
  api.mutate.mockResolvedValue(control('human', 'auto'));
  render(<BrowserPanel {...base} awaitingUser awaitingKind="browser_action" />);
  await screen.findByRole('button', { name: '我来操作' });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(api.mutate.mock.calls.filter(([args]) => args.action === 'takeover')).toHaveLength(0);
  expect(screen.getByTestId('viewport').dataset.lease).toBe('');
});

it('V2 portrait sheet owns only the visible width and defaults to contain', async () => {
  api.capabilities.mockResolvedValue({
    viewportV2: true,
    observationV2: false,
    replayV1: false,
    routingV2: false,
  });
  render(<BrowserPanel {...base} layout="sheet" />);
  const viewport = await screen.findByTestId('viewport');
  await waitFor(() => expect(viewport.parentElement?.className).toContain('w-full'));
  expect(viewport.parentElement?.style.width).toBe('');
  expect(viewport.parentElement?.className).not.toContain('shrink-0');
});

it('does not retain processing text in terminal browser activity', () => {
  const step = { tickIndex: 2, status: 'running' as const, actionSummary: '正在处理…' };
  expect(summariseAction(step as Parameters<typeof summariseAction>[0], true)).toBe(
    '步骤 3 · 已结束',
  );
});

it('clears recent live actions when the task is terminal (PR259 semantics)', () => {
  const steps = [{ tickIndex: 0, status: 'running' as const, startedAt: 1, actionKind: 'click' }];
  expect(recentActivitySteps(steps, false)).toHaveLength(1);
  expect(recentActivitySteps(steps, true)).toEqual([]);
});

it('renders a blank browser address as an empty state instead of about:blank', async () => {
  render(<BrowserPanel {...base} />);
  const input = await screen.findByRole('textbox', { name: /浏览器地址栏/ });
  expect((input as HTMLInputElement).value).toBe('');
  expect(input.getAttribute('placeholder')).toBe('尚未打开网页');
});

it('FIX-61: pressing the screen of a running task takes over and says the assistant paused', async () => {
  api.mutate.mockResolvedValue(control('human', 'screen'));
  render(<BrowserPanel {...base} />);
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.canRequest).toBe('true'));
  fireEvent.click(screen.getByTestId('screen'));
  await waitFor(() =>
    expect(api.mutate).toHaveBeenCalledWith({ taskId: 'tsk_one', action: 'takeover' }),
  );
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.lease).toBe('screen'));
  expect(screen.getByText('你在操作，我先停下；需要我继续时点『交还给我』。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '交还给我' })).toBeTruthy();
});

it('FIX-61: a finished task with its browser still open can be used straight from the screen', async () => {
  useTaskStore.setState((state) => ({
    tasks: state.tasks.map((task) => ({ ...task, status: 'completed' as const })),
  }));
  api.query.mockResolvedValue({ ...control('closed'), mode: 'review' });
  api.mutate.mockResolvedValue({ ...control('human', 'review-lease'), mode: 'review' });
  render(<BrowserPanel {...base} taskStatus="completed" />);
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.canRequest).toBe('true'));
  expect(screen.getByRole('button', { name: '我来操作' }).textContent).toContain('我来操作');
  fireEvent.click(screen.getByTestId('screen'));
  await waitFor(() =>
    expect(api.mutate).toHaveBeenCalledWith({ taskId: 'tsk_one', action: 'takeover' }),
  );
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.lease).toBe('review-lease'));
});

it('FIX-61: a released browser that cannot be reopened says so plainly and offers 「重新打开这个页面」', async () => {
  useTaskStore.setState((state) => ({
    tasks: state.tasks.map((task) => ({
      ...task,
      status: 'completed' as const,
      finalUrl: 'https://www.google.com/',
    })),
  }));
  api.query.mockResolvedValue({
    taskId: 'tsk_one',
    supported: false,
    mode: 'review',
    phase: 'closed',
    lease: null,
    error: 'session_unavailable',
  });
  api.ensure.mockRejectedValue(new Error('restore failed'));
  render(<BrowserPanel {...base} taskStatus="completed" />);
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.canRequest).toBe('true'));
  fireEvent.click(screen.getByTestId('screen'));
  await waitFor(() => expect(api.ensure).toHaveBeenCalledWith({ taskId: 'tsk_one' }));
  await screen.findByText('这个页面的浏览器已经关掉了，刚才没能重新打开。');
  api.ensure.mockResolvedValue({ restored: true });
  api.mutate.mockResolvedValue({ ...control('human', 'reopened'), mode: 'review' });
  fireEvent.click(screen.getByRole('button', { name: '重新打开这个页面' }));
  await waitFor(() =>
    expect(api.mutate).toHaveBeenCalledWith({ taskId: 'tsk_one', action: 'takeover' }),
  );
  expect(api.mutate).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'return' }));
});
