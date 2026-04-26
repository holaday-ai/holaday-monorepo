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
 * `task_quotas` — per-(user, period) consumption counters.
 *
 * One row per (user_id, period_start). Period is 'day' for free
 * users (UTC midnight boundaries) or 'month' for paid (UTC first of
 * month). The unique key is (user_id, period_start) so we never
 * accidentally race two rows into the same period.
 *
 * Counters split into used vs. bonus so we can show the user "you've
 * burned 12/100 + 8 bonus":
 *   - tasks_used: regular monthly/daily allowance consumed
 *   - opus_used:  pro-only Opus sub-quota consumed
 *   - bonus_tasks / bonus_opus: gifts (firstMonthBonus) and add-on
 *                               purchases. Consumed BEFORE regular —
 *                               see QuotaService.tryConsume.
 */
export const taskQuotas = mysqlTable(
  'task_quotas',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    period: varchar('period', { length: 8 }).notNull(),
    periodStart: datetime('period_start', { mode: 'date', fsp: 3 }).notNull(),
    periodEnd: datetime('period_end', { mode: 'date', fsp: 3 }).notNull(),
    tasksUsed: int('tasks_used', { unsigned: true }).notNull().default(0),
    opusUsed: int('opus_used', { unsigned: true }).notNull().default(0),
    bonusTasks: int('bonus_tasks', { unsigned: true }).notNull().default(0),
    bonusOpus: int('bonus_opus', { unsigned: true }).notNull().default(0),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_task_quotas_user_period').on(t.userId, t.periodStart),
    index('ix_task_quotas_user_active').on(t.userId, t.periodEnd),
  ],
);

export type TaskQuota = typeof taskQuotas.$inferSelect;
export type NewTaskQuota = typeof taskQuotas.$inferInsert;
