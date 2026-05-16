/**
 * Phase 25 — browsing-history service tests.
 *
 * Focused on the pure helpers (`normaliseDomain`, schema validation,
 * dedupe/aggregation logic inside `replaceUserSiteStats`). The DB
 * write path is exercised end-to-end at deploy via the SPA + extension
 * smoke; mocking the drizzle transaction chain just to assert
 * INSERT-was-called isn't worth the test-only ceremony.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DB } from '../db/client.js';
import {
  browsingHistorySchema,
  MAX_HOSTS_PER_SYNC,
  normaliseDomain,
  replaceUserSiteStats,
} from './service.js';

describe('normaliseDomain', () => {
  it('lowercases + strips www', () => {
    expect(normaliseDomain('WWW.Example.COM')).toBe('example.com');
  });

  it('strips http:// + https://', () => {
    expect(normaliseDomain('https://example.com')).toBe('example.com');
    expect(normaliseDomain('http://example.com')).toBe('example.com');
  });

  it('strips path after host', () => {
    expect(normaliseDomain('https://example.com/some/path?q=1')).toBe('example.com');
  });

  it('keeps subdomains', () => {
    expect(normaliseDomain('shop.taobao.com')).toBe('shop.taobao.com');
  });

  it('rejects chrome:// + about: + extension URLs', () => {
    expect(normaliseDomain('chrome://newtab')).toBeNull();
    expect(normaliseDomain('about:blank')).toBeNull();
    expect(normaliseDomain('chrome-extension://abc/popup.html')).toBeNull();
    expect(normaliseDomain('moz-extension://xyz')).toBeNull();
  });

  it('rejects IPv4 literals', () => {
    expect(normaliseDomain('127.0.0.1')).toBeNull();
    expect(normaliseDomain('192.168.1.1')).toBeNull();
  });

  it('rejects IPv6 literals', () => {
    expect(normaliseDomain('::1')).toBeNull();
    expect(normaliseDomain('fe80::1')).toBeNull();
  });

  it('rejects single-label hostnames', () => {
    expect(normaliseDomain('localhost')).toBeNull();
    expect(normaliseDomain('intranet')).toBeNull();
  });

  it('rejects whitespace + control characters embedded in the host', () => {
    // trim() strips trailing whitespace, so 'example.com\n' is fine
    // (the check is against EMBEDDED whitespace). Use a space inside
    // the host instead.
    expect(normaliseDomain('exa mple.com')).toBeNull();
    expect(normaliseDomain('exam\tple.com')).toBeNull();
  });

  it('rejects empty + leading/trailing dot', () => {
    expect(normaliseDomain('')).toBeNull();
    expect(normaliseDomain('.example.com')).toBeNull();
    expect(normaliseDomain('example.com.')).toBeNull();
  });

  it('rejects domains over 253 chars after strip', () => {
    expect(normaliseDomain(`${'a'.repeat(250)}.com`)).toBeNull();
  });
});

describe('browsingHistorySchema', () => {
  it('accepts well-formed payload', () => {
    const r = browsingHistorySchema.safeParse({
      domains: [
        { domain: 'taobao.com', visitCount: 50, lastVisitAt: '2026-05-15T10:00:00Z' },
        { domain: 'douyin.com', visitCount: 12 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('coerces numeric lastVisitAt (epoch ms) to Date', () => {
    const r = browsingHistorySchema.safeParse({
      domains: [{ domain: 'a.com', visitCount: 1, lastVisitAt: 1715760000000 }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.domains[0]?.lastVisitAt).toBeInstanceOf(Date);
    }
  });

  it('rejects > MAX_HOSTS_PER_SYNC entries', () => {
    const tooMany = {
      domains: Array.from({ length: MAX_HOSTS_PER_SYNC + 1 }, (_, i) => ({
        domain: `host${i}.com`,
        visitCount: 1,
      })),
    };
    const r = browsingHistorySchema.safeParse(tooMany);
    expect(r.success).toBe(false);
  });

  it('rejects negative visitCount', () => {
    const r = browsingHistorySchema.safeParse({
      domains: [{ domain: 'a.com', visitCount: -1 }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects domain over 253 chars', () => {
    const r = browsingHistorySchema.safeParse({
      domains: [{ domain: 'a'.repeat(254), visitCount: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it('treats missing visitCount as 0 (default)', () => {
    const r = browsingHistorySchema.safeParse({
      domains: [{ domain: 'a.com' }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.domains[0]?.visitCount).toBe(0);
  });
});

/**
 * Minimal drizzle-shaped stub: only methods replaceUserSiteStats
 * actually calls (`transaction`, `delete`, `insert`). The stub
 * captures the rows passed so the test can assert dedupe + filter
 * outcomes without spinning up MySQL.
 */
function makeDbStub() {
  const inserted: Array<{ userId: number; domain: string; visitCount: number }> = [];
  let deletes = 0;
  const tx = {
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: (rows: Array<{ userId: number; domain: string; visitCount: number }>) => {
        inserted.push(...rows);
        return Promise.resolve();
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => {
      deletes += 1;
      await fn(tx);
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as DB;
  return { db, inserted, getDeletes: () => deletes };
}

describe('replaceUserSiteStats', () => {
  it('filters out chrome:// + IP entries', async () => {
    const { db, inserted } = makeDbStub();
    const r = await replaceUserSiteStats(db, 42, {
      domains: [
        { domain: 'taobao.com', visitCount: 10 },
        { domain: 'chrome://newtab', visitCount: 999 },
        { domain: '127.0.0.1', visitCount: 5 },
        { domain: 'douyin.com', visitCount: 30 },
      ],
    });
    expect(r.ingested).toBe(2);
    expect(r.rejected).toBe(2);
    expect(inserted.map((r) => r.domain).sort()).toEqual(['douyin.com', 'taobao.com']);
  });

  it('dedupes case + www variants, keeps MAX visit count', async () => {
    const { db, inserted } = makeDbStub();
    const r = await replaceUserSiteStats(db, 42, {
      domains: [
        { domain: 'Taobao.com', visitCount: 5 },
        { domain: 'WWW.taobao.com', visitCount: 10 },
        { domain: 'https://taobao.com/cart', visitCount: 3 },
      ],
    });
    expect(r.ingested).toBe(1);
    expect(inserted[0]?.domain).toBe('taobao.com');
    expect(inserted[0]?.visitCount).toBe(10);
  });

  it('returns top domains sorted by visitCount desc', async () => {
    const { db } = makeDbStub();
    const r = await replaceUserSiteStats(db, 42, {
      domains: [
        { domain: 'a.com', visitCount: 5 },
        { domain: 'b.com', visitCount: 30 },
        { domain: 'c.com', visitCount: 12 },
      ],
    });
    expect(r.topDomains).toEqual(['b.com', 'c.com', 'a.com']);
  });

  it('empty input is a valid no-op (still wraps in transaction)', async () => {
    const { db, inserted, getDeletes } = makeDbStub();
    const r = await replaceUserSiteStats(db, 42, { domains: [] });
    expect(r.ingested).toBe(0);
    expect(inserted).toHaveLength(0);
    expect(getDeletes()).toBe(1);
  });
});
