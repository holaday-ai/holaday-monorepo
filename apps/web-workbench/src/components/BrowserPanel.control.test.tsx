import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  capabilities: vi.fn(),
  nav: vi.fn(),
  ensure: vi.fn(),
  refresh: vi.fn(),
  abort: vi.fn(),
  checkpoint: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    browserReplay: {
      capabilities: { query: api.capabilities },
    },
    tasks: {
      browserNav: { mutate: api.nav },
      ensureBrowserSession: { mutate: api.ensure },
      checkpointBrowserSession: { mutate: api.checkpoint },
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
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), show: api.toast }),
}));
const viewportProps = vi.hoisted(() => ({ latest: null as Record<string, unknown> | null }));
vi.mock('@/components/CdpScreencastViewport', () => ({
  CdpScreencastViewport: (props: {
    onStatusChange: (status: string) => void;
    viewOnly: boolean;
    onUserInput?: () => void;
    onInputRefused?: (input: 'key' | 'pointer') => void;
  }) => {
    viewportProps.latest = props as unknown as Record<string, unknown>;
    const onStatus = React.useRef(props.onStatusChange);
    React.useEffect(() => {
      queueMicrotask(() => onStatus.current('connected'));
    }, []);
    return (
      <div data-testid="viewport" data-readonly={String(props.viewOnly)}>
        <button type="button" data-testid="screen" onClick={() => props.onUserInput?.()}>
          screen
        </button>
        <button
          type="button"
          data-testid="refused"
          onClick={() => props.onInputRefused?.('pointer')}
        >
          refused
        </button>
      </div>
    );
  },
}));
import { useTaskStore } from '@/stores/task-store';
import { BrowserPanel, recentActivitySteps, summariseAction } from './BrowserPanel';
const base = {
  activeTaskId: 'tsk_one',
  taskStatus: 'executing' as const,
  poolUserId: 'usr_one',
  onToggleFullscreen: vi.fn(),
};
const setTaskStatus = (status: 'executing' | 'completed') =>
  useTaskStore.setState((state) => ({
    tasks: state.tasks.map((task) => ({ ...task, status })),
  }));
beforeEach(() => {
  viewportProps.latest = null;
  api.capabilities.mockResolvedValue({
    viewportV2: true,
    observationV2: false,
    replayV1: false,
    routingV2: false,
  });
  useTaskStore.setState({
    browserInteractive: false,
    awaitingUserByTask: {},
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
  api.nav.mockResolvedValue({ ok: true });
  api.abort.mockResolvedValue({ ok: true, state: 'aborting' });
  api.checkpoint.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

const NO_TAKEOVER = /我来操作|交还给我|交还|接管/;

it('REBUILD-4: the running task screen takes input straight away — no lease, no first click', async () => {
  render(<BrowserPanel {...base} />);
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.readonly).toBe('false'));
  expect(viewportProps.latest).not.toHaveProperty('controlLease');
  expect(viewportProps.latest).not.toHaveProperty('onRequestControl');
  expect(viewportProps.latest).not.toHaveProperty('mobileViewport');
  expect(viewportProps.latest).not.toHaveProperty('desktopViewport');
  expect(screen.getByTestId('browser-coop-status').textContent).toBe(
    'AI 正在操作，你也可以直接点画面',
  );
});

it('REBUILD-4 (d): for 2 s after the person acts, the status says the assistant is waiting for them', async () => {
  render(<BrowserPanel {...base} />);
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.readonly).toBe('false'));
  vi.useFakeTimers();
  fireEvent.click(screen.getByTestId('screen'));
  expect(screen.getByTestId('browser-coop-status').textContent).toBe('你在操作，我等你停下再继续');
  act(() => {
    vi.advanceTimersByTime(1_500);
  });
  // Still acting: the 2 s start again from the newest input.
  fireEvent.click(screen.getByTestId('screen'));
  act(() => {
    vi.advanceTimersByTime(1_900);
  });
  expect(screen.getByTestId('browser-coop-status').textContent).toBe('你在操作，我等你停下再继续');
  act(() => {
    vi.advanceTimersByTime(200);
  });
  expect(screen.getByTestId('browser-coop-status').textContent).toBe(
    'AI 正在操作，你也可以直接点画面',
  );
});

