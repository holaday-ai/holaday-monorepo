import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { browserSessionVaults } from '../db/schema/browser-session-vaults.js';
import { users } from '../db/schema/users.js';
import {
  MAX_ACTIVE_GRANTS,
  type VaultDocument,
  VaultError,
  type VaultStore,
  nextExpiryAt,
} from './vault.js';

/** Active grants plus the pruned inactive history kept for the settings page. */
const MAX_GRANT_RECORDS = MAX_ACTIVE_GRANTS + 20;

/** The active-owner row is locked before the vault row, across all operations/processes.
 * Revocation and saves serialize on the same DB lock; old writers cannot resurrect state.
 * Closure status is checked on EVERY read/decrypt/import/save (including after a restart).
 */
export class SqlVaultStore implements VaultStore {
  constructor(private readonly db: DB) {}
  /** Owners with a live grant due to expire, earliest first (indexed, bounded batch). */
  async due(now: number, limit = 100) {
    return this.db
      .select({ id: browserSessionVaults.id, userId: users.externalId })
      .from(browserSessionVaults)
      .innerJoin(users, eq(users.id, browserSessionVaults.userId))
      .where(
        and(
          isNotNull(browserSessionVaults.nextExpiryAt),
          lte(browserSessionVaults.nextExpiryAt, now),
          eq(users.status, 'active'),
        ),
      )
      .orderBy(asc(browserSessionVaults.nextExpiryAt))
      .limit(limit);
  }
  /** Lock-free read for status checks and listing; never writes. */
  async read<T>(userId: string, view: (doc: VaultDocument) => T | Promise<T>): Promise<T> {
    const [row] = await this.db
      .select({ status: users.status, document: browserSessionVaults.document })
      .from(users)
      .leftJoin(browserSessionVaults, eq(browserSessionVaults.userId, users.id))
      .where(eq(users.externalId, userId))
      .limit(1);
    if (!row || row.status !== 'active') throw new VaultError('user_unavailable');
    const document: VaultDocument = row.document ? structuredClone(row.document) : { grants: [] };
    if (!Array.isArray(document.grants) || document.grants.length > MAX_GRANT_RECORDS)
      throw new VaultError('vault_corrupt');
    return view(document);
  }
  async update<T>(userId: string, change: (doc: VaultDocument) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.externalId, userId))
        .limit(1)
        .for('update');
      if (!user || user.status !== 'active') throw new VaultError('user_unavailable');
      const [row] = await tx
        .select()
        .from(browserSessionVaults)
        .where(eq(browserSessionVaults.userId, user.id))
        .limit(1)
        .for('update');
      const document: VaultDocument = row ? structuredClone(row.document) : { grants: [] };
      if (!Array.isArray(document.grants) || document.grants.length > MAX_GRANT_RECORDS)
        throw new VaultError('vault_corrupt');
      const result = await change(document);
      if (Buffer.byteLength(JSON.stringify(document)) > 8 * 1024 * 1024)
        throw new VaultError('vault_capacity');
      if (row) {
        const updated = await tx
          .update(browserSessionVaults)
          .set({ document, revision: row.revision + 1, nextExpiryAt: nextExpiryAt(document) })
          .where(
            and(
              eq(browserSessionVaults.id, row.id),
              eq(browserSessionVaults.userId, user.id),
              eq(browserSessionVaults.revision, row.revision),
            ),
          );
        if (readAffectedRows(updated) !== 1) throw new VaultError('cas_conflict');
      } else
        await tx.insert(browserSessionVaults).values({
          userId: user.id,
          revision: 1,
          document,
          nextExpiryAt: nextExpiryAt(document),
        });
      return result;
    });
  }
}
