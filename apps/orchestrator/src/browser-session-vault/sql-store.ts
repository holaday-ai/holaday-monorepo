import { and, asc, eq, gt } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { browserSessionVaults } from '../db/schema/browser-session-vaults.js';
import { users } from '../db/schema/users.js';
import { type VaultDocument, VaultError, type VaultStore } from './vault.js';

/** The active-owner row is locked before the vault row, across all operations/processes.
 * Revocation and saves serialize on the same DB lock; old writers cannot resurrect state.
 * Closure status is checked on EVERY read/decrypt/import/save (including after a restart).
 */
export class SqlVaultStore implements VaultStore {
  constructor(private readonly db: DB) {}
  async owners(after: number) {
    return this.db
      .select({ id: browserSessionVaults.id, userId: users.externalId })
      .from(browserSessionVaults)
      .innerJoin(users, eq(users.id, browserSessionVaults.userId))
      .where(and(gt(browserSessionVaults.id, after), eq(users.status, 'active')))
      .orderBy(asc(browserSessionVaults.id))
      .limit(100);
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
      if (!Array.isArray(document.grants) || document.grants.length > 100)
        throw new VaultError('vault_corrupt');
      const result = await change(document);
      if (Buffer.byteLength(JSON.stringify(document)) > 8 * 1024 * 1024)
        throw new VaultError('vault_capacity');
      if (row) {
        const updated = await tx
          .update(browserSessionVaults)
          .set({ document, revision: row.revision + 1 })
          .where(
            and(
              eq(browserSessionVaults.id, row.id),
              eq(browserSessionVaults.userId, user.id),
              eq(browserSessionVaults.revision, row.revision),
            ),
          );
        if (readAffectedRows(updated) !== 1) throw new VaultError('cas_conflict');
      } else
        await tx.insert(browserSessionVaults).values({ userId: user.id, revision: 1, document });
      return result;
    });
  }
}
