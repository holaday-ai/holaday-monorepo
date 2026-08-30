import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  foreignKey,
  index,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { organizations } from './organizations.js';
import { teamWorkItemAppeals } from './team-work-item-appeals.js';
import { teamWorkItems } from './team-work-items.js';
import { users } from './users.js';

export const teamArbitrationDecisions = mysqlTable(
  'team_arbitration_decisions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true }).notNull(),
    workItemId: bigint('work_item_id', { mode: 'number', unsigned: true }).notNull(),
    appealId: bigint('appeal_id', { mode: 'number', unsigned: true }).notNull(),
    arbitratorUserId: bigint('arbitrator_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    conflictSnapshotJson: json('conflict_snapshot_json').notNull(),
    decision: varchar('decision', { length: 32 }).notNull(),
    criterionIdsJson: json('criterion_ids_json').notNull(),
    evidenceRefsJson: json('evidence_refs_json').notNull(),
    rationale: text('rationale').notNull(),
    decidedAt: datetime('decided_at', { mode: 'date', fsp: 3 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_team_arbitration_decisions_external_id').on(table.externalId),
    uniqueIndex('uk_team_arbitration_decisions_appeal').on(table.appealId),
    foreignKey({
      name: 'fk_team_arbitration_decisions_work_item_lineage',
      columns: [table.workItemId, table.organizationId, table.projectId],
      foreignColumns: [teamWorkItems.id, teamWorkItems.organizationId, teamWorkItems.projectId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_team_arbitration_decisions_appeal_lineage',
      columns: [table.appealId, table.workItemId, table.organizationId, table.projectId],
      foreignColumns: [
        teamWorkItemAppeals.id,
        teamWorkItemAppeals.workItemId,
        teamWorkItemAppeals.organizationId,
        teamWorkItemAppeals.projectId,
      ],
    }).onDelete('restrict'),
    index('ix_team_arbitration_decisions_tenant').on(
      table.organizationId,
      table.projectId,
      table.decidedAt,
    ),
    index('ix_team_arbitration_decisions_arbitrator').on(table.arbitratorUserId, table.decidedAt),
  ],
);

export type TeamArbitrationDecision = typeof teamArbitrationDecisions.$inferSelect;
export type NewTeamArbitrationDecision = typeof teamArbitrationDecisions.$inferInsert;
