/**
 * Access-token storage for the web workbench. Mirrors the Chrome
 * extension's pattern (Chrome uses chrome.storage.local; the web app
 * uses localStorage) — same key name so a shared dev token lands in
 * the expected slot. Callers read synchronously at module load; the
 * orchestrator tolerates a missing token by rejecting the first
 * request / closing the WS with 4401.
 */
const TOKEN_KEY = 'holaday.access_token';

/**
 * OAuth callback handoff: the `/api/auth/google/callback` handler
 * redirects back to `/#token=<JWT>` after a successful token swap.
 * On module load we pick that up, persist it, and clean the hash so
 * the token doesn't linger in the browser history. Must run BEFORE
 * App.tsx reads `getAccessToken` at initial render.
 */
(function consumeOAuthFragment(): void {
  if (typeof window === 'undefined' || !window.location.hash) return;
  const m = /(?:^|[#&])token=([^&]+)/.exec(window.location.hash);
  if (!m || !m[1]) return;
  try {
    localStorage.setItem(TOKEN_KEY, decodeURIComponent(m[1]));
  } catch {
    /* see setAccessToken */
  }
  // Strip the token from the URL without a page reload so it can't
  // leak into referrers / shared links. History replaceState keeps
  // the current pathname + search but nukes the hash.
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
})();

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private-mode / storage disabled — fall through; state stays in
    // memory only and the user will log in again on refresh.
  }
}

export function clearAccessToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // see setAccessToken
  }
}
