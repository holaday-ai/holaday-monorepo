import { expect, it, vi } from 'vitest';
import { finishTaskBrowser } from './finish-task-browser.js';
it('releases an interrupted CAPTCHA browser and waits for physical pool release', async () => {
  let released = false;
  let finish!: () => void;
  const pool = {
    retain: vi.fn(() => true),
    release: vi.fn(
      () =>
        new Promise<boolean>((r) => {
          finish = () => {
            released = true;
            r(true);
          };
        }),
    ),
  };
  let settled = false;
  const result = finishTaskBrowser(pool as never, 'tsk_captcha', 60000, false).then(() => {
    settled = true;
  });
  expect(pool.retain).not.toHaveBeenCalled();
  expect(pool.release).toHaveBeenCalledWith('tsk_captcha', 'task-tsk_captcha-done');
  expect(settled).toBe(false);
  finish();
  await result;
  expect(released).toBe(true);
});
it('keeps ordinary successful task review retention and releases when retention fails', async () => {
  const pool = { retain: vi.fn(() => true), release: vi.fn(async () => true) };
  await finishTaskBrowser(pool as never, 'tsk_normal', 60000, true);
  expect(pool.release).not.toHaveBeenCalled();
  pool.retain.mockReturnValue(false);
  await finishTaskBrowser(pool as never, 'tsk_normal', 60000, true);
  expect(pool.release).toHaveBeenCalledOnce();
});
