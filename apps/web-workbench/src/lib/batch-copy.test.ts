import { describe, expect, it } from 'vitest';
import { batchUnsuccessfulCopy } from './batch-copy';

describe('batchUnsuccessfulCopy', () => {
  it('splits review-needed/failed and cancelled counts when cancellation count is available', () => {
    expect(batchUnsuccessfulCopy(3, 1)).toBe(' · 3 需复核/失败 · 1 取消');
    expect(batchUnsuccessfulCopy(0, 2)).toBe(' · 2 取消');
  });

  it('uses honest fallback copy when old API only returns the combined count', () => {
    expect(batchUnsuccessfulCopy(3)).toBe(' · 3 未成功');
  });

  it('omits copy when every item completed', () => {
    expect(batchUnsuccessfulCopy(0, 0)).toBe('');
  });

  it('does not hide cancellations when there are no failures', () => {
    expect(batchUnsuccessfulCopy(0, 1)).toBe(' · 1 取消');
  });
});
