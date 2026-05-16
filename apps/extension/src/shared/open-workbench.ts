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
 *
 * Subdomains of holaday.ai (staging.holaday.ai, etc.) are
 * intentionally NOT matched — staging tabs shouldn't catch the
 * primary "login" intent. If the user needs the broader scope later
 * we can switch to `*://*.holaday.ai/*` (which also covers the apex
 * per Chrome's match-pattern semantics).
 *
 * All chrome.* calls are wrapped in defensive try/catch — a transient
 * failure (e.g. extension unloading mid-call) should still resolve
 * to a sane "create a new tab" fallback rather than swallowing the
 * user's intent.
 */

export const WORKBENCH_TAB_MATCH_PATTERNS: readonly string[] = [
  '*://hd-app.orangebench.tech/*',
  '*://holaday.ai/*',
] as const;

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
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({ url: WORKBENCH_TAB_MATCH_PATTERNS as string[] });
  } catch {
    // chrome.tabs.query rejects (e.g. invalid pattern in some Chrome
    // builds, extension being torn down). Skip the focus path and
    // create a fresh tab below.
  }

  const target = pickBestTab(tabs);
  if (target && typeof target.id === 'number') {
    let activated = false;
    try {
      await chrome.tabs.update(target.id, { active: true });
      activated = true;
    } catch {
      /* see windows.update below */
    }
    if (typeof target.windowId === 'number') {
      try {
        await chrome.windows.update(target.windowId, { focused: true });
      } catch {
        /* non-fatal */
      }
    }
    if (activated) return;
  }

  // No existing workbench tab found OR activating failed — open fresh.
  try {
    await chrome.tabs.create({ url: fallbackUrl });
  } catch {
    /* nothing else to do — user-facing button is non-blocking */
  }
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
