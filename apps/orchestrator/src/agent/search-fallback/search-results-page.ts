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
 * dispose removes the route. Throws when the route could not be installed in time (G2d).
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
  const remove = await routeWithin(context, pattern, handler);
  if (!remove) throw new Error('search_results_route_unavailable');
  return {
    url,
    add: (page) => {
      const at = searchResultsUrl(page.query);
      pages.set(at, searchResultsHtml(page));
      return at;
    },
    dispose: async () => {
      await remove();
    },
  };
}

/**
 * G2d: search-engine result URLs as a RegExp, so Playwright matches them in its own server and
 * never sends another host's request to this process (a function matcher is serialised as the
 * match-everything glob: every request of the context came here). A superset of
 * engineResultsQuery — the handler still checks each URL exactly and lets the rest through.
 * Playwright 1.59 on Chromium still pauses every request (Fetch.enable '*') and turns the cache
 * off while any route exists, whatever the matcher; that is why the run-wide guard is installed
 * only when the run heads for an engine (guardRunSearches).
 */
export const ENGINE_RESULTS_ROUTE =
  /^https?:\/\/(?:[^/?#@]*\.)?(?:google\.[a-z.]+|bing\.com|duckduckgo\.com)(?::\d+)?\/(?:search|sorry|html|lite)?(?:[/?#]|$)/i;

/** G2d: an engine's own pages (home included), where the person's next step may be a search. */
export function isEngineHost(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return (
      /^(?:www\.)?google\.[a-z.]+$/.test(host) ||
      /^(?:www\.|cn\.)?bing\.com$/.test(host) ||
      /^(?:(?:www|html|lite)\.)?duckduckgo\.com$/.test(host)
    );
  } catch {
    return false;
  }
}

/**
 * G2d: a browser context whose route table may no longer match what this process thinks.
 * Taking a route down that does not settle in time (DEPLOY-R5, BestBuy) leaves Playwright's
 * server half way: its interceptor is already gone while the patterns are reset only when the
 * removal finishes, so a route installed later in the same context (a follow-up task's search
 * guard, a results page on SEARCH_RESULTS_ORIGIN) silently never applies. Such a context — and
 * the browser objects linked to it (the pool's executor) — must not be handed to another task.
 */
const unreliableRouting = new WeakSet<object>();
const routingOwners = new WeakMap<object, Set<object>>();
/** Links `owners` (e.g. the task's executor) to `context`: marking the context marks them too. */
export function linkRoutingOwner(context: object, ...owners: Array<object | null | undefined>) {
  const linked = routingOwners.get(context) ?? new Set<object>();
  for (const owner of owners) if (owner) linked.add(owner);
  routingOwners.set(context, linked);
  if (unreliableRouting.has(context)) markRoutingUnreliable(context);
}
export function markRoutingUnreliable(context: object): void {
  unreliableRouting.add(context);
  for (const owner of routingOwners.get(context) ?? []) unreliableRouting.add(owner);
}
export function routingUnreliable(owner: object | null | undefined): boolean {
  return !!owner && unreliableRouting.has(owner);
}

/**
 * G2d: `context.route` is a round trip to the browser too and can stall like unroute. Installing
 * gets a few seconds; when it does not finish the handler is switched off (it lets every request
 * through if the route still lands) and the caller runs without it. A slow install usually lands
 * later and is fine: it is taken down in the background once it has settled. Only when that
 * removal does not settle within `lateMs` of the give-up (the install never landed, or its
 * removal stalled) is the context marked unreliable. Returns the bounded remover, or null.
 */
export const ROUTE_WAIT_MS = 3_000;
export const LATE_ROUTE_REMOVAL_MS = 30_000;
type RouteUrl = Parameters<BrowserContext['route']>[0];
type RouteHandler = (...args: Parameters<Parameters<BrowserContext['route']>[1]>) => unknown;
export async function routeWithin(
  context: BrowserContext,
  url: RouteUrl,
  handler: RouteHandler,
  ms = ROUTE_WAIT_MS,
  lateMs = LATE_ROUTE_REMOVAL_MS,
): Promise<(() => Promise<boolean>) | null> {
  if (routingUnreliable(context)) return null;
  let live = true;
  const guarded = (route: Route, request: Parameters<RouteHandler>[1]) =>
    live ? handler(route, request) : route.fallback();
  const installing = context.route(url, guarded);
  const outcome = await settleWithin(installing, ms);
  if (outcome === 'done') return () => unrouteWithin(context, url, guarded);
  live = false;
  // Removed after the install settled (either way), so the removal is ordered after it.
  const removing = installing.then(
    () => context.unroute(url, guarded),
    () => context.unroute(url, guarded),
  );
  void settleWithin(removing, lateMs).then((removal) => {
    if (removal === 'late') markRoutingUnreliable(context);
  });
  return null;
}

/**
 * DEPLOY-R5 (BestBuy hang, 4/4 on the candidate): on some pages Playwright's `context.unroute`
 * never settles — the run itself had finished and the task then waited for the watchdog
 * (~10 min). Taking a route down is cleanup: it is given a few seconds and never holds up the
 * result. G2d: one that did not finish marks the context unreliable (see above); on a context
 * already marked, nothing waits. True when the route is gone.
 */
export const UNROUTE_WAIT_MS = 3_000;
export async function unrouteWithin(
  context: BrowserContext,
  url: Parameters<BrowserContext['unroute']>[0],
  handler: Parameters<BrowserContext['unroute']>[1],
  ms = UNROUTE_WAIT_MS,
): Promise<boolean> {
  const removing = context.unroute(url, handler);
  if (routingUnreliable(context)) {
    removing.catch(() => {});
    return false;
  }
  const outcome = await settleWithin(removing, ms);
  if (outcome === 'late') markRoutingUnreliable(context);
  return outcome === 'done';
}

async function settleWithin(work: Promise<unknown>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      work.then(
        () => 'done' as const,
        () => 'failed' as const,
      ),
      late,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
