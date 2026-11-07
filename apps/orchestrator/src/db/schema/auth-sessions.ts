import { bigint, datetime, index, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/** One login/device; account-wide revocation remains users.authVersion. */
export const authSessions = mysqlTable(
  'auth_sessions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    sid: varchar('sid', { length: 36 }).notNull(),
    userExternalId: varchar('user_external_id', { length: 32 })
      .notNull()
      .references(() => users.externalId, { onDelete: 'cascade' }),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    revokedAt: datetime('revoked_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [
    uniqueIndex('uk_auth_sessions_sid').on(t.sid),
    index('ix_auth_sessions_user').on(t.userExternalId),
    index('ix_auth_sessions_expiry').on(t.expiresAt),
  ],
);
