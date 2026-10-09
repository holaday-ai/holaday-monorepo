import { bigint, int, json, mysqlTable, uniqueIndex } from 'drizzle-orm/mysql-core';
import type { VaultDocument } from '../../browser-session-vault/vault.js';
import { users } from './users.js';
/** Metadata and authenticated ciphertext only; never a plaintext storage-state column. */
export const browserSessionVaults = mysqlTable(
  'browser_session_vaults',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    revision: int('revision', { unsigned: true }).notNull(),
    document: json('document').$type<VaultDocument>().notNull(),
  },
  (t) => [uniqueIndex('uk_browser_session_vault_user').on(t.userId)],
);
