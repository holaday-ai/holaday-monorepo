import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * `payments` — one row per checkout attempt.
 *
 * Money stored as `amount_cents` (unsigned int) instead of DECIMAL —
 * floating-point math on plan upgrades isn't worth the headache and
 * USD/CNY both fit comfortably in 32-bit cents up to $42M.
 *
 * `status` lifecycle:
 *   pending   → created an order, waiting for capture / webhook
 *   completed → payment captured, plan upgraded
 *   failed    → user abandoned, gateway declined, or webhook said no
 *   refunded  → manual or gateway refund applied
 *
 * `metadata` keeps gateway-specific blobs (full PayPal capture, WeChat
 * notify body, etc.) so we can investigate disputes without a separate
 * audit table.
 */
export const payments = mysqlTable(
  'payments',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userExternalId: varchar('user_external_id', { length: 32 }).notNull(),
    provider: varchar('provider', { length: 16 }).notNull(),
    providerOrderId: varchar('provider_order_id', { length: 128 }),
    providerCaptureId: varchar('provider_capture_id', { length: 128 }),
    plan: varchar('plan', { length: 32 }).notNull(),
    /**
     * What this payment buys. 'subscription' (default; matches the
     * 0006 behaviour) extends `users.plan_expires_at` on capture.
     * 'addon' tops up the active `task_quotas.bonus_tasks` /
     * `bonus_opus` instead. The same `plan` column carries either a
     * plan id ('basic'/'pro') or an addon pack id ('pack-20', …);
     * `kind` is the discriminator.
     */
    kind: varchar('kind', { length: 16 }).notNull().default('subscription'),
    amountCents: int('amount_cents', { unsigned: true }).notNull(),
    currency: varchar('currency', { length: 8 }).notNull().default('USD'),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    metadata: json('metadata'),
    /**
     * Immutable settlement timestamp. Set exactly when a pending row
     * transitions to completed; unlike updatedAt it never moves when
     * metadata or another operational field changes later.
     */
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_payments_external_id').on(t.externalId),
    index('ix_payments_user_status').on(t.userExternalId, t.status),
    index('ix_payments_status_completed').on(t.status, t.completedAt),
    index('ix_payments_provider_order').on(t.provider, t.providerOrderId),
    // Race-safe idempotency for capture writes — both PayPal's
    // capture id and the WX/Alipay transactionId land in
    // provider_capture_id. MySQL allows multiple NULLs in a UNIQUE
    // index, so pending rows (capture id still NULL) don't fight.
    // Only completed/failed captures collide, which is exactly the
    // case we want to dedupe on retries.
    uniqueIndex('uk_payments_provider_capture').on(t.provider, t.providerCaptureId),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
