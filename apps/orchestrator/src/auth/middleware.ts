import { DEFAULT_TASK_ORIGIN, type TaskOrigin } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import type { DB } from '../db/client.js';
import { db } from '../db/client.js';
import { users } from '../db/schema/users.js';
import { runOwnedDatabaseQuery } from '../execution/original-database-query.js';
import { verifyAccessToken, verifyStreamToken } from './jwt.js';

import { isSessionActive } from './sessions.js';

const BEARER_PREFIX = 'Bearer ';

export interface AuthenticatedSession {
  userId: string;
  sid?: string;
  authVersion: number;
  taskOrigin?: TaskOrigin;
}

async function activeUserSession(
  database: DB,
  userId: string,
  authVersion: number,
  taskOrigin?: TaskOrigin,
  sid?: string,
): Promise<AuthenticatedSession | null> {
  const [user] = await runOwnedDatabaseQuery(() =>
    database
      .select({
        externalId: users.externalId,
        status: users.status,
        authVersion: users.authVersion,
      })
      .from(users)
      .where(eq(users.externalId, userId))
      .limit(1),
  );
  if (!user || user.status !== 'active' || user.authVersion !== authVersion) {
    return null;
  }
  if (sid && !(await isSessionActive(database, userId, sid))) return null;
  return {
    ...(sid ? { sid } : {}),
    userId: user.externalId,
    authVersion: user.authVersion,
    ...(taskOrigin ? { taskOrigin } : {}),
  };
}

export async function authenticateAccessTokenSession(
  database: DB,
  token: string,
): Promise<AuthenticatedSession | null> {
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  return activeUserSession(database, claims.sub, claims.authVersion, claims.taskOrigin, claims.sid);
}

export async function authenticateBearerSession(
  database: DB,
  header: string | undefined,
): Promise<AuthenticatedSession | null> {
  if (!header?.startsWith(BEARER_PREFIX)) return null;
  return authenticateAccessTokenSession(database, header.slice(BEARER_PREFIX.length).trim());
}

export async function authenticateBearerHeader(
  database: DB,
  header: string | undefined,
): Promise<string | null> {
  return (await authenticateBearerSession(database, header))?.userId ?? null;
}

export async function authenticateAccessToken(database: DB, token: string): Promise<string | null> {
  return (await authenticateAccessTokenSession(database, token))?.userId ?? null;
}

/**
 * Authenticate a token at WebSocket upgrade time and retain the versioned
 * account session for later revalidation. A stream JWT is intentionally only
 * valid for the handshake; using it again after its 60-second TTL would tear
 * down an otherwise healthy browser takeover session.
 */
export async function authenticateStreamOrAccessSession(
  database: DB,
  token: string,
): Promise<AuthenticatedSession | null> {
  const streamClaims = await verifyStreamToken(token);
  if (streamClaims) {
    return activeUserSession(
      database,
      streamClaims.sub,
      streamClaims.authVersion,
      undefined,
      streamClaims.sid,
    );
  }
  return authenticateAccessTokenSession(database, token);
}

/**
 * Revalidate an already established browser session without reusing its
 * short-lived connection token. Account suspension and auth-version changes
 * still close the socket immediately.
 */
export async function revalidateAuthenticatedSession(
  database: DB,
  session: AuthenticatedSession,
): Promise<boolean> {
  return (
    (await activeUserSession(
      database,
      session.userId,
      session.authVersion,
      session.taskOrigin,
      session.sid,
    )) !== null
  );
}

export async function authenticateStreamOrAccessToken(
  database: DB,
  token: string,
): Promise<string | null> {
  return (await authenticateStreamOrAccessSession(database, token))?.userId ?? null;
}

export async function bearerAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await authenticateBearerSession(db, req.header('authorization'));
    if (session) {
      const authenticatedRequest = req as Request & {
        userId?: string;
        userAuthVersion?: number;
        userSessionId?: string;
        taskOrigin?: TaskOrigin;
      };
      authenticatedRequest.userId = session.userId;
      if (session.sid) authenticatedRequest.userSessionId = session.sid;
      authenticatedRequest.userAuthVersion = session.authVersion;
      authenticatedRequest.taskOrigin = session.taskOrigin ?? DEFAULT_TASK_ORIGIN;
    }
  } catch {
    // Authentication must fail closed if the account lookup is
    // unavailable. Public routes can continue; protected routes return
    // UNAUTHORIZED because userId was not attached.
  }
  next();
}