it('REBUILD-4 (e): no 我来操作 / 交还给我 button renders — panel header or fullscreen bar', async () => {
  const { rerender } = render(<BrowserPanel {...base} />);
  await screen.findByTestId('viewport');
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.readonly).toBe('false'));
  expect(
    screen.queryAllByRole('button').filter((b) => NO_TAKEOVER.test(b.textContent ?? '')),
  ).toEqual([]);
  expect(screen.queryByRole('button', { name: NO_TAKEOVER })).toBeNull();
  rerender(<BrowserPanel {...base} fullscreen />);
  expect(screen.queryByRole('button', { name: NO_TAKEOVER })).toBeNull();
  expect(screen.queryByText(NO_TAKEOVER)).toBeNull();
  // The fullscreen bar carries the status instead of the status line.
  expect(screen.getByText('AI 正在操作，你也可以直接点画面')).toBeTruthy();
  expect(screen.queryByTestId('browser-coop-status')).toBeNull();
});

it('REBUILD-4 (f): the 停止 button still renders and stops the task — panel header and fullscreen', async () => {
  const { rerender } = render(<BrowserPanel {...base} />);
  await screen.findByTestId('viewport');
  fireEvent.click(screen.getByRole('button', { name: '停止当前任务' }));
  await waitFor(() => expect(api.abort).toHaveBeenCalledWith({ taskId: 'tsk_one' }));
  rerender(<BrowserPanel {...base} fullscreen />);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '停止当前任务' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: '停止当前任务' }));
  await waitFor(() => expect(api.abort).toHaveBeenCalledTimes(2));
});

it('REBUILD-4: back / forward / reload work without a lease', async () => {
  render(<BrowserPanel {...base} fullscreen />);
  await screen.findByTestId('viewport');
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(api.nav).toHaveBeenCalledWith({ direction: 'reload', taskId: 'tsk_one' });
});

it('REBUILD-4: a finished task whose browser is still open can just be used', async () => {
  setTaskStatus('completed');
  render(<BrowserPanel {...base} taskStatus="completed" />);
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.readonly).toBe('false'));
  expect(screen.getByTestId('browser-coop-status').textContent).toBe('浏览器还开着，可以直接操作');
  expect(screen.queryByRole('button', { name: '停止当前任务' })).toBeNull();
  expect(screen.queryByRole('button', { name: NO_TAKEOVER })).toBeNull();
});

it('REBUILD-4: a login wall asks the person to act right on the screen, and never takes control', async () => {
  render(<BrowserPanel {...base} awaitingUser awaitingKind="login" />);
  await waitFor(() => expect(screen.getByTestId('viewport').dataset.readonly).toBe('false'));
  expect(screen.getByText('这一步需要你来：直接在画面上操作，过了我会自动继续。')).toBeTruthy();
  // The waiting banner says it; no second, contradicting status line.
  expect(screen.queryByTestId('browser-coop-status')).toBeNull();
  expect(screen.queryByText(NO_TAKEOVER)).toBeNull();
});

it('REBUILD-4: an input the server refused because the page changed is said plainly', async () => {
  render(<BrowserPanel {...base} />);
  await screen.findByTestId('viewport');
  fireEvent.click(screen.getByTestId('refused'));
  expect(api.toast).toHaveBeenCalledWith('页面刚变了，再点一次', 'info');
});

it('local Chrome shows the stop control and no takeover controls, without a cloud viewport', async () => {
  useTaskStore.setState((state) => ({
    tasks: state.tasks.map((task) => ({ ...task, browserSource: 'local-chrome' as const })),
  }));
  render(<BrowserPanel {...base} />);
  expect(screen.getByText('在你的 Chrome 中执行')).toBeTruthy();
  expect(screen.getByText('AI 正在处理你选择的页面，你也可以直接在 Chrome 里操作。')).toBeTruthy();
  expect(screen.queryByTestId('viewport')).toBeNull();
  expect(screen.queryByRole('button', { name: NO_TAKEOVER })).toBeNull();
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

it('V2 portrait sheet owns only the visible width and defaults to contain', async () => {
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
