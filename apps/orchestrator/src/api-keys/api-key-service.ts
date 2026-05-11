/**
 * Phase 5d — API key service.
 *
 * Plaintext format:  `hd_live_<24 hex chars>` (12 bytes of crypto.
 *                     randomBytes, hex-encoded). 96 bits of entropy.
 * Hash format:        SHA-256 of the plaintext, hex-encoded (64 chars).
 * Display prefix:     `hd_live_xxxx` (first 12 chars) — kept on the row
 *                     for the SPA's "Your keys" list. Knowing the
 *                     prefix doesn't help an attacker without the
 *                     remaining 20 hex chars.
 *
 * Invariants:
 *   - Plaintext is returned ONCE on create (and never persisted)
 *   - All lookups are by SHA-256 hash (constant-time matching via
 *     the DB unique index)
 *   - Revoked keys still match by hash but are filtered out via
 *     `revoked_at IS NULL` in the lookup query
 *
 * Token prefix `hd_live_` is intentional — leaves room for `hd_test_`
 * if we ever add a sandbox tier; the prefix is stored on the row so
 * a future migration to per-tier behaviour is just a varchar update.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const API_KEY_PREFIX = 'hd_live_';
const RANDOM_BYTES = 12; // 24 hex chars
const PLAINTEXT_LENGTH = API_KEY_PREFIX.length + RANDOM_BYTES * 2;
/** Display prefix length: `hd_live_` + 4 chars of randomness. */
export const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 4;

export interface GeneratedKey {
  /** Plaintext — return to the caller ONCE; never persist. */
  plaintext: string;
  /** First 12 chars; safe to persist + display. */
  displayPrefix: string;
  /** SHA-256 hex; persist as `key_hash`. */
  hash: string;
}

/**
 * Generate a fresh API key. Crypto-strong randomness; the resulting
 * plaintext is the ONLY copy of the key — caller MUST surface it to
 * the user immediately and not re-display.
 */
export function generateApiKey(): GeneratedKey {
  const random = randomBytes(RANDOM_BYTES).toString('hex');
  const plaintext = `${API_KEY_PREFIX}${random}`;
  const displayPrefix = plaintext.slice(0, DISPLAY_PREFIX_LENGTH);
  const hash = hashApiKey(plaintext);
  return { plaintext, displayPrefix, hash };
}

/**
 * Compute the storage hash for a plaintext key. Pure (deterministic),
 * no side effects — same input always yields same output, so the DB
 * lookup is a direct index hit.
 */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Shape-check a bearer string. Rejects empty, wrong-prefix, wrong-
 * length values BEFORE we hit the DB so a flood of malformed bearers
 * doesn't fan out into useless queries. Constant-time string compare
 * on the prefix to avoid leaking "prefix is right" via timing.
 */
export function isValidApiKeyShape(plaintext: string): boolean {
  if (typeof plaintext !== 'string') return false;
  if (plaintext.length !== PLAINTEXT_LENGTH) return false;
  // Constant-time prefix check. Both strings are short + same length,
  // so timingSafeEqual is safe here without padding tricks.
  const a = Buffer.from(plaintext.slice(0, API_KEY_PREFIX.length));
  const b = Buffer.from(API_KEY_PREFIX);
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  // Tail must be lowercase hex.
  return /^[0-9a-f]+$/.test(plaintext.slice(API_KEY_PREFIX.length));
}

/**
 * Pull the bearer token out of an Authorization header. Returns
 * null for missing / non-bearer / no-token shapes. We do NOT trim
 * inner whitespace — the bearer is supposed to be one token after
 * the scheme, anything else is malformed and bounces.
 */
export function extractBearer(authorizationHeader: string | undefined | null): string | null {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') return null;
  const trimmed = authorizationHeader.trim();
  // Case-insensitive 'Bearer ' prefix; what follows is the token.
  const match = /^Bearer\s+(\S+)\s*$/i.exec(trimmed);
  if (!match) return null;
  return match[1] ?? null;
}
