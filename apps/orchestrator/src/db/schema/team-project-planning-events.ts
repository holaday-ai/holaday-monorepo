import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  foreignKey,
  index,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { organizations } from './organizations.js';
import { projects } from './projects.js';
import { teamMilestones } from './team-milestones.js';
import { users } from './users.js';

export const teamProjectPlanningEvents = mysqlTable(
  'team_project_planning_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true }).notNull(),
    milestoneId: bigint('milestone_id', { mode: 'number', unsigned: true }),
    actorUserId: bigint('actor_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    eventType: varchar('event_type', { length: 48 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    metadataJson: json('metadata_json'),
    occurredAt: datetime('occurred_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_team_project_planning_events_external_id').on(table.externalId),
    uniqueIndex('uk_team_project_planning_events_organization_idempotency').on(
      table.organizationId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: 'fk_team_project_planning_events_project_tenant',
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_team_project_planning_events_milestone_lineage',
      columns: [table.milestoneId, table.organizationId, table.projectId],
      foreignColumns: [teamMilestones.id, teamMilestones.organizationId, teamMilestones.projectId],
    }).onDelete('restrict'),
    index('ix_team_project_planning_events_tenant_type').on(
      table.organizationId,
      table.projectId,
      table.eventType,
    ),
    index('ix_team_project_planning_events_milestone_time').on(table.milestoneId, table.occurredAt),
    index('ix_team_project_planning_events_actor').on(table.actorUserId, table.occurredAt),
  ],
);

export type TeamProjectPlanningEvent = typeof teamProjectPlanningEvents.$inferSelect;
export type NewTeamProjectPlanningEvent = typeof teamProjectPlanningEvents.$inferInsert;
