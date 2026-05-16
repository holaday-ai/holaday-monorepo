import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/**
 * Phase 25 — `user_site_stats`: per-user browsing-history aggregate
 * uploaded by the Chrome extension.
 *
 * The extension reads `chrome.history.search` for the last 30 days,
 * groups visits by host, and POSTs `{ domain, visit_count, last_visit_at }`
 * tuples to `POST /api/extension/browsing-history`. The orchestrator
 * stores them here so:
 *   - the site-config router can prefer configs for domains the user
 *     actually visits (e.g. taobao.com → load the taobao SiteConfig
 *     ahead of others when an ambiguous URL hits the dispatcher)
 *   - the admin dashboard can summarise per-user browsing weight
 *
 * **Privacy contract** — we ONLY store the host. No full URLs, no
 * page titles, no query strings. Aggregation happens client-side
 * before upload; the wire payload is host + count + lastVisitAt.
 *
 * Index strategy:
 *   - `uk_user_site_stats_user_domain` (unique) — upsert lookup key
 *   - `ix_user_site_stats_user` — per-user list queries
 *
 * `source` is reserved for future provenance ('extension' vs
 * 'task_observed'); only 'extension' is written today, but we keep
 * the column so a future migration doesn't need to ADD it.
 */
export const userSiteStats = mysqlTable(
  'user_site_stats',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    domain: varchar('domain', { length: 253 }).notNull(),
    visitCount: int('visit_count', { unsigned: true }).notNull().default(0),
    lastVisitAt: datetime('last_visit_at', { mode: 'date', fsp: 3 }),
    source: varchar('source', { length: 32 }).notNull().default('extension'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('uk_user_site_stats_user_domain').on(t.userId, t.domain),
    index('ix_user_site_stats_user').on(t.userId),
  ],
);

export type UserSiteStat = typeof userSiteStats.$inferSelect;
export type NewUserSiteStat = typeof userSiteStats.$inferInsert;
