import { describe, expect, it, vi } from 'vitest';
import { createMediaActionGuard } from './media-action-guard';

describe('createMediaActionGuard', () => {
  it('rejects a second media action until the first action releases the guard', () => {
    const guard = createMediaActionGuard();

    expect(guard.acquire()).toBe(true);
    expect(guard.acquire()).toBe(false);

    guard.release();

    expect(guard.acquire()).toBe(true);
  });

  it('keeps repeated submit attempts from invoking the paid action twice', async () => {
    const guard = createMediaActionGuard();
    let finishFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const paidAction = vi.fn(async () => {
      await firstFinished;
    });

    async function submit(): Promise<void> {
      if (!guard.acquire()) return;
      try {
        await paidAction();
      } finally {
        guard.release();
      }
    }

    const first = submit();
    const duplicate = submit();
    expect(paidAction).toHaveBeenCalledTimes(1);

    finishFirst();
    await Promise.all([first, duplicate]);
    await submit();

    expect(paidAction).toHaveBeenCalledTimes(2);
  });
});
