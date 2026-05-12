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
 * `scheduled_tasks` — user-defined cron-style task triggers.
 *
 * `repeat_type`: 'once' | 'daily' | 'weekly' | 'monthly' | 'custom'.
 * `cron_expression` is only populated for 'custom'; the other repeats
 * are computed from `next_run_at` directly via `calculateNextRun()`.
 *
 * Status machine:
 *   active    → ready for the runner to pick up at next_run_at
 *   running   → claimed by a runner tick (transient; restored to
 *               active/completed/failed at end of dispatch)
 *   paused    → user-paused; runner skips
 *   completed → terminal for repeat_type='once' after a SUCCESSFUL run
 *   failed    → terminal for repeat_type='once' whose single dispatch
 *               threw (Codex P1 follow-up — was previously misclassified
 *               as 'completed', hiding the failure from the user)
 *
 * Recurring runs that fail keep `status='active'` (they get another
 * shot at next_run_at) but record the failure via `last_run_status` +
 * `last_error` so the SPA can surface a red badge + tooltip.
 *
 * `last_task_id` points at the orchestrator-generated task that ran
 * for the latest fire — lets the SPA show "上次运行：tsk_…" with a
 * deep link. Null until the first fire.
 *
 * `last_run_status` is 'success' | 'failed' | NULL (never run yet).
 * `last_error` is a short error message when `last_run_status='failed'`,
 * NULL otherwise.
 */
export const scheduledTasks = mysqlTable(
  'scheduled_tasks',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    intent: text('intent').notNull(),
    repeatType: varchar('repeat_type', { length: 16 }).notNull().default('once'),
    cronExpression: varchar('cron_expression', { length: 100 }),
    nextRunAt: datetime('next_run_at', { mode: 'date', fsp: 3 }).notNull(),
    lastRunAt: datetime('last_run_at', { mode: 'date', fsp: 3 }),
    lastTaskId: bigint('last_task_id', { mode: 'number', unsigned: true }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    /** Codex P1 — outcome of the most recent dispatch attempt.
     *  'success' | 'failed' | null (never run yet). */
    lastRunStatus: varchar('last_run_status', { length: 16 }),
    /** Codex P1 — short error message when last_run_status='failed';
     *  null on success / not-yet-run. */
    lastError: text('last_error'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_scheduled_external_id').on(t.externalId),
    index('ix_scheduled_user_id').on(t.userId),
    index('ix_scheduled_due').on(t.status, t.nextRunAt),
  ],
);

export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type NewScheduledTask = typeof scheduledTasks.$inferInsert;
