/**
 * URLs in browser answers have two separate jobs, kept apart here:
 *
 * 1. **Accessible address** — what is shown, navigated, cited and recorded as
 *    observed evidence. It must still open: `stripTrackingFromUrl` removes
 *    tracking tokens from the raw string and leaves every other byte as it
 *    was (signed URLs are byte-sensitive). It never re-serialises a query.
 * 2. **Identity key** — `urlResourceIdentity`, only for "is this the same
 *    source?" (dedupe / counting), never for navigation. Normalisation lives
 *    here: host case, `www.`, default ports, tracking parameters (also inside
 *    SPA hash routes) and the order of *different* parameter names.
 *
 * Only well-known tracking parameters are removed. Everything else — ids,
 * SKUs, search terms, signatures, expiry, cloud-storage auth (X-Amz-*), route
 * parameters such as `from`/`to` — is part of what the URL points at. A plain
 * fragment (`#section`) is a position inside the same page; an SPA hash route
 * (`#/…`, `#!/…`) selects a different view and is kept.
 */

/**
 * Exact tracking parameter names (case-insensitive). `from` is deliberately
 * absent: travel and OTA URLs use it for the departure city (?from=SHA&to=PEK).
 */
export const DEFAULT_TRACKING_PARAMS: readonly string[] = [
  'gclid',
  'gclsrc',
  'dclid',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'spm',
  'scm',
  'ref_src',
  'share',
  'sharesource',
];

/** Tracking parameter name prefixes (case-insensitive). */
export const DEFAULT_TRACKING_PREFIXES: readonly string[] = ['utm_', 'share_', 'spm_'];

/**
 * Never removed, even if a tracking rule would match: resource ids, search,
 * signed-URL and auth parameters.
 */
const PRESERVED_PARAMS = new Set([
  'id',
  'sku',
  'skuid',
  'item',
  'itemid',
  'item_id',
  'q',
  'query',
  'keyword',
  'p',
  'page',
  'sign',
  'signature',
  'sig',
  'token',
  'expires',
  'expiry',
  'auth_key',
]);

export interface TrackingRules {
  params?: readonly string[];
  prefixes?: readonly string[];
}

interface NormalizedRules {
  params: ReadonlySet<string>;
  prefixes: readonly string[];
}

const DEFAULT_RULES: NormalizedRules = {
  params: new Set(DEFAULT_TRACKING_PARAMS),
  prefixes: DEFAULT_TRACKING_PREFIXES,
};

/** Custom rules are matched case-insensitively: lower-cased once, on load. */
function normalizeRules(rules: TrackingRules | undefined): NormalizedRules {
  if (!rules) return DEFAULT_RULES;
  return {
    params: new Set((rules.params ?? DEFAULT_TRACKING_PARAMS).map((name) => name.toLowerCase())),
    prefixes: (rules.prefixes ?? DEFAULT_TRACKING_PREFIXES).map((prefix) => prefix.toLowerCase()),
  };
}

function decodeComponent(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

function isTrackingName(name: string, rules: NormalizedRules): boolean {
  const key = name.toLowerCase();
  if (PRESERVED_PARAMS.has(key) || key.startsWith('x-amz-')) return false;
  return rules.params.has(key) || rules.prefixes.some((prefix) => key.startsWith(prefix));
}

/** Raw query tokens (no leading `?`), each with its decoded name. */
function queryTokens(query: string): Array<{ raw: string; name: string; value: string }> {
  return query
    .split('&')
    .filter((token) => token.length > 0)
    .map((raw) => {
      const eq = raw.indexOf('=');
      return {
        raw,
        name: decodeComponent(eq < 0 ? raw : raw.slice(0, eq)),
        value: decodeComponent(eq < 0 ? '' : raw.slice(eq + 1)),
      };
    });
}

/** The query with tracking tokens removed; kept tokens are byte-for-byte unchanged. */
function stripQuery(query: string, rules: NormalizedRules): string {
  const kept = queryTokens(query).filter((token) => !isTrackingName(token.name, rules));
  return kept.map((token) => token.raw).join('&');
}

/** `#/…` and `#!/…` select an SPA view; any other fragment is an in-page anchor. */
export function isHashRoute(hash: string): boolean {
  return /^#!?\//.test(hash);
}

/** Splits `before?query#hash` on the raw string (no parsing, no re-encoding). */
function splitRaw(href: string): { before: string; query: string | null; hash: string } {
  const hashAt = href.indexOf('#');
  const head = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : href.slice(hashAt);
  const queryAt = head.indexOf('?');
  return queryAt < 0
    ? { before: head, query: null, hash }
    : { before: head.slice(0, queryAt), query: head.slice(queryAt + 1), hash };
}

/**
 * The same link without tracking tokens or an in-page anchor. Works on the
 * raw string: every kept byte — path, kept parameters, their encoding and
 * order — is unchanged, so signed URLs still verify. Relative input stays
 * relative (resolve it against the page's base URL before showing or
 * recording it). An SPA hash route is kept, with its own tracking tokens
 * removed the same way. Non-http(s) schemes come back unchanged.
 */
export function stripTrackingFromUrl(href: string, rules?: TrackingRules): string {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.trim())?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return href;
  const normalized = normalizeRules(rules);
  const { before, query, hash } = splitRaw(href);
  const keptQuery = query === null ? null : stripQuery(query, normalized);
  let keptHash = '';
  if (isHashRoute(hash)) {
    const routeQueryAt = hash.indexOf('?');
    if (routeQueryAt < 0) keptHash = hash;
    else {
      const routeQuery = stripQuery(hash.slice(routeQueryAt + 1), normalized);
      keptHash = `${hash.slice(0, routeQueryAt)}${routeQuery ? `?${routeQuery}` : ''}`;
    }
  }
  return `${before}${keptQuery ? `?${keptQuery}` : ''}${keptHash}`;
}

