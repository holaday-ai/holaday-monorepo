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
const CLOSURE_RECOVERY_KEY = 'holaday.closure_recovery';
let memoryToken: string | null = null;
let memoryMfaChallenge: string | null = null;
let memoryClosureRecovery: string | null = null;

/**
 * OAuth callback handoff: the `/api/auth/google/callback` handler
 * redirects back to `/#token=<JWT>` after a successful token swap.
 * On module load we pick that up, persist it, and clean the hash so
 * the token doesn't linger in the browser history. Must run BEFORE
 * App.tsx reads `getAccessToken` at initial render.
 */
(function consumeOAuthFragment(): void {
  if (typeof window === 'undefined' || !window.location.hash) return;
  const scrubFragment = (): void => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  };
  const hasUnassociatedFactorFragment = /(?:^|[#&])(?:mfa|closure)=/.test(
    window.location.hash,
  );
  if (hasUnassociatedFactorFragment && getAccessToken()) {
    scrubFragment();
    return;
  }
  const tokenMatch = /(?:^|[#&])token=([^&]+)/.exec(window.location.hash);
  const mfaMatch = /(?:^|[#&])mfa=([^&]+)/.exec(window.location.hash);
  const closureMatch = /(?:^|[#&])closure=([^&]+)/.exec(window.location.hash);
  if (!tokenMatch?.[1] && !mfaMatch?.[1] && !closureMatch?.[1]) {
    if (hasUnassociatedFactorFragment) scrubFragment();
    return;
  }
  try {
    if (closureMatch?.[1]) {
      setClosureRecovery(decodeURIComponent(closureMatch[1]));
    } else if (mfaMatch?.[1]) {
      setMfaChallenge(decodeURIComponent(mfaMatch[1]));
    } else if (tokenMatch?.[1]) {
      setAccessToken(decodeURIComponent(tokenMatch[1]));
    }
  } catch {
    // Malformed percent escapes are untrusted input; discard the handoff.
  }
  // Strip the token from the URL without a page reload so it can't
  // leak into referrers / shared links. History replaceState keeps
  // the current pathname + search but nukes the hash.
  scrubFragment();
})();

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setAccessToken(token: string): void {
  clearMfaChallenge();
  clearClosureRecovery();
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
  clearAccessToken();
  clearClosureRecovery();
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

export function getClosureRecovery(): string | null {
  try {
    return sessionStorage.getItem(CLOSURE_RECOVERY_KEY) ?? memoryClosureRecovery;
  } catch {
    return memoryClosureRecovery;
  }
}

export function setClosureRecovery(token: string): void {
  clearAccessToken();
  clearMfaChallenge();
  memoryClosureRecovery = token;
  try {
    sessionStorage.setItem(CLOSURE_RECOVERY_KEY, token);
  } catch {
    // Recovery credentials intentionally survive only this browser tab.
  }
}

export function clearClosureRecovery(): void {
  memoryClosureRecovery = null;
  try {
    sessionStorage.removeItem(CLOSURE_RECOVERY_KEY);
  } catch {
    // see setClosureRecovery
  }
}
