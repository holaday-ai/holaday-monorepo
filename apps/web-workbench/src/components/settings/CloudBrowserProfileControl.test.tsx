// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const { query, mutate } = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn() }));
vi.mock('@/lib/trpc', () => ({
  trpc: { tasks: { browserProfileStatus: { query }, browserProfileClear: { mutate } } },
}));
import { CloudBrowserProfileControl } from './CloudBrowserProfileControl';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('stays hidden while the profile store is off', async () => {
  query.mockResolvedValue({ configured: false });
  render(<CloudBrowserProfileControl />);
  await waitFor(() => expect(query).toHaveBeenCalled());
  expect(screen.queryByTestId('cloud-browser-profile')).toBeNull();
});
it('clears only the caller’s profile in one click (CAPTCHA-REDUCE-1)', async () => {
  query.mockResolvedValue({ configured: true });
  mutate.mockResolvedValue({ ok: true, configured: true });
  render(<CloudBrowserProfileControl />);
  fireEvent.click(await screen.findByRole('button', { name: '清除云端浏览器档案' }));
  await waitFor(() => expect(screen.getByText('已清除。')).toBeTruthy());
  expect(mutate).toHaveBeenCalledTimes(1);
});
