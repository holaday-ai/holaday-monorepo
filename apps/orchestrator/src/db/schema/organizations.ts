import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  datetime,
  index,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import type { ModelDataRegion } from '../../llm/model-data-region.js';
import { users } from './users.js';

export const organizations = mysqlTable(
  'organizations',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    ownerUserId: bigint('owner_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    teamProjectsEnabled: boolean('team_projects_enabled').notNull().default(false),
    /** Organization-project processing region; null until explicitly assigned. */
    modelDataRegion: varchar('model_data_region', { length: 8 }).$type<ModelDataRegion>(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_organizations_external_id').on(table.externalId),
    index('ix_organizations_owner').on(table.ownerUserId),
    index('ix_organizations_status').on(table.status),
    check(
      'ck_organizations_model_data_region',
      sql`${table.modelDataRegion} IS NULL OR ${table.modelDataRegion} IN ('cn', 'intl')`,
    ),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
