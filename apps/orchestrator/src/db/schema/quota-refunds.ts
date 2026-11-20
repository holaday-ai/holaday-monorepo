import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  index,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * Quota charged per task at creation (migration 0063). `refundedAt` is set at
 * most once by a conditional UPDATE when the task fails for a platform reason.
 */
export const quotaRefunds = mysqlTable(
  'quota_refunds',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    taskExternalId: varchar('task_external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
    plan: varchar('plan', { length: 16 }).notNull(),
    isOpus: boolean('is_opus').notNull().default(false),
    chargedAt: datetime('charged_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    refundedAt: datetime('refunded_at', { mode: 'date', fsp: 3 }),
    refundReason: varchar('refund_reason', { length: 64 }),
  },
  (t) => [
    uniqueIndex('uk_quota_refunds_task').on(t.taskExternalId),
    index('ix_quota_refunds_pending').on(t.refundedAt, t.chargedAt),
    index('ix_quota_refunds_user').on(t.userId),
  ],
);
