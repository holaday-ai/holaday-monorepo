// @vitest-environment happy-dom
import { useTaskStore } from '@/stores/task-store';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FLOATING_COMPOSER_MAX_HEIGHT_PX,
  FLOATING_COMPOSER_MIN_HEIGHT_PX,
  InputArea,
  floatingComposerHeight,
} from './InputArea';
import { ToastProvider } from './ui/toast';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    skills: { list: { query: async () => [] } },
    models: { list: { query: async () => ({ items: [] }) } },
  },
}));

afterEach(() => {
  cleanup();
  useTaskStore.setState({ tasks: [], selectedTaskId: null });
  vi.restoreAllMocks();
});

function mount(props: { floating?: boolean } = { floating: true }) {
  const onSubmit = vi.fn(async () => ({ ok: true }));
  render(
    <MemoryRouter>
      <ToastProvider>
        <InputArea onSubmit={onSubmit} attachmentsAllowed {...props} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onSubmit };
}

describe('BROWSER-HOME-1 InputArea floating variant (same component)', () => {
  it('is a single line by default (44–48px)', () => {
    mount();
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.getAttribute('rows')).toBe('1');
    expect(FLOATING_COMPOSER_MIN_HEIGHT_PX).toBeGreaterThanOrEqual(44);
    expect(FLOATING_COMPOSER_MIN_HEIGHT_PX).toBeLessThanOrEqual(48);
    expect(box.style.height).toBe(`${FLOATING_COMPOSER_MIN_HEIGHT_PX}px`);
    // The full-size composer's footer / batch hint are not part of the floating bar.
    expect(screen.queryByText('Enter 发送')).toBeNull();
  });

  it('grows with its content up to 5 lines, then scrolls', async () => {
    expect(floatingComposerHeight(0)).toBe(FLOATING_COMPOSER_MIN_HEIGHT_PX);
    expect(floatingComposerHeight(88)).toBe(88);
    expect(floatingComposerHeight(5000)).toBe(FLOATING_COMPOSER_MAX_HEIGHT_PX);
    // 5 lines of 22px + padding.
    expect(FLOATING_COMPOSER_MAX_HEIGHT_PX).toBe(22 * 5 + 22);

    const { user } = mount();
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.style.maxHeight).toBe(`${FLOATING_COMPOSER_MAX_HEIGHT_PX}px`);
    let contentHeight = 66;
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => contentHeight });
    await user.type(box, 'a');
    expect(box.style.height).toBe('66px');
    contentHeight = 900;
    await user.type(box, '{Shift>}{Enter}{/Shift}b');
    expect(box.style.height).toBe(`${FLOATING_COMPOSER_MAX_HEIGHT_PX}px`);
  });

  it('collapses into a small button and expands with the text kept', async () => {
    const { user } = mount();
    await user.type(screen.getByRole('textbox'), '整理这个页面');
    await user.click(screen.getByRole('button', { name: '收起输入框' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    const expand = screen.getByRole('button', { name: '展开输入框' });
    expect(expand.textContent).toContain('继续输入');
    await user.click(expand);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('整理这个页面');
  });

  it('submits through the same onSubmit', async () => {
    const { user, onSubmit } = mount();
    await user.type(screen.getByRole('textbox'), '把标题和价格整理一下{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((onSubmit.mock.calls[0] as unknown[])[0]).toBe('把标题和价格整理一下');
  });

  it('leaves the normal composer unchanged', () => {
    mount({ floating: false });
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.getAttribute('rows')).toBe('2');
    expect(box.style.height).toBe('');
    expect(screen.queryByRole('button', { name: '收起输入框' })).toBeNull();
  });
});
