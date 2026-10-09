// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ read: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/trpc', () => ({
  trpc: { browserReplay: { read: { query: api.read }, remove: { mutate: api.remove } } },
}));
import { BrowserReplay } from './BrowserReplay';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('shows privacy gaps, steps through frames, and removes the visible archive', async () => {
  api.read.mockResolvedValue({
    frames: [
      { id: '1', actionId: 'a', phase: 'before', capturedAt: 1000, redacted: true, gap: false },
      { id: '2', actionId: 'a', phase: 'failure', capturedAt: 2000, redacted: false, gap: true },
    ],
    total: 2,
    next: null,
    truncated: false,
  });
  api.remove.mockResolvedValue({ ok: true });
  render(<BrowserReplay taskId="task" />);
  fireEvent.click(screen.getByRole('button', { name: '查看回放' }));
  await screen.findByText('敏感页面已遮挡');
  expect(screen.queryByRole('img')).toBeNull();
  fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } });
  expect(screen.getByText('此处未录制或连接中断')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '删除回放' }));
  await waitFor(() => expect(screen.queryByText('此处未录制或连接中断')).toBeNull());
});

it('can reopen after collapsing a pending page load', async () => {
  api.read
    .mockResolvedValueOnce({ frames: [], total: 30, next: 20, truncated: false })
    .mockImplementationOnce(() => new Promise(() => {}));
  render(<BrowserReplay taskId="task" />);
  fireEvent.click(screen.getByRole('button', { name: '查看回放' }));
  fireEvent.click(await screen.findByRole('button', { name: '加载后续画面' }));
  fireEvent.click(screen.getByRole('button', { name: '收起' }));
  expect((screen.getByRole('button', { name: '查看回放' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});
