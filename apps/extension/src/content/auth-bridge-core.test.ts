import { describe, expect, it } from 'vitest';
import { decideAction, decideObservedTokenAction, looksLikeToken } from './auth-bridge-core.js';

describe('decideAction', () => {
  it('null → null is unchanged', () => {
    expect(decideAction(null, null)).toEqual({ kind: 'unchanged' });
  });

  it('null → token is set', () => {
    expect(decideAction(null, 'eyJabc.def.ghi-jwt-long-enough')).toEqual({
      kind: 'set',
      token: 'eyJabc.def.ghi-jwt-long-enough',
    });
  });

  it('token → null is clear', () => {
    expect(decideAction('eyJfoo', null)).toEqual({ kind: 'clear' });
  });

  it('same token is unchanged', () => {
    expect(decideAction('eyJfoo', 'eyJfoo')).toEqual({ kind: 'unchanged' });
  });

  it('different token is set (account swap / refresh)', () => {
    expect(decideAction('eyJold', 'eyJnew')).toEqual({ kind: 'set', token: 'eyJnew' });
  });

  it('trims observed token values before comparing or setting', () => {
    expect(decideAction(null, '  eyJabc.def.ghi-jwt-long-enough  ')).toEqual({
      kind: 'set',
      token: 'eyJabc.def.ghi-jwt-long-enough',
    });
    expect(decideAction('eyJfoo', '  eyJfoo  ')).toEqual({ kind: 'unchanged' });
  });

  it('empty string is treated as null', () => {
    expect(decideAction('eyJfoo', '')).toEqual({ kind: 'clear' });
    expect(decideAction(null, '')).toEqual({ kind: 'unchanged' });
  });

  it('whitespace-only is treated as null', () => {
    expect(decideAction(null, '   ')).toEqual({ kind: 'unchanged' });
    expect(decideAction('eyJfoo', '   ')).toEqual({ kind: 'clear' });
  });
});

describe('looksLikeToken', () => {
  it('accepts long JWT-like strings', () => {
    expect(looksLikeToken('eyJabc.def.ghi-jwt-long-enough')).toBe(true);
  });

  it('rejects too-short values', () => {
    expect(looksLikeToken('abc')).toBe(false);
  });

  it('rejects the literal strings "undefined" / "null"', () => {
    expect(looksLikeToken('undefined')).toBe(false);
    expect(looksLikeToken('Undefined')).toBe(false);
    expect(looksLikeToken('null')).toBe(false);
    expect(looksLikeToken('NULL')).toBe(false);
  });

  it('rejects values with whitespace', () => {
    expect(looksLikeToken('eyJ abc def ghi long enough')).toBe(false);
    expect(looksLikeToken('eyJtab\there.is.tab')).toBe(false);
  });

  it('accepts long opaque token (not strictly JWT format)', () => {
    expect(looksLikeToken('hd_live_' + 'a'.repeat(24))).toBe(true);
  });
});

describe('decideObservedTokenAction', () => {
  it('ignores malformed observed tokens when no token was previously sent', () => {
    expect(decideObservedTokenAction(null, 'Undefined')).toEqual({ kind: 'unchanged' });
  });

  it('treats malformed observed tokens as a clear action after a valid token', () => {
    expect(decideObservedTokenAction('hd_live_' + 'a'.repeat(24), 'token with spaces')).toEqual({
      kind: 'clear',
    });
  });

  it('keeps valid observed tokens on the set path', () => {
    expect(decideObservedTokenAction(null, 'hd_live_' + 'a'.repeat(24))).toEqual({
      kind: 'set',
      token: 'hd_live_' + 'a'.repeat(24),
    });
  });
});
