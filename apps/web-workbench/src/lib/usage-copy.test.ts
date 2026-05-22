import { describe, expect, it } from 'vitest';
import { usageOutcomeSubcopy } from './usage-copy';

describe('usageOutcomeSubcopy', () => {
  it('surfaces partial-success counts separately from hard failures', () => {
    expect(
      usageOutcomeSubcopy({
        partialSuccess: 2,
        failed: 1,
        cancelled: 0,
        executing: 3,
      }),
    ).toBe('部分完成 2 · 失败 1 · 取消 0 · 进行中 3');
  });

  it('keeps failed and cancelled month counts separate', () => {
    expect(usageOutcomeSubcopy({ failed: 2, cancelled: 1, executing: 3 })).toBe(
      '失败 2 · 取消 1 · 进行中 3',
    );
  });

  it('uses honest fallback copy when old API lacks cancelled count', () => {
    expect(usageOutcomeSubcopy({ failed: 3, executing: 1 })).toBe(
      '失败/取消 3 · 进行中 1',
    );
  });
});
