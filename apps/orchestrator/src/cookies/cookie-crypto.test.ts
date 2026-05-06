/**
 * Round-trip + tamper detection for the cookie envelope encryption
 * helpers. Master key is set in beforeEach so tests don't depend on
 * the real `.env` and reset the module-level cache between cases.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  _resetMasterKeyCacheForTests,
  decryptCookieJson,
  encryptCookieJson,
} from './cookie-crypto.js';

let prevKey: string | undefined;

beforeEach(() => {
  prevKey = process.env.COOKIE_MASTER_KEY;
  process.env.COOKIE_MASTER_KEY = randomBytes(32).toString('base64');
  _resetMasterKeyCacheForTests();
});

afterEach(() => {
  if (prevKey === undefined) delete process.env.COOKIE_MASTER_KEY;
  else process.env.COOKIE_MASTER_KEY = prevKey;
  _resetMasterKeyCacheForTests();
});

describe('cookie-crypto', () => {
  it('round-trips a typical cookies JSON payload', () => {
    const plaintext = JSON.stringify([
      { domain: '.taobao.com', name: 'session', value: 'abc123', secure: true },
      { domain: 'jd.com', name: 'token', value: 'xyz', httpOnly: true },
    ]);
    const blob = encryptCookieJson(plaintext);
    const decoded = decryptCookieJson(blob);
    expect(decoded).toBe(plaintext);
  });

  it('round-trips an empty array', () => {
    const plaintext = '[]';
    const blob = encryptCookieJson(plaintext);
    expect(decryptCookieJson(blob)).toBe(plaintext);
  });

  it('produces fresh IVs per encrypt — same plaintext yields different ciphertexts', () => {
    const plaintext = '[]';
    const a = encryptCookieJson(plaintext);
    const b = encryptCookieJson(plaintext);
    expect(a.encryptionIv.equals(b.encryptionIv)).toBe(false);
    expect(a.encryptedBlob.equals(b.encryptedBlob)).toBe(false);
    expect(a.encryptedKey.equals(b.encryptedKey)).toBe(false);
  });

  it('rejects a tampered ciphertext (auth tag mismatch)', () => {
    const blob = encryptCookieJson('{"answer":42}');
    // Flip one bit in the ciphertext.
    const tampered = Buffer.from(blob.encryptedBlob);
    tampered[0] ^= 0x01;
    expect(() =>
      decryptCookieJson({ ...blob, encryptedBlob: tampered }),
    ).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const blob = encryptCookieJson('{"answer":42}');
    const tag = Buffer.from(blob.encryptionTag);
    tag[0] ^= 0x01;
    expect(() => decryptCookieJson({ ...blob, encryptionTag: tag })).toThrow();
  });

  it('rejects decrypt with a different master key', () => {
    const blob = encryptCookieJson('{"answer":42}');
    process.env.COOKIE_MASTER_KEY = randomBytes(32).toString('base64');
    _resetMasterKeyCacheForTests();
    expect(() => decryptCookieJson(blob)).toThrow();
  });

  it('throws on missing master key', () => {
    delete process.env.COOKIE_MASTER_KEY;
    _resetMasterKeyCacheForTests();
    expect(() => encryptCookieJson('[]')).toThrow(/COOKIE_MASTER_KEY/);
  });

  it('throws on wrong-sized master key', () => {
    process.env.COOKIE_MASTER_KEY = Buffer.from('too-short').toString('base64');
    _resetMasterKeyCacheForTests();
    expect(() => encryptCookieJson('[]')).toThrow(/32 bytes/);
  });
});
