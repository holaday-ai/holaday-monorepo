import type { FirecrawlLane } from '../../firecrawl/firecrawl-lane.js';
import type { WebSearchHit } from './unified-browser-loop.js';

export interface ReadPageResult {
  url: string;
  title: string;
  markdown: string;
}

const DEFAULT_PRIMARY_TIMEOUT_MS = 45_000;
const MAX_READ_CHARS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('web search timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Batch 09 — web search for the unified browser loop: the brain's built-in
 * search (Qwen Responses web_search) first; on error, timeout or no results,
 * Firecrawl search. Returns undefined when neither source is configured, so
 * the loop simply runs without a search tool.
 */
export function createFallbackWebSearch(input: {
  primary?: ((query: string) => Promise<WebSearchHit[]>) | null;
  firecrawl?: Pick<FirecrawlLane, 'search'> | null;
  primaryTimeoutMs?: number;
  onFallback?: (reason: string) => void;
}): ((query: string) => Promise<WebSearchHit[]>) | undefined {
  const { primary, firecrawl } = input;
  if (!primary && !firecrawl) return undefined;
  return async (query) => {
    if (primary) {
      try {
        const hits = await withTimeout(
          primary(query),
          input.primaryTimeoutMs ?? DEFAULT_PRIMARY_TIMEOUT_MS,
        );
        if (hits.length > 0 || !firecrawl) return hits;
        input.onFallback?.('primary_empty');
      } catch (error) {
        if (!firecrawl) throw error;
        input.onFallback?.(
          error instanceof Error && /timed out/.test(error.message)
            ? 'primary_timeout'
            : 'primary_error',
        );
      }
    }
    if (!firecrawl) return [];
    const result = await firecrawl.search(query, { limit: 5 });
    if (!result.ok) throw new Error('web search unavailable');
    return result.results.map((hit) => ({ title: hit.title?.trim() || hit.url, url: hit.url }));
  };
}

/** Read-only page text through Firecrawl scrape, for pages the browser cannot open. */
export function createFirecrawlReadPage(
  firecrawl: Pick<FirecrawlLane, 'scrape'> | null | undefined,
): ((url: string) => Promise<ReadPageResult>) | undefined {
  if (!firecrawl) return undefined;
  return async (url) => {
    const result = await firecrawl.scrape(url);
    if (!result.ok) throw new Error('page read unavailable');
    return {
      url: result.url,
      title: result.title ?? '',
      markdown: result.markdown.slice(0, MAX_READ_CHARS),
    };
  };
}
