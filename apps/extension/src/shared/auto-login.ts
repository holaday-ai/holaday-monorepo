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
import { compactLogErrorReason } from './log-error.js';
import { sanitizePageContextUrl } from './page-context.js';

const TOKEN_KEY = 'holaday.access_token';
const AUTO_LOGIN_TAB_READ_TIMEOUT_MS = 2_000;
const AUTO_LOGIN_TRANSIENT_RETRY_DELAY_MS = 150;
const AUTO_LOGIN_TAB_QUERY_TIMEOUT_MS = 2_000;
const MAX_AUTO_LOGIN_CANDIDATE_TABS = 8;

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
  const logUrl = sanitizePageContextUrl(url);
  try {
    const results = await readTokenResultFromTab(tabId);
    const value = results[0]?.result;
    const token = normalizeAccessToken(value);
    if (token && looksLikeAutoLoginToken(token)) {
      return token;
    }
    console.info(
      `[holaday] auto-login: tab ${tabId} (${logUrl}) has no token in localStorage`,
    );
    return null;
  } catch (err) {
    console.warn(
      `[holaday] auto-login: executeScript on tab ${tabId} (${logUrl}) failed`,
      compactLogErrorReason(err),
    );
    return null;
  }
}

async function readTokenResultFromTab(
  tabId: number,
): Promise<chrome.scripting.InjectionResult<string | null>[]> {
  try {
    return await readTokenResultFromTabOnce(tabId);
  } catch (err) {
    if (!isTransientAutoLoginReadError(err)) throw err;
    await new Promise<void>((resolve) => setTimeout(resolve, AUTO_LOGIN_TRANSIENT_RETRY_DELAY_MS));
    return readTokenResultFromTabOnce(tabId);
  }
}

function readTokenResultFromTabOnce(
  tabId: number,
): Promise<chrome.scripting.InjectionResult<string | null>[]> {
  // Inline closure-free arrow function. Doesn't reference any
  // bundler-injected helpers or imported symbols, so the
  // function source serializes cleanly when chrome.scripting
  // calls .toString() to ship it to the page world.
  return withDeadline(
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
}

function isTransientAutoLoginReadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes('permission') ||
    lower.includes('cannot access') ||
    lower.includes('chrome://') ||
    lower.includes('chrome-extension://') ||
    lower.includes('file://') ||
    lower.includes('auto_login_tab_timeout')
  ) {
    return false;
  }
  return (
    lower.includes('execution context was destroyed') ||
    lower.includes('receiving end does not exist') ||
    lower.includes('message port closed') ||
    lower.includes('frame was detached') ||
    lower.includes('frame with id') ||
    lower.includes('context invalidated')
  );
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
      compactLogErrorReason(err),
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
    sorted.slice(0, MAX_AUTO_LOGIN_CANDIDATE_TABS).map(async (tab) => {
      if (typeof tab.id !== 'number') return { tab, token: null };
      const token = await readTokenFromTab(tab.id, getTabAutoLoginUrl(tab));
      return { tab, token };
    }),
  );

  for (const { tab, token } of reads) {
    if (token) {
      const logUrl = sanitizePageContextUrl(getTabAutoLoginUrl(tab));
      console.info(
        `[holaday] auto-login: lifted token from tab ${tab.id} (${logUrl}) — ${token.length} chars`,
      );
      return token;
    }
  }
  console.info('[holaday] auto-login: no token found in any candidate tab');
  return null;
}

function getTabAutoLoginUrl(tab: chrome.tabs.Tab): string {
  return tab.pendingUrl || tab.url || '';
}

/** Exposed for the diagnostics pages / unit tests; safe to call. */
export const _internals = {
  TOKEN_KEY,
  WORKBENCH_URL_PATTERNS,
  isWorkbenchUrl,
  MAX_AUTO_LOGIN_CANDIDATE_TABS,
};
