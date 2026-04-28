import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * `users` — account.
 * - `external_id` is the outward-facing id (NanoID 21 + prefix `usr_`).
 * - `plan` kept as VARCHAR(32) (not ENUM) so plans can evolve without DDL churn.
 * - `password_hash` is empty string for OAuth-only users — bcrypt(``) never
 *   matches anything, so they can't password-login by accident.
 * - Phase 0: no soft delete.
 */
export const users = mysqlTable(
  'users',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    /**
     * Phase 12 — email becomes nullable. SMS-first users have no
     * email until they add one via /profile. MySQL UNIQUE treats
     * multiple NULLs as distinct, so the uk_users_email index stays
     * correct.
     */
    email: varchar('email', { length: 255 }),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    plan: varchar('plan', { length: 32 }).notNull().default('free'),
    planExpiresAt: datetime('plan_expires_at', { mode: 'date', fsp: 3 }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    displayName: varchar('display_name', { length: 128 }),
    googleId: varchar('google_id', { length: 64 }),
    avatarUrl: varchar('avatar_url', { length: 512 }),
    emailVerified: boolean('email_verified').notNull().default(false),
    /** Phase 12 — canonical 11-digit Chinese mobile, no +86 prefix. */
    phone: varchar('phone', { length: 20 }),
    phoneVerified: boolean('phone_verified').notNull().default(false),
    /**
     * Open-pool role ids the Basic-plan user has actively chosen
     * (max 5). Pro plan ignores this — they get all 33 by default.
     * Stored as JSON so future schemas can carry per-pick metadata
     * (last-used, popularity rank) without a migration.
     */
    selectedRoles: json('selected_roles').$type<string[] | null>(),
    /**
     * Number of role-set changes the user has made in the current
     * `roleChangesPeriodStart` month. Resets via app code when
     * `roleChangesPeriodStart` rolls into a new month.
     */
    roleChangesThisMonth: int('role_changes_this_month').notNull().default(0),
    roleChangesPeriodStart: datetime('role_changes_period_start', { mode: 'date', fsp: 3 }),
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
    uniqueIndex('uk_users_google_id').on(t.googleId),
    uniqueIndex('uk_users_phone').on(t.phone),
    index('ix_users_plan').on(t.plan),
    index('ix_users_plan_expires_at').on(t.planExpiresAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
