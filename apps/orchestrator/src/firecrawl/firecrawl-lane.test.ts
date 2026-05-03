/**
 * Phase 24 RC follow-up — Firecrawl adapter tests.
 *
 * REST-direct (no SDK) — same pattern as the Apify adapter so the
 * surface stays small and SDK churn doesn't bleed into our deps.
 * Tests use a fake fetch so they can run offline + don't burn a real
 * Firecrawl credit per test pass.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirecrawlLane, type FirecrawlLane } from './firecrawl-lane.js';

interface FakeResp {
  status: number;
  body: unknown;
  ok?: boolean;
}

function makeFetch(...sequence: FakeResp[]): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fakeFetch: typeof fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = sequence[Math.min(i, sequence.length - 1)];
    i += 1;
    if (!r) throw new Error('fake fetch: no response queued');
    return {
      ok: r.ok ?? (r.status >= 200 && r.status < 300),
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    } as Response;
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, calls };
}

function makeLane(fetchFn: typeof fetch, overrides: Partial<{ apiKey: string; timeoutMs: number }> = {}): FirecrawlLane {
  return createFirecrawlLane({
    apiKey: overrides.apiKey ?? 'fc-test-key',
    baseUrl: 'https://api.firecrawl.test',
    fetch: fetchFn,
    timeoutMs: overrides.timeoutMs ?? 30_000,
  });
}

describe('createFirecrawlLane — scrape()', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns markdown on a successful response', async () => {
    const { fetch, calls } = makeFetch({
      status: 200,
      body: {
        success: true,
        data: {
          markdown: '# Hello\n\nworld',
          metadata: { title: 'Hello', sourceURL: 'https://example.com' },
        },
      },
    });
    const lane = makeLane(fetch);

    const out = await lane.scrape('https://example.com');

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.markdown).toContain('Hello');
      expect(out.url).toBe('https://example.com');
      expect(out.title).toBe('Hello');
    }
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://api.firecrawl.test/v1/scrape');
    expect(call.init?.method).toBe('POST');
    const headers = call.init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer fc-test-key');
    const body = JSON.parse(call.init?.body as string) as { url: string };
    expect(body.url).toBe('https://example.com');
  });

  it('returns error on HTTP non-2xx', async () => {
    const { fetch } = makeFetch({
      status: 401,
      ok: false,
      body: { error: 'unauthorized' },
    });
    const lane = makeLane(fetch);

    const out = await lane.scrape('https://example.com');
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/firecrawl.*401|unauthorized/i);
    }
  });

  it('returns error when API responds success:false', async () => {
    const { fetch } = makeFetch({
      status: 200,
      body: { success: false, error: 'invalid url' },
    });
    const lane = makeLane(fetch);

    const out = await lane.scrape('not-a-url');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/invalid url/i);
  });

  it('retries once on network failure, returns first 2xx body', async () => {
    let attempt = 0;
    const flakyFetch: typeof fetch = (async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('ECONNRESET');
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { markdown: '# After retry' } }),
        text: async () => '',
      } as Response;
    }) as unknown as typeof fetch;
    const lane = makeLane(flakyFetch);

    const out = await lane.scrape('https://example.com');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.markdown).toContain('After retry');
    expect(attempt).toBe(2);
  });

  it('gives up after 2 attempts, returns descriptive error', async () => {
    const failingFetch: typeof fetch = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const lane = makeLane(failingFetch);

    const out = await lane.scrape('https://example.com');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/ECONNRESET|2 attempts/i);
  });

  it('rejects empty url synchronously without calling fetch', async () => {
    const { fetch, calls } = makeFetch({ status: 200, body: {} });
    const lane = makeLane(fetch);

    const out = await lane.scrape('');
    expect(out.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('rejects when api key is empty', async () => {
    const { fetch, calls } = makeFetch({ status: 200, body: {} });
    const lane = makeLane(fetch, { apiKey: '' });

    const out = await lane.scrape('https://example.com');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/api key|not configured/i);
    expect(calls).toHaveLength(0);
  });
});

describe('createFirecrawlLane — search()', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns markdown-bodied search results', async () => {
    const { fetch, calls } = makeFetch({
      status: 200,
      body: {
        success: true,
        data: [
          {
            url: 'https://example.com/a',
            title: 'A',
            markdown: '# A body',
          },
          {
            url: 'https://example.com/b',
            title: 'B',
            markdown: '# B body',
          },
        ],
      },
    });
    const lane = makeLane(fetch);

    const out = await lane.search('test query', { limit: 5 });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.results).toHaveLength(2);
      expect(out.results[0]!.url).toBe('https://example.com/a');
      expect(out.results[0]!.markdown).toContain('A body');
      expect(out.results[0]!.title).toBe('A');
    }
    const call = calls[0]!;
    expect(call.url).toBe('https://api.firecrawl.test/v1/search');
    const body = JSON.parse(call.init?.body as string) as { query: string; limit: number };
    expect(body.query).toBe('test query');
    expect(body.limit).toBe(5);
  });

  it('default limit is 5 when omitted', async () => {
    const { fetch, calls } = makeFetch({
      status: 200,
      body: { success: true, data: [] },
    });
    const lane = makeLane(fetch);

    await lane.search('q');
    const body = JSON.parse(calls[0]!.init?.body as string) as { limit: number };
    expect(body.limit).toBe(5);
  });

  it('returns ok=true with empty results when API returns []', async () => {
    const { fetch } = makeFetch({
      status: 200,
      body: { success: true, data: [] },
    });
    const lane = makeLane(fetch);

    const out = await lane.search('niche query');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.results).toEqual([]);
  });

  it('rejects empty query without calling fetch', async () => {
    const { fetch, calls } = makeFetch({ status: 200, body: {} });
    const lane = makeLane(fetch);

    const out = await lane.search('   ');
    expect(out.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('createFirecrawlLane — surface', () => {
  it('exposes scrape and search functions', () => {
    const { fetch } = makeFetch({ status: 200, body: {} });
    const lane = makeLane(fetch);
    expect(typeof lane.scrape).toBe('function');
    expect(typeof lane.search).toBe('function');
  });
});
