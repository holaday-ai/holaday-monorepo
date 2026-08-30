import { sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { acceptanceContractVersions } from './acceptance-contract-versions.js';
import { organizations } from './organizations.js';
import { projects } from './projects.js';
import { teamMilestones } from './team-milestones.js';
import { users } from './users.js';

export const teamWorkItems = mysqlTable(
  'team_work_items',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    milestoneId: bigint('milestone_id', { mode: 'number', unsigned: true }).references(
      () => teamMilestones.id,
      { onDelete: 'restrict' },
    ),
    createdByUserId: bigint('created_by_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    assignmentMode: varchar('assignment_mode', { length: 24 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('draft'),
    version: int('version', { unsigned: true }).notNull().default(1),
    currentContractVersionId: bigint('current_contract_version_id', {
      mode: 'number',
      unsigned: true,
    }).references((): AnyMySqlColumn => acceptanceContractVersions.id, { onDelete: 'restrict' }),
    dueAt: datetime('due_at', { mode: 'date', fsp: 3 }),
    blockerJson: json('blocker_json'),
    revisionRound: int('revision_round', { unsigned: true }).notNull().default(0),
    closedAt: datetime('closed_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_team_work_items_external_id').on(table.externalId),
    index('ix_team_work_items_tenant_status').on(
      table.organizationId,
      table.projectId,
      table.status,
    ),
    index('ix_team_work_items_project_due').on(table.projectId, table.dueAt),
    index('ix_team_work_items_milestone').on(table.milestoneId, table.status),
    index('ix_team_work_items_current_contract').on(table.currentContractVersionId),
  ],
);

export type TeamWorkItem = typeof teamWorkItems.$inferSelect;
export type NewTeamWorkItem = typeof teamWorkItems.$inferInsert;