/** Identity of a query: tracking dropped, different names ordered, same-name order kept. */
function identityQuery(query: string, rules: NormalizedRules): string {
  const tokens = queryTokens(query)
    .filter((token) => !isTrackingName(token.name, rules))
    .map((token, index) => ({ ...token, index }));
  // Stable by name only: `?id=1&id=2` and `?id=2&id=1` may pick different
  // resources (first-value vs last-value), so same-name order is semantic.
  tokens.sort((a, b) => (a.name === b.name ? a.index - b.index : a.name < b.name ? -1 : 1));
  return tokens
    .map((token) => `${encodeURIComponent(token.name)}=${encodeURIComponent(token.value)}`)
    .join('&');
}

/**
 * Resource identity of an absolute URL, for "is this the same source?" only —
 * never navigate to it. Scheme-insensitive, lower-case host without `www.`,
 * no default port, tracking parameters removed and different parameter names
 * ordered (top-level query and SPA route query alike), in-page anchors
 * dropped, SPA route path kept. Path case and trailing slashes are kept: a
 * site may serve `/a` and `/a/` as different resources. Null when not http(s).
 */
export function urlResourceIdentity(raw: string, rules?: TrackingRules): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const normalized = normalizeRules(rules);
  const host = url.host.toLowerCase().replace(/^www\./, '');
  const query = identityQuery(url.search.replace(/^\?/, ''), normalized);
  let route = '';
  if (isHashRoute(url.hash)) {
    const routeQueryAt = url.hash.indexOf('?');
    const routePath = routeQueryAt < 0 ? url.hash : url.hash.slice(0, routeQueryAt);
    const routeQuery =
      routeQueryAt < 0 ? '' : identityQuery(url.hash.slice(routeQueryAt + 1), normalized);
    route = `${routePath.replace(/^#!/, '#')}${routeQuery ? `?${routeQuery}` : ''}`;
  }
  return `${host}${url.pathname}${query ? `?${query}` : ''}${route}`;
}

/**
 * A homepage, search page or listing page — never an item's own source.
 * Shared by the answer verifier, the auto-fix layer and the browser eval
 * scorer so all three judge "detail source" the same way. The page path is
 * the SPA route when there is one (`#/post/7`); a root page with a resource
 * id (`/?id=3`) is a detail page.
 */
export function isNonDetailUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/[)\].,;:，。]+$/, ''));
  } catch {
    return true;
  }
  let path = url.pathname;
  let search = url.search;
  if (isHashRoute(url.hash)) {
    const route = url.hash.replace(/^#!?/, '');
    const routeQueryAt = route.indexOf('?');
    const routePath = routeQueryAt < 0 ? route : route.slice(0, routeQueryAt);
    if (routePath && routePath !== '/') path = routePath;
    if (routeQueryAt >= 0) search = `${search}&${route.slice(routeQueryAt + 1)}`;
  }
  const page = path.replace(/\/+$/, '').toLowerCase();
  if (page === '' || /^\/(?:index|default|home)(?:\.(?:s?html?|php|aspx?))?$/.test(page)) {
    return !/[?&](?:id|p|aid|itemid|item_id|article_id)=/i.test(search);
  }
  if (/(?:^|\/)(?:search|s|list|lists|category|categories|tag|tags)(?:\/|$)/.test(page))
    return true;
  return /[?&](?:q|query|keyword|keywords|wd|search)=/i.test(search);
}
