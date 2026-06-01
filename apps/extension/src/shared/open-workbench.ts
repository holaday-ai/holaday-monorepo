/**
 * Phase 25c — open-or-focus helper for the HOLA DAY workbench tab.
 *
 * The popup's "前往 HOLA DAY 登录" + "前往网页" CTAs previously called
 * `chrome.tabs.create` unconditionally, so every click spawned a fresh
 * duplicate tab even when the user already had the workbench open.
 * This helper first searches all open tabs for a workbench URL and
 * activates the existing one when found; only when nothing matches
 * does it create a new tab.
 *
 * Match patterns intentionally narrow to the two prod surfaces the
 * popup CTA points at:
 *   - hd-app.orangebench.tech  (Aliyun, China route)
 *   - holaday.ai               (international apex)
 *   - app.holaday.ai           (app subdomain, public route)
 *
 * Subdomains of holaday.ai (staging.holaday.ai, etc.) are
 * otherwise NOT matched — staging tabs shouldn't catch the primary
 * "login" intent. If the user needs the broader scope later we can
 * switch to `*://*.holaday.ai/*` (which also covers the apex per
 * Chrome's match-pattern semantics).
 *
 * All chrome.* calls are wrapped in defensive try/catch — a transient
 * failure (e.g. extension unloading mid-call) should still resolve
 * to a sane "create a new tab" fallback rather than swallowing the
 * user's intent.
 */

import { withDeadline } from './deadline.js';

export const WORKBENCH_TAB_MATCH_PATTERNS: readonly string[] = [
  '*://hd-app.orangebench.tech/*',
  '*://holaday.ai/*',
  '*://app.holaday.ai/*',
] as const;
const WORKBENCH_TAB_QUERY_TIMEOUT_MS = 1_500;
const WORKBENCH_TAB_ACTION_TIMEOUT_MS = 1_500;
const MAX_WORKBENCH_URL_LENGTH = 2_048;

export function isWorkbenchTabUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'hd-app.orangebench.tech' ||
        parsed.hostname === 'holaday.ai' ||
        parsed.hostname === 'app.holaday.ai')
    );
  } catch {
    return false;
  }
}

/**
 * Find an existing workbench tab, activate it (and focus its window),
 * or create a new tab pointed at `fallbackUrl` when no match exists.
 *
 * Multi-tab tiebreak: when more than one workbench tab is open, prefer
 * the active tab in the current window (so a user with two browser
 * windows both showing the workbench gets focused on whichever they
 * were most recently using). Falls back to the first tab returned by
 * chrome.tabs.query when no active/recent signal differentiates.
 */
export async function openOrFocusWorkbench(fallbackUrl: string): Promise<void> {
  const createUrl = normalizeWorkbenchOpenUrl(fallbackUrl);
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await withDeadline(
      chrome.tabs.query({ url: WORKBENCH_TAB_MATCH_PATTERNS as string[] }),
      WORKBENCH_TAB_QUERY_TIMEOUT_MS,
      'workbench_tab_query_timeout',
    );
  } catch {
    // chrome.tabs.query can reject on URL match quirks in some Chrome
    // builds. Fall back to querying all tabs and filtering in-process
    // before deciding to open a duplicate tab.
    try {
      tabs = (
        await withDeadline(
          chrome.tabs.query({}),
          WORKBENCH_TAB_QUERY_TIMEOUT_MS,
          'workbench_tab_query_timeout',
        )
      ).filter((tab) => isWorkbenchTabUrl(tab.url));
    } catch {
      tabs = [];
    }
  }

  const target = pickBestTab(tabs);
  if (target && typeof target.id === 'number') {
    let activated = false;
    try {
      await withDeadline(
        chrome.tabs.update(target.id, { active: true }),
        WORKBENCH_TAB_ACTION_TIMEOUT_MS,
        'workbench_tab_action_timeout',
      );
      activated = true;
    } catch {
      /* see windows.update below */
    }
    if (typeof target.windowId === 'number') {
      try {
        await withDeadline(
          chrome.windows.update(target.windowId, { focused: true }),
          WORKBENCH_TAB_ACTION_TIMEOUT_MS,
          'workbench_tab_action_timeout',
        );
      } catch {
        /* non-fatal */
      }
    }
    if (activated) {
      if (target.discarded) {
        try {
          await withDeadline(
            chrome.tabs.reload(target.id),
            WORKBENCH_TAB_ACTION_TIMEOUT_MS,
            'workbench_tab_action_timeout',
          );
        } catch {
          /* active tab is still a better target than opening a duplicate */
        }
      }
      return;
    }
  }

  // No existing workbench tab found OR activating failed — open fresh.
  if (!createUrl) return;
  try {
    await withDeadline(
      chrome.tabs.create({ url: createUrl }),
      WORKBENCH_TAB_ACTION_TIMEOUT_MS,
      'workbench_tab_action_timeout',
    );
  } catch {
    /* nothing else to do — user-facing button is non-blocking */
  }
}

export function normalizeWorkbenchOpenUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > MAX_WORKBENCH_URL_LENGTH) return null;
  const normalized = hasHierarchicalUrlScheme(value) ? value : normalizeBareWorkbenchUrl(value);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function hasHierarchicalUrlScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function normalizeBareWorkbenchUrl(value: string): string {
  const localHost = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::|\/|$)/i;
  return `${localHost.test(value) ? 'http' : 'https'}://${value}`;
}

/**
 * Tiebreak among multiple workbench tabs. Pure function so the
 * preference order can be unit-tested without spinning chrome.tabs.
 *
 * Priority:
 *   1. Active tab in the LAST FOCUSED window (most-recent intent)
 *   2. Any active tab (across all windows)
 *   3. The most recently accessed tab (Chrome's `lastAccessed`)
 *   4. First tab in the array (deterministic)
 *
 * Returns null when the list is empty.
 */
export function pickBestTab(tabs: readonly chrome.tabs.Tab[]): chrome.tabs.Tab | null {
  if (tabs.length === 0) return null;
  if (tabs.length === 1) return tabs[0] ?? null;
  const activeFocused = tabs.find((t) => t.active && t.lastAccessed != null);
  if (activeFocused) {
    // Among active tabs, prefer the most-recently-accessed (best
    // proxy for "the window the user is currently using").
    const allActive = tabs.filter((t) => t.active);
    return allActive.reduce((best, cur) => {
      if (!best) return cur;
      const bestAt = best.lastAccessed ?? 0;
      const curAt = cur.lastAccessed ?? 0;
      return curAt > bestAt ? cur : best;
    }, allActive[0] ?? null);
  }
  const anyActive = tabs.find((t) => t.active);
  if (anyActive) return anyActive;
  const byRecent = [...tabs].sort(
    (a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
  );
  return byRecent[0] ?? tabs[0] ?? null;
}
