import { describe, expect, it } from 'vitest';
import { usageOutcomeSubcopy } from './usage-copy';

describe('usageOutcomeSubcopy', () => {
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
