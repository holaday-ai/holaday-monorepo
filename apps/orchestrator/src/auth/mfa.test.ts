import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetMfaKeyCacheForTests,
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  totpAt,
  verifyTotp,
} from './mfa.js';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP', () => {
  it('matches RFC 6238 SHA-1 vectors and accepts at most one adjacent step', () => {
    expect(totpAt(RFC_SECRET, 59_000, 8)).toBe('94287082');
    expect(totpAt(RFC_SECRET, 1_111_111_109_000, 8)).toBe('07081804');

    const now = 1_700_000_000_000;
    const previous = totpAt(RFC_SECRET, now - 30_000);
    expect(verifyTotp(RFC_SECRET, previous, now)).toMatchObject({ valid: true });
    expect(verifyTotp(RFC_SECRET, previous, now, 0)).toEqual({ valid: false });
  });

  it('generates a unique 160-bit Base32 secret', () => {
    const first = generateTotpSecret();
    const second = generateTotpSecret();
    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    expect(second).not.toBe(first);
  });
});

describe('MFA secret storage and recovery codes', () => {
  beforeEach(() => {
    process.env.MFA_MASTER_KEY = randomBytes(32).toString('base64');
    _resetMfaKeyCacheForTests();
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, 'MFA_MASTER_KEY');
    _resetMfaKeyCacheForTests();
  });

  it('encrypts the authenticator secret with authenticated encryption', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptMfaSecret(encrypted)).toBe(secret);
    expect(() => decryptMfaSecret(`${encrypted.slice(0, -2)}aa`)).toThrow();
  });

  it('creates normalized recovery-code material without storing plaintext', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
      const normalized = normalizeRecoveryCode(code.toLowerCase());
      const digest = hashRecoveryCode(code);
      expect(normalized).toMatch(/^[A-Z0-9]{10}$/);
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
      expect(digest).not.toContain(normalized);
    }
  });
});
