// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputArea } from './InputArea';
import { ToastProvider } from './ui/toast';

vi.mock('@/lib/trpc', () => ({ trpc: { skills: { list: { query: async () => [] } } } }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(attachmentsAllowed: boolean) {
  const onSubmit = vi.fn<Parameters<typeof InputArea>[0]['onSubmit']>(async () => ({ ok: true }));
  render(
    <MemoryRouter>
      <ToastProvider>
        <InputArea attachmentsAllowed={attachmentsAllowed} onSubmit={onSubmit} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onSubmit };
}
describe('composer task choices independent of attachment entitlement', () => {
  it('lets a user without attachments select plan mode and submit it', async () => {
    const { user, onSubmit } = mount(false);
    await user.click(screen.getByRole('button', { name: '附件与任务选项' }));
    await user.click(screen.getByRole('menuitem', { name: '先出方案' }));
    await user.keyboard('{Escape}');
    await user.type(screen.getByRole('textbox'), '只制定三步计划');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(onSubmit.mock.calls[0]?.slice(0, 4)).toEqual(['只制定三步计划', [], 'plan', 'auto']);
  });
  it('keeps restricted upload from opening the file picker', async () => {
    const { user } = mount(false);
    const picker = document.querySelector('input[type=file]') as HTMLInputElement;
    const open = vi.spyOn(picker, 'click');
    await user.click(screen.getByRole('button', { name: '附件与任务选项' }));
    await user.click(screen.getByRole('menuitem', { name: /添加照片和文件/ }));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByText(/免费版不支持附件/)).toBeTruthy();
  });
  it('still opens the file picker when attachments are allowed', async () => {
    const { user } = mount(true);
    const picker = document.querySelector('input[type=file]') as HTMLInputElement;
    const open = vi.spyOn(picker, 'click');
    await user.click(screen.getByRole('button', { name: '附件与任务选项' }));
    await user.click(screen.getByRole('menuitem', { name: '添加照片和文件' }));
    expect(open).toHaveBeenCalledOnce();
    expect(screen.queryByText(/免费版不支持附件/)).toBeNull();
  });
});
