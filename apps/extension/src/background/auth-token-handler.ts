/**
 * Phase 25b fix — pure decision logic for the SW's
 * `holaday.auth.token` message handler, extracted so it can be
 * unit-tested without the chrome.storage / WS / SW environment.
 *
 * Inputs:
 *   - `incoming`: token the content script just observed (or null
 *      meaning the SPA cleared localStorage / logged out)
 *   - `stored`:   token currently in chrome.storage.local
 *   - `knownBad`: token the orchestrator recently rejected via 4401
 *      (read from KNOWN_BAD_TOKEN_KEY by the caller). null when
 *      no rejection on record.
 *
 * Output: a discriminated `AuthTokenAction` the caller dispatches on.
 *
 * Why a pure function: the cycle in production that this fix
 * addresses (popup mount clears + SW handler revives forever) was
 * subtle enough that I want regression tests on the decision logic
 * itself, independent of the chrome.storage mocking ceremony.
 */

export type AuthTokenAction =
  | { kind: 'unchanged' }
  | { kind: 'clear' }
  | { kind: 'set'; token: string }
  | { kind: 'refuse'; reason: 'known_bad_token' | 'invalid_token' };

const MIN_TOKEN_LENGTH = 10;

export function looksLikeAuthToken(value: string): boolean {
  if (value.length < MIN_TOKEN_LENGTH) return false;
  if (value === 'undefined' || value === 'null') return false;
  if (/\s/.test(value)) return false;
  return true;
}

export function decideAuthTokenAction(
  incoming: string | null,
  stored: string | null,
  knownBad: string | null,
): AuthTokenAction {
  const normalizedIncoming =
    incoming !== null && incoming.trim().length > 0 ? incoming.trim() : null;
  // Identical to current storage: caller short-circuits, no chrome
  // storage writes, no WS churn.
  if (normalizedIncoming === stored) return { kind: 'unchanged' };
  // SPA cleared localStorage → mirror.
  if (normalizedIncoming === null) return { kind: 'clear' };
  if (!looksLikeAuthToken(normalizedIncoming)) {
    return { kind: 'refuse', reason: 'invalid_token' };
  }
  // Refuse to revive a token the orchestrator just rejected — this
  // prevents the auth-bridge poll from undoing onUnauthorized's
  // cleanup every 3 s. The user has to log in fresh on the SPA
  // (producing a different token value) before this gate releases.
  if (knownBad !== null && normalizedIncoming === knownBad) {
    return { kind: 'refuse', reason: 'known_bad_token' };
  }
  return { kind: 'set', token: normalizedIncoming };
}
