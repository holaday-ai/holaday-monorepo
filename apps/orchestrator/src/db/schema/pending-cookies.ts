import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  int,
  mysqlTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/**
 * `pending_cookies` — extension-shipped cookies waiting for injection
 * into the user's next allocated Brave instance. One row per user;
 * the sync endpoint upserts on uk_pending_cookies_user_id.
 *
 * The runtime path:
 *   1. Extension POSTs SyncableCookie[] to /api/cookies/sync
 *   2. Endpoint upserts the row, then tries an immediate inject if
 *      a live executor exists
 *   3. If no executor, the row sits here. BrowserPool.allocate calls
 *      injectPendingCookies() which reads + injects + deletes.
 */
export const pendingCookies = mysqlTable(
  'pending_cookies',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * JSON-encoded SyncableCookie[]. Stored as mediumtext (16 MB
     * cap) but typical payloads are tens of KB.
     */
    cookiesJson: text('cookies_json').notNull(),
    cookieCount: int('cookie_count', { unsigned: true }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('uk_pending_cookies_user_id').on(t.userId)],
);

export type PendingCookies = typeof pendingCookies.$inferSelect;
export type NewPendingCookies = typeof pendingCookies.$inferInsert;
