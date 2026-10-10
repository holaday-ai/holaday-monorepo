import { useTaskStore } from '@/stores/task-store';
// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskStream } from './TaskStream';
const mocks = vi.hoisted(() => ({ abort: vi.fn(), toast: { show: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    tasks: { abort: { mutate: mocks.abort } },
    taskRecovery: {
      failureContext: {
        query: vi.fn().mockResolvedValue({
          refund: { state: 'not_charged' },
          inputFiles: [],
          unavailableInputCount: 0,
        }),
      },
    },
  },
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => mocks.toast }));
afterEach(() => {
  cleanup();
  useTaskStore.getState().reset();
});
it('one cancel click removes the waiting banner and updates the rendered terminal card without a websocket', async () => {
  mocks.abort.mockResolvedValue({ ok: true, state: 'cancelled' });
  useTaskStore.setState({
    tasks: [
      {
        taskId: 'tsk_cancel',
        title: '等待确认',
        intent: '写短文',
        status: 'awaiting_user',
        tickCount: 0,
        createdAt: new Date(),
      },
    ],
    awaitingUserByTask: {
      tsk_cancel: { question: '需要补充什么？', awaitingKind: 'clarification', at: Date.now() },
    },
  });
  function Harness() {
    const task = useTaskStore((s) => s.tasks[0]);
    return task ? <TaskStream task={task} /> : null;
  }
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: /取消/ }));
  await waitFor(() => expect(useTaskStore.getState().tasks[0]?.status).toBe('cancelled'));
  expect(mocks.abort).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('需要补充什么？')).toBeNull();
  expect(screen.getAllByText(/已取消/).length).toBeGreaterThan(0);
});

it('shows "用公开云端（无登录态）继续" only for a non-identity Chrome-extension wait (FIX-D11)', async () => {
  const continueSpy = vi.fn().mockResolvedValue({ taskId: 'tsk_public' });
  for (const publicCloudAllowed of [false, true]) {
    useTaskStore.setState({
      tasks: [
        {
          taskId: 'tsk_conn',
          title: '查询',
          intent: '在京东查一下价格',
          status: 'awaiting_user',
          tickCount: 0,
          createdAt: new Date(),
        },
      ],
      awaitingUserByTask: {
        tsk_conn: {
          question: '需要连接 HOLA DAY Chrome 插件：请安装或连接插件。',
          awaitingKind: 'permission',
          at: Date.now(),
          browserConnection: { reason: 'extension_offline', publicCloudAllowed },
        },
      },
      continueInPublicCloud: continueSpy,
    });
    function Harness() {
      const task = useTaskStore((s) => s.tasks[0]);
      return task ? <TaskStream task={task} /> : null;
    }
    render(<Harness />);
    expect(screen.getAllByText('需要连接 HOLA DAY Chrome 插件').length).toBeGreaterThan(0);
    expect(screen.queryByText(/拒绝访问/)).toBeNull();
    const button = screen.queryByRole('button', { name: '用公开云端（无登录态）继续' });
    if (!publicCloudAllowed) expect(button).toBeNull();
    else {
      expect(button).not.toBeNull();
      await userEvent.click(button as HTMLElement);
      await waitFor(() => expect(continueSpy).toHaveBeenCalledWith('tsk_conn'));
    }
    cleanup();
  }
});

it('offers one retry when the original is cancelled but the public-cloud task was not created (FIX-PR259-2)', async () => {
  let release!: (value: { taskId: string }) => void;
  const continueSpy = vi.fn(
    () =>
      new Promise<{ taskId: string }>((resolve) => {
        release = resolve;
      }),
  );
  useTaskStore.setState({
    tasks: [
      {
        taskId: 'tsk_conn',
        title: '查询',
        intent: '在京东查一下价格',
        status: 'cancelled',
        tickCount: 0,
        createdAt: new Date(),
      },
    ],
    awaitingUserByTask: {},
    publicCloudContinuationByTask: { tsk_conn: { stage: 'cancelled' } },
    continueInPublicCloud: continueSpy,
  });
  function Harness() {
    const task = useTaskStore((s) => s.tasks[0]);
    return task ? <TaskStream task={task} /> : null;
  }
  render(<Harness />);
  const retry = screen.getByRole('button', { name: '重试用公开云端（无登录态）继续' });
  await userEvent.click(retry);
  await userEvent.click(screen.getByRole('button', { name: '提交中…' }));
  expect(continueSpy).toHaveBeenCalledTimes(1);
  release({ taskId: 'tsk_public' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '重试用公开云端（无登录态）继续' })).toBeTruthy(),
  );
});
