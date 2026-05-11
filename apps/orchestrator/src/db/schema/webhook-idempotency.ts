import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { tasks } from './tasks.js';
import { users } from './users.js';

/**
 * Phase 5d follow-up — `webhook_idempotency`: per-user idempotency
 * keys for the POST /webhooks/tasks endpoint.
 *
 * Why a dedicated table (vs. stuffing into tasks): tasks rows are
 * narrow and the idempotency key is a webhook-only concern. Mixing
 * the two would bloat `tasks` with rarely-read columns + couple two
 * lifecycles. Separate table → independent TTL cleanup, no impact
 * on the hot task path.
 *
 * Lookup contract (Zapier-style):
 *   - Caller sets `Idempotency-Key` header
 *   - Server SHA-256s the request body and stores (user, key, hash, taskId)
 *   - Same key + same hash → return the original taskId/response
 *   - Same key + different hash → 409 idempotency_conflict
 *   - Different key OR missing key → normal flow (no row inserted
 *     when the header is absent — opt-in semantics)
 *
 * 24h `expires_at` so a Zapier task that retries days later doesn't
 * keep reading a stale taskId. Cleanup cron sweeps `expires_at < NOW`
 * every hour.
 */
export const webhookIdempotency = mysqlTable(
  'webhook_idempotency',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    /** SHA-256 hex of the request body. 64 chars. */
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    /** External taskId returned to the original caller. */
    taskId: varchar('task_id', { length: 32 }).notNull(),
    /** JSON snapshot of the original response body for byte-equal replay. */
    responseJson: json('response_json').notNull(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    // Hot path: (user, key) lookup. Unique so the same (user, key)
    // can't ever have two live rows — the second insert collides at
    // the DB layer, which we catch + interpret as "race re-attempted
    // the same idempotency key from two parallel calls".
    uniqueIndex('uk_webhook_idempotency_user_key').on(t.userId, t.idempotencyKey),
    // Cleanup sweep filters by expires_at < NOW.
    index('ix_webhook_idempotency_expires').on(t.expiresAt),
  ],
);

export type WebhookIdempotency = typeof webhookIdempotency.$inferSelect;
export type NewWebhookIdempotency = typeof webhookIdempotency.$inferInsert;

// `tasks` import retained for IDE-cross-reference even though we use
// the external taskId string for the FK-equivalent — webhook callers
// only see external ids, so storing the bigint internal id would
// require an extra lookup on every replay. The denormalised varchar
// is cheaper at read time.
void tasks;
