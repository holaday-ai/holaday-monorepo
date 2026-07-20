import { describe, expect, it, vi } from 'vitest';
import { retainScreencastInputFocus } from './screencast-input-focus';

describe('retainScreencastInputFocus', () => {
  it('prevents canvas focus theft and restores the keyboard target after the pointer event', () => {
    const preventDefault = vi.fn();
    const focus = vi.fn();
    const scheduled: FrameRequestCallback[] = [];

    retainScreencastInputFocus({
      event: { preventDefault },
      input: { focus },
      scheduleFrame: (callback) => {
        scheduled.push(callback);
        return 1;
      },
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });

    expect(scheduled).toHaveLength(1);
    scheduled[0]?.(0);

    expect(focus).toHaveBeenCalledTimes(2);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });
});
