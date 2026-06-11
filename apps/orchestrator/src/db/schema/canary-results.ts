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
import { explorationRuns } from './exploration-runs.js';
import { operationPaths } from './operation-paths.js';
import { tasks } from './tasks.js';

/**
 * `canary_results` — operation-path validation outcomes (Phase 1 指令
 * #3, design §3.1.6). The key trigger source of the path state machine.
 *
 * A canary reuses the `tasks` runner (tagged `origin='playbook_canary'`)
 * but keeps its own result summary here so freshness queries never scan
 * `tasks.result`. `path_id` is ON DELETE CASCADE; `task_id` /
 * `exploration_run_id` are SET NULL so the canary record outlives a
 * pruned task. `needs_human_review` is a first-class status (ambiguous
 * ≠ pass/fail).
 */
export const canaryResults = mysqlTable(
  'canary_results',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    pathId: bigint('path_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => operationPaths.id, { onDelete: 'cascade' }),
    taskId: bigint('task_id', { mode: 'number', unsigned: true }).references(() => tasks.id, {
      onDelete: 'set null',
    }),
    explorationRunId: bigint('exploration_run_id', {
      mode: 'number',
      unsigned: true,
    }).references(() => explorationRuns.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    failureType: varchar('failure_type', { length: 64 }),
    verifiedOutputsJson: json('verified_outputs_json'),
    evidenceSummaryJson: json('evidence_summary_json'),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 }),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_canary_external_id').on(t.externalId),
    index('ix_canary_path_status').on(t.pathId, t.status),
    index('ix_canary_task').on(t.taskId),
  ],
);

export type CanaryResult = typeof canaryResults.$inferSelect;
export type NewCanaryResult = typeof canaryResults.$inferInsert;
