/**
 * Phase 24 RC follow-up — Firecrawl REST adapter.
 *
 * Replaces the heavy "spin up a Brave to fetch a public page" flow
 * with a 2-3 second markdown round-trip. Two endpoints:
 *
 *   scrape(url)     → POST /v1/scrape  → { markdown, url, title }
 *   search(query)   → POST /v1/search  → [{ url, markdown, title }]
 *
 * Direct fetch — no SDK install. Matches the Apify-adapter shape so
 * callers don't have to learn a new construction pattern (everything
 * funnels through a `Lane` interface with `ok | error` results).
 *
 * Defensive against missing API key: every call short-circuits with
 * a clear "api key not configured" reason rather than 401-looping
 * the upstream. Callers (scrape-runner, supercar's scrape_website)
 * should surface that reason verbatim to the user.
 *
 * Retry: one extra attempt on transport failure (network throw / 5xx
 * not yet implemented). Application-level errors (4xx, success=false)
 * do NOT retry — bad URL stays bad.
 */

export interface FirecrawlScrapeOk {
  ok: true;
  markdown: string;
  url: string;
  title?: string;
}

export interface FirecrawlSearchResult {
  url: string;
  markdown: string;
  title?: string;
}

export interface FirecrawlSearchOk {
  ok: true;
  results: FirecrawlSearchResult[];
}

export interface FirecrawlError {
  ok: false;
  error: string;
}

export type FirecrawlScrapeResult = FirecrawlScrapeOk | FirecrawlError;
export type FirecrawlSearchResultBundle = FirecrawlSearchOk | FirecrawlError;

export interface FirecrawlSearchOpts {
  limit?: number;
}

export interface FirecrawlLane {
  scrape(url: string): Promise<FirecrawlScrapeResult>;
  search(query: string, opts?: FirecrawlSearchOpts): Promise<FirecrawlSearchResultBundle>;
}

export interface CreateFirecrawlLaneOpts {
  apiKey: string;
  baseUrl?: string;
  /** Test seam — defaults to global fetch. */
  fetch?: typeof fetch;
  /** Per-call wall-clock cap. Default 30s. Aborts via AbortSignal. */
  timeoutMs?: number;
  /**
   * Optional pino-style logger so transport / 5xx / abort failures
   * land in pm2 logs with HTTP status + first 500 chars of body. Without
   * this, every Firecrawl failure is opaque "operation aborted (after
   * 2 attempts)" — diagnosable only by reproducing the upstream request.
   */
  logger?: { warn(obj: object, msg: string): void };
}

const DEFAULT_BASE_URL = 'https://api.firecrawl.dev';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

export function createFirecrawlLane(opts: CreateFirecrawlLaneOpts): FirecrawlLane {
  const apiKey = opts.apiKey;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = opts.fetch ?? fetch;
  const logger = opts.logger;

  async function request(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
    if (!apiKey) {
      return { ok: false, error: 'firecrawl: api key not configured (FIRECRAWL_API_KEY empty)' };
    }
    let lastErr: string = 'unknown';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const startedAt = Date.now();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(`${baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          // Read body once for diagnostic logging — capped at 500
          // chars so an HTML error page from a misconfigured endpoint
          // doesn't blow out pm2 logs. Body read errors are caught so
          // the diagnostic path itself never throws.
          let bodyPreview = '';
          try {
            const txt = await res.text();
            bodyPreview = txt.slice(0, 500);
          } catch {
            /* body unreadable — ignore */
          }
          logger?.warn(
            {
              path,
              status: res.status,
              attempt,
              elapsedMs: Date.now() - startedAt,
              bodyPreview,
            },
            'firecrawl: non-2xx response',
          );
          // 4xx / 5xx — no retry on 4xx (bad request stays bad);
          // retry once on 5xx by falling through.
          if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
            lastErr = `firecrawl HTTP ${res.status}`;
            continue;
          }
          return {
            ok: false,
            error: `firecrawl HTTP ${res.status}${bodyPreview ? `: ${bodyPreview.slice(0, 120)}` : ''}`,
          };
        }
        const json = (await res.json()) as unknown;
        return { ok: true, json };
      } catch (err) {
        clearTimeout(timer);
        lastErr = err instanceof Error ? err.message : String(err);
        const isAbort =
          err instanceof Error &&
          (err.name === 'AbortError' || /aborted|abort/i.test(err.message));
        logger?.warn(
          {
            path,
            attempt,
            elapsedMs: Date.now() - startedAt,
            timeoutMs,
            isAbort,
            err: lastErr,
          },
          isAbort
            ? 'firecrawl: request aborted (timeout)'
            : 'firecrawl: transport failure',
        );
        // network/timeout — retry once
      }
    }
    return { ok: false, error: `firecrawl: ${lastErr} (after ${MAX_ATTEMPTS} attempts)` };
  }

  return {
    async scrape(url: string): Promise<FirecrawlScrapeResult> {
      const trimmed = url.trim();
      if (!trimmed) return { ok: false, error: 'firecrawl: empty url' };
      const result = await request('/v1/scrape', {
        url: trimmed,
        formats: ['markdown'],
      });
      if (!result.ok) return { ok: false, error: result.error };
      const j = result.json as
        | {
            success?: boolean;
            error?: string;
            data?: {
              markdown?: string;
              metadata?: { title?: string; sourceURL?: string };
            };
          }
        | undefined;
      if (!j || j.success === false) {
        return { ok: false, error: `firecrawl: ${j?.error ?? 'unknown error'}` };
      }
      const markdown = j.data?.markdown ?? '';
      if (!markdown) {
        return { ok: false, error: 'firecrawl: no markdown in response' };
      }
      const title = j.data?.metadata?.title;
      return {
        ok: true,
        markdown,
        url: j.data?.metadata?.sourceURL ?? trimmed,
        ...(title ? { title } : {}),
      };
    },

    async search(query: string, searchOpts?: FirecrawlSearchOpts): Promise<FirecrawlSearchResultBundle> {
      const trimmed = query.trim();
      if (!trimmed) return { ok: false, error: 'firecrawl: empty query' };
      const limit = Math.max(1, Math.min(20, searchOpts?.limit ?? 5));
      const result = await request('/v1/search', {
        query: trimmed,
        limit,
        scrapeOptions: { formats: ['markdown'] },
      });
      if (!result.ok) return { ok: false, error: result.error };
      const j = result.json as
        | {
            success?: boolean;
            error?: string;
            data?: Array<{ url?: string; title?: string; markdown?: string }>;
          }
        | undefined;
      if (!j || j.success === false) {
        return { ok: false, error: `firecrawl: ${j?.error ?? 'unknown error'}` };
      }
      const arr = Array.isArray(j.data) ? j.data : [];
      const results: FirecrawlSearchResult[] = arr
        .filter((r) => typeof r?.url === 'string' && typeof r?.markdown === 'string')
        .map((r) => ({
          url: r.url!,
          markdown: r.markdown!,
          ...(r.title ? { title: r.title } : {}),
        }));
      return { ok: true, results };
    },
  };
}
