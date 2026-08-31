import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const organizationMembers = mysqlTable(
  'organization_members',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: varchar('role', { length: 16 }).notNull(),
    managerUserId: bigint('manager_user_id', { mode: 'number', unsigned: true }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    joinedAt: datetime('joined_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_organization_members_external_id').on(table.externalId),
    uniqueIndex('uk_organization_members_organization_user').on(table.organizationId, table.userId),
    index('ix_organization_members_organization_status').on(table.organizationId, table.status),
    index('ix_organization_members_user_status').on(table.userId, table.status),
    index('ix_organization_members_manager_status').on(
      table.organizationId,
      table.managerUserId,
      table.status,
    ),
  ],
);

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
