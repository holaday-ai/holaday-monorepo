import { describe, expect, it, vi } from 'vitest';
import { dispatchSpecialOrGeneric } from './planned-runner.js';

describe('planned runner specialized dispatch boundary', () => {
  it('does not create a generic task when the stock monitor handles the run', async () => {
    const generic = vi.fn(async () => undefined);
    const result = await dispatchSpecialOrGeneric({
      special: vi.fn(async () => ({ handled: true as const, ok: true as const })),
      generic,
    });
    expect(result).toEqual({ handled: true, ok: true });
    expect(generic).not.toHaveBeenCalled();
  });

  it('keeps the existing generic path when no specialized record exists', async () => {
    const generic = vi.fn(async () => undefined);
    const result = await dispatchSpecialOrGeneric({
      special: vi.fn(async () => ({ handled: false as const })),
      generic,
    });
    expect(result).toEqual({ handled: false });
    expect(generic).toHaveBeenCalledTimes(1);
  });
});
