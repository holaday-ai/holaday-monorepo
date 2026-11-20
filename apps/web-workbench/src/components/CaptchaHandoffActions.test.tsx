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
it('shows the challenge hint and offers another way only after repeated failed rounds (CAPTCHA-REDUCE-1)', async () => {
  const hint = '把所有符合题目的格子点掉；点过的格子会换新图，新图里还有也要点';
  mutate.mockImplementation(async ({ action }: { action: string }) =>
    action === 'status'
      ? {
          ok: true,
          state: 'waiting',
          failedRounds: 0,
          alternateAvailable: false,
          challenge: { kind: 'recaptcha_image', hint },
        }
      : action === 'continue'
        ? {
            ok: false,
            state: 'waiting',
            failedRounds: 2,
            alternateAvailable: true,
            challenge: { kind: 'recaptcha_image', hint },
          }
        : {
            ok: true,
            state: 'alternate',
            failedRounds: 2,
            alternateAvailable: true,
            challenge: null,
          },
  );
  render(<CaptchaHandoffActions taskId="tsk_fixture" />);
  await waitFor(() =>
    expect(screen.getByTestId('captcha-hint').textContent).toContain('新图里还有也要点'),
  );
  expect(screen.queryByRole('button', { name: '换个方式继续' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '我已完成，继续' }));
  const another = await screen.findByRole('button', { name: '换个方式继续' });
  fireEvent.click(another);
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith({ taskId: 'tsk_fixture', action: 'alternate' }),
  );
});
it('opens the live browser full screen once on a phone', async () => {
  mutate.mockResolvedValue({
    ok: true,
    state: 'waiting',
    failedRounds: 0,
    alternateAvailable: false,
    challenge: null,
  });
  const width = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  const onFullscreen = vi.fn();
  const view = render(<CaptchaHandoffActions taskId="tsk_fixture" onFullscreen={onFullscreen} />);
  view.rerender(<CaptchaHandoffActions taskId="tsk_fixture" onFullscreen={onFullscreen} />);
  expect(onFullscreen).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '全屏操作' }));
  expect(onFullscreen).toHaveBeenCalledTimes(2);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
});
