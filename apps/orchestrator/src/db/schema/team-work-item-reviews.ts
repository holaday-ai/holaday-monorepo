import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { organizations } from './organizations.js';
import { teamTaskReviewDelegations } from './team-task-review-delegations.js';
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
    projectId: bigint('project_id', { mode: 'number', unsigned: true }).notNull(),
    workItemId: bigint('work_item_id', { mode: 'number', unsigned: true }).notNull(),
    submissionId: bigint('submission_id', { mode: 'number', unsigned: true }).notNull(),
    contractVersionId: bigint('contract_version_id', {
      mode: 'number',
      unsigned: true,
    }).notNull(),
    reviewerUserId: bigint('reviewer_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reviewDelegationId: bigint('review_delegation_id', { mode: 'number', unsigned: true }),
    reviewAttempt: int('review_attempt', { unsigned: true }).notNull().default(1),
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
    uniqueIndex('uk_team_work_item_reviews_submission_attempt').on(
      table.submissionId,
      table.reviewAttempt,
    ),
    uniqueIndex('uk_team_work_item_reviews_id_lineage').on(
      table.id,
      table.submissionId,
      table.workItemId,
      table.organizationId,
      table.projectId,
    ),
    uniqueIndex('uk_team_work_item_reviews_id_tenant_item').on(
      table.id,
      table.workItemId,
      table.organizationId,
      table.projectId,
    ),
    foreignKey({
      name: 'fk_team_work_item_reviews_work_item_lineage',
      columns: [table.workItemId, table.organizationId, table.projectId],
      foreignColumns: [teamWorkItems.id, teamWorkItems.organizationId, teamWorkItems.projectId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_team_work_item_reviews_submission_lineage',
      columns: [
        table.submissionId,
        table.contractVersionId,
        table.workItemId,
        table.organizationId,
        table.projectId,
      ],
      foreignColumns: [
        teamWorkItemSubmissions.id,
        teamWorkItemSubmissions.contractVersionId,
        teamWorkItemSubmissions.workItemId,
        teamWorkItemSubmissions.organizationId,
        teamWorkItemSubmissions.projectId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_team_work_item_reviews_delegation_lineage',
      columns: [
        table.reviewDelegationId,
        table.organizationId,
        table.projectId,
        table.reviewerUserId,
      ],
      foreignColumns: [
        teamTaskReviewDelegations.id,
        teamTaskReviewDelegations.organizationId,
        teamTaskReviewDelegations.projectId,
        teamTaskReviewDelegations.delegateUserId,
      ],
    }).onDelete('restrict'),
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
