import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  json,
  mysqlTable,
  primaryKey,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * `task_events` — append-only event log and audit base for the Agent Loop.
 *
 * **Partitioning note:** we want RANGE partitioning by month on `created_at`.
 * Drizzle does not yet emit partition clauses, so a hand-written migration
 * (`drizzle/0001_partition_task_events.sql`) adds:
 *
 *   ALTER TABLE task_events
 *     PARTITION BY RANGE (TO_DAYS(created_at)) (
 *       PARTITION p2026_04 VALUES LESS THAN (TO_DAYS('2026-05-01')),
 *       PARTITION p2026_05 VALUES LESS THAN (TO_DAYS('2026-06-01')),
 *       ...
 *       PARTITION pmax     VALUES LESS THAN MAXVALUE
 *     );
 *
 * (MySQL requires partition key to be part of every unique/primary key, which is
 *  why the PK here is composite `(id, created_at)`.)
 */
export const taskEvents = mysqlTable(
  'task_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).notNull().autoincrement(),
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
    // Composite PK so MySQL accepts partitioning by created_at.
    primaryKey({ name: 'pk_task_events', columns: [t.id, t.createdAt] }),
    index('ix_task_events_task_id_created_at').on(t.taskId, t.createdAt),
    index('ix_task_events_type').on(t.type),
    index('ix_task_events_external_id').on(t.externalId),
  ],
);

export type TaskEvent = typeof taskEvents.$inferSelect;
export type NewTaskEvent = typeof taskEvents.$inferInsert;
