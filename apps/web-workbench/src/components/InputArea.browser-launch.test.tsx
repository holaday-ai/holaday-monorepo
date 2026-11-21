import { useTaskStore } from '@/stores/task-store';
import { BROWSER_LAUNCH_RECOVERED_EVENT } from '@holaday/shared-types';
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InputArea } from './InputArea';
import { ToastProvider } from './ui/toast';
const api = vi.hoisted(() => ({ options: vi.fn() }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    skills: { list: { query: async () => [] } },
    models: { list: { query: async () => ({ items: [] }) } },
    tasks: { localChromeLaunchOptions: { query: api.options } },
  },
}));
beforeEach(() => {
  useTaskStore.getState().reset();
  localStorage.setItem('holaday.access_token', 'fixture-owner');
  api.options.mockResolvedValue({ backgroundTaskTabs: true });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetAllMocks();
});
function mount(floating = false, submit = vi.fn()) {
  render(
    <MemoryRouter>
      <ToastProvider>
        <InputArea approved onSubmit={submit} floating={floating} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return submit;
}
it('offers Chrome at the new-task starting point when enabled', async () => {
  mount();
  expect(await screen.findByRole('button', { name: '选择 Chrome 页面' })).toBeTruthy();
});
it('keeps the legacy new-task UI when disabled', async () => {
  api.options.mockResolvedValue({ backgroundTaskTabs: false });
  mount();
  await vi.waitFor(() => expect(api.options).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: '选择 Chrome 页面' })).toBeNull();
});
it('keeps a personal cloud-browser composer on that browser', async () => {
  mount(true);
  expect(screen.queryByRole('button', { name: '选择 Chrome 页面' })).toBeNull();
  expect(api.options).not.toHaveBeenCalled();
});
it('asks for a page instead of guessing one for a new current-page task', async () => {
  const submit = mount();
  await screen.findByRole('button', { name: '选择 Chrome 页面' });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '处理当前页' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(submit).not.toHaveBeenCalled();
  expect(await screen.findByText(/请先选择.*Chrome.*页面/)).toBeTruthy();
});

const recoveredSource = {
  browserSessionId: '82cf0bca-b78c-4f12-af23-035421ab959c',
  tabId: 42,
  origin: 'https://work.example',
  selectionId: '4888c303-9880-44d9-885e-51e13755933b',
  mode: 'independent' as const,
};
const recoveredOperation = '6488c303-9880-44d9-885e-51e13755933b';
async function submitUnknownDraft() {
  useTaskStore.setState({
    localChromeSelection: {
      extensionClientId: 'connection',
      tabId: 42,
      expectedUrl: recoveredSource.origin,
      selectionId: recoveredSource.selectionId,
      title: 'Work',
      launchRecovery: true,
      launchRecoveryReady: true,
      launchBrowserSessionId: recoveredSource.browserSessionId,
    },
  });
  const submit = mount();
  submit.mockResolvedValue({ ok: false, browserOperationId: recoveredOperation });
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '整理后台报表' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(input.disabled).toBe(false));
  return { input, submit };
}
function recoverDraft() {
  fireEvent(
    window,
    new CustomEvent(BROWSER_LAUNCH_RECOVERED_EVENT, {
      detail: {
        operationId: recoveredOperation,
        intent: '整理后台报表',
        source: recoveredSource,
        taskId: 'tsk_recovered',
      },
    }),
  );
}
it('clears only the unchanged failed draft after its original task is recovered, preventing another send', async () => {
  const { input, submit } = await submitUnknownDraft();
  recoverDraft();
  await vi.waitFor(() => expect(input.value).toBe(''));
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(screen.getByText('已找回刚才创建的 Chrome 任务。')).toBeTruthy();
});
it('preserves a new user draft when an older submission is recovered', async () => {
  const { input } = await submitUnknownDraft();
  fireEvent.change(input, { target: { value: '整理另一份报表' } });
  recoverDraft();
  expect(input.value).toBe('整理另一份报表');
});

it.each([false, true])(
  'keeps a submission error visible after its toast expires and preserves the draft (floating=%s)',
  async (floating) => {
    vi.useFakeTimers();
    try {
      const submit = vi.fn(async () => ({ error: '独立页面仍在加载，请稍后继续核对。' }));
      mount(floating, submit);
      const input = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: '整理报表，保留输入' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await vi.waitFor(() => expect(input.disabled).toBe(false));
      expect(screen.getByRole('alert').textContent).toContain('仍在加载');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500);
      });
      expect(screen.queryByRole('button', { name: /关闭提示.*仍在加载/ })).toBeNull();
      expect(screen.getByRole('alert').textContent).toContain('仍在加载');
      expect(input.value).toBe('整理报表，保留输入');
      expect(submit).toHaveBeenCalledOnce();
      fireEvent.change(input, { target: { value: '用户修改后的新指令' } });
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  },
);
it('shows actual preparation feedback while submission is pending without asserting acceptance', async () => {
  let finish!: (value: { error: string }) => void;
  const submit = vi.fn(
    () =>
      new Promise<{ error: string }>((resolve) => {
        finish = resolve;
      }),
  );
  mount(false, submit);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '整理报表' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
  act(() =>
    useTaskStore.setState({
      browserPreparationStatus: '独立页面已创建，仍在加载；正在核对原页面…',
    }),
  );
  expect(
    screen.getByRole('button', { name: '独立页面已创建，仍在加载；正在核对原页面…' }),
  ).toBeTruthy();
  expect(screen.queryByText(/已收到任务/)).toBeNull();
  await act(async () => finish({ error: '独立页面仍在加载，请稍后继续核对。' }));
  expect(input.value).toBe('整理报表');
  expect(screen.getByRole('alert')).toBeTruthy();
});

it('does not display a late submission error under a different account', async () => {
  let finish!: (value: { error: string }) => void;
  const submit = vi.fn(
    () =>
      new Promise<{ error: string }>((resolve) => {
        finish = resolve;
      }),
  );
  mount(false, submit);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '整理原账号报表' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
  localStorage.setItem('holaday.access_token', 'fixture-other-owner');
  await act(async () => finish({ error: '原账号的回执错误' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(submit).toHaveBeenCalledOnce();
});
