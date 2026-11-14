/**
 * BROWSER-HOME-1 — the「云浏览器」entry's client-side rules: search engines, the recommended-site
 * config (`public/browser-home/sites.json`), the person's own shortcuts, and the address bar's
 * refusal copy. The home view is rendered by the app (not inside the cloud browser); only the
 * site the person opens goes to the cloud browser.
 */

import { browserNavExceptionMessage, browserNavFailureMessage } from '@/lib/browser-nav-copy';

export type BrowserHomeRegion = 'cn' | 'intl';
export type BrowserHomeSearchEngineId = 'google' | 'baidu';
export type BrowserHomeNavDirection = 'back' | 'forward' | 'reload' | 'goto';

export interface BrowserHomeSearchEngine {
  readonly id: BrowserHomeSearchEngineId;
  readonly label: string;
  searchUrl(query: string): string;
}

const MAX_SEARCH_LENGTH = 512;

export const BROWSER_HOME_SEARCH_ENGINES: readonly BrowserHomeSearchEngine[] = [
  {
    id: 'google',
    label: 'Google',
    searchUrl: (query) =>
      `https://www.google.com/search?q=${encodeURIComponent(query.slice(0, MAX_SEARCH_LENGTH))}`,
  },
  {
    id: 'baidu',
    label: '百度',
    searchUrl: (query) =>
      `https://www.baidu.com/s?wd=${encodeURIComponent(query.slice(0, MAX_SEARCH_LENGTH))}`,
  },
];

export function browserHomeSearchEngine(id: BrowserHomeSearchEngineId): BrowserHomeSearchEngine {
  return (
    BROWSER_HOME_SEARCH_ENGINES.find((engine) => engine.id === id) ??
    BROWSER_HOME_SEARCH_ENGINES[1]!
  );
}

/**
 * The overseas entry searches with Google, the domestic one with 百度. An account that never
 * chose a region uses the server default (`MODEL_DATA_REGION_DEFAULT`, cn).
 */
export function defaultBrowserHomeSearchEngine(
  region: BrowserHomeRegion | null | undefined,
): BrowserHomeSearchEngineId {
  return region === 'intl' ? 'google' : 'baidu';
}

/** The region whose recommended sites are shown (same default as above). */
export function browserHomeRegion(region: BrowserHomeRegion | null | undefined): BrowserHomeRegion {
  return region === 'intl' ? 'intl' : 'cn';
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOST_PORT = /^[^\s/:?#]+:\d{1,5}(?:[/?#]|$)/;
const DOMAIN_LIKE =
  /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+(?:\p{L}{2,}|xn--[a-z0-9-]+)(?::\d{1,5})?(?:[/?#]|$)/iu;

/** Whether typed text is an address (the server classifies it again and checks its policy). */
export function looksLikeWebAddress(input: string): boolean {
  const text = input.trim();
  if (!text || /\s/.test(text)) return false;
  if (SCHEME.test(text) && !HOST_PORT.test(text)) return true;
  return DOMAIN_LIKE.test(text) || HOST_PORT.test(text);
}

/**
 * What the home search box opens: an address as typed (the server checks it), search words as a
 * search page of the engine picked on the page. Null for empty input.
 */
export function browserHomeSearchTarget(
  input: string,
  engine: BrowserHomeSearchEngineId,
): string | null {
  const text = input.trim();
  if (!text) return null;
  if (looksLikeWebAddress(text)) return text;
  return browserHomeSearchEngine(engine).searchUrl(text);
}

/** A page worth showing in the browser view (not about:blank / an error page). */
export function isWebPageUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

// ── Recommended sites (config, not code) ─────────────────────────────────────

export interface BrowserHomeSite {
  readonly name: string;
  readonly url: string;
  /** Our own static asset under /browser-home/logos/ (never the site's own image URL). */
  readonly logo: string | null;
  readonly regions: readonly BrowserHomeRegion[];
  readonly order: number;
  /** Grey「待添加」tile while BOSS's list has not arrived; never shown in a production build. */
  readonly placeholder: boolean;
}

export const BROWSER_HOME_SITES_URL = '/browser-home/sites.json';
const LOGO_PATH = /^\/browser-home\/logos\/[A-Za-z0-9._-]+\.(?:png|svg|webp|jpg|jpeg)$/;

function parseSite(value: unknown): BrowserHomeSite | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const placeholder = raw.placeholder === true;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!name) return null;
  if (!placeholder && !isWebPageUrl(url)) return null;
  const regions = Array.isArray(raw.regions)
    ? raw.regions.filter(
        (region): region is BrowserHomeRegion => region === 'cn' || region === 'intl',
      )
    : [];
  if (regions.length === 0) return null;
  const logo = typeof raw.logo === 'string' && LOGO_PATH.test(raw.logo) ? raw.logo : null;
  const order = typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : 0;
  return { name, url: placeholder ? '' : url, logo, regions, order, placeholder };
}

export function parseBrowserHomeSites(value: unknown): BrowserHomeSite[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { sites?: unknown }).sites)
      ? (value as { sites: unknown[] }).sites
      : [];
  return list.map(parseSite).filter((site): site is BrowserHomeSite => site !== null);
}

