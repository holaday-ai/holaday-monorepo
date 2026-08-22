import { sql } from 'drizzle-orm';
import { bigint, datetime, index, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/** High-entropy, single-use MFA recovery codes. Only keyed digests are stored. */
export const userMfaRecoveryCodes = mysqlTable(
  'user_mfa_recovery_codes',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    consumedAt: datetime('consumed_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uk_user_mfa_recovery_code').on(table.userId, table.codeHash),
    index('ix_user_mfa_recovery_available').on(table.userId, table.consumedAt),
  ],
);
