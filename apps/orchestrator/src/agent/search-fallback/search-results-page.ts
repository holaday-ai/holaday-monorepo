import type { BrowserContext, Route } from 'playwright';
import type { WebSearchResult } from './search-provider.js';

/**
 * CAPTCHA-REDUCE-1 — a search API's results shown as a page in the task's own
 * browser, so the agent reads, cites and opens them like any results page and
 * every completion check applies unchanged. The host never resolves (`.invalid`)
 * and is answered inside the browser; nothing goes to the network.
 */
export const SEARCH_RESULTS_ORIGIN = 'https://search-results.holaday.invalid';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function searchResultsHtml(input: {
  query: string;
  label: string;
  results: WebSearchResult[];
}): string {
  const items = input.results
    .map(
      (r, i) =>
        `<li><h3><a href="${escape(r.url)}">${escape(r.title)}</a></h3><cite>${escape(r.url)}</cite>${r.snippet ? `<p>${escape(r.snippet)}</p>` : ''}<span hidden>${i + 1}</span></li>`,
    )
    .join('\n');
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>「${escape(input.query)}」- ${escape(input.label)}</title></head><body><main><h1>「${escape(input.query)}」的搜索结果</h1><p>来源：${escape(input.label)}（不是 Google 结果页）</p><ol>${items}</ol></main></body></html>`;
}

/** Serves the results page in `context`; dispose removes the route. */
export async function serveSearchResults(
  context: BrowserContext,
  input: { query: string; label: string; results: WebSearchResult[] },
): Promise<{ url: string; dispose: () => Promise<void> }> {
  const url = `${SEARCH_RESULTS_ORIGIN}/search?q=${encodeURIComponent(input.query)}`;
  const body = searchResultsHtml(input);
  const pattern = `${SEARCH_RESULTS_ORIGIN}/**`;
  const handler = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: { 'cache-control': 'no-store', 'content-security-policy': "script-src 'none'" },
      body,
    });
  await context.route(pattern, handler);
  return { url, dispose: () => context.unroute(pattern, handler) };
}
