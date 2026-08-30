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
import { evidenceArtifacts } from './evidence-artifacts.js';
import { organizations } from './organizations.js';
import { taskFiles } from './task-files.js';
import { teamAiContributions } from './team-ai-contributions.js';
import { teamWorkItemAppeals } from './team-work-item-appeals.js';
import { teamWorkItemReviews } from './team-work-item-reviews.js';
import { teamWorkItemSubmissions } from './team-work-item-submissions.js';
import { teamWorkItems } from './team-work-items.js';
import { users } from './users.js';

export const teamEvidenceBindings = mysqlTable(
  'team_evidence_bindings',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true }).notNull(),
    workItemId: bigint('work_item_id', { mode: 'number', unsigned: true }).notNull(),
    submissionId: bigint('submission_id', { mode: 'number', unsigned: true }),
    reviewId: bigint('review_id', { mode: 'number', unsigned: true }),
    appealId: bigint('appeal_id', { mode: 'number', unsigned: true }),
    aiContributionId: bigint('ai_contribution_id', { mode: 'number', unsigned: true }),
    evidenceArtifactId: bigint('evidence_artifact_id', {
      mode: 'number',
      unsigned: true,
    }).references(() => evidenceArtifacts.id, { onDelete: 'restrict' }),
    taskFileId: bigint('task_file_id', { mode: 'number', unsigned: true }).references(
      () => taskFiles.id,
      { onDelete: 'restrict' },
    ),
    sourceKind: varchar('source_kind', { length: 32 }).notNull(),
    controlledExternalRef: varchar('controlled_external_ref', { length: 512 }),
    metadataJson: json('metadata_json'),
    boundByUserId: bigint('bound_by_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_team_evidence_bindings_external_id').on(table.externalId),
    foreignKey({
      name: 'fk_team_evidence_bindings_work_item_lineage',
      columns: [table.workItemId, table.organizationId, table.projectId],
      foreignColumns: [teamWorkItems.id, teamWorkItems.organizationId, teamWorkItems.projectId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_team_evidence_bindings_submission_lineage',
      columns: [table.submissionId, table.workItemId, table.organizationId, table.projectId],
      foreignColumns: [
        teamWorkItemSubmissions.id,
        teamWorkItemSubmissions.workItemId,
        teamWorkItemSubmissions.organizationId,
        teamWorkItemSubmissions.projectId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_team_evidence_bindings_review_lineage',
      columns: [table.reviewId, table.workItemId, table.organizationId, table.projectId],
      foreignColumns: [
        teamWorkItemReviews.id,
        teamWorkItemReviews.workItemId,
        teamWorkItemReviews.organizationId,
        teamWorkItemReviews.projectId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_team_evidence_bindings_appeal_lineage',
      columns: [table.appealId, table.workItemId, table.organizationId, table.projectId],
      foreignColumns: [
        teamWorkItemAppeals.id,
        teamWorkItemAppeals.workItemId,
        teamWorkItemAppeals.organizationId,
        teamWorkItemAppeals.projectId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_team_evidence_bindings_ai_lineage',
      columns: [table.aiContributionId, table.workItemId, table.organizationId, table.projectId],
      foreignColumns: [
        teamAiContributions.id,
        teamAiContributions.workItemId,
        teamAiContributions.organizationId,
        teamAiContributions.projectId,
      ],
    }).onDelete('restrict'),
    index('ix_team_evidence_bindings_tenant').on(
      table.organizationId,
      table.projectId,
      table.workItemId,
    ),
    index('ix_team_evidence_bindings_submission').on(table.submissionId),
    index('ix_team_evidence_bindings_review').on(table.reviewId),
    index('ix_team_evidence_bindings_appeal').on(table.appealId),
    index('ix_team_evidence_bindings_ai').on(table.aiContributionId),
    index('ix_team_evidence_bindings_artifact').on(table.evidenceArtifactId),
    index('ix_team_evidence_bindings_task_file').on(table.taskFileId),
  ],
);

export type TeamEvidenceBinding = typeof teamEvidenceBindings.$inferSelect;
export type NewTeamEvidenceBinding = typeof teamEvidenceBindings.$inferInsert;
