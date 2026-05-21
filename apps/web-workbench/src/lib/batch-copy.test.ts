import { describe, expect, it } from 'vitest';
import { batchUnsuccessfulCopy } from './batch-copy';

describe('batchUnsuccessfulCopy', () => {
  it('splits failed and cancelled counts when cancellation count is available', () => {
    expect(batchUnsuccessfulCopy(4, 1)).toBe(' · 3 失败 · 1 取消');
    expect(batchUnsuccessfulCopy(2, 2)).toBe(' · 2 取消');
  });

  it('uses honest fallback copy when old API only returns the combined count', () => {
    expect(batchUnsuccessfulCopy(3)).toBe(' · 3 失败/取消');
  });

  it('omits copy when every item completed', () => {
    expect(batchUnsuccessfulCopy(0, 0)).toBe('');
  });
});
