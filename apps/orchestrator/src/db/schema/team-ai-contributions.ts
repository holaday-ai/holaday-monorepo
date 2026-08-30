import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { organizations } from './organizations.js';
import { projects } from './projects.js';
import { tasks } from './tasks.js';
import { teamWorkItems } from './team-work-items.js';
import { users } from './users.js';

export const teamAiContributions = mysqlTable(
  'team_ai_contributions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    workItemId: bigint('work_item_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => teamWorkItems.id, { onDelete: 'restrict' }),
    contributedByUserId: bigint('contributed_by_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    executionTaskId: bigint('execution_task_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => tasks.id, { onDelete: 'restrict' }),
    requestedScope: text('requested_scope').notNull(),
    inputSourceSummaryJson: json('input_source_summary_json').notNull(),
    resultVersion: varchar('result_version', { length: 64 }).notNull(),
    usageSnapshotJson: json('usage_snapshot_json').notNull(),
    humanConfirmationStatus: varchar('human_confirmation_status', { length: 24 })
      .notNull()
      .default('pending'),
    humanChangesSummary: text('human_changes_summary'),
    unverifiedRisksJson: json('unverified_risks_json').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    confirmedAt: datetime('confirmed_at', { mode: 'date', fsp: 3 }),
  },
  (table) => [
    uniqueIndex('uk_team_ai_contributions_external_id').on(table.externalId),
    index('ix_team_ai_contributions_tenant').on(
      table.organizationId,
      table.projectId,
      table.workItemId,
    ),
    index('ix_team_ai_contributions_execution_task').on(table.executionTaskId),
    index('ix_team_ai_contributions_contributor').on(table.contributedByUserId, table.createdAt),
  ],
);

export type TeamAiContribution = typeof teamAiContributions.$inferSelect;
export type NewTeamAiContribution = typeof teamAiContributions.$inferInsert;
