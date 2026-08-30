import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

/**
 * `projects` — user-owned task grouping. Phase 16 first-batch feature
 * graduation: the sidebar "项目" entry now opens a real project list.
 *
 * Tasks reference projects via `tasks.project_id` (nullable FK with
 * ON DELETE SET NULL — deleting a project preserves the tasks but
 * orphans them to the default 所有任务 list).
 */
export const projects = mysqlTable(
  'projects',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true }).references(
      () => organizations.id,
      { onDelete: 'restrict' },
    ),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 500 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_projects_external_id').on(t.externalId),
    index('ix_projects_user_id').on(t.userId),
    index('ix_projects_organization_id').on(t.organizationId),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
