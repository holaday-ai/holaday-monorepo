/**
 * Phase 27C — admin-learning aggregator unit tests.
 *
 * Covers the per-domain aggregation logic without a live DB. The
 * router itself (which composes DB scans + aggregator) is covered
 * by manual smoke after deploy.
 */

import { describe, expect, it } from 'vitest';
import { __learningInternals } from './admin-learning.js';

const { aggregateByDomain } = __learningInternals;

function makeScanRow(over: {
  id: number;
  status: string;
  intent: string;
  errorMessage?: string | null;
  errorCode?: string | null;
  createdAt: Date;
}) {
  return {
    id: over.id,
    status: over.status,
    intent: over.intent,
    errorMessage: over.errorMessage ?? null,
    errorCode: over.errorCode ?? null,
    createdAt: over.createdAt,
  };
}

describe('aggregateByDomain', () => {
  it('returns an empty map for an empty input', () => {
    const result = aggregateByDomain([]);
    expect(result.size).toBe(0);
  });

  it('skips tasks without a URL in their intent', () => {
    const rows = [
      makeScanRow({
        id: 1,
        status: 'completed',
        intent: '帮我翻译这段话',
        createdAt: new Date('2026-05-01'),
      }),
    ];
    const result = aggregateByDomain(rows);
    expect(result.size).toBe(0);
  });

  it('groups multiple tasks per domain', () => {
    const rows = [
      makeScanRow({
        id: 1,
        status: 'completed',
        intent: 'check https://taobao.com/item/1',
        createdAt: new Date('2026-05-01'),
      }),
      makeScanRow({
        id: 2,
        status: 'failed',
        intent: 'open https://taobao.com/item/2',
        errorMessage: '超时',
        createdAt: new Date('2026-05-02'),
      }),
      makeScanRow({
        id: 3,
        status: 'completed',
        intent: 'visit https://jd.com/foo',
        createdAt: new Date('2026-05-03'),
      }),
    ];
    const result = aggregateByDomain(rows);
    expect(result.size).toBe(2);
    expect(result.get('taobao.com')).toMatchObject({
      domain: 'taobao.com',
      total: 2,
      success: 1,
      failed: 1,
      cancelled: 0,
    });
    expect(result.get('jd.com')).toMatchObject({
      domain: 'jd.com',
      total: 1,
      success: 1,
      failed: 0,
      cancelled: 0,
    });
  });

  it('keeps cancelled tasks out of failed counts and failure categories', () => {
    const rows = [
      makeScanRow({
        id: 1,
        status: 'completed',
        intent: 'visit https://example.com/a',
        createdAt: new Date('2026-05-01'),
      }),
      makeScanRow({
        id: 2,
        status: 'cancelled',
        intent: 'visit https://example.com/b',
        errorMessage: 'user cancelled',
        createdAt: new Date('2026-05-02'),
      }),
      makeScanRow({
        id: 3,
        status: 'failed',
        intent: 'visit https://example.com/c',
        errorMessage: 'timeout',
        createdAt: new Date('2026-05-03'),
      }),
    ];

    const agg = aggregateByDomain(rows).get('example.com');

    expect(agg).toMatchObject({
      total: 3,
      success: 1,
      failed: 1,
      cancelled: 1,
      topFailureCategory: 'timeout',
    });
  });

  it('counts partial_success as a learning failure, not as invisible volume', () => {
    const rows = [
      makeScanRow({
        id: 1,
        status: 'completed',
        intent: 'visit https://example.com/a',
        createdAt: new Date('2026-05-01'),
      }),
      makeScanRow({
        id: 2,
        status: 'partial_success',
        intent: 'visit https://example.com/b',
        errorMessage: '质量校验未通过：缺少来源链接',
        createdAt: new Date('2026-05-02'),
      }),
    ];

    const agg = aggregateByDomain(rows).get('example.com');

    expect(agg).toMatchObject({
      total: 2,
      success: 1,
      failed: 1,
      cancelled: 0,
      topFailureCategory: 'quality',
    });
  });

  it("picks the most-frequent failure category per domain", () => {
    const rows = [
      makeScanRow({
        id: 1,
        status: 'failed',
        intent: 'login at https://example.com/login',
        errorMessage: '需要登录',
        createdAt: new Date('2026-05-01'),
      }),
      makeScanRow({
        id: 2,
        status: 'failed',
        intent: 'login at https://example.com/profile',
        errorMessage: '需要登录',
        createdAt: new Date('2026-05-02'),
      }),
      makeScanRow({
        id: 3,
        status: 'failed',
        intent: 'browse https://example.com/timeout',
        errorMessage: 'timeout after 30s',
        createdAt: new Date('2026-05-03'),
      }),
    ];
    const result = aggregateByDomain(rows);
    const agg = result.get('example.com');
    expect(agg?.topFailureCategory).toBe('auth_required');
  });

  it('tracks lastFailedAt across multiple failed tasks', () => {
    const earlier = new Date('2026-05-01T10:00:00Z');
    const later = new Date('2026-05-05T12:00:00Z');
    const rows = [
      makeScanRow({
        id: 1,
        status: 'failed',
        intent: 'https://foo.com/a',
        errorMessage: 'timeout',
        createdAt: earlier,
      }),
      makeScanRow({
        id: 2,
        status: 'failed',
        intent: 'https://foo.com/b',
        errorMessage: 'timeout',
        createdAt: later,
      }),
    ];
    const result = aggregateByDomain(rows);
    expect(result.get('foo.com')?.lastFailedAt).toEqual(later);
  });

  it('strips www. when grouping (www.x.com === x.com)', () => {
    const rows = [
      makeScanRow({
        id: 1,
        status: 'completed',
        intent: 'visit https://www.example.com/a',
        createdAt: new Date('2026-05-01'),
      }),
      makeScanRow({
        id: 2,
        status: 'completed',
        intent: 'visit https://example.com/b',
        createdAt: new Date('2026-05-02'),
      }),
    ];
    const result = aggregateByDomain(rows);
    expect(result.size).toBe(1);
    expect(result.get('example.com')?.total).toBe(2);
  });
});
