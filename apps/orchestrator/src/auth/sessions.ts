import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { authSessions } from '../db/schema/auth-sessions.js';
import { users } from '../db/schema/users.js';
import { runOwnedDatabaseQuery } from '../execution/original-database-query.js';
import { type AccessTokenClaims, signAccessToken } from './jwt.js';

export const SESSION_CACHE_TTL_MS = 30_000;
const caches = new WeakMap<DB, Map<string, number>>();
function cacheFor(db: DB) {
  let cache = caches.get(db);
  if (!cache) {
    cache = new Map();
    caches.set(db, cache);
  }
  return cache;
}
export async function issueSessionAccessToken(
  db: DB,
  claims: Omit<AccessTokenClaims, 'sid'>,
): Promise<string> {
  const sid = randomUUID();
  await runOwnedDatabaseQuery(() =>
    db.insert(authSessions).values({
      sid,
      userExternalId: claims.sub,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
    }),
  );
  return signAccessToken({ ...claims, sid });
}
export async function isSessionActive(db: DB, userId: string, sid: string): Promise<boolean> {
  const cache = cacheFor(db);
  const key = `${userId}:${sid}`;
  const started = Date.now();
  if ((cache.get(key) ?? 0) > started) return true;
  cache.delete(key);
  const [row] = await runOwnedDatabaseQuery(() =>
    db
      .select({
        sid: authSessions.sid,
        expiresAt: authSessions.expiresAt,
        revokedAt: authSessions.revokedAt,
      })
      .from(authSessions)
      .where(and(eq(authSessions.sid, sid), eq(authSessions.userExternalId, userId)))
      .limit(1),
  );
  if (
    !row ||
    row.revokedAt ||
    row.expiresAt.getTime() <= Date.now() ||
    Date.now() - started >= SESSION_CACHE_TTL_MS
  )
    return false;
  // Bound memory; eviction only adds database reads, never grants access.
  if (cache.size >= 10_000) cache.clear();
  cache.set(key, Math.min(started + SESSION_CACHE_TTL_MS, row.expiresAt.getTime()));
  return true;
}
export async function revokeSession(db: DB, userId: string, sid: string): Promise<void> {
  await runOwnedDatabaseQuery(() =>
    db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.sid, sid), eq(authSessions.userExternalId, userId))),
  );
  cacheFor(db).delete(`${userId}:${sid}`);
}
export async function revokeAllSessions(db: DB, userId: string): Promise<void> {
  await runOwnedDatabaseQuery(() =>
    db
      .update(users)
      .set({ authVersion: sql`${users.authVersion} + 1` })
      .where(eq(users.externalId, userId)),
  );
  caches.delete(db);
}
