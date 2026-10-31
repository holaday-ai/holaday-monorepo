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
    // Flip one bit of a decoded byte: rewriting the last base64url characters can
    // leave the bytes as they were (the final character's low bits are padding).
    for (const part of [1, 2, 3]) {
      const fields = encrypted.split('.');
      const bytes = Buffer.from(fields[part]!, 'base64url');
      bytes[bytes.length - 1]! ^= 0x01;
      fields[part] = bytes.toString('base64url');
      expect(() => decryptMfaSecret(fields.join('.'))).toThrow();
    }
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
