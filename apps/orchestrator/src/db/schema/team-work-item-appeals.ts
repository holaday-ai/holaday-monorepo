import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  foreignKey,
  index,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { organizations } from './organizations.js';
import { teamWorkItemReviews } from './team-work-item-reviews.js';
import { teamWorkItems } from './team-work-items.js';
import { users } from './users.js';

export const teamWorkItemAppeals = mysqlTable(
  'team_work_item_appeals',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true }).notNull(),
    workItemId: bigint('work_item_id', { mode: 'number', unsigned: true }).notNull(),
    submissionId: bigint('submission_id', { mode: 'number', unsigned: true }).notNull(),
    reviewId: bigint('review_id', { mode: 'number', unsigned: true }).notNull(),
    openedByUserId: bigint('opened_by_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    disputeType: varchar('dispute_type', { length: 32 }).notNull(),
    grounds: text('grounds').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('appeal_open'),
    openedAt: datetime('opened_at', { mode: 'date', fsp: 3 }).notNull(),
    resolvedAt: datetime('resolved_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_team_work_item_appeals_external_id').on(table.externalId),
    uniqueIndex('uk_team_work_item_appeals_submission').on(table.submissionId),
    uniqueIndex('uk_team_work_item_appeals_id_tenant_item').on(
      table.id,
      table.workItemId,
      table.organizationId,
      table.projectId,
    ),
    foreignKey({
      name: 'fk_team_work_item_appeals_work_item_lineage',
      columns: [table.workItemId, table.organizationId, table.projectId],
      foreignColumns: [teamWorkItems.id, teamWorkItems.organizationId, teamWorkItems.projectId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_team_work_item_appeals_review_lineage',
      columns: [
        table.reviewId,
        table.submissionId,
        table.workItemId,
        table.organizationId,
        table.projectId,
      ],
      foreignColumns: [
        teamWorkItemReviews.id,
        teamWorkItemReviews.submissionId,
        teamWorkItemReviews.workItemId,
        teamWorkItemReviews.organizationId,
        teamWorkItemReviews.projectId,
      ],
    }).onDelete('restrict'),
    index('ix_team_work_item_appeals_tenant_status').on(
      table.organizationId,
      table.projectId,
      table.status,
    ),
    index('ix_team_work_item_appeals_opened_by').on(table.openedByUserId, table.openedAt),
  ],
);

export type TeamWorkItemAppeal = typeof teamWorkItemAppeals.$inferSelect;
export type NewTeamWorkItemAppeal = typeof teamWorkItemAppeals.$inferInsert;
