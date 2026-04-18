import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { tasks } from './tasks.js';

/**
 * `task_steps` — the Agent Loop's step ledger.
 * Persisted after every step so Orchestrator can recover from restart.
 * `index` is the 0-based ordinal within the parent task.
 */
export const taskSteps = mysqlTable(
  'task_steps',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    taskId: bigint('task_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    parentStepId: bigint('parent_step_id', { mode: 'number', unsigned: true }),
    seq: int('seq').notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    riskLevel: varchar('risk_level', { length: 16 }).notNull().default('low'),
    /** Phase 0: ≤ MAX_STEP_RETRIES before step failure escalates to task pause. */
    retryCount: int('retry_count').notNull().default(0),
    input: json('input'),
    output: json('output'),
    screenshotKey: varchar('screenshot_key', { length: 255 }),
    /**
     * When status='awaiting_user', this holds the confirm-prompt payload
     * (stepId, prompt, risk) needed to re-emit server.user.confirm on
     * orchestrator restart. Null in every other status.
     */
    pendingConfirmPayload: json('pending_confirm_payload'),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: text('error_message'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 }),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [
    uniqueIndex('uk_task_steps_external_id').on(t.externalId),
    uniqueIndex('uk_task_steps_task_seq').on(t.taskId, t.seq),
    index('ix_task_steps_status').on(t.status),
    index('ix_task_steps_parent').on(t.parentStepId),
  ],
);

export type TaskStep = typeof taskSteps.$inferSelect;
export type NewTaskStep = typeof taskSteps.$inferInsert;
