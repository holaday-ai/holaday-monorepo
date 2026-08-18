import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  datetime,
  index,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/** User-owned controls for the explainable stock-preference profile. */
export const stockPreferenceProfiles = mysqlTable(
  'stock_preference_profiles',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    manualPreferencesJson: json('manual_preferences_json'),
    /** Evidence at or before this time is excluded without altering the watchlist itself. */
    clearedAt: datetime('cleared_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('uk_stock_preference_profiles_user').on(table.userId)],
);

/** Canonical, privacy-bounded evidence from successful user-confirmed stock actions. */
export const stockPreferenceSignals = mysqlTable(
  'stock_preference_signals',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    dedupeHash: char('dedupe_hash', { length: 64 }).notNull(),
    payloadJson: json('payload_json').notNull(),
    dataAsOf: varchar('data_as_of', { length: 10 }),
    occurredAt: datetime('occurred_at', { mode: 'date', fsp: 3 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_stock_preference_signals_user_hash').on(table.userId, table.dedupeHash),
    index('ix_stock_preference_signals_user_time').on(table.userId, table.occurredAt),
  ],
);

export type StockPreferenceProfile = typeof stockPreferenceProfiles.$inferSelect;
export type NewStockPreferenceProfile = typeof stockPreferenceProfiles.$inferInsert;
export type StockPreferenceSignal = typeof stockPreferenceSignals.$inferSelect;
export type NewStockPreferenceSignal = typeof stockPreferenceSignals.$inferInsert;
