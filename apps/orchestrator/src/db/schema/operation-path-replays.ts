import { sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
  bigint,
  datetime,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { operationPaths } from './operation-paths.js';
import { tasks } from './tasks.js';

/**
 * `operation_path_replays` — one row per REUSE attempt of a verified
 * operation path (batch 06, migration 0062). Feeds the 学习引擎 dashboard:
 * reuse hit rate, repairs, and estimated model calls saved.
 *
 * Holds no free text from the user: counts, an outcome code and a bounded
 * machine failure reason. `task_id` is SET NULL (the metric outlives a
 * pruned task) and account closure removes rows owned through the task or
 * the path's source task explicitly.
 */
export const operationPathReplays = mysqlTable(
  'operation_path_replays',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    pathId: bigint('path_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => operationPaths.id, { onDelete: 'cascade' }),
    taskId: bigint('task_id', { mode: 'number', unsigned: true }).references(() => tasks.id, {
      onDelete: 'set null',
    }),
    /** 'success' | 'repaired' | 'failed'. */
    outcome: varchar('outcome', { length: 16 }).notNull(),
    stepsTotal: int('steps_total', { unsigned: true }).notNull().default(0),
    stepsDeterministic: int('steps_deterministic', { unsigned: true }).notNull().default(0),
    stepsRepaired: int('steps_repaired', { unsigned: true }).notNull().default(0),
    modelCalls: int('model_calls', { unsigned: true }).notNull().default(0),
    /** Estimate: steps + 1 (unassisted agent turns) − modelCalls, floored at 0. */
    modelCallsSaved: int('model_calls_saved', { unsigned: true }).notNull().default(0),
    repairedPathId: bigint('repaired_path_id', { mode: 'number', unsigned: true }).references(
      (): AnyMySqlColumn => operationPaths.id,
      { onDelete: 'set null' },
    ),
    failedStepIndex: int('failed_step_index', { unsigned: true }),
    failureReason: varchar('failure_reason', { length: 255 }),
    durationMs: int('duration_ms', { unsigned: true }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('uk_operation_path_replays_external_id').on(t.externalId),
    index('ix_operation_path_replays_path_created').on(t.pathId, t.createdAt),
    index('ix_operation_path_replays_task').on(t.taskId),
    index('ix_operation_path_replays_repaired_path').on(t.repairedPathId),
  ],
);

export type OperationPathReplay = typeof operationPathReplays.$inferSelect;
export type NewOperationPathReplay = typeof operationPathReplays.$inferInsert;
