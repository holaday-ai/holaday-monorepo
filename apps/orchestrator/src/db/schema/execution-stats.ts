import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  mysqlTable,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/**
 * `execution_stats` — per-tool-call performance log.
 *
 * Powers the ExecutionRouter's lane scoring on subsequent runs:
 * success rate × 0.7 + speed-normalised × 0.3. Logged at every
 * tool_result; bounded by a short time window in the scorer (last
 * 30 days) so old data doesn't stale-block a recovered route.
 *
 * Domain stripped to bare host (e.g. "jd.com" not "www.m.jd.com")
 * so cross-task aggregation is meaningful. lane_used uses the
 * router's stable lane id ('brave_api' / 'browser_cdp' /
 * 'zapier' / 'apify' / 'computer_use'). error_type is best-effort
 * classifier output ('timeout' / 'anti_bot' / 'http_4xx' /
 * 'http_5xx' / 'network' / 'unknown').
 */
export const executionStats = mysqlTable(
  'execution_stats',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** External id of the parent task (for join/audit, not FK to keep stats writes lock-free). */
    taskExternalId: varchar('task_external_id', { length: 32 }),
    taskType: varchar('task_type', { length: 64 }),
    targetSite: varchar('target_site', { length: 255 }),
    laneUsed: varchar('lane_used', { length: 48 }).notNull(),
    success: boolean('success').notNull(),
    latencyMs: int('latency_ms', { unsigned: true }),
    errorType: varchar('error_type', { length: 64 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index('ix_execution_stats_user_site').on(t.userId, t.targetSite),
    index('ix_execution_stats_type_site').on(t.taskType, t.targetSite),
    index('ix_execution_stats_created').on(t.createdAt),
  ],
);

export type ExecutionStat = typeof executionStats.$inferSelect;
export type NewExecutionStat = typeof executionStats.$inferInsert;
