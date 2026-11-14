import type { BrowserContext, Route } from 'playwright';
import type { WebSearchResult } from './search-provider.js';

/**
 * CAPTCHA-REDUCE-1 — a search API's results shown as a page in the task's own
 * browser, so the agent reads, cites and opens them like any results page and
 * every completion check applies unchanged. The host never resolves (`.invalid`)
 * and is answered inside the browser; nothing goes to the network.
 */
export const SEARCH_RESULTS_ORIGIN = 'https://search-results.holaday.invalid';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function searchResultsHtml(input: {
  query: string;
  label: string;
  results: WebSearchResult[];
  /** SEARCH-GUARD-1: why the agent is on this page instead of the engine's. */
  note?: string;
}): string {
  const items = input.results
    .map(
      (r, i) =>
        `<li><h3><a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a></h3><cite>${escapeHtml(r.url)}</cite>${r.snippet ? `<p>${escapeHtml(r.snippet)}</p>` : ''}<span hidden>${i + 1}</span></li>`,
    )
    .join('\n');
  const note = input.note ? `<p><strong>${escapeHtml(input.note)}</strong></p>` : '';
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>「${escapeHtml(input.query)}」- ${escapeHtml(input.label)}</title></head><body><main><h1>「${escapeHtml(input.query)}」的搜索结果</h1>${note}<p>来源：${escapeHtml(input.label)}（不是 Google 结果页）</p><ol>${items}</ol></main></body></html>`;
}

export const searchResultsUrl = (query: string) =>
  `${SEARCH_RESULTS_ORIGIN}/search?q=${encodeURIComponent(query)}`;

/**
 * Serves results pages in `context`, one per query (`add` for later queries);
 * dispose removes the route.
 */
export async function serveSearchResults(
  context: BrowserContext,
  input: { query: string; label: string; results: WebSearchResult[] },
): Promise<{
  url: string;
  add: (page: {
    query: string;
    label: string;
    results: WebSearchResult[];
    note?: string;
  }) => string;
  dispose: () => Promise<void>;
}> {
  const url = searchResultsUrl(input.query);
  const pages = new Map([[url, searchResultsHtml(input)]]);
  const pattern = `${SEARCH_RESULTS_ORIGIN}/**`;
  const handler = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: { 'cache-control': 'no-store', 'content-security-policy': "script-src 'none'" },
      body: pages.get(route.request().url()) ?? pages.get(url)!,
    });
  await context.route(pattern, handler);
  return {
    url,
    add: (page) => {
      const at = searchResultsUrl(page.query);
      pages.set(at, searchResultsHtml(page));
      return at;
    },
    dispose: () => context.unroute(pattern, handler),
  };
}

/**
 * SEARCH-GUARD-1: a search engine's own web results page (or its wall). Not
 * an engine's home page, Maps, Shopping or other verticals (`tbm`/`udm`).
 */
export function engineResultsQuery(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const vertical = url.searchParams.has('tbm') || url.searchParams.has('udm');
  if (/(?:^|\.)google\.[a-z.]+$/.test(host)) {
    if (url.pathname === '/search' && !vertical) return url.searchParams.get('q');
    // The wall carries the original search in `continue`.
    if (url.pathname.startsWith('/sorry')) {
      const next = url.searchParams.get('continue');
      return next ? engineResultsQuery(next) : null;
    }
    return null;
  }
  if (/(?:^|\.)bing\.com$/.test(host) && url.pathname === '/search')
    return url.searchParams.get('q');
  if (/(?:^|\.)duckduckgo\.com$/.test(host)) {
    if (url.pathname === '/html/' || url.pathname === '/html' || url.pathname === '/lite/')
      return url.searchParams.get('q');
    if (url.pathname === '/' && url.searchParams.get('q')) return url.searchParams.get('q');
  }
  return null;
}

/** A page that only sends the browser on to the results page (no script needed). */
export const redirectHtml = (to: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escapeHtml(to)}"></head><body><a href="${escapeHtml(to)}">已改用搜索接口结果页</a></body></html>`;
