import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  int,
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
 * `last_run_status` is 'success' | 'failed' | 'skipped' | NULL (never run yet).
 * `last_error` is a short error/skip note when `last_run_status='failed'`
 * or 'skipped', NULL otherwise.
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
     *  'success' | 'failed' | 'skipped' | null (never run yet). */
    lastRunStatus: varchar('last_run_status', { length: 16 }),
    /** Codex P1 — short error/skip note when last_run_status='failed' or 'skipped';
     *  null on success / not-yet-run. */
    lastError: text('last_error'),
    /**
     * Phase 26A — RFC 5545 RRULE for advanced recurrence (custom
     * cron-style patterns the legacy `repeat_type` enum can't
     * express, e.g. 'FREQ=WEEKLY;BYDAY=MO,WE,FR'). When NON-NULL the
     * runner ignores `repeat_type` and computes next_run_at by
     * expanding the rrule. When NULL the legacy enum-driven path
     * runs unchanged. The FullCalendar UI also reads this to render
     * recurring events natively via @fullcalendar/rrule.
     */
    rrule: varchar('rrule', { length: 255 }),
    /**
     * Phase 26A — visual duration in calendar grid (week / day views).
     * Doesn't affect dispatch — a task fires at next_run_at regardless.
     * Defaults to 30 minutes; users can resize via eventResize handles
     * in the TimeGrid views.
     */
    durationMinutes: int('duration_minutes', { unsigned: true }).notNull().default(30),
    /**
     * Phase 26A — IANA timezone for rrule expansion across DST
     * transitions. Defaults to 'Asia/Shanghai' (primary user base).
     * Required for "every weekday 9am local" semantics — UTC alone
     * would drift across spring/fall clock changes.
     */
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Shanghai'),
    /**
     * Phase 26B polish — optional human-readable annotation. Shown
     * in the event-detail popover but never passed to the agent's
     * dispatch path (the agent only sees `intent`). Lets users tag
     * a recurring task with context ("产品同事每周看的报告") without
     * polluting the prompt.
     */
    description: text('description'),
    /**
     * Phase 26B follow-up — reminder lead time. NULL = no reminder.
     * 0 = fire reminder at execution time. Positive integer = fire
     * that many minutes before next_run_at. The runner's reminder
     * scan + the notify hook with type='task_reminder' handle
     * dispatch.
     */
    reminderMinutes: int('reminder_minutes', { unsigned: true }),
    /**
     * Phase 26B follow-up — records the `next_run_at` value of the
     * cycle whose reminder we've already fired. Compared against
     * current next_run_at to prevent double-fire within one cycle.
     * Stays at NULL until the first reminder fires.
     */
    lastReminderRun: datetime('last_reminder_run', { mode: 'date', fsp: 3 }),
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
