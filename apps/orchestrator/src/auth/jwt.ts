import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';

const ISSUER = 'holaday-orchestrator';
const AUDIENCE = 'holaday-app';
const ALGORITHM = 'HS256';
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
/**
 * Item 6 — short-lived audience for streaming WebSocket auth.
 * The SPA fetches one of these per screencast/VNC connect via
 * /api/stream-token, swaps it into the WS URL, and discards it.
 * 60s is enough to ride out a slow CDN handshake but short enough
 * that a token leaked into a console or screen share expires before
 * it's useful.
 */
const STREAM_TOKEN_TTL_SECONDS = 60;
const STREAM_AUDIENCE = 'holaday-stream';

const key = new TextEncoder().encode(env.JWT_SECRET);

export interface AccessTokenClaims {
  sub: string; // user external_id (usr_...)
  plan: string;
  authVersion: number;
}

export async function signAccessToken(
  claims: Omit<AccessTokenClaims, 'authVersion'> & { authVersion?: number },
): Promise<string> {
  return new SignJWT({ plan: claims.plan, authVersion: claims.authVersion ?? 0 })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== 'string' || typeof payload.plan !== 'string') return null;
    const authVersion =
      payload.authVersion === undefined
        ? 0
        : typeof payload.authVersion === 'number' &&
            Number.isInteger(payload.authVersion) &&
            payload.authVersion >= 0
          ? payload.authVersion
          : null;
    if (authVersion === null) return null;
    return { sub: payload.sub, plan: payload.plan, authVersion };
  } catch {
    return null;
  }
}

/**
 * Mint a short-lived JWT for streaming WS connections (screencast,
 * VNC). Different audience so a leak can't be replayed against the
 * tRPC API or the workbench WS.
 */
export async function signStreamToken(sub: string): Promise<{ token: string; expiresIn: number }> {
  const token = await new SignJWT({ purpose: 'stream' })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(STREAM_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${STREAM_TOKEN_TTL_SECONDS}s`)
    .sign(key);
  return { token, expiresIn: STREAM_TOKEN_TTL_SECONDS };
}

/**
 * Verify only the short-lived streaming token. Long-lived access
 * token fallback requires a database-backed account/session check
 * and therefore lives in auth/middleware.ts.
 */
export async function verifyStreamToken(token: string): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: STREAM_AUDIENCE,
    });
    if (typeof payload.sub !== 'string') return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}
