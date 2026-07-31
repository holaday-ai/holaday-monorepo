import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { db } from '../db/client.js';
import { users } from '../db/schema/users.js';
import { verifyAccessToken, verifyStreamToken } from './jwt.js';

const BEARER_PREFIX = 'Bearer ';

export async function authenticateBearerHeader(
  database: DB,
  header: string | undefined,
): Promise<string | null> {
  if (!header?.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return authenticateAccessToken(database, token);
}

export async function authenticateAccessToken(
  database: DB,
  token: string,
): Promise<string | null> {
  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  const [user] = await database
    .select({
      externalId: users.externalId,
      status: users.status,
      authVersion: users.authVersion,
    })
    .from(users)
    .where(eq(users.externalId, claims.sub))
    .limit(1);
  if (
    !user ||
    user.status !== 'active' ||
    user.authVersion !== claims.authVersion
  ) {
    return null;
  }
  return user.externalId;
}

export async function authenticateStreamOrAccessToken(
  database: DB,
  token: string,
): Promise<string | null> {
  const streamClaims = await verifyStreamToken(token);
  if (streamClaims) return streamClaims.sub;
  return authenticateAccessToken(database, token);
}

export async function bearerAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = await authenticateBearerHeader(db, req.header('authorization'));
    if (userId) {
      (req as Request & { userId?: string }).userId = userId;
    }
  } catch {
    // Authentication must fail closed if the account lookup is
    // unavailable. Public routes can continue; protected routes return
    // UNAUTHORIZED because userId was not attached.
  }
  next();
}
