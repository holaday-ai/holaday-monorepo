import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _bucketCountForTesting, _resetAllBucketsForTesting, tryAcquire } from './rate-limiter.js';

const RATE = { windowMs: 60_000, max: 120 } as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-16T12:00:00.000Z'));
  _resetAllBucketsForTesting();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rate limiter bucket lifecycle', () => {
  it('evicts inactive user buckets while retaining a recently active bucket', () => {
    tryAcquire('energy-analytics-report:inactive', RATE);
    tryAcquire('energy-analytics-report:active', RATE);
    expect(_bucketCountForTesting()).toBe(2);

    vi.advanceTimersByTime(30_000);
    tryAcquire('energy-analytics-report:active', RATE);

    vi.advanceTimersByTime(30_001);
    tryAcquire('energy-analytics-report:new', RATE);

    expect(_bucketCountForTesting()).toBe(2);
  });
});
