import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAccessToken,
  getStoredUser,
  normalizeAccessToken,
  normalizeStoredUser,
} from './storage.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

describe('normalizeAccessToken', () => {
  it('trims valid token strings and rejects empty storage values', () => {
    expect(normalizeAccessToken('  token.value  ')).toBe('token.value');
    expect(normalizeAccessToken('   ')).toBeNull();
    expect(normalizeAccessToken(null)).toBeNull();
    expect(normalizeAccessToken(123)).toBeNull();
  });

  it('treats obvious placeholder strings as invalid tokens', () => {
    expect(normalizeAccessToken('undefined')).toBeNull();
    expect(normalizeAccessToken(' Undefined ')).toBeNull();
    expect(normalizeAccessToken(' null ')).toBeNull();
    expect(normalizeAccessToken(' NULL ')).toBeNull();
  });
});

describe('normalizeStoredUser', () => {
  it('keeps valid stored user records', () => {
    expect(
      normalizeStoredUser({
        externalId: 'user_1',
        email: 'person@example.com',
        plan: 'basic',
        displayName: 'Person',
      }),
    ).toEqual({
      externalId: 'user_1',
      email: 'person@example.com',
      plan: 'basic',
      displayName: 'Person',
    });
  });

  it('rejects malformed records from chrome storage', () => {
    expect(normalizeStoredUser(null)).toBeNull();
    expect(normalizeStoredUser({ email: 'person@example.com', plan: 'basic' })).toBeNull();
    expect(
      normalizeStoredUser({ externalId: 'user_1', email: '', plan: 'basic' }),
    ).toBeNull();
    expect(
      normalizeStoredUser({ externalId: 'user_1', email: 'person@example.com', plan: 123 }),
    ).toBeNull();
  });

  it('drops malformed display names without rejecting the user', () => {
    expect(
      normalizeStoredUser({
        externalId: 'user_1',
        email: 'person@example.com',
        plan: 'basic',
        displayName: { bad: true },
      }),
    ).toEqual({
      externalId: 'user_1',
      email: 'person@example.com',
      plan: 'basic',
    });
  });
});

describe('storage reads', () => {
  it('returns null when token storage read hangs', async () => {
    vi.useFakeTimers();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(() => new Promise(() => undefined)),
        },
      },
    } as unknown as typeof chrome;

    const pending = getAccessToken();
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toBeNull();
  });

  it('returns null when user storage read hangs', async () => {
    vi.useFakeTimers();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(() => new Promise(() => undefined)),
        },
      },
    } as unknown as typeof chrome;

    const pending = getStoredUser();
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toBeNull();
  });
});
