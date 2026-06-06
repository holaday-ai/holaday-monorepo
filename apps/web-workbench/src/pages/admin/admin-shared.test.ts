import { describe, expect, it } from 'vitest';
import {
  adminLoadErrorCopy,
  clampNumber,
  finiteNumber,
  formatDurationMs,
  indexedFallback,
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
    expect(token.textClass).toContain('#8A6A00');
    expect(token.bgClass).toContain('#FFC910');
  });

  it('falls back for missing statuses', () => {
    expect(statusToken('').label).toBe('未知');
  });

  it('hides raw unknown status codes in badges', () => {
    expect(statusToken('unknown_internal_state').label).toBe('未知状态');
  });
});

describe('adminLoadErrorCopy', () => {
  it('keeps admin load errors in a title/body shape', () => {
    expect(adminLoadErrorCopy('请稍后重试')).toEqual({
      title: '数据暂时无法加载',
      body: '请稍后重试',
    });
    expect(adminLoadErrorCopy('')).toEqual({
      title: '数据暂时无法加载',
      body: '数据暂时无法加载，请稍后重试。',
    });
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
    expect(indexedFallback('未知任务', 2)).toBe('未知任务 3');
    expect(indexedFallback('未知任务', -1)).toBe('未知任务 1');
    expect(formatDurationMs(Number.NaN)).toBe('—');
    expect(formatDurationMs(90_000)).toBe('1分30秒');
  });
});
