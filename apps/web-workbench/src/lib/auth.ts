/**
 * Access-token storage for the web workbench. Mirrors the Chrome
 * extension's pattern (Chrome uses chrome.storage.local; the web app
 * uses localStorage) — same key name so a shared dev token lands in
 * the expected slot. Callers read synchronously at module load; the
 * orchestrator tolerates a missing token by rejecting the first
 * request / closing the WS with 4401.
 */
const TOKEN_KEY = 'holaday.access_token';

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
