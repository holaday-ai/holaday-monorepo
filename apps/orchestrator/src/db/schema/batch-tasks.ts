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
import { tasks } from './tasks.js';
import { users } from './users.js';

/**
 * Phase 5b — `batch_tasks`: a user-defined group of tasks to run
 * together. Status machine:
 *   pending   → just created, executor hasn't started yet
 *   running   → at least one item dispatched
 *   completed → every item finished status='completed'
 *   partial   → all items settled, some failed, cancelled, or need review
 *   cancelled → user pressed cancel; remaining items skipped, already-
 *               dispatched ones continue to their natural terminal
 *
 * `concurrency` is captured at create time from the user's plan
 * (Basic=3, Pro=5, Free=1). Storing the value rather than re-reading
 * the plan lets a downgrade mid-batch finish at the original budget
 * the user paid for.
 *
 * `items_*` counters duplicate what `COUNT(*) FROM batch_task_items
 * WHERE status=...` would give but cached on the parent so a 50-item
 * batch's list view doesn't fan out 50× per render.
 */
export const batchTasks = mysqlTable(
  'batch_tasks',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }),
    concurrency: int('concurrency').notNull().default(3),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    itemsTotal: int('items_total').notNull().default(0),
    itemsDone: int('items_done').notNull().default(0),
    itemsReview: int('items_review').notNull().default(0),
    itemsFailed: int('items_failed').notNull().default(0),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [
    uniqueIndex('uk_batch_external_id').on(t.externalId),
    index('ix_batch_user_status').on(t.userId, t.status),
    index('ix_batch_created_at').on(t.createdAt),
  ],
);

/**
 * Phase 5b — `batch_task_items`: a single prompt inside a batch.
 *
 * Status machine:
 *   pending   → waiting in queue, executor hasn't dispatched yet
 *   running   → tasks.create returned, task is in flight
 *   completed → underlying task terminal=completed
 *   partial_success → underlying task produced output but needs review
 *   failed    → tasks.create threw OR underlying task terminal=failed/timeout
 *   cancelled → batch was cancelled before this item was dispatched
 *
 * `task_id` is the dispatched task's internal id once tasks.create
 * succeeded. Null while pending / failed-pre-dispatch. The SPA
 * detail view links each item row to its underlying task panel via
 * the corresponding external id.
 *
 * `seq` is 0-based ordering inside the batch; the executor processes
 * items in seq order so output matches the user's input list. Unique
 * per batch_id so the executor can resume from `seq > N` on restart
 * without re-dispatching anything.
 */
export const batchTaskItems = mysqlTable(
  'batch_task_items',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    batchId: bigint('batch_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => batchTasks.id, { onDelete: 'cascade' }),
    seq: int('seq').notNull(),
    prompt: text('prompt').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    taskId: bigint('task_id', { mode: 'number', unsigned: true })
      .references(() => tasks.id, { onDelete: 'set null' }),
    errorMessage: text('error_message'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [
    uniqueIndex('uk_batch_item_external_id').on(t.externalId),
    uniqueIndex('uk_batch_item_batch_seq').on(t.batchId, t.seq),
    index('ix_batch_item_batch_id').on(t.batchId),
    index('ix_batch_item_task_id').on(t.taskId),
  ],
);

export type BatchTask = typeof batchTasks.$inferSelect;
export type NewBatchTask = typeof batchTasks.$inferInsert;
export type BatchTaskItem = typeof batchTaskItems.$inferSelect;
export type NewBatchTaskItem = typeof batchTaskItems.$inferInsert;
