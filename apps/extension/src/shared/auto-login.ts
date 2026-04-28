/**
 * Phase 14 — opportunistic auto-login (v2).
 *
 * The web workbench stores the JWT in `localStorage` under
 * `holaday.access_token` (apps/web-workbench/src/lib/auth.ts).
 * It's NOT a cookie — chrome.cookies cannot reach it. To lift
 * the token we have to run a tiny script in the page world of an
 * open holaday.ai (or local-dev) tab and read localStorage from
 * there.
 *
 * Strict: only reads, never writes. Returns null when:
 *   - no matching tab is open;
 *   - the matching tab has no token in localStorage;
 *   - chrome.scripting rejects (chrome:// pages, NTP, etc.).
 *
 * The caller (background/index.ts) only invokes this when it has
 * NO token in chrome.storage already, so we never overwrite a
 * token the user explicitly installed via the popup login flow.
 */

/** Same key the web-workbench uses — see web-workbench/src/lib/auth.ts. */
const TOKEN_KEY = 'holaday.access_token';

/**
 * URL patterns to scan for an open workbench tab. Order matters
 * (first hit wins): production first, then common dev origins.
 * Patterns mirror Chrome's match-pattern grammar — host wildcards
 * cover hd-* subdomains the workbench may move under.
 */
const WORKBENCH_TAB_PATTERNS = [
  'https://holaday.ai/*',
  'https://*.holaday.ai/*',
  'http://localhost:5173/*',
  'http://127.0.0.1:5173/*',
  'http://localhost:4173/*',
] as const;

/** Page-world function: reads localStorage and returns the token or null. */
function readTokenFromPage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function readTokenFromTab(tabId: number): Promise<string | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: readTokenFromPage,
      args: [TOKEN_KEY],
    });
    const value = results[0]?.result;
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    // chrome.scripting throws on restricted schemes (chrome://, the
    // Web Store, etc.) and when the host permission isn't granted
    // for that origin. We have <all_urls> so the latter shouldn't
    // happen, but tabs may close mid-call. Best-effort.
    return null;
  }
}

export async function tryAutoLogin(): Promise<string | null> {
  let candidates: chrome.tabs.Tab[] = [];
  try {
    candidates = await chrome.tabs.query({ url: [...WORKBENCH_TAB_PATTERNS] });
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;

  // Active tab in the focused window first — that's most likely the
  // one the user just signed in on. Fall through to other matching
  // tabs (a stale dev tab in the background may still have a token).
  const sorted = [...candidates].sort((a, b) => {
    const aScore = (a.active ? 2 : 0) + (a.lastAccessed ?? 0) / 1e13;
    const bScore = (b.active ? 2 : 0) + (b.lastAccessed ?? 0) / 1e13;
    return bScore - aScore;
  });

  for (const tab of sorted) {
    if (typeof tab.id !== 'number') continue;
    const token = await readTokenFromTab(tab.id);
    if (token) return token;
  }
  return null;
}
