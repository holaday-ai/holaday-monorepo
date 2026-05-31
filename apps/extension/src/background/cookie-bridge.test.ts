import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLoginStatesMessage, readLoginStates } from './cookie-bridge.js';

function cookie(name: string): chrome.cookies.Cookie {
  return {
    name,
    value: '1',
    domain: '.github.com',
    hostOnly: false,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    session: true,
    storeId: '0',
  } as chrome.cookies.Cookie;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

describe('readLoginStates', () => {
  it('marks domains by auth cookie name', async () => {
    globalThis.chrome = {
      cookies: {
        getAll: vi.fn(async ({ domain }: chrome.cookies.GetAllDetails) =>
          domain === 'github.com' ? [cookie('user_session')] : [],
        ),
      },
    } as unknown as typeof chrome;

    const states = await readLoginStates();

    expect(states['github.com']).toBe(true);
    expect(states['taobao.com']).toBe(false);
  });

  it('does not block the snapshot when one cookie domain hangs', async () => {
    vi.useFakeTimers();
    globalThis.chrome = {
      cookies: {
        getAll: vi.fn(({ domain }: chrome.cookies.GetAllDetails) => {
          if (domain === 'taobao.com') return new Promise(() => undefined);
          if (domain === 'github.com') return Promise.resolve([cookie('logged_in')]);
          return Promise.resolve([]);
        }),
      },
    } as unknown as typeof chrome;

    const pending = readLoginStates();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({
      'taobao.com': false,
      'github.com': true,
    });
  });
});

describe('buildLoginStatesMessage', () => {
  it('wraps the state map in the extension login message', () => {
    expect(buildLoginStatesMessage({ 'github.com': true })).toEqual({
      type: 'client.extension.login_states',
      states: { 'github.com': true },
    });
  });
});
