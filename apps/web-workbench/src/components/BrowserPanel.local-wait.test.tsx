// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), abort: vi.fn() }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    tasks: {
      browserControlState: { query: api.query },
      browserControl: { mutate: api.mutate },
      abort: { mutate: api.abort },
    },
  },
}));
vi.mock('@/lib/use-stream-token', () => ({
  useStreamToken: () => ({ token: 'test', refresh: vi.fn() }),
}));
vi.mock('@/lib/ws', () => ({ send: vi.fn() }));
vi.mock('@/lib/hd-debug', () => ({ hdDebug: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), show: vi.fn() }),
}));
import { useTaskStore } from '@/stores/task-store';
import type { UiTask } from '@/types/task';
import { BrowserPanel } from './BrowserPanel';

const props = {
  activeTaskId: 'tsk_wait',
  taskStatus: 'awaiting_user' as const,
  poolUserId: 'usr_one',
  onToggleFullscreen: vi.fn(),
};
const localTask: UiTask = {
  taskId: 'tsk_wait',
  title: null,
  intent: '在京东查一下 iPhone 价格',
  status: 'awaiting_user',
  tickCount: 0,
  createdAt: new Date(),
  browserSource: 'local-chrome',
};
beforeEach(() => {
  // No Chrome session exists for a routing wait: the ownership probe fails.
  api.query.mockRejectedValue(new Error('no session'));
  useTaskStore.setState({ tasks: [localTask], awaitingUserByTask: {} });
});
afterEach(cleanup);

it.each([
  [true, '用公开云端（无登录态）继续'],
  [false, '不会改用无登录态的云端浏览器'],
])(
  'the local Chrome panel shows the connect-the-extension wait (publicCloudAllowed=%s)',
  async (publicCloudAllowed, followUp) => {
    useTaskStore.setState({
      awaitingUserByTask: {
        tsk_wait: {
          question: 'q',
          at: 1,
          awaitingKind: 'permission',
          browserConnection: { reason: 'extension_offline', publicCloudAllowed },
        },
      },
    });
    render(<BrowserPanel {...props} />);
    expect(screen.getByTestId('local-chrome-panel-frame')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '需要连接 HOLA DAY Chrome 插件' })).toBeTruthy();
    expect(screen.getByText(new RegExp(followUp))).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('在你的 Chrome 中执行')).toBeNull();
    expect(screen.queryByText(/正在确认 Chrome 会话|暂时无法确认控制状态/)).toBeNull();
    expect(screen.queryByRole('button', { name: '接管' })).toBeNull();
    expect(screen.getByRole('button', { name: '停止任务' })).toBeTruthy();
  },
);

it('a running local Chrome task keeps its in-session copy', () => {
  useTaskStore.setState({ tasks: [{ ...localTask, status: 'executing' }] });
  render(<BrowserPanel {...props} taskStatus="executing" />);
  expect(screen.getByRole('heading', { name: '在你的 Chrome 中执行' })).toBeTruthy();
});
