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
import { users } from './users.js';

/**
 * Last real A-share dashboard snapshot per user/watchlist signature.
 *
 * This is a display cache, not an analytics source of truth. It exists so
 * AkShare minute/quote outages or an orchestrator restart do not replace a
 * previously verified intraday chart with an empty state.
 */
export const stockDashboardSnapshots = mysqlTable(
  'stock_dashboard_snapshots',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cacheKeyHash: varchar('cache_key_hash', { length: 64 }).notNull(),
    snapshotJson: json('snapshot_json').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_stock_dashboard_snapshots_user_key').on(t.userId, t.cacheKeyHash),
    index('ix_stock_dashboard_snapshots_user').on(t.userId),
  ],
);

export type StockDashboardSnapshot = typeof stockDashboardSnapshots.$inferSelect;
export type NewStockDashboardSnapshot = typeof stockDashboardSnapshots.$inferInsert;
