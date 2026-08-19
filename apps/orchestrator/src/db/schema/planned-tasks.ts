import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { batchTasks } from './batch-tasks.js';
import { tasks } from './tasks.js';
import { users } from './users.js';

export const plannedTasks = mysqlTable(
  'planned_tasks',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    instruction: text('instruction').notNull(),
    notes: text('notes'),
    scope: varchar('scope', { length: 16 }).notNull().default('single'),
    repeatType: varchar('repeat_type', { length: 16 }).notNull().default('once'),
    rrule: varchar('rrule', { length: 255 }),
    firstRunAt: datetime('first_run_at', { mode: 'date', fsp: 3 }).notNull(),
    endsAt: datetime('ends_at', { mode: 'date', fsp: 3 }),
    nextRunAt: datetime('next_run_at', { mode: 'date', fsp: 3 }),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Shanghai'),
    reminderMinutes: int('reminder_minutes', { unsigned: true }),
    lastReminderRun: datetime('last_reminder_run', { mode: 'date', fsp: 3 }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    itemCount: int('item_count', { unsigned: true }).notNull().default(1),
    lastRunAt: datetime('last_run_at', { mode: 'date', fsp: 3 }),
    lastRunStatus: varchar('last_run_status', { length: 24 }),
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
    uniqueIndex('uk_planned_tasks_external_id').on(t.externalId),
    index('ix_planned_tasks_user_status').on(t.userId, t.status),
    index('ix_planned_tasks_due').on(t.status, t.nextRunAt),
  ],
);

export const plannedTaskItems = mysqlTable(
  'planned_task_items',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    plannedTaskId: bigint('planned_task_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => plannedTasks.id, { onDelete: 'cascade' }),
    seq: int('seq', { unsigned: true }).notNull(),
    instruction: text('instruction').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_planned_items_external_id').on(t.externalId),
    uniqueIndex('uk_planned_items_plan_seq').on(t.plannedTaskId, t.seq),
    index('ix_planned_items_plan').on(t.plannedTaskId),
  ],
);

export const plannedTaskOccurrenceOverrides = mysqlTable(
  'planned_task_occurrence_overrides',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    plannedTaskId: bigint('planned_task_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => plannedTasks.id, { onDelete: 'cascade' }),
    originalScheduledFor: datetime('original_scheduled_for', { mode: 'date', fsp: 3 }).notNull(),
    action: varchar('action', { length: 16 }).notNull(),
    scheduledFor: datetime('scheduled_for', { mode: 'date', fsp: 3 }),
    instruction: text('instruction'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_planned_override_external_id').on(t.externalId),
    uniqueIndex('uk_planned_override_occurrence').on(t.plannedTaskId, t.originalScheduledFor),
    index('ix_planned_override_scheduled').on(t.scheduledFor),
  ],
);

export const plannedTaskRuns = mysqlTable(
  'planned_task_runs',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    plannedTaskId: bigint('planned_task_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => plannedTasks.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    scheduledFor: datetime('scheduled_for', { mode: 'date', fsp: 3 }).notNull(),
    seriesScheduledFor: datetime('series_scheduled_for', { mode: 'date', fsp: 3 }).notNull(),
    trigger: varchar('trigger', { length: 16 }).notNull().default('scheduled'),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    taskId: bigint('task_id', { mode: 'number', unsigned: true }).references(() => tasks.id, {
      onDelete: 'set null',
    }),
    batchTaskId: bigint('batch_task_id', { mode: 'number', unsigned: true }).references(
      () => batchTasks.id,
      { onDelete: 'set null' },
    ),
    itemsTotal: int('items_total', { unsigned: true }).notNull().default(1),
    itemsDone: int('items_done', { unsigned: true }).notNull().default(0),
    itemsReview: int('items_review', { unsigned: true }).notNull().default(0),
    itemsFailed: int('items_failed', { unsigned: true }).notNull().default(0),
    errorMessage: text('error_message'),
    resultJson: json('result_json'),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 }),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('uk_planned_runs_external_id').on(t.externalId),
    uniqueIndex('uk_planned_runs_occurrence').on(
      t.plannedTaskId,
      t.seriesScheduledFor,
      t.trigger,
    ),
    index('ix_planned_runs_plan_created').on(t.plannedTaskId, t.createdAt),
    index('ix_planned_runs_status').on(t.status),
    index('ix_planned_runs_task').on(t.taskId),
    index('ix_planned_runs_batch').on(t.batchTaskId),
  ],
);

export const plannedTaskRunItems = mysqlTable(
  'planned_task_run_items',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    plannedTaskRunId: bigint('planned_task_run_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => plannedTaskRuns.id, { onDelete: 'cascade' }),
    plannedTaskItemId: bigint('planned_task_item_id', { mode: 'number', unsigned: true }).references(
      () => plannedTaskItems.id,
      { onDelete: 'set null' },
    ),
    seq: int('seq', { unsigned: true }).notNull(),
    instruction: text('instruction').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    taskId: bigint('task_id', { mode: 'number', unsigned: true }).references(() => tasks.id, {
      onDelete: 'set null',
    }),
    errorMessage: text('error_message'),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('uk_planned_run_items_external_id').on(t.externalId),
    uniqueIndex('uk_planned_run_items_run_seq').on(t.plannedTaskRunId, t.seq),
    index('ix_planned_run_items_task').on(t.taskId),
  ],
);

export type PlannedTask = typeof plannedTasks.$inferSelect;
export type PlannedTaskItem = typeof plannedTaskItems.$inferSelect;
export type PlannedTaskOccurrenceOverride = typeof plannedTaskOccurrenceOverrides.$inferSelect;
export type PlannedTaskRun = typeof plannedTaskRuns.$inferSelect;
export type PlannedTaskRunItem = typeof plannedTaskRunItems.$inferSelect;
