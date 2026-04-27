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
import { tasks } from './tasks.js';
import { users } from './users.js';

/**
 * `task_files` — index of uploaded inputs + agent-generated outputs.
 *
 * `kind` values:
 *   'input'  → user upload that the agent reads. Storage stays as
 *              long as the parent task exists. `expires_at` null.
 *   'output' → file the agent created via the `create_file` tool.
 *              `expires_at` = uploaded_at + 24h; cron deletes the
 *              row + on-disk file when expired.
 *
 * `task_id` is nullable: input files are uploaded BEFORE the task
 * exists (the SPA calls `/api/files/upload` first, then includes
 * the returned external_id in `tasks.create.fileIds`, and that
 * mutation back-fills the link in the same transaction).
 */
export const taskFiles = mysqlTable(
  'task_files',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: bigint('task_id', { mode: 'number', unsigned: true }).references(
      () => tasks.id,
      { onDelete: 'cascade' },
    ),
    kind: varchar('kind', { length: 8 }).notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimetype: varchar('mimetype', { length: 96 }).notNull(),
    sizeBytes: int('size_bytes', { unsigned: true }).notNull(),
    storagePath: varchar('storage_path', { length: 512 }).notNull(),
    /**
     * 'active' | 'expired'. Cron flips to 'expired' AFTER the on-disk
     * bytes have been unlinked. Audit-only — the download endpoint
     * already 404s on expires_at < now() regardless of this column.
     */
    status: varchar('status', { length: 16 }).notNull().default('active'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [
    uniqueIndex('uk_task_files_external_id').on(t.externalId),
    index('ix_task_files_user_id').on(t.userId),
    index('ix_task_files_task_kind').on(t.taskId, t.kind),
    index('ix_task_files_expires_at').on(t.expiresAt),
    index('ix_task_files_status_expires').on(t.status, t.expiresAt),
  ],
);

export type TaskFile = typeof taskFiles.$inferSelect;
export type NewTaskFile = typeof taskFiles.$inferInsert;
