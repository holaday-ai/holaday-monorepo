import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  foreignKey,
  index,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { organizations } from './organizations.js';
import { teamWorkItems } from './team-work-items.js';
import { users } from './users.js';

export const teamWorkItemAssignments = mysqlTable(
  'team_work_item_assignments',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true }).notNull(),
    workItemId: bigint('work_item_id', { mode: 'number', unsigned: true }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: varchar('role', { length: 24 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    responsibleActiveKey: bigint('responsible_active_key', {
      mode: 'number',
      unsigned: true,
    }).generatedAlwaysAs(
      sql`CASE WHEN ${sql.identifier('role')} = 'responsible' AND ${sql.identifier('status')} = 'accepted' THEN ${sql.identifier('work_item_id')} ELSE NULL END`,
      { mode: 'stored' },
    ),
    offeredByUserId: bigint('offered_by_user_id', { mode: 'number', unsigned: true }).references(
      () => users.id,
      { onDelete: 'restrict' },
    ),
    respondedAt: datetime('responded_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_team_work_item_assignments_external_id').on(table.externalId),
    uniqueIndex('uk_team_work_item_assignments_responsible_active').on(table.responsibleActiveKey),
    foreignKey({
      name: 'fk_team_work_item_assignments_work_item_lineage',
      columns: [table.workItemId, table.organizationId, table.projectId],
      foreignColumns: [teamWorkItems.id, teamWorkItems.organizationId, teamWorkItems.projectId],
    }).onDelete('restrict'),
    index('ix_team_work_item_assignments_tenant_status').on(
      table.organizationId,
      table.projectId,
      table.status,
    ),
    index('ix_team_work_item_assignments_item_role_status').on(
      table.workItemId,
      table.role,
      table.status,
    ),
    index('ix_team_work_item_assignments_user_status').on(table.userId, table.status),
  ],
);

export type TeamWorkItemAssignment = typeof teamWorkItemAssignments.$inferSelect;
export type NewTeamWorkItemAssignment = typeof teamWorkItemAssignments.$inferInsert;
