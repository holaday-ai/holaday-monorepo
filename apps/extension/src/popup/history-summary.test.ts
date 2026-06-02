import { describe, expect, it } from 'vitest';
import { normalizeHistorySummary } from './history-summary.js';

describe('normalizeHistorySummary', () => {
  it('normalizes stored popup history summary values', () => {
    const before = Date.now();
    const summary = normalizeHistorySummary({
      ingested: 2.9,
      topDomains: [
        ' example.com ',
        42,
        '',
        'a.com',
        'b.com',
        'c.com',
        'd.com',
        'e.com',
        'f.com',
        'x'.repeat(300),
      ],
      at: Number.NaN,
    });

    expect(summary).toEqual({
      ingested: 2,
      topDomains: ['example.com', 'a.com', 'b.com', 'c.com', 'd.com', 'e.com'],
      at: expect.any(Number),
    });
    expect(summary?.at).toBeGreaterThanOrEqual(before);
  });

  it('rejects malformed popup history summaries', () => {
    expect(
      normalizeHistorySummary({
        ingested: Number.NaN,
        topDomains: ['example.com'],
        at: Date.now(),
      }),
    ).toBeNull();
    expect(normalizeHistorySummary(null)).toBeNull();
  });
});
