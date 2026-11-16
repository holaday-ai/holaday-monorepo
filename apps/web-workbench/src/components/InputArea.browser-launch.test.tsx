import { useTaskStore } from '@/stores/task-store';
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
function mount(floating = false) {
  const submit = vi.fn();
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
