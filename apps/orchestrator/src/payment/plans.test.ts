import { describe, expect, it } from 'vitest';
import { describePlanOrder, nextExpiryFor } from './plans.js';

describe('nextExpiryFor', () => {
  it('extends from now when no current expiry', () => {
    const before = Date.now();
    const next = nextExpiryFor('basic', null);
    const after = Date.now();
    const expected = before + 30 * 24 * 60 * 60 * 1000;
    const expectedMax = after + 30 * 24 * 60 * 60 * 1000;
    expect(next.getTime()).toBeGreaterThanOrEqual(expected);
    expect(next.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('extends from now when expiry is in the past', () => {
    const before = Date.now();
    const stale = new Date(before - 10 * 24 * 60 * 60 * 1000);
    const next = nextExpiryFor('pro', stale);
    expect(next.getTime()).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000 - 100);
  });

  it('stacks 30 days on top of an active expiry', () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const next = nextExpiryFor('basic', future);
    const expected = future.getTime() + 30 * 24 * 60 * 60 * 1000;
    expect(next.getTime()).toBe(expected);
  });
});

describe('describePlanOrder', () => {
  it('returns a Chinese description for monthly plans', () => {
    expect(describePlanOrder('basic')).toContain('Basic');
    expect(describePlanOrder('basic')).toContain('月度');
    expect(describePlanOrder('pro')).toContain('Pro');
  });
});
