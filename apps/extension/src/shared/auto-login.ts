/**
 * Phase 14 — opportunistic auto-login.
 *
 * If the user is already signed in to holaday.ai in this Chrome
 * profile, lift their JWT out of cookie/local-storage so the
 * extension comes online without a separate sign-in. Strictly
 * read-only — never overwrites a token the user explicitly stored
 * via the popup login flow.
 *
 * Lookup order (first hit wins):
 *   1. chrome.cookies on `holaday.ai` → cookie name `holaday_token`
 *      or `auth_token`. The web workbench currently uses
 *      localStorage rather than a cookie, so this branch is a
 *      forward-compatibility hook for the day we set a server
 *      cookie on login.
 *   2. (Future) read `localStorage.getItem('holaday.access_token')`
 *      via chrome.scripting on a holaday.ai tab — costs a tab
 *      lookup and only works when the user has the page open, so
 *      we keep it gated behind manual invocation rather than firing
 *      on every SW boot.
 *
 * The function returns null when nothing was found; the caller
 * decides whether to leave the SW disconnected or surface a "sign
 * in via Side Panel" CTA.
 */

const HOLADAY_DOMAIN = 'holaday.ai';
const COOKIE_NAMES = ['holaday_token', 'auth_token'] as const;

export async function tryAutoLogin(): Promise<string | null> {
  // chrome.cookies.get throws when the extension lacks the
  // `cookies` permission for the requested URL — we have it
  // declared in manifest.config.ts, so the only realistic failure
  // is a transient Chrome bug. Catch + return null in any case.
  let cookies: chrome.cookies.Cookie[] = [];
  try {
    cookies = await chrome.cookies.getAll({ domain: HOLADAY_DOMAIN });
  } catch {
    return null;
  }
  for (const name of COOKIE_NAMES) {
    const c = cookies.find((it) => it.name === name && it.value);
    if (c?.value) return c.value;
  }
  return null;
}
