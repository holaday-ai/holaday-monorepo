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
 * `sessions` — extension WebSocket session.
 * One session per extension install; it manages all tabs the extension controls.
 * `last_seen_at` advances on every ping; reaper drops sessions idle > 5×heartbeat.
 */
export const sessions = mysqlTable(
  'sessions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    extensionVersion: varchar('extension_version', { length: 32 }),
    userAgent: varchar('user_agent', { length: 512 }),
    status: varchar('status', { length: 16 }).notNull().default('connected'),
    meta: json('meta'),
    connectedAt: datetime('connected_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    lastSeenAt: datetime('last_seen_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    disconnectedAt: datetime('disconnected_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [
    uniqueIndex('uk_sessions_external_id').on(t.externalId),
    index('ix_sessions_user_id_status').on(t.userId, t.status),
    index('ix_sessions_last_seen_at').on(t.lastSeenAt),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
