// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ tabs: vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc: { tasks: { localChromeTabs: { query: api.tabs } } } }));
import { LocalChromePicker } from './LocalChromePicker';
import { useTaskStore } from '@/stores/task-store';
afterEach(() => { cleanup(); vi.resetAllMocks(); useTaskStore.setState({ localChromeSelection: null }); });
it('never auto-selects and retains the exact user-selected connection and tab', async () => {
  const tab = { extensionClientId: 'connection', tabId: 42, expectedUrl: 'https://work.example', selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4', title: '工作页面' };
  api.tabs.mockResolvedValue({ tabs: [tab], connected: true, unavailable: false });
  render(<LocalChromePicker />);
  expect(api.tabs).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('button', { name: '选择 Chrome 页面' }), { key: 'Enter' });
  await screen.findByRole('menuitem', { name: /工作页面/ });
  expect(useTaskStore.getState().localChromeSelection).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: /工作页面/ }));
  expect(useTaskStore.getState().localChromeSelection).toEqual(tab);
  fireEvent.click(screen.getByRole('button', { name: '移除 Chrome 页面' }));
  expect(useTaskStore.getState().localChromeSelection).toBeNull();
});
it('shows a disconnected state without offering an arbitrary default tab', async () => {
  api.tabs.mockResolvedValue({ tabs: [], connected: false, unavailable: false });
  render(<LocalChromePicker />);
  fireEvent.keyDown(screen.getByRole('button', { name: '选择 Chrome 页面' }), { key: 'Enter' });
  await waitFor(() => expect(screen.getByText('请先连接 HOLADAY Chrome 扩展')).toBeTruthy());
  expect(useTaskStore.getState().localChromeSelection).toBeNull();
});
it('offers reconnect and conditional update guidance when discovery cannot determine compatibility', async () => {
  api.tabs.mockResolvedValue({ tabs: [], connected: true, unavailable: true, needsUpdate: false });
  render(<LocalChromePicker />);
  fireEvent.keyDown(screen.getByRole('button', { name: '选择 Chrome 页面' }), { key: 'Enter' });
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toMatch(/重新连接/);
  expect(alert.textContent).toMatch(/旧版.*更新/);
  expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  expect(useTaskStore.getState().localChromeSelection).toBeNull();
});
it('shows a definite update instruction only for an incompatible extension response', async () => {
  api.tabs.mockResolvedValue({ tabs: [], connected: true, unavailable: true, needsUpdate: true });
  render(<LocalChromePicker />);
  fireEvent.keyDown(screen.getByRole('button', { name: '选择 Chrome 页面' }), { key: 'Enter' });
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toMatch(/请更新并重新连接/);
  expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  expect(useTaskStore.getState().localChromeSelection).toBeNull();
});
