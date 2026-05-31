import { describe, expect, it, vi } from 'vitest';
import { withDeadline } from './deadline.js';

describe('withDeadline', () => {
  it('resolves non-promise values without throwing synchronously', async () => {
    await expect(withDeadline('ok', 100, 'too_late')).resolves.toBe('ok');
  });

  it('rejects when promise-like work misses the deadline', async () => {
    vi.useFakeTimers();
    try {
      const pending = withDeadline(new Promise(() => undefined), 100, 'too_late');
      const assertion = expect(pending).rejects.toThrow('too_late');
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
