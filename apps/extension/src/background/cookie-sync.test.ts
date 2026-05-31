import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectCookies, normalizeSyncableCookie, syncCookiesToServer } from './cookie-sync.js';

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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

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

  it('skips a stuck cookie domain without blocking the whole sync', async () => {
    vi.useFakeTimers();
    const getAll = vi.fn(({ domain }: chrome.cookies.GetAllDetails) => {
      if (domain === '.taobao.com') return new Promise<chrome.cookies.Cookie[]>(() => undefined);
      if (domain === '.github.com') return Promise.resolve([cookie({ domain: '.github.com' })]);
      return Promise.resolve([]);
    });
    globalThis.chrome = {
      cookies: { getAll },
    } as unknown as typeof chrome;

    const pending = collectCookies();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toEqual([
      expect.objectContaining({ domain: '.github.com', name: 'sid' }),
    ]);
    expect(getAll).toHaveBeenCalledWith({ domain: '.taobao.com' });
    expect(getAll).toHaveBeenCalledWith({ domain: '.github.com' });
  });

  it('times out a stuck cookie sync post', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({ 'holaday.access_token': 'token' })),
        },
      },
    } as unknown as typeof chrome;

    const assertion = expect(syncCookiesToServer([cookie()])).rejects.toThrow(
      'cookie_sync_post_timeout',
    );
    await vi.advanceTimersByTimeAsync(8_000);

    await assertion;
  });
});
