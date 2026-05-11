import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/**
 * Phase 5d — `api_keys`: user-scoped bearer tokens for webhook /
 * external-trigger access. The webhook endpoint (POST /api/webhooks/
 * tasks) reads `Authorization: Bearer hd_live_<...>`, hashes it, and
 * looks up by `key_hash`. We never store the plaintext key — only:
 *
 *   key_prefix    first 12 chars (`hd_live_xxxx`) for SPA display.
 *                 Knowing the prefix doesn't help an attacker without
 *                 the full key (the remaining 24 hex chars are random).
 *   key_hash      SHA-256 of the full key, hex-encoded. Webhook does
 *                 the same hash and matches.
 *
 * Lifecycle:
 *   - create   plaintext returned ONCE to the caller, never persisted
 *   - revoke   sets `revoked_at`; row stays for audit but lookups fail
 *   - expires  optional `expires_at`; null = never expires
 *
 * Index strategy:
 *   - `uk_api_keys_hash` (unique) — primary webhook lookup path
 *   - `ix_api_keys_user` — settings page lists a user's keys
 *
 * The plaintext key is composed as `hd_live_` + 24 hex chars (12 bytes
 * of randomness from crypto.randomBytes). 96 bits of entropy is more
 * than enough for a non-rotated bearer; if we add an `hd_test_` tier
 * later it shares the same shape.
 */
export const apiKeys = mysqlTable(
  'api_keys',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    lastUsedAt: datetime('last_used_at', { mode: 'date', fsp: 3 }),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }),
    revokedAt: datetime('revoked_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('uk_api_keys_external_id').on(t.externalId),
    uniqueIndex('uk_api_keys_hash').on(t.keyHash),
    index('ix_api_keys_user').on(t.userId),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
