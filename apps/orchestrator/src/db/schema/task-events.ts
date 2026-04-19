import { sql } from 'drizzle-orm';
import { bigint, datetime, index, json, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

/**
 * `task_events` — append-only event log and audit base for the Agent Loop.
 *
 * **Primary key**: plain `id` (auto_increment). Earlier iterations used a
 * composite PK `(id, created_at)` so MySQL's RANGE-by-created_at partitioning
 * (see `drizzle/manual/0001_partition_task_events.sql`) could be applied on
 * top — MySQL requires the partition key to be part of every unique/primary
 * key. Drizzle-kit 0.31.x misdiffs composite PKs on `db:push` and emits a
 * spurious "primary key removed from a table with auto-increment" warning,
 * which blocks operators on their first push. Since partitioning is an
 * ops-side manual step and isn't applied in dogfood or CI anyway, we
 * simplify here and let the manual partition migration drop+re-add the PK
 * as composite when it runs.
 */
export const taskEvents = mysqlTable(
  'task_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    taskId: bigint('task_id', { mode: 'number', unsigned: true }).notNull(),
    stepId: bigint('step_id', { mode: 'number', unsigned: true }),
    type: varchar('type', { length: 48 }).notNull(),
    actor: varchar('actor', { length: 32 }).notNull().default('system'),
    payload: json('payload'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index('ix_task_events_task_id_created_at').on(t.taskId, t.createdAt),
    index('ix_task_events_type').on(t.type),
    index('ix_task_events_external_id').on(t.externalId),
    // `created_at` used to be part of the PK; keep an index for range
    // scans (time-window queries, rollover detection) now that the
    // composite PK is gone.
    index('ix_task_events_created_at').on(t.createdAt),
  ],
);

export type TaskEvent = typeof taskEvents.$inferSelect;
export type NewTaskEvent = typeof taskEvents.$inferInsert;
