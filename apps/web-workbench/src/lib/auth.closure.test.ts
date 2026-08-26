// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  window.history.replaceState(null, '', '/login');
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('closure recovery credential storage', () => {
  it('keeps recovery credentials in sessionStorage and makes auth modes mutually exclusive', async () => {
    const auth = await import('./auth.js');

    auth.setAccessToken('normal-access-token');
    expect(localStorage.getItem('holaday.access_token')).toBe('normal-access-token');

    auth.setMfaChallenge('mfa-challenge-token');
    expect(auth.getAccessToken()).toBeNull();
    expect(sessionStorage.getItem('holaday.mfa_challenge')).toBe('mfa-challenge-token');

    auth.setClosureRecovery('closure-recovery-token');
    expect(auth.getClosureRecovery()).toBe('closure-recovery-token');
    expect(auth.getAccessToken()).toBeNull();
    expect(auth.getMfaChallenge()).toBeNull();
    expect(sessionStorage.getItem('holaday.closure_recovery')).toBe('closure-recovery-token');
    expect(localStorage.getItem('holaday.closure_recovery')).toBeNull();

    auth.setAccessToken('new-normal-access-token');
    expect(auth.getClosureRecovery()).toBeNull();
    expect(auth.getMfaChallenge()).toBeNull();
  });

  it('consumes a Google closure fragment into sessionStorage and scrubs the URL', async () => {
    window.history.replaceState(null, '', '/login#closure=fragment-recovery-token');

    const auth = await import('./auth.js');

    expect(sessionStorage.getItem('holaday.closure_recovery')).toBe('fragment-recovery-token');
    expect(auth.getClosureRecovery()).toBe('fragment-recovery-token');
    expect(auth.getAccessToken()).toBeNull();
    expect(auth.getMfaChallenge()).toBeNull();
    expect(window.location.hash).toBe('');
    expect(localStorage.getItem('holaday.closure_recovery')).toBeNull();
  });
});
