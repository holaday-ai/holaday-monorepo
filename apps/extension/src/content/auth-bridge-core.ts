/**
 * Phase 25b — auth-bridge pure-function core.
 *
 * Split from the content-script entry so the decision logic can be
 * unit-tested without spinning up a Chrome extension test harness.
 * The entry (`auth-bridge.ts`) wraps these helpers in chrome.runtime
 * + window.addEventListener side effects; everything that matters
 * for correctness lives here.
 *
 * Token storage contract (must match apps/web-workbench/src/lib/auth.ts):
 *   localStorage['holaday.access_token'] = <jwt> | null
 *
 * The content script polls + listens for cross-tab `storage` events
 * (the in-tab write does NOT fire `storage`, hence the poll fallback).
 * On every observed value it calls `decideAction(prev, curr)` and acts
 * on the result by posting a message to the SW.
 */

export const TOKEN_KEY = 'holaday.access_token';

/**
 * What the SW message handler should do given the (prev, curr) pair.
 *
 *   - 'unchanged': value identical to what we last sent. No-op. The
 *     dedupe matters because the poll fires every few seconds; we
 *     don't want to flood the SW with redundant `holaday.auth.token`
 *     frames just to have it run `setAccessToken` → trigger a
 *     storage.onChanged → trigger a WS reconnect.
 *
 *   - 'set': a fresh non-empty token. Could be a brand-new login,
 *     a token swap (different account, refresh, etc.), or the very
 *     first observation after content-script load. The SW writes it
 *     to chrome.storage.local; ws-client's storage.onChanged listener
 *     handles the WS reconnect automatically.
 *
 *   - 'clear': SPA cleared the token (logout, expiry, manual wipe).
 *     The SW clears chrome.storage and disconnects the WS so the
 *     extension UI flips to logged-out within seconds.
 */
export type SyncAction =
  | { kind: 'unchanged' }
  | { kind: 'set'; token: string }
  | { kind: 'clear' };

/**
 * Decide what to do given an observed localStorage value relative to
 * the previously-sent value.
 *
 *   prev | curr  | action
 *   -----|-------|-----------
 *   null | null  | unchanged
 *   null | "abc" | set "abc"
 *   "ab" | null  | clear
 *   "ab" | "ab"  | unchanged
 *   "ab" | "xy"  | set "xy"
 *
 * Empty-string and whitespace-only `curr` is treated as null
 * (SPA's auth.ts shouldn't write empty strings, but defending
 * against a buggy build that does so).
 */
export function decideAction(prev: string | null, curr: string | null): SyncAction {
  const normalised = curr && curr.trim().length > 0 ? curr : null;
  if (normalised === prev) return { kind: 'unchanged' };
  if (normalised === null) return { kind: 'clear' };
  return { kind: 'set', token: normalised };
}

export function decideObservedTokenAction(
  prev: string | null,
  curr: string | null,
): SyncAction {
  const decision = decideAction(prev, curr);
  if (decision.kind !== 'set') return decision;
  return looksLikeToken(decision.token) ? decision : { kind: 'clear' };
}

/**
 * Minimum number of characters a JWT can be and still pass our
 * sanity check. Real JWTs are ~120+ chars; this floor catches a
 * stray "test" or "1" that some debug snippet might inject without
 * being so strict that a legit short token gets dropped.
 */
const MIN_TOKEN_LENGTH = 10;

/**
 * Filter for the SET path. Returns true when the value looks like
 * a plausible JWT (or any opaque token long enough to be worth
 * sending). The motivation: a corrupted localStorage write that
 * lands "undefined" as a string shouldn't trigger a WS reconnect
 * with that as the bearer.
 *
 * Intentionally loose — token format may change. We refuse only
 * obvious garbage.
 */
export function looksLikeToken(value: string): boolean {
  if (value.length < MIN_TOKEN_LENGTH) return false;
  const lower = value.toLowerCase();
  if (lower === 'undefined' || lower === 'null') return false;
  // Any whitespace anywhere is suspect (real JWTs are URL-safe).
  if (/\s/.test(value)) return false;
  return true;
}
