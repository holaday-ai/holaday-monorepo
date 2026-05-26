import { describe, expect, it } from 'vitest';
import { formatFileSize } from './file-size';

describe('formatFileSize', () => {
  it('formats common byte ranges compactly', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('2 KB');
    expect(formatFileSize(1024 * 1024 * 2.25)).toBe('2.3 MB');
    expect(formatFileSize(1024 * 1024 * 1024 * 1.5)).toBe('1.5 GB');
  });

  it('coerces string numbers and rejects malformed values', () => {
    expect(formatFileSize('2048')).toBe('2 KB');
    expect(formatFileSize(Number.NaN)).toBe('—');
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatFileSize(-1)).toBe('—');
    expect(formatFileSize('bad')).toBe('—');
    expect(formatFileSize(null)).toBe('—');
  });
});
