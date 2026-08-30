import { sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
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
import { teamWorkItems } from './team-work-items.js';
import { users } from './users.js';

function workItemLineageColumns(): [AnyMySqlColumn, AnyMySqlColumn, AnyMySqlColumn] {
  return [teamWorkItems.id, teamWorkItems.organizationId, teamWorkItems.projectId];
}

export const acceptanceContractVersions = mysqlTable(
  'acceptance_contract_versions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: bigint('project_id', { mode: 'number', unsigned: true }).notNull(),
    workItemId: bigint('work_item_id', { mode: 'number', unsigned: true }).notNull(),
    version: int('version', { unsigned: true }).notNull(),
    objective: text('objective').notNull(),
    deliverablesJson: json('deliverables_json').notNull(),
    criteriaJson: json('criteria_json').notNull(),
    requiredEvidenceTypesJson: json('required_evidence_types_json').notNull(),
    approverUserId: bigint('approver_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    arbitratorUserId: bigint('arbitrator_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    dueAt: datetime('due_at', { mode: 'date', fsp: 3 }).notNull(),
    maxRevisionRounds: int('max_revision_rounds', { unsigned: true }).notNull().default(2),
    versionNote: text('version_note'),
    createdByUserId: bigint('created_by_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    confirmedByUserId: bigint('confirmed_by_user_id', {
      mode: 'number',
      unsigned: true,
    }).references(() => users.id, { onDelete: 'restrict' }),
    confirmedAt: datetime('confirmed_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_acceptance_contract_versions_external_id').on(table.externalId),
    uniqueIndex('uk_acceptance_contract_versions_work_item_version').on(
      table.workItemId,
      table.version,
    ),
    uniqueIndex('uk_acceptance_contract_versions_id_lineage').on(
      table.id,
      table.workItemId,
      table.organizationId,
      table.projectId,
    ),
    foreignKey({
      name: 'fk_acceptance_contract_versions_work_item_lineage',
      columns: [table.workItemId, table.organizationId, table.projectId],
      foreignColumns: workItemLineageColumns(),
    }).onDelete('restrict'),
    index('ix_acceptance_contract_versions_tenant').on(
      table.organizationId,
      table.projectId,
      table.workItemId,
    ),
    index('ix_acceptance_contract_versions_approver').on(table.approverUserId, table.confirmedAt),
  ],
);

export type AcceptanceContractVersion = typeof acceptanceContractVersions.$inferSelect;
export type NewAcceptanceContractVersion = typeof acceptanceContractVersions.$inferInsert;
