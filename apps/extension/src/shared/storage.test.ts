import { describe, expect, it } from 'vitest';
import { normalizeAccessToken, normalizeStoredUser } from './storage.js';

describe('normalizeAccessToken', () => {
  it('trims valid token strings and rejects empty storage values', () => {
    expect(normalizeAccessToken('  token.value  ')).toBe('token.value');
    expect(normalizeAccessToken('   ')).toBeNull();
    expect(normalizeAccessToken(null)).toBeNull();
    expect(normalizeAccessToken(123)).toBeNull();
  });

  it('treats obvious placeholder strings as invalid tokens', () => {
    expect(normalizeAccessToken('undefined')).toBeNull();
    expect(normalizeAccessToken(' null ')).toBeNull();
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
