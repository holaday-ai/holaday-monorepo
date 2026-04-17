import { sql } from 'drizzle-orm';
import { bigint, datetime, index, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

/**
 * `users` — account.
 * - `external_id` is the outward-facing id (NanoID 21 + prefix `usr_`).
 * - `plan` kept as VARCHAR(32) (not ENUM) so plans can evolve without DDL churn.
 * - Phase 0: no soft delete.
 */
export const users = mysqlTable(
  'users',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    plan: varchar('plan', { length: 32 }).notNull().default('free'),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    displayName: varchar('display_name', { length: 128 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_users_external_id').on(t.externalId),
    uniqueIndex('uk_users_email').on(t.email),
    index('ix_users_plan').on(t.plan),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
