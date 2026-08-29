import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  datetime,
  index,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const organizationInvitations = mysqlTable(
  'organization_invitations',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    organizationId: bigint('organization_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    role: varchar('role', { length: 16 }).notNull(),
    managerUserId: bigint('manager_user_id', { mode: 'number', unsigned: true }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    invitedByUserId: bigint('invited_by_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    acceptedAt: datetime('accepted_at', { mode: 'date', fsp: 3 }),
    revokedAt: datetime('revoked_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uk_organization_invitations_external_id').on(table.externalId),
    uniqueIndex('uk_organization_invitations_token_hash').on(table.tokenHash),
    index('ix_organization_invitations_active').on(
      table.organizationId,
      table.acceptedAt,
      table.revokedAt,
      table.expiresAt,
    ),
  ],
);

export type OrganizationInvitation = typeof organizationInvitations.$inferSelect;
export type NewOrganizationInvitation = typeof organizationInvitations.$inferInsert;
