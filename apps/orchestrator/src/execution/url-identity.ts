/**
 * URL identity shared by the browser executor (which links it shows the model
 * and records as observed) and the answer verifier (whether list items cite
 * distinct sources).
 *
 * Only well-known tracking parameters are removed. Everything else — ids,
 * SKUs, search terms, signatures, expiry, cloud-storage auth (X-Amz-*) — is
 * part of what the URL points at and is always kept. A plain fragment
 * (`#section`) is a position inside the same page; an SPA hash route
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

function isTrackingParam(name: string, rules: TrackingRules = {}): boolean {
  const key = name.toLowerCase();
  if (PRESERVED_PARAMS.has(key) || key.startsWith('x-amz-')) return false;
  if ((rules.params ?? DEFAULT_TRACKING_PARAMS).includes(key)) return true;
  return (rules.prefixes ?? DEFAULT_TRACKING_PREFIXES).some((prefix) => key.startsWith(prefix));
}

/** `#/…` and `#!/…` select an SPA view; any other fragment is an in-page anchor. */
export function isHashRoute(hash: string): boolean {
  return /^#!?\//.test(hash);
}

const RELATIVE_BASE = 'http://relative.invalid';

/**
 * The same link without tracking parameters or an in-page anchor. Keeps the
 * input's form: absolute stays absolute, `//host/…` and `/path` stay relative.
 * Unparseable input comes back unchanged.
 */
export function stripTrackingFromUrl(href: string, rules?: TrackingRules): string {
  const trimmed = href.trim();
  let url: URL;
  try {
    url = new URL(trimmed, RELATIVE_BASE);
  } catch {
    return href;
  }
  if (!/^https?:$/.test(url.protocol)) return href;
  const kept = [...url.searchParams.entries()].filter(([name]) => !isTrackingParam(name, rules));
  const search = kept.length > 0 ? `?${new URLSearchParams(kept).toString()}` : '';
  // Untouched queries keep their exact encoding (signatures are byte-sensitive).
  const query = kept.length === [...url.searchParams.keys()].length ? url.search : search;
  const hash = isHashRoute(url.hash) ? url.hash : '';
  const rest = `${url.pathname}${query}${hash}`;
  if (/^https?:\/\//i.test(trimmed)) return `${url.protocol}//${url.host}${rest}`;
  if (trimmed.startsWith('//')) return `//${url.host}${rest}`;
  return rest;
}

/**
 * Resource identity of an absolute URL, for "is this the same source?":
 * scheme-insensitive, lower-case host without `www.`, no default port, no
 * trailing slash, tracking parameters removed, remaining parameters sorted,
 * in-page anchors dropped and SPA hash routes kept. Null when not http(s).
 */
export function urlResourceIdentity(raw: string, rules?: TrackingRules): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.host.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const params = [...url.searchParams.entries()]
    .filter(([name]) => !isTrackingParam(name, rules))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
  const hash = isHashRoute(url.hash) ? url.hash : '';
  return `${host}${path}${query}${hash}`;
}
