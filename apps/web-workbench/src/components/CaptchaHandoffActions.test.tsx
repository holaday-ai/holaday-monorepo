// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CaptchaHandoffActions } from './CaptchaHandoffActions';
const mutate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/trpc', () => ({ trpc: { tasks: { browserCaptcha: { mutate } } } }));
afterEach(() => {
  cleanup();
  mutate.mockReset();
});
it('keeps the user waiting when continue still sees a wall, without sending page input', async () => {
  mutate.mockResolvedValue({ ok: false, state: 'waiting' });
  render(<CaptchaHandoffActions taskId="tsk_fixture" />);
  fireEvent.click(screen.getByRole('button', { name: '我已完成，继续' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('验证仍未完成'));
  expect(mutate).toHaveBeenCalledWith({ taskId: 'tsk_fixture', action: 'continue' });
});
it('cancels only the current task through the authenticated handoff route', async () => {
  mutate.mockResolvedValue({ ok: true, state: 'cancelled' });
  render(<CaptchaHandoffActions taskId="tsk_fixture" />);
  fireEvent.click(screen.getByRole('button', { name: '放弃' }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith({ taskId: 'tsk_fixture', action: 'cancel' }),
  );
});
