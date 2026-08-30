import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { acceptanceContractVersions } from './acceptance-contract-versions.js';
import { organizations } from './organizations.js';
import { projects } from './projects.js';
import { teamWorkItems } from './team-work-items.js';
import { users } from './users.js';

export const teamWorkItemEvents = mysqlTable(
  'team_work_item_events',
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
    actorUserId: bigint('actor_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    eventType: varchar('event_type', { length: 48 }).notNull(),
    fromState: varchar('from_state', { length: 32 }),
    toState: varchar('to_state', { length: 32 }),
    contractVersionId: bigint('contract_version_id', { mode: 'number', unsigned: true }).references(
      () => acceptanceContractVersions.id,
      { onDelete: 'restrict' },
    ),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    metadataJson: json('metadata_json'),
    occurredAt: datetime('occurred_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_team_work_item_events_external_id').on(table.externalId),
    uniqueIndex('uk_team_work_item_events_organization_idempotency').on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index('ix_team_work_item_events_item_time').on(table.workItemId, table.occurredAt),
    index('ix_team_work_item_events_tenant_type').on(
      table.organizationId,
      table.projectId,
      table.eventType,
    ),
    index('ix_team_work_item_events_actor').on(table.actorUserId, table.occurredAt),
  ],
);

export type TeamWorkItemEvent = typeof teamWorkItemEvents.$inferSelect;
export type NewTeamWorkItemEvent = typeof teamWorkItemEvents.$inferInsert;
