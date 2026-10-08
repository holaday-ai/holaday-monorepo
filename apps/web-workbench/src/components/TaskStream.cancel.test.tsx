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
