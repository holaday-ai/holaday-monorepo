import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  datetime,
  foreignKey,
  index,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { organizations } from './organizations.js';
import { projects } from './projects.js';
import { users } from './users.js';

export const teamTaskReviewDelegations = mysqlTable(
  'team_task_review_delegations',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true }).notNull(),
    delegatorUserId: bigint('delegator_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    delegateUserId: bigint('delegate_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    validFrom: datetime('valid_from', { mode: 'date', fsp: 3 }).notNull(),
    validUntil: datetime('valid_until', { mode: 'date', fsp: 3 }).notNull(),
    revokedAt: datetime('revoked_at', { mode: 'date', fsp: 3 }),
    revokedByUserId: bigint('revoked_by_user_id', { mode: 'number', unsigned: true }).references(
      () => users.id,
      { onDelete: 'restrict' },
    ),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_team_task_review_delegations_external_id').on(table.externalId),
    uniqueIndex('uk_team_task_review_delegations_id_lineage').on(
      table.id,
      table.organizationId,
      table.projectId,
      table.delegateUserId,
    ),
    uniqueIndex('uk_team_task_review_delegations_grant').on(
      table.organizationId,
      table.projectId,
      table.delegatorUserId,
      table.delegateUserId,
      table.validFrom,
    ),
    index('ix_team_task_review_delegations_tenant_window').on(
      table.organizationId,
      table.projectId,
      table.delegatorUserId,
      table.delegateUserId,
      table.validFrom,
      table.validUntil,
    ),
    foreignKey({
      name: 'fk_team_task_review_delegations_project_tenant',
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('restrict'),
    check('ck_team_task_review_delegations_window', sql`${table.validUntil} > ${table.validFrom}`),
    check(
      'ck_team_task_review_delegations_distinct_users',
      sql`${table.delegatorUserId} <> ${table.delegateUserId}`,
    ),
    check(
      'ck_team_task_review_delegations_revocation',
      sql`(${table.revokedAt} IS NULL AND ${table.revokedByUserId} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedByUserId} IS NOT NULL AND ${table.revokedAt} >= ${table.validFrom})`,
    ),
  ],
);

export type TeamTaskReviewDelegation = typeof teamTaskReviewDelegations.$inferSelect;
export type NewTeamTaskReviewDelegation = typeof teamTaskReviewDelegations.$inferInsert;
