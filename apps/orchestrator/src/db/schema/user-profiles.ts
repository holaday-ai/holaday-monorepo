import { sql } from 'drizzle-orm';
import { bigint, datetime, json, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/**
 * `user_profiles` — 职业指纹。
 * - `occupation_raw`: user-typed free text.
 * - `occupation_canonical`: matched against the canonical list (VARCHAR for schema stability).
 * - `fingerprint`: JSON blob with tools/scenarios/preferences harvested from onboarding.
 */
export const userProfiles = mysqlTable(
  'user_profiles',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    occupationRaw: varchar('occupation_raw', { length: 255 }).notNull(),
    occupationCanonical: varchar('occupation_canonical', { length: 64 }),
    locale: varchar('locale', { length: 16 }).notNull().default('zh-CN'),
    fingerprint: json('fingerprint'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_user_profiles_external_id').on(t.externalId),
    uniqueIndex('uk_user_profiles_user_id').on(t.userId),
  ],
);

export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
