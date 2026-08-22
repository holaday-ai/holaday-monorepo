/**
 * Access-token storage for the web workbench. Mirrors the Chrome
 * extension's pattern (Chrome uses chrome.storage.local; the web app
 * uses localStorage) — same key name so a shared dev token lands in
 * the expected slot. Callers read synchronously at module load; the
 * orchestrator tolerates a missing token by rejecting the first
 * request / closing the WS with 4401.
 */
const TOKEN_KEY = 'holaday.access_token';
const MFA_CHALLENGE_KEY = 'holaday.mfa_challenge';
let memoryToken: string | null = null;
let memoryMfaChallenge: string | null = null;

/**
 * OAuth callback handoff: the `/api/auth/google/callback` handler
 * redirects back to `/#token=<JWT>` after a successful token swap.
 * On module load we pick that up, persist it, and clean the hash so
 * the token doesn't linger in the browser history. Must run BEFORE
 * App.tsx reads `getAccessToken` at initial render.
 */
(function consumeOAuthFragment(): void {
  if (typeof window === 'undefined' || !window.location.hash) return;
  const tokenMatch = /(?:^|[#&])token=([^&]+)/.exec(window.location.hash);
  const mfaMatch = /(?:^|[#&])mfa=([^&]+)/.exec(window.location.hash);
  if (!tokenMatch?.[1] && !mfaMatch?.[1]) return;
  if (tokenMatch?.[1]) {
    setAccessToken(decodeURIComponent(tokenMatch[1]));
  } else if (mfaMatch?.[1]) {
    setMfaChallenge(decodeURIComponent(mfaMatch[1]));
  }
  // Strip the token from the URL without a page reload so it can't
  // leak into referrers / shared links. History replaceState keeps
  // the current pathname + search but nukes the hash.
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
})();

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setAccessToken(token: string): void {
  memoryToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private-mode / storage disabled — fall through; state stays in
    // memory only and the user will log in again on refresh.
  }
}

export function clearAccessToken(): void {
  memoryToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // see setAccessToken
  }
}

export function getMfaChallenge(): string | null {
  try {
    return sessionStorage.getItem(MFA_CHALLENGE_KEY) ?? memoryMfaChallenge;
  } catch {
    return memoryMfaChallenge;
  }
}

export function setMfaChallenge(token: string): void {
  memoryMfaChallenge = token;
  try {
    sessionStorage.setItem(MFA_CHALLENGE_KEY, token);
  } catch {
    // The in-memory fallback lasts for the current page only, which
    // matches the five-minute challenge lifetime.
  }
}

export function clearMfaChallenge(): void {
  memoryMfaChallenge = null;
  try {
    sessionStorage.removeItem(MFA_CHALLENGE_KEY);
  } catch {
    // see setMfaChallenge
  }
}
