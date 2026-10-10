import { describe, expect, it } from 'vitest';
import {
  decideTaskOutcomeNotification,
  normaliseFailureThreshold,
} from './task-outcome-policy.js';

const prefs = (consecutiveFailures: number, threshold?: number, notifyOnSuccess?: boolean) => ({
  consecutiveFailures,
  failureNotifyThreshold: threshold,
  notifyOnSuccess,
});

describe('decideTaskOutcomeNotification', () => {
  it('notifies every failure by default (N=1), inbox + IM', () => {
    for (const streak of [1, 2, 3]) {
      expect(decideTaskOutcomeNotification('failed', prefs(streak))).toEqual({
        notify: true,
        delivery: 'all',
      });
    }
  });

  it('waits for N consecutive failures, then reminds every N', () => {
    const fires = [1, 2, 3, 4, 5, 6, 7].filter(
      (streak) => decideTaskOutcomeNotification('failed', prefs(streak, 3)).notify,
    );
    expect(fires).toEqual([3, 6]);
  });

  it('success is silent unless the task opted in', () => {
    expect(decideTaskOutcomeNotification('success', prefs(0))).toEqual({ notify: false });
    expect(decideTaskOutcomeNotification('success', prefs(0, 1, false))).toEqual({ notify: false });
    expect(decideTaskOutcomeNotification('success', prefs(0, 1, true))).toEqual({
      notify: true,
      delivery: 'all',
    });
  });

  it('started / skipped stay inbox-only; cancelled is silent', () => {
    expect(decideTaskOutcomeNotification('started', prefs(0, 1, true))).toEqual({
      notify: true,
      delivery: 'in_app_only',
    });
    expect(decideTaskOutcomeNotification('skipped', prefs(0))).toEqual({
      notify: true,
      delivery: 'in_app_only',
    });
    expect(decideTaskOutcomeNotification('cancelled', prefs(0, 1, true))).toEqual({
      notify: false,
    });
  });
});

describe('normaliseFailureThreshold', () => {
  it('clamps into 1..10 and defaults to 1', () => {
    expect(normaliseFailureThreshold(undefined)).toBe(1);
    expect(normaliseFailureThreshold(null)).toBe(1);
    expect(normaliseFailureThreshold(0)).toBe(1);
    expect(normaliseFailureThreshold(3.7)).toBe(3);
    expect(normaliseFailureThreshold(99)).toBe(10);
    expect(normaliseFailureThreshold(Number.NaN)).toBe(1);
  });
});
