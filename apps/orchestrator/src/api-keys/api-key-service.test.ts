/**
 * Phase 5d — API key service unit tests.
 *
 * Covers the pure-logic surface: key generation shape, deterministic
 * hashing, shape validation (prefix + length + hex), bearer extraction.
 * DB-layer + webhook integration are exercised by the api-keys-router
 * test + webhook-route test respectively.
 */

import { describe, expect, it } from 'vitest';
import {
  API_KEY_PREFIX,
  DISPLAY_PREFIX_LENGTH,
  extractBearer,
  generateApiKey,
  hashApiKey,
  isValidApiKeyShape,
} from './api-key-service.js';

describe('generateApiKey', () => {
  it('plaintext has the hd_live_ prefix', () => {
    const k = generateApiKey();
    expect(k.plaintext.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it('plaintext is 32 chars total (prefix + 24 hex)', () => {
    const k = generateApiKey();
    expect(k.plaintext.length).toBe(API_KEY_PREFIX.length + 24);
  });

  it('displayPrefix is hd_live_ + 4 random chars', () => {
    const k = generateApiKey();
    expect(k.displayPrefix.length).toBe(DISPLAY_PREFIX_LENGTH);
    expect(k.displayPrefix.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(k.plaintext.startsWith(k.displayPrefix)).toBe(true);
  });

  it('hash is sha256-hex (64 lowercase hex chars)', () => {
    const k = generateApiKey();
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two consecutive calls produce different plaintexts (entropy is real)', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('hashApiKey', () => {
  it('deterministic — same input → same hash', () => {
    expect(hashApiKey('hd_live_abc')).toBe(hashApiKey('hd_live_abc'));
  });

  it('different inputs → different hashes', () => {
    expect(hashApiKey('hd_live_abc')).not.toBe(hashApiKey('hd_live_abd'));
  });

  it('hash of a generated key matches the bundled hash field', () => {
    const k = generateApiKey();
    expect(hashApiKey(k.plaintext)).toBe(k.hash);
  });
});

describe('isValidApiKeyShape', () => {
  it('accepts a freshly-generated key', () => {
    const k = generateApiKey();
    expect(isValidApiKeyShape(k.plaintext)).toBe(true);
  });

  it('rejects empty / non-string', () => {
    expect(isValidApiKeyShape('')).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isValidApiKeyShape(null as any)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isValidApiKeyShape(undefined as any)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isValidApiKeyShape(123 as any)).toBe(false);
  });

  it('rejects wrong prefix', () => {
    expect(isValidApiKeyShape('hd_test_' + '0'.repeat(24))).toBe(false);
    expect(isValidApiKeyShape('sk_live_' + '0'.repeat(24))).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidApiKeyShape('hd_live_short')).toBe(false);
    expect(isValidApiKeyShape('hd_live_' + '0'.repeat(40))).toBe(false);
  });

  it('rejects non-hex tail (uppercase / non-hex chars)', () => {
    expect(isValidApiKeyShape('hd_live_' + 'g'.repeat(24))).toBe(false);
    expect(isValidApiKeyShape('hd_live_' + 'A'.repeat(24))).toBe(false);
  });
});

describe('extractBearer', () => {
  it('extracts the token after "Bearer "', () => {
    expect(extractBearer('Bearer hd_live_abc')).toBe('hd_live_abc');
  });

  it('case-insensitive scheme match', () => {
    expect(extractBearer('bearer hd_live_abc')).toBe('hd_live_abc');
    expect(extractBearer('BEARER hd_live_abc')).toBe('hd_live_abc');
  });

  it('tolerates multiple spaces between scheme and token', () => {
    expect(extractBearer('Bearer   hd_live_abc')).toBe('hd_live_abc');
  });

  it('returns null on missing header', () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer(null)).toBeNull();
    expect(extractBearer('')).toBeNull();
  });

  it('returns null on non-Bearer scheme', () => {
    expect(extractBearer('Basic abc:def')).toBeNull();
    expect(extractBearer('hd_live_abc')).toBeNull(); // missing scheme
  });

  it('returns null when scheme has no token', () => {
    expect(extractBearer('Bearer')).toBeNull();
    expect(extractBearer('Bearer ')).toBeNull();
  });
});
