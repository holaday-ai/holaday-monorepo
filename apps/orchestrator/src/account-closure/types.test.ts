import { describe, expect, it } from 'vitest';
import {
  parseAccountClosureCheckpoint,
  parseAccountClosureReceiptCategoryIds,
} from './types.js';

describe('account closure durable payload validation', () => {
  it('accepts numeric cursor and processed-count checkpoints', () => {
    expect(parseAccountClosureCheckpoint({ cursor: 7, processedCount: 100 })).toEqual({
      cursor: 7,
      processedCount: 100,
    });
  });

  it.each([
    { cursor: 1, email: 'not-permitted' },
    { cursor: -1 },
    { cursor: 1.5 },
    { processedCount: -1 },
    { processedCount: 2.5 },
  ])('rejects a checkpoint that can carry invalid progress or private fields', (value) => {
    expect(() => parseAccountClosureCheckpoint(value)).toThrow();
  });

  it('accepts stable governance category IDs in receipt arrays', () => {
    expect(parseAccountClosureReceiptCategoryIds(['account_security', 'analytics_logs'])).toEqual([
      'account_security',
      'analytics_logs',
    ]);
  });

  it.each([
    'account_security',
    [{ category: 'account_security' }],
    ['account_security', 'unknown_category'],
  ])('rejects a receipt category payload outside the stable ID array contract', (value) => {
    expect(() => parseAccountClosureReceiptCategoryIds(value)).toThrow();
  });
});
