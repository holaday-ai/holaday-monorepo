import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/**
 * `execution_memory` — cross-task memory bank.
 *
 * After a task completes the agent extracts long-term-valuable
 * facts (preferences, site state, useful tips) and stores them
 * here keyed by user. On subsequent task starts a relevance match
 * picks the top few entries to inject into the user message so the
 * agent benefits from accumulated context.
 *
 * Categories (varchar not enum so future ones don't need DDL):
 *   'preference'    — user habits / settings ("prefers JD over Tmall")
 *   'site_state'    — site-specific tips ("Taobao requires login for prices")
 *   'task_history'  — useful one-off recall ("upgraded to Pro on 2026-04-12")
 *   'execution_tip' — generic "next time, do X" notes
 *
 * Composite uniqueness on (user_id, category, key_name) lets the
 * upsert path freely re-store the same key with an updated value.
 * `expires_at` is per-row so the model can pick a sensible TTL when
 * extracting (e.g. "valid for 30 days" for site_state, NULL for
 * preference).
 */
export const executionMemory = mysqlTable(
  'execution_memory',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: varchar('category', { length: 32 }).notNull(),
    keyName: varchar('key_name', { length: 255 }).notNull(),
    value: text('value').notNull(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_execution_memory_external_id').on(t.externalId),
    uniqueIndex('uk_execution_memory_user_key').on(t.userId, t.category, t.keyName),
    index('ix_execution_memory_user_category').on(t.userId, t.category),
    index('ix_execution_memory_expires').on(t.expiresAt),
  ],
);

export type ExecutionMemory = typeof executionMemory.$inferSelect;
export type NewExecutionMemory = typeof executionMemory.$inferInsert;
