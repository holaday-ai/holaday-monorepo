import { describe, expect, it } from 'vitest';
import { describePlanOrder, nextExpiryFor } from './plans.js';

describe('nextExpiryFor', () => {
  it('extends from now (monthly) when no current expiry', () => {
    const before = Date.now();
    const next = nextExpiryFor('basic', 'monthly', null);
    const after = Date.now();
    const expected = before + 30 * 24 * 60 * 60 * 1000;
    const expectedMax = after + 30 * 24 * 60 * 60 * 1000;
    expect(next.getTime()).toBeGreaterThanOrEqual(expected);
    expect(next.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('extends from now (monthly) when expiry is in the past', () => {
    const before = Date.now();
    const stale = new Date(before - 10 * 24 * 60 * 60 * 1000);
    const next = nextExpiryFor('pro', 'monthly', stale);
    expect(next.getTime()).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000 - 100);
  });

  it('stacks 30 days on top of an active expiry (monthly)', () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const next = nextExpiryFor('basic', 'monthly', future);
    const expected = future.getTime() + 30 * 24 * 60 * 60 * 1000;
    expect(next.getTime()).toBe(expected);
  });

  it('uses 365-day cycle when yearly', () => {
    const before = Date.now();
    const next = nextExpiryFor('pro', 'yearly', null);
    const expected = before + 365 * 24 * 60 * 60 * 1000;
    expect(next.getTime()).toBeGreaterThanOrEqual(expected - 100);
    expect(next.getTime()).toBeLessThanOrEqual(expected + 1000);
  });
});

describe('describePlanOrder', () => {
  it('Chinese description includes plan name + cycle label (monthly)', () => {
    const out = describePlanOrder('basic', 'monthly');
    expect(out).toContain('基础版');
    expect(out).toContain('月度');
  });
  it('Chinese description includes plan name + cycle label (yearly)', () => {
    const out = describePlanOrder('pro', 'yearly');
    expect(out).toContain('专业版');
    expect(out).toContain('年度');
  });
});
