import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAccessToken,
  clearStoredUser,
  getAccessToken,
  getStoredUser,
  normalizeAccessToken,
  normalizeStoredUser,
  setAccessToken,
  setStoredUser,
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

  it('trims and bounds stored user text fields', () => {
    const normalized = normalizeStoredUser({
      externalId: ` user_${'x'.repeat(200)} `,
      email: ` ${'e'.repeat(400)}@example.com `,
      plan: ` ${'p'.repeat(100)} `,
      displayName: ` ${'n'.repeat(220)} `,
    });

    expect(normalized?.externalId).toHaveLength(128);
    expect(normalized?.email).toHaveLength(320);
    expect(normalized?.plan).toHaveLength(64);
    expect(normalized?.displayName).toHaveLength(160);
    expect(normalized?.externalId.startsWith('user_')).toBe(true);
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

describe('storage writes', () => {
  it('bounds token writes that hang', async () => {
    vi.useFakeTimers();
    globalThis.chrome = {
      storage: {
        local: {
          set: vi.fn(() => new Promise(() => undefined)),
        },
      },
    } as unknown as typeof chrome;

    const pending = setAccessToken('token.value');
    const assertion = expect(pending).rejects.toThrow('storage_token_write_timeout');
    await vi.advanceTimersByTimeAsync(1_500);

    await assertion;
  });

  it('bounds token removals that hang', async () => {
    vi.useFakeTimers();
    globalThis.chrome = {
      storage: {
        local: {
          remove: vi.fn(() => new Promise(() => undefined)),
        },
      },
    } as unknown as typeof chrome;

    const pending = clearAccessToken();
    const assertion = expect(pending).rejects.toThrow('storage_token_remove_timeout');
    await vi.advanceTimersByTimeAsync(1_500);

    await assertion;
  });

  it('bounds user writes that hang', async () => {
    vi.useFakeTimers();
    globalThis.chrome = {
      storage: {
        local: {
          set: vi.fn(() => new Promise(() => undefined)),
        },
      },
    } as unknown as typeof chrome;

    const pending = setStoredUser({
      externalId: 'user_1',
      email: 'person@example.com',
      plan: 'basic',
    });
    const assertion = expect(pending).rejects.toThrow('storage_user_write_timeout');
    await vi.advanceTimersByTimeAsync(1_500);

    await assertion;
  });

  it('normalizes user records before writing them', async () => {
    const set = vi.fn(async () => undefined);
    globalThis.chrome = {
      storage: {
        local: {
          set,
        },
      },
    } as unknown as typeof chrome;

    await setStoredUser({
      externalId: ' user_1 ',
      email: ' person@example.com ',
      plan: ' basic ',
      displayName: ' Person ',
    });

    expect(set).toHaveBeenCalledWith({
      'holaday.user': {
        externalId: 'user_1',
        email: 'person@example.com',
        plan: 'basic',
        displayName: 'Person',
      },
    });
  });

  it('bounds user removals that hang', async () => {
    vi.useFakeTimers();
    globalThis.chrome = {
      storage: {
        local: {
          remove: vi.fn(() => new Promise(() => undefined)),
        },
      },
    } as unknown as typeof chrome;

    const pending = clearStoredUser();
    const assertion = expect(pending).rejects.toThrow('storage_user_remove_timeout');
    await vi.advanceTimersByTimeAsync(1_500);

    await assertion;
  });
});
