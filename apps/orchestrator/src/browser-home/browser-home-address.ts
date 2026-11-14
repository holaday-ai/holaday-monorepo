/**
 * BROWSER-HOME-1 — what the cloud-browser address bar typed means: a web address or search words.
 * Search words become a search page of the entry's region (Google for intl, Baidu for cn). This
 * only classifies; every resulting URL still goes through the browser network policy before the
 * browser goes there (file://, localhost, private networks and cloud metadata are refused there).
 */

export type BrowserHomeRegion = 'cn' | 'intl';

export type BrowserHomeAddress =
  | { kind: 'url'; url: string }
  | { kind: 'search'; url: string; query: string };

const MAX_SEARCH_LENGTH = 512;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// host:port ("example.com:8080/x", "localhost:3000") looks like a scheme to SCHEME; it is not one.
const HOST_PORT = /^[^\s/:?#]+:\d{1,5}(?:[/?#]|$)/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
// A dotted name whose last label is alphabetic (example.com, 中文.cn) or a punycode TLD.
const DOMAIN = /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+(?:\p{L}{2,}|xn--[a-z0-9-]+)$/iu;

export function searchUrlFor(query: string, region: BrowserHomeRegion): string {
  const q = encodeURIComponent(query.slice(0, MAX_SEARCH_LENGTH));
  return region === 'intl'
    ? `https://www.google.com/search?q=${q}`
    : `https://www.baidu.com/s?wd=${q}`;
}

/** Null for empty input. */
export function resolveBrowserHomeAddress(
  raw: string,
  region: BrowserHomeRegion,
): BrowserHomeAddress | null {
  const input = raw.trim();
  if (!input) return null;
  if (/\s/.test(input)) return { kind: 'search', url: searchUrlFor(input, region), query: input };
  // Anything with a scheme is an address, so file:, javascript:, data: … reach the policy and are
  // refused there — never silently turned into a search.
  if (SCHEME.test(input) && !HOST_PORT.test(input)) return { kind: 'url', url: input };
  if (looksLikeHost(input)) return { kind: 'url', url: `https://${input}` };
  return { kind: 'search', url: searchUrlFor(input, region), query: input };
}

function looksLikeHost(input: string): boolean {
  const authority = input.split(/[/?#]/, 1)[0] ?? '';
  if (authority.startsWith('[')) return /^\[[0-9a-f:.]+\](?::\d{1,5})?$/i.test(authority);
  const host = authority.replace(/:\d{1,5}$/, '');
  if (!host || host.includes('@')) return false;
  return host.toLowerCase() === 'localhost' || IPV4.test(host) || DOMAIN.test(host);
}
