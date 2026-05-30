import { describe, expect, it } from 'vitest';
import { normalizeSyncableCookie } from './cookie-sync.js';

function cookie(overrides: Partial<chrome.cookies.Cookie> = {}): chrome.cookies.Cookie {
  return {
    domain: '.example.com',
    name: 'sid',
    value: 'abc',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    session: false,
    storeId: '0',
    hostOnly: false,
    ...overrides,
  } as chrome.cookies.Cookie;
}

describe('normalizeSyncableCookie', () => {
  it('keeps normal cookies intact for server sync', () => {
    expect(normalizeSyncableCookie(cookie({ expirationDate: 1_800_000_000 }))).toEqual({
      domain: '.example.com',
      name: 'sid',
      value: 'abc',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: 1_800_000_000,
    });
  });

  it('drops malformed or oversized cookies before upload', () => {
    expect(normalizeSyncableCookie(cookie({ name: '' }))).toBeNull();
    expect(normalizeSyncableCookie(cookie({ domain: '' }))).toBeNull();
    expect(normalizeSyncableCookie(cookie({ value: 'x'.repeat(8193) }))).toBeNull();
  });

  it('defaults a missing cookie path to the root path', () => {
    expect(normalizeSyncableCookie(cookie({ path: '' }))?.path).toBe('/');
  });

  it('clips metadata fields while preserving the cookie value', () => {
    const normalized = normalizeSyncableCookie(
      cookie({
        domain: `.${'a'.repeat(300)}.com`,
        name: 'n'.repeat(300),
        path: `/${'p'.repeat(1200)}`,
        value: 'secret',
        expirationDate: Number.NaN,
      }),
    );

    expect(normalized?.domain).toHaveLength(253);
    expect(normalized?.name).toHaveLength(256);
    expect(normalized?.path).toHaveLength(1024);
    expect(normalized?.value).toBe('secret');
    expect(normalized).not.toHaveProperty('expirationDate');
  });
});
