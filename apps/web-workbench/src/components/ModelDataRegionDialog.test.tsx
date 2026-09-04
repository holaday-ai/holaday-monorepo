// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelDataRegionDialog } from './ModelDataRegionDialog';

afterEach(cleanup);

describe('ModelDataRegionDialog', () => {
  it('explains permanence, disables continuation until selection, and confirms once', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => undefined);
    render(
      <ModelDataRegionDialog
        open
        assigning={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '选择任务处理区域' });
    expect(within(dialog).getByText(/控制 AI 模型任务在哪里处理/)).toBeTruthy();
    expect(within(dialog).getByText(/创建模型数据后不能直接更改/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: '确认并继续任务' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByText('请选择一个区域后继续。')).toBeTruthy();

    await user.click(within(dialog).getByRole('radio', { name: /国际/ }));
    expect(confirm.hasAttribute('disabled')).toBe(false);
    await user.dblClick(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('intl');
  });

  it('uses modal focus containment and Escape cancels without confirmation', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ModelDataRegionDialog
        open
        assigning={false}
        error={null}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '选择任务处理区域' });
    const cancel = within(dialog).getByRole('button', { name: '暂不选择' });
    cancel.focus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('explains the disabled state while assignment is running', () => {
    render(
      <ModelDataRegionDialog
        open
        assigning
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '正在保存区域…' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText('正在保存区域并恢复你的任务…')).toBeTruthy();
  });
});
