import { sql } from 'drizzle-orm';
import { bigint, datetime, index, mysqlTable, uniqueIndex } from 'drizzle-orm/mysql-core';
import { organizations } from './organizations.js';
import { projects } from './projects.js';
import { teamWorkItems } from './team-work-items.js';
import { users } from './users.js';

export const teamWorkItemDependencies = mysqlTable(
  'team_work_item_dependencies',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    workItemId: bigint('work_item_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => teamWorkItems.id, { onDelete: 'restrict' }),
    dependsOnWorkItemId: bigint('depends_on_work_item_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => teamWorkItems.id, { onDelete: 'restrict' }),
    createdByUserId: bigint('created_by_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_team_work_item_dependencies_edge').on(
      table.workItemId,
      table.dependsOnWorkItemId,
    ),
    index('ix_team_work_item_dependencies_tenant').on(table.organizationId, table.projectId),
    index('ix_team_work_item_dependencies_predecessor').on(table.dependsOnWorkItemId),
  ],
);

export type TeamWorkItemDependency = typeof teamWorkItemDependencies.$inferSelect;
export type NewTeamWorkItemDependency = typeof teamWorkItemDependencies.$inferInsert;
