import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  datetime,
  int,
  mysqlTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/**
 * Binary columns expressed as Buffer in/out. Drizzle 0.38's built-in
 * `varbinary` helper types its driverData as string (cookie payloads
 * are not text), so customType keeps the typing honest end-to-end —
 * sync-service writes Buffers; reads return Buffers; the encryption
 * helper never has to round-trip through hex/base64.
 */
const mediumblob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'mediumblob';
  },
});
const fixedVarbinary = (length: number) =>
  customType<{ data: Buffer; driverData: Buffer }>({
    dataType() {
      return `varbinary(${length})`;
    },
  });

/**
 * `pending_cookies` — extension-shipped cookies waiting for injection
 * into the user's next allocated Brave instance. One row per user;
 * the sync endpoint upserts on uk_pending_cookies_user_id.
 *
 * The runtime path:
 *   1. Extension POSTs SyncableCookie[] to /api/cookies/sync
 *   2. Endpoint upserts the row, then tries an immediate inject if
 *      a live executor exists
 *   3. If no executor, the row sits here. BrowserPool.allocate calls
 *      injectPendingCookies() which reads + injects + deletes.
 */
export const pendingCookies = mysqlTable(
  'pending_cookies',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Legacy plaintext storage. Kept as nullable during the Spec B
     * envelope-encryption rollout so a rollback of the new code can
     * still read existing rows from this column. Will be dropped in
     * a follow-up migration after the soak window closes.
     */
    cookiesJson: text('cookies_json'),
    /**
     * Spec B envelope encryption — AES-256-GCM ciphertext of the
     * JSON payload, encrypted under a per-row data key that's itself
     * wrapped by the master key from `COOKIE_MASTER_KEY`. See
     * `cookies/cookie-crypto.ts` for the layout. Nullable until the
     * 0019 migration drops `cookies_json` and flips these to NOT
     * NULL.
     */
    encryptedBlob: mediumblob('encrypted_blob'),
    encryptionIv: fixedVarbinary(12)('encryption_iv'),
    encryptionTag: fixedVarbinary(16)('encryption_tag'),
    encryptedKey: fixedVarbinary(256)('encrypted_key'),
    cookieCount: int('cookie_count', { unsigned: true }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('uk_pending_cookies_user_id').on(t.userId)],
);

export type PendingCookies = typeof pendingCookies.$inferSelect;
export type NewPendingCookies = typeof pendingCookies.$inferInsert;
