// @vitest-environment happy-dom

import type { UiTask, UiTaskStatus } from '@/types/task';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunningTaskDock } from './RunningTaskDock';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

function task(taskId: string, status: UiTaskStatus, createdAt = '2026-08-12T10:00:00Z'): UiTask {
  return {
    taskId,
    intent: `整理 ${taskId} 的资料并生成报告`,
    title: `任务 ${taskId}`,
    status,
    tickCount: 2,
    createdAt: new Date(createdAt),
  };
}

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

describe('RunningTaskDock', () => {
  it('keeps the tracked task visible when it completes and links back to it', async () => {
    const onEvent = vi.fn();
    const { rerender } = render(
      <RunningTaskDock tasks={[task('one', 'executing')]} onEvent={onEvent} />,
    );

    expect(screen.getByText('执行中')).toBeTruthy();
    rerender(<RunningTaskDock tasks={[task('one', 'completed')]} onEvent={onEvent} />);
    expect(screen.getByText('已完成')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '查看任务结果' }));
    expect(navigate).toHaveBeenCalledWith('/?task=one');
    expect(onEvent).toHaveBeenCalledWith({
      type: 'running_task_returned',
      taskStatus: 'completed',
    });
  });

  it('does not guess a task when equal-priority work is active', async () => {
    const onEvent = vi.fn();
    render(
      <RunningTaskDock
        tasks={[
          task('one', 'executing', '2026-08-12T09:00:00Z'),
          task('two', 'executing', '2026-08-12T11:00:00Z'),
        ]}
        onEvent={onEvent}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '查看进行中的任务' }));
    expect(navigate).toHaveBeenCalledWith('/');
    expect(onEvent).toHaveBeenCalledWith({
      type: 'running_task_returned',
      taskStatus: 'multiple',
    });
  });

  it('shows the waiting state without forcing navigation', () => {
    render(<RunningTaskDock tasks={[task('approval', 'awaiting_user')]} onEvent={vi.fn()} />);
    expect(screen.getByText('需要你回复')).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回任务处理' })).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders nothing for terminal history on first mount', () => {
    const { container } = render(
      <RunningTaskDock tasks={[task('old', 'completed')]} onEvent={vi.fn()} />,
    );
    expect(container.firstElementChild).toBeNull();
  });
});
