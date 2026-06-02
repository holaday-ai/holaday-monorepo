/**
 * Phase 14 — opportunistic auto-login (v3).
 *
 * The web workbench stores its JWT in `localStorage` under
 * `holaday.access_token` (apps/web-workbench/src/lib/auth.ts), not
 * a cookie — chrome.cookies cannot reach it. We `executeScript`
 * into any open workbench tab and read localStorage from its page
 * world.
 *
 * Why we don't pass `url: [...]` to chrome.tabs.query: Chrome's
 * tab-URL match patterns reject patterns that contain a port
 * (e.g. `http://localhost:5173/*`) — and a single invalid entry in
 * the array silently fails the whole query. The previous version
 * swallowed that failure and returned null, leaving BOSS staring
 * at "Demo user" with no diagnostic. v3 queries ALL tabs and
 * filters client-side via regex, then logs every step at info /
 * warn so the SW DevTools console makes failures obvious.
 *
 * Strict: only reads, never writes. Caller (background/index.ts)
 * only invokes this when chrome.storage has no token already.
 */

import { normalizeAccessToken } from './storage.js';
import { withDeadline } from './deadline.js';

const TOKEN_KEY = 'holaday.access_token';
const AUTO_LOGIN_TAB_READ_TIMEOUT_MS = 2_000;
const AUTO_LOGIN_TAB_QUERY_TIMEOUT_MS = 2_000;

/**
 * URLs we'll consider "the workbench". Same rule as a chrome.tabs
 * match pattern but expressed as RegExp so port-ful localhost
 * variants are accepted. Anchored at the start of the URL so a
 * page that merely LINKS to holaday.ai doesn't qualify.
 */
const WORKBENCH_URL_PATTERNS: readonly RegExp[] = [
  /^https:\/\/hd-app\.orangebench\.tech(?:[/:]|$)/i,
  /^https:\/\/holaday\.ai(?:[/:]|$)/i,
  /^https:\/\/app\.holaday\.ai(?:[/:]|$)/i,
  /^http:\/\/localhost(?::\d+)?(?:[/?#]|$)/i,
  /^http:\/\/127(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/i,
  /^http:\/\/\[::1\](?::\d+)?(?:[/?#]|$)/i,
] as const;
const MIN_TOKEN_LENGTH = 10;

function isWorkbenchUrl(url: string | undefined): boolean {
  if (!url) return false;
  return WORKBENCH_URL_PATTERNS.some((re) => re.test(url));
}

function looksLikeAutoLoginToken(token: string): boolean {
  return token.length >= MIN_TOKEN_LENGTH && !/\s/.test(token);
}

async function readTokenFromTab(tabId: number, url: string): Promise<string | null> {
  try {
    // Inline closure-free arrow function. Doesn't reference any
    // bundler-injected helpers or imported symbols, so the
    // function source serializes cleanly when chrome.scripting
    // calls .toString() to ship it to the page world.
    const results = await withDeadline(
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          try {
            return window.localStorage.getItem('holaday.access_token');
          } catch {
            return null;
          }
        },
      }),
      AUTO_LOGIN_TAB_READ_TIMEOUT_MS,
      'auto_login_tab_timeout',
    );
    const value = results[0]?.result;
    const token = normalizeAccessToken(value);
    if (token && looksLikeAutoLoginToken(token)) {
      return token;
    }
    console.info(
      `[holaday] auto-login: tab ${tabId} (${url}) has no token in localStorage`,
    );
    return null;
  } catch (err) {
    console.warn(
      `[holaday] auto-login: executeScript on tab ${tabId} (${url}) failed`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function tryAutoLogin(): Promise<string | null> {
  let allTabs: chrome.tabs.Tab[];
  try {
    allTabs = await withDeadline(
      chrome.tabs.query({}),
      AUTO_LOGIN_TAB_QUERY_TIMEOUT_MS,
      'auto_login_tab_query_timeout',
    );
  } catch (err) {
    console.warn(
      '[holaday] auto-login: tabs.query({}) failed',
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  const candidates = allTabs.filter((t) => isWorkbenchUrl(getTabAutoLoginUrl(t)));
  console.info(
    `[holaday] auto-login: scanning ${candidates.length} workbench tab(s) of ${allTabs.length} total`,
  );
  if (candidates.length === 0) return null;

  // Active focused tab first, then most-recently-accessed. lastAccessed
  // is a ms timestamp; division puts it on the same scale as the boolean.
  const sorted = [...candidates].sort((a, b) => {
    const aScore = (a.active ? 2 : 0) + (a.lastAccessed ?? 0) / 1e13;
    const bScore = (b.active ? 2 : 0) + (b.lastAccessed ?? 0) / 1e13;
    return bScore - aScore;
  });

  const reads = await Promise.all(
    sorted.map(async (tab) => {
      if (typeof tab.id !== 'number') return { tab, token: null };
      const token = await readTokenFromTab(tab.id, getTabAutoLoginUrl(tab));
      return { tab, token };
    }),
  );

  for (const { tab, token } of reads) {
    if (token) {
      console.info(
        `[holaday] auto-login: lifted token from tab ${tab.id} (${getTabAutoLoginUrl(tab)}) — ${token.length} chars`,
      );
      return token;
    }
  }
  console.info('[holaday] auto-login: no token found in any candidate tab');
  return null;
}

function getTabAutoLoginUrl(tab: chrome.tabs.Tab): string {
  return tab.url || tab.pendingUrl || '';
}

/** Exposed for the diagnostics pages / unit tests; safe to call. */
export const _internals = {
  TOKEN_KEY,
  WORKBENCH_URL_PATTERNS,
  isWorkbenchUrl,
};
