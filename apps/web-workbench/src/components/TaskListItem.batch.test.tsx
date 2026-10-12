// @vitest-environment happy-dom
import { ToastProvider } from '@/components/ui/toast';
import type { UiTask } from '@/types/task';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskListItem } from './TaskListItem';

const task: UiTask = {
  taskId: 'tsk_batch',
  intent: '整理新品资料',
  title: null,
  status: 'executing',
  tickCount: 1,
  createdAt: new Date('2026-10-12T00:00:00Z'),
};

afterEach(cleanup);

function mount(batchMode = true, batchDisabled = true) {
  const onSelect = vi.fn();
  const onBatchToggle = vi.fn();
  const view = render(
    <ToastProvider>
      <TaskListItem
        task={task}
        selected={false}
        batchMode={batchMode}
        batchDisabled={batchDisabled}
        onSelect={onSelect}
        onBatchToggle={onBatchToggle}
      />
    </ToastProvider>,
  );
  const row = view.container.querySelector('[data-task-status]') as HTMLElement;
  const title = within(row).getByRole('button', { name: '整理新品资料' });
  return { row, title, onSelect, onBatchToggle };
}

describe('batch task rows', () => {
  it('exposes disabled semantics on the row and title with a hover explanation', () => {
    const { row, title } = mount();
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(title.getAttribute('aria-disabled')).toBe('true');
    expect(row.title).toMatch(/进行中.*不能批量操作/);
  });

  it.each(['row', 'title'] as const)(
    'explains a disabled %s click without selecting or opening it',
    (target) => {
      const view = mount();
      fireEvent.click(view[target]);
      expect(screen.getByText('进行中的任务不能批量操作')).toBeTruthy();
      expect(view.onSelect).not.toHaveBeenCalled();
      expect(view.onBatchToggle).not.toHaveBeenCalled();
    },
  );

  it.each(['row', 'title'] as const)('still toggles an available %s exactly once', (target) => {
    const view = mount(true, false);
    fireEvent.click(view[target]);
    expect(view.onBatchToggle).toHaveBeenCalledTimes(1);
    expect(view.onBatchToggle).toHaveBeenCalledWith('tsk_batch');
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(view.title.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('still opens an active task outside batch mode', () => {
    const view = mount(false, true);
    fireEvent.click(view.title);
    expect(view.onSelect).toHaveBeenCalledTimes(1);
    expect(view.onSelect).toHaveBeenCalledWith('tsk_batch');
    expect(view.onBatchToggle).not.toHaveBeenCalled();
    expect(view.title.getAttribute('aria-disabled')).not.toBe('true');
  });
});
