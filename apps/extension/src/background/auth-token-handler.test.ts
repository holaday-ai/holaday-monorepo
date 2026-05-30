import { describe, expect, it } from 'vitest';
import { decideAuthTokenAction, looksLikeAuthToken } from './auth-token-handler.js';

describe('decideAuthTokenAction', () => {
  it('incoming === stored → unchanged (no storage write, no WS churn)', () => {
    expect(decideAuthTokenAction('eyJfoo', 'eyJfoo', null)).toEqual({
      kind: 'unchanged',
    });
    expect(decideAuthTokenAction(null, null, null)).toEqual({
      kind: 'unchanged',
    });
  });

  it('incoming null + stored has value → clear (SPA logout mirror)', () => {
    expect(decideAuthTokenAction(null, 'eyJfoo', null)).toEqual({ kind: 'clear' });
  });

  it('fresh token, no knownBad → set', () => {
    expect(decideAuthTokenAction('eyJnew.token.value', null, null)).toEqual({
      kind: 'set',
      token: 'eyJnew.token.value',
    });
    expect(decideAuthTokenAction(' eyJnew.token.value ', 'eyJold', null)).toEqual({
      kind: 'set',
      token: 'eyJnew.token.value',
    });
  });

  it('fresh token, different knownBad → set (only the SAME knownBad is refused)', () => {
    expect(decideAuthTokenAction('eyJnew.token.value', null, 'eyJrejected.token.value')).toEqual({
      kind: 'set',
      token: 'eyJnew.token.value',
    });
  });

  it('incoming matches knownBad + stored is null → refuse (cycle-breaker)', () => {
    // This is the bug case: onUnauthorized just cleared chrome.storage
    // and saved the token as knownBad. The content script polls and
    // re-sends the SAME token from SPA localStorage. Without the
    // refuse path, the handler would write it back → reconnect → 4401
    // again. With refuse, we short-circuit.
    expect(
      decideAuthTokenAction('eyJrejected.token.value', null, 'eyJrejected.token.value'),
    ).toEqual({
      kind: 'refuse',
      reason: 'known_bad_token',
    });
  });

  it('incoming matches knownBad + stored differs → still refuse', () => {
    // Defensive: even if stored disagrees (shouldn't happen post-clear),
    // a knownBad match wins over a set decision.
    expect(
      decideAuthTokenAction('eyJrejected.token.value', 'eyJold', 'eyJrejected.token.value'),
    ).toEqual({
      kind: 'refuse',
      reason: 'known_bad_token',
    });
  });

  it('stored matches knownBad but incoming differs → set (token rotated)', () => {
    // The user logged in fresh on the SPA; localStorage has a NEW
    // token. Even though chrome.storage still has the dead token
    // (uncleared race) and knownBad still points at the dead one,
    // the NEW token is unrelated and should be set.
    expect(
      decideAuthTokenAction(
        'eyJnew.token.value',
        'eyJrejected.token.value',
        'eyJrejected.token.value',
      ),
    ).toEqual({
      kind: 'set',
      token: 'eyJnew.token.value',
    });
  });

  it('empty knownBad does not match an empty incoming (both null are unchanged)', () => {
    expect(decideAuthTokenAction(null, null, null)).toEqual({ kind: 'unchanged' });
  });

  it('empty strings mirror logout while obvious garbage is refused', () => {
    expect(decideAuthTokenAction('   ', 'eyJstored.token.value', null)).toEqual({
      kind: 'clear',
    });
    expect(decideAuthTokenAction('undefined', null, null)).toEqual({
      kind: 'refuse',
      reason: 'invalid_token',
    });
    expect(decideAuthTokenAction('short', null, null)).toEqual({
      kind: 'refuse',
      reason: 'invalid_token',
    });
  });
});

describe('looksLikeAuthToken', () => {
  it('accepts long opaque auth tokens and rejects obvious garbage', () => {
    expect(looksLikeAuthToken('hd_live_' + 'a'.repeat(24))).toBe(true);
    expect(looksLikeAuthToken('abc')).toBe(false);
    expect(looksLikeAuthToken('undefined')).toBe(false);
    expect(looksLikeAuthToken('null')).toBe(false);
    expect(looksLikeAuthToken('token with spaces')).toBe(false);
  });
});
