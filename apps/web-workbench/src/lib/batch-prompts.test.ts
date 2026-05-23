import { describe, expect, it } from 'vitest';
import { parseBatchPrompts } from './batch-prompts';

describe('parseBatchPrompts', () => {
  it('trims blank lines and preserves first occurrence order', () => {
    expect(parseBatchPrompts('  A  \n\nB\nA\nC', 50)).toEqual({
      prompts: ['A', 'B', 'C'],
      rawCount: 4,
      duplicateCount: 1,
      overLimit: false,
    });
  });

  it('checks the limit after de-duplication', () => {
    expect(parseBatchPrompts('A\nA\nB', 1)).toEqual({
      prompts: ['A', 'B'],
      rawCount: 3,
      duplicateCount: 1,
      overLimit: true,
    });
  });
});
