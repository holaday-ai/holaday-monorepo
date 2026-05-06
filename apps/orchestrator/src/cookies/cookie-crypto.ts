/**
 * Spec B — envelope encryption for `pending_cookies.cookies_json`.
 *
 * Threat model: an attacker who reads the DB at rest (backup leak,
 * SQL-injection read, dump exfiltration) without compromising the
 * orchestrator host. Such an attacker sees ciphertext + IV + auth
 * tag + a wrapped-data-key blob — none useful without the master
 * key, which lives in env on the orchestrator host. An attacker
 * with code execution on the orchestrator can decrypt; that's a
 * separate (much higher) bar and the upgrade path there is KMS.
 *
 * Scheme: per-row AES-256-GCM data key, wrapped with the master
 * key (also AES-256-GCM). Per-row data keys mean compromise of
 * one row's wrapped key never reveals plaintext for other rows.
 *
 *   encrypted_blob   = AES-256-GCM(dataKey, iv_blob, plaintext)
 *   encryption_iv    = iv_blob (12 bytes — GCM standard)
 *   encryption_tag   = authTag from encrypted_blob cipher (16 bytes)
 *   encrypted_key    = [iv_key (12) | tag_key (16) | wrappedDataKey (32)]
 *                      = 60 bytes, where wrappedDataKey is
 *                        AES-256-GCM(masterKey, iv_key, dataKey)
 *
 * `encrypted_key` is a packed buffer instead of three separate
 * columns purely to keep the schema small — wrapping is internal
 * implementation detail that the DB doesn't need to introspect.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm' as const;
const IV_LEN = 12; // GCM recommended
const TAG_LEN = 16;
const KEY_LEN = 32; // AES-256

export interface EncryptedCookieBlob {
  encryptedBlob: Buffer;
  encryptionIv: Buffer;
  encryptionTag: Buffer;
  encryptedKey: Buffer;
}

let cachedMasterKey: Buffer | null = null;

/**
 * Resolve the master key from the COOKIE_MASTER_KEY env var. Cached
 * after first read so we're not paying base64 decode on every
 * encrypt. Throws if absent or wrong size — fail-loud at first use
 * so a misconfigured deploy can't silently store unencrypted
 * payloads under the new code path.
 */
function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;
  const raw = process.env.COOKIE_MASTER_KEY;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'COOKIE_MASTER_KEY is not set. Generate one with `openssl rand -base64 32` and add it to apps/orchestrator/.env',
    );
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw.trim(), 'base64');
  } catch {
    throw new Error('COOKIE_MASTER_KEY is not valid base64');
  }
  if (buf.length !== KEY_LEN) {
    throw new Error(
      `COOKIE_MASTER_KEY must decode to ${KEY_LEN} bytes (got ${buf.length}). Generate with \`openssl rand -base64 32\`.`,
    );
  }
  cachedMasterKey = buf;
  return buf;
}

/**
 * Test-only helper to reset the cached master key. Production code
 * never calls this; tests use it after rotating env vars across
 * cases.
 */
export function _resetMasterKeyCacheForTests(): void {
  cachedMasterKey = null;
}

/**
 * Encrypt a JSON string (the cookies array serialized) into a four-
 * column envelope. Caller is responsible for storing each Buffer to
 * the matching column in `pending_cookies`.
 */
export function encryptCookieJson(plaintext: string): EncryptedCookieBlob {
  const masterKey = getMasterKey();
  const dataKey = randomBytes(KEY_LEN);
  const ivBlob = randomBytes(IV_LEN);
  const blobCipher = createCipheriv(ALGO, dataKey, ivBlob);
  const encryptedBlob = Buffer.concat([
    blobCipher.update(plaintext, 'utf8'),
    blobCipher.final(),
  ]);
  const encryptionTag = blobCipher.getAuthTag();

  const ivKey = randomBytes(IV_LEN);
  const keyCipher = createCipheriv(ALGO, masterKey, ivKey);
  const wrappedDataKey = Buffer.concat([keyCipher.update(dataKey), keyCipher.final()]);
  const tagKey = keyCipher.getAuthTag();
  // Pack [ivKey | tagKey | wrappedDataKey] = 12 + 16 + 32 = 60 bytes.
  const encryptedKey = Buffer.concat([ivKey, tagKey, wrappedDataKey]);

  return {
    encryptedBlob,
    encryptionIv: ivBlob,
    encryptionTag,
    encryptedKey,
  };
}

/**
 * Reverse of `encryptCookieJson`. Throws on auth-tag mismatch
 * (corruption / wrong master key / tampering); caller (sync-service)
 * logs + drops the row in that case rather than serving stale or
 * forged cookies.
 */
export function decryptCookieJson(blob: EncryptedCookieBlob): string {
  const masterKey = getMasterKey();
  if (blob.encryptedKey.length !== IV_LEN + TAG_LEN + KEY_LEN) {
    throw new Error(
      `encrypted_key wrong length: expected ${IV_LEN + TAG_LEN + KEY_LEN}, got ${blob.encryptedKey.length}`,
    );
  }
  const ivKey = blob.encryptedKey.subarray(0, IV_LEN);
  const tagKey = blob.encryptedKey.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const wrappedDataKey = blob.encryptedKey.subarray(IV_LEN + TAG_LEN);
  const keyDecipher = createDecipheriv(ALGO, masterKey, ivKey);
  keyDecipher.setAuthTag(tagKey);
  const dataKey = Buffer.concat([
    keyDecipher.update(wrappedDataKey),
    keyDecipher.final(),
  ]);

  const blobDecipher = createDecipheriv(ALGO, dataKey, blob.encryptionIv);
  blobDecipher.setAuthTag(blob.encryptionTag);
  const plaintext = Buffer.concat([
    blobDecipher.update(blob.encryptedBlob),
    blobDecipher.final(),
  ]).toString('utf8');
  return plaintext;
}
