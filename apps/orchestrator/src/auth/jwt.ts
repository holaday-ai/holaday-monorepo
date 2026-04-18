import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';

const ISSUER = 'holaday-orchestrator';
const AUDIENCE = 'holaday-app';
const ALGORITHM = 'HS256';
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const key = new TextEncoder().encode(env.JWT_SECRET);

export interface AccessTokenClaims {
  sub: string; // user external_id (usr_...)
  plan: string;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ plan: claims.plan })
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
    return { sub: payload.sub, plan: payload.plan };
  } catch {
    return null;
  }
}
