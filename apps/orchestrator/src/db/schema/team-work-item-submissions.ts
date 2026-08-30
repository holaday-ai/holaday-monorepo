import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
import { teamWorkItems } from './team-work-items.js';
import { users } from './users.js';

export const teamWorkItemSubmissions = mysqlTable(
  'team_work_item_submissions',
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
    contractVersionId: bigint('contract_version_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => acceptanceContractVersions.id, { onDelete: 'restrict' }),
    submittedByUserId: bigint('submitted_by_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submissionVersion: int('submission_version', { unsigned: true }).notNull(),
    summary: text('summary').notNull(),
    deliverablesJson: json('deliverables_json').notNull(),
    submittedOnTime: boolean('submitted_on_time').notNull(),
    submittedAt: datetime('submitted_at', { mode: 'date', fsp: 3 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_team_work_item_submissions_external_id').on(table.externalId),
    uniqueIndex('uk_team_work_item_submissions_work_item_version').on(
      table.workItemId,
      table.submissionVersion,
    ),
    index('ix_team_work_item_submissions_tenant').on(
      table.organizationId,
      table.projectId,
      table.workItemId,
    ),
    index('ix_team_work_item_submissions_submitter').on(table.submittedByUserId, table.submittedAt),
  ],
);

export type TeamWorkItemSubmission = typeof teamWorkItemSubmissions.$inferSelect;
export type NewTeamWorkItemSubmission = typeof teamWorkItemSubmissions.$inferInsert;
