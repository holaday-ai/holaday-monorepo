import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { pendingCookies } from '../db/schema/pending-cookies.js';
import { users } from '../db/schema/users.js';
/** A legacy queued payload has no exact-site consent. Never migrate it by guessing a grant.
 * Explicit new consent/revoke/clear invalidates that owner's old recoverable queue instead.
 */
export async function purgeLegacyCookiesForVault(db: DB, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.externalId, userId))
      .limit(1)
      .for('update');
    if (!user || user.status !== 'active') throw new Error('user_unavailable');
    await tx.delete(pendingCookies).where(eq(pendingCookies.userId, user.id));
  });
}
