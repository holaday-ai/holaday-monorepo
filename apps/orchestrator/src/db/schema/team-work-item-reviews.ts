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
import { acceptanceContractVersions } from './acceptance-contract-versions.js';
import { organizations } from './organizations.js';
import { projects } from './projects.js';
import { teamWorkItemSubmissions } from './team-work-item-submissions.js';
import { teamWorkItems } from './team-work-items.js';
import { users } from './users.js';

export const teamWorkItemReviews = mysqlTable(
  'team_work_item_reviews',
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
    submissionId: bigint('submission_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => teamWorkItemSubmissions.id, { onDelete: 'restrict' }),
    contractVersionId: bigint('contract_version_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => acceptanceContractVersions.id, { onDelete: 'restrict' }),
    reviewerUserId: bigint('reviewer_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    decision: varchar('decision', { length: 32 }).notNull(),
    failedCriterionIdsJson: json('failed_criterion_ids_json'),
    evidenceRefsJson: json('evidence_refs_json'),
    revisionInstructionsJson: json('revision_instructions_json'),
    rationale: text('rationale'),
    newDueAt: datetime('new_due_at', { mode: 'date', fsp: 3 }),
    reviewedAt: datetime('reviewed_at', { mode: 'date', fsp: 3 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_team_work_item_reviews_external_id').on(table.externalId),
    uniqueIndex('uk_team_work_item_reviews_submission').on(table.submissionId),
    index('ix_team_work_item_reviews_tenant_decision').on(
      table.organizationId,
      table.projectId,
      table.decision,
    ),
    index('ix_team_work_item_reviews_reviewer').on(table.reviewerUserId, table.reviewedAt),
  ],
);

export type TeamWorkItemReview = typeof teamWorkItemReviews.$inferSelect;
export type NewTeamWorkItemReview = typeof teamWorkItemReviews.$inferInsert;
