import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { organizations } from './organizations.js';
import { projects } from './projects.js';
import { users } from './users.js';

export const teamMilestones = mysqlTable(
  'team_milestones',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true }).notNull(),
    createdByUserId: bigint('created_by_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 24 }).notNull().default('open'),
    version: int('version', { unsigned: true }).notNull().default(1),
    sortOrder: int('sort_order', { unsigned: true }).notNull().default(0),
    dueAt: datetime('due_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_team_milestones_external_id').on(table.externalId),
    uniqueIndex('uk_team_milestones_id_tenant').on(table.id, table.organizationId, table.projectId),
    foreignKey({
      name: 'fk_team_milestones_project_tenant',
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('restrict'),
    index('ix_team_milestones_tenant_status').on(
      table.organizationId,
      table.projectId,
      table.status,
    ),
    index('ix_team_milestones_project_sort').on(table.projectId, table.sortOrder),
  ],
);

export type TeamMilestone = typeof teamMilestones.$inferSelect;
export type NewTeamMilestone = typeof teamMilestones.$inferInsert;
