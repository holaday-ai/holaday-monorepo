import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sessions } from './sessions.js';
import { skills } from './skills.js';
import { users } from './users.js';

/**
 * `tasks` — main Agent Loop tasks.
 * Status machine: pending → planning → executing ↔ awaiting_user ↔ paused
 *                                   → completed / failed / cancelled
 */
export const tasks = mysqlTable(
  'tasks',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: bigint('session_id', { mode: 'number', unsigned: true }).references(
      () => sessions.id,
      { onDelete: 'set null' },
    ),
    skillId: bigint('skill_id', { mode: 'number', unsigned: true }).references(() => skills.id, {
      onDelete: 'set null',
    }),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    /**
     * Populated while status='paused'. One of: user, retries_exhausted,
     * quota_exceeded. Nullable everywhere else.
     */
    pauseReason: varchar('pause_reason', { length: 32 }),
    intent: text('intent').notNull(),
    /**
     * User-renamed display title. When null, the UI falls back to
     * summariseIntent(intent). Stays null on creation — only set when
     * the user explicitly renames via the sidebar context menu.
     */
    title: varchar('title', { length: 255 }),
    plan: json('plan'),
    result: json('result'),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: text('error_message'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 }),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [
    uniqueIndex('uk_tasks_external_id').on(t.externalId),
    index('ix_tasks_user_id_created_at').on(t.userId, t.createdAt),
    index('ix_tasks_status').on(t.status),
    index('ix_tasks_session_id').on(t.sessionId),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
