import { describe, expect, it } from 'vitest';
import {
  clampNumber,
  finiteNumber,
  formatDurationMs,
  nonNegativeNumber,
  nullableFiniteNumber,
  safeArray,
  safeText,
  statusToken,
} from './admin-shared';

describe('admin statusToken', () => {
  it('renders partial success as a user-facing warning label', () => {
    const token = statusToken('partial_success');

    expect(token.label).toBe('部分完成');
    expect(token.textClass).toContain('amber');
  });

  it('falls back for missing statuses', () => {
    expect(statusToken('').label).toBe('未知');
  });
});

describe('admin shared data guards', () => {
  it('coerces malformed arrays and numbers into stable render values', () => {
    expect(safeArray('not-array')).toEqual([]);
    expect(finiteNumber('12')).toBe(12);
    expect(finiteNumber(Number.NaN, 7)).toBe(7);
    expect(nonNegativeNumber(-3)).toBe(0);
    expect(nullableFiniteNumber('bad')).toBeNull();
    expect(clampNumber(140, 0, 100)).toBe(100);
  });

  it('keeps text and duration helpers resilient to bad payload values', () => {
    expect(safeText('', 'fallback')).toBe('fallback');
    expect(formatDurationMs(Number.NaN)).toBe('—');
    expect(formatDurationMs(90_000)).toBe('1分30秒');
  });
});
