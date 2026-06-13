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
import { sites } from './sites.js';

/**
 * `exploration_runs` — one offline exploration / watch execution
 * (Phase 1 指令 #3, design §3.1.5).
 *
 * `watch_target_id` is a plain nullable column in Pack A — its FK to
 * `site_watch_targets` is deferred to Pack D (watch / diff) along with
 * that table, so it carries no `.references()` here.
 */
export const explorationRuns = mysqlTable(
  'exploration_runs',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    siteId: bigint('site_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    watchTargetId: bigint('watch_target_id', { mode: 'number', unsigned: true }),
    triggerType: varchar('trigger_type', { length: 32 }).notNull(),
    runnerType: varchar('runner_type', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 }),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
    summary: text('summary'),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: text('error_message'),
    metadataJson: json('metadata_json'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_exploration_run_external_id').on(t.externalId),
    index('ix_exploration_site_created').on(t.siteId, t.createdAt),
    index('ix_exploration_status').on(t.status),
  ],
);

export type ExplorationRun = typeof explorationRuns.$inferSelect;
export type NewExplorationRun = typeof explorationRuns.$inferInsert;