/** Sites for this entry, in config order; placeholders dropped in a production build. */
export function visibleBrowserHomeSites(
  sites: readonly BrowserHomeSite[],
  region: BrowserHomeRegion,
  options: { production: boolean },
): BrowserHomeSite[] {
  return sites
    .filter((site) => site.regions.includes(region))
    .filter((site) => !(options.production && site.placeholder))
    .slice()
    .sort((a, b) => a.order - b.order);
}

export async function loadBrowserHomeSites(
  fetchImpl: typeof fetch = fetch,
): Promise<BrowserHomeSite[]> {
  try {
    const res = await fetchImpl(BROWSER_HOME_SITES_URL, { cache: 'no-cache' });
    if (!res.ok) return [];
    return parseBrowserHomeSites(await res.json());
  } catch {
    return [];
  }
}

// ── The person's own shortcuts (kept apart from the recommended sites) ───────

export interface BrowserHomeShortcut {
  readonly name: string;
  readonly url: string;
}

export const BROWSER_HOME_SHORTCUTS_KEY = 'holaday.browserHome.shortcuts';
export const MAX_BROWSER_HOME_SHORTCUTS = 24;

/** `example.com` → `https://example.com`; null when it is not an http(s) address. */
export function normalizeShortcutUrl(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  const withScheme = SCHEME.test(text) && !HOST_PORT.test(text) ? text : `https://${text}`;
  if (!isWebPageUrl(withScheme)) return null;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function shortcutNameFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function parseShortcuts(value: unknown): BrowserHomeShortcut[] {
  if (!Array.isArray(value)) return [];
  const out: BrowserHomeShortcut[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const url = typeof raw.url === 'string' ? normalizeShortcutUrl(raw.url) : null;
    if (!url) continue;
    const name =
      typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : shortcutNameFor(url);
    out.push({ name: name.slice(0, 40), url });
    if (out.length >= MAX_BROWSER_HOME_SHORTCUTS) break;
  }
  return out;
}

export function readBrowserHomeShortcuts(): BrowserHomeShortcut[] {
  try {
    const raw = window.localStorage.getItem(BROWSER_HOME_SHORTCUTS_KEY);
    return raw ? parseShortcuts(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function writeBrowserHomeShortcuts(shortcuts: readonly BrowserHomeShortcut[]): void {
  try {
    window.localStorage.setItem(
      BROWSER_HOME_SHORTCUTS_KEY,
      JSON.stringify(shortcuts.slice(0, MAX_BROWSER_HOME_SHORTCUTS)),
    );
  } catch {
    // Storage can be disabled (private window); the list just is not kept.
  }
}

// ── Address bar copy ─────────────────────────────────────────────────────────

/** A refusal from `browserHome.nav`: the server's own Chinese message wins. */
export function browserHomeNavFailureMessage(
  result: { reason: string; message?: string },
  direction: BrowserHomeNavDirection,
): string | null {
  if (result.message) return result.message;
  if (result.reason === 'no_session') return '云浏览器还在打开，请稍候再试';
  if (result.reason === 'missing_url') return '请输入网址或搜索内容';
  return browserNavFailureMessage(result.reason, direction);
}

const HAS_CHINESE = /[一-鿿]/;

/** A thrown error: the server's Chinese refusal (暂未开放 / 都在忙 …) is shown as is. */
export function browserHomeErrorMessage(
  error: unknown,
  direction: BrowserHomeNavDirection,
): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (raw && HAS_CHINESE.test(raw)) return raw;
  return browserNavExceptionMessage(error, direction);
}

export function browserHomeOpenErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (raw && HAS_CHINESE.test(raw)) return raw;
  return '云浏览器打开失败，请稍后重试';
}
