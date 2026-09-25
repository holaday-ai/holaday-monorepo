import { describe, expect, it, vi } from 'vitest';
import type { QuotaSnapshot } from './quota-indicator-state';
import { isQuotaExhausted } from './use-quota-status';

vi.mock('@/lib/trpc', () => ({ trpc: {} }));

describe('task input quota gate', () => {
  it.each([
    ['unmetered_test', 0, false],
    ['unmetered_test', -1, false],
    ['metered', 0, true],
    ['metered', -1, true],
    ['metered', 1, false],
  ] as const)('%s with %s tasks remaining is exhausted=%s', (quotaMode, tasksRemaining, expected) => {
    const snap: QuotaSnapshot = {
      plan: 'free', quotaMode, tasksRemaining,
      tasksUsed: 3, tasksLimit: 3, bonusTasks: 0,
      period: 'day', opusUsed: 0, opusLimit: null, opusRemaining: null,
      bonusOpus: 0, concurrencyLimit: 1, concurrentCount: 0,
    };
    expect(isQuotaExhausted(snap)).toBe(expected);
  });
  it('does not declare an unloaded snapshot exhausted', () => {
    expect(isQuotaExhausted(null)).toBe(false);
  });
});
