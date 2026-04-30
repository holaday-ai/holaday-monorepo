/**
 * Phase 17 — extension-driven cookie sync.
 *
 * The Chrome extension reads cookies for a curated list of high-
 * frequency sites and POSTs them here. Two paths from receipt:
 *
 *   1. User has a live Brave instance in the BrowserPool → inject
 *      via Playwright's BrowserContext.addCookies() immediately so
 *      the next agent task on jd.com / taobao.com is already
 *      logged in.
 *   2. No live instance → park the payload in `pending_cookies`.
 *      BrowserPool's spawn path drains the row on next allocate.
 *
 * The send shape mirrors chrome.cookies.Cookie. We translate to
 * Playwright's expected shape inside `injectCookies` — Playwright
 * normalises sameSite + path defaults itself, so the helper is
 * thin on purpose.
 */

import type { BrowserContext } from 'playwright';
import { eq, sql } from 'drizzle-orm';
import { logger } from '../config/logger.js';
import type { db as DbHandle } from '../db/client.js';
import { pendingCookies } from '../db/schema/pending-cookies.js';
import { users } from '../db/schema/users.js';

export interface SyncableCookie {
  domain: string;
  name: string;
  value: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  /** Seconds since epoch (chrome.cookies format). Optional → session cookie. */
  expirationDate?: number;
}

/** Hard cap on a single sync payload. Power users can have a few hundred
 *  cookies across the curated domain list; 5 000 is comfortably above
 *  worst real-world case and below anything that would risk a slow
 *  CDP injection loop. Endpoint rejects payloads above this. */
export const MAX_COOKIES_PER_SYNC = 5_000;

/**
 * Replace the user's pending cookie payload with the new one. Idempotent
 * across retries — the unique index on user_id makes this a true
 * upsert via ON DUPLICATE KEY UPDATE.
 */
export async function upsertPendingCookies(
  db: typeof DbHandle,
  userInternalId: number,
  cookies: readonly SyncableCookie[],
): Promise<{ count: number }> {
  const json = JSON.stringify(cookies);
  await db
    .insert(pendingCookies)
    .values({
      userId: userInternalId,
      cookiesJson: json,
      cookieCount: cookies.length,
    })
    .onDuplicateKeyUpdate({
      set: {
        cookiesJson: json,
        cookieCount: cookies.length,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      },
    });
  return { count: cookies.length };
}

/**
 * Inject (and clear) any parked cookies for `userExternalId` into the
 * given Playwright context. Best-effort: a missing pending row is a
 * silent no-op, malformed JSON drops the row + logs.
 *
 * Returns the count of cookies that were injected. Caller (BrowserPool
 * spawn path) treats the call as side-effect-only.
 */
export async function injectPendingCookies(opts: {
  db: typeof DbHandle;
  context: BrowserContext;
  userExternalId: string;
}): Promise<number> {
  const [userRow] = await opts.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, opts.userExternalId))
    .limit(1);
  if (!userRow) return 0;
  const [row] = await opts.db
    .select({ id: pendingCookies.id, cookiesJson: pendingCookies.cookiesJson })
    .from(pendingCookies)
    .where(eq(pendingCookies.userId, userRow.id))
    .limit(1);
  if (!row) return 0;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.cookiesJson);
  } catch (err) {
    logger.warn(
      { err: errMsg(err), userExternalId: opts.userExternalId },
      'cookie-sync: pending row had invalid JSON; dropping',
    );
    await opts.db.delete(pendingCookies).where(eq(pendingCookies.id, row.id));
    return 0;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    await opts.db.delete(pendingCookies).where(eq(pendingCookies.id, row.id));
    return 0;
  }

  const cookies = parsed as SyncableCookie[];
  await injectCookies(opts.context, cookies);

  // Clear AFTER injection so a mid-loop throw leaves the row for the
  // next allocate to retry.
  await opts.db.delete(pendingCookies).where(eq(pendingCookies.id, row.id));
  logger.info(
    { userExternalId: opts.userExternalId, count: cookies.length },
    'cookie-sync: injected pending cookies on allocate',
  );
  return cookies.length;
}

/**
 * Best-effort cookie injection via Playwright's BrowserContext.
 * Per-cookie validation errors land as a single warn log + an array
 * of skipped names — never throws. Caller may invoke directly
 * (immediate-inject path) or via injectPendingCookies (drain).
 */
export async function injectCookies(
  context: BrowserContext,
  cookies: readonly SyncableCookie[],
): Promise<void> {
  if (cookies.length === 0) return;
  const playwrightCookies = cookies
    .map((c) => mapToPlaywrightCookie(c))
    .filter((c): c is NonNullable<typeof c> => c !== null);
  if (playwrightCookies.length === 0) return;
  try {
    await context.addCookies(playwrightCookies);
  } catch (err) {
    // Single shot fails on the first invalid cookie — fall back to
    // per-cookie loop so one bad entry doesn't poison the batch.
    logger.warn(
      { err: errMsg(err), batchSize: playwrightCookies.length },
      'cookie-sync: bulk addCookies failed, falling back to per-cookie',
    );
    for (const cookie of playwrightCookies) {
      try {
        await context.addCookies([cookie]);
      } catch (perErr) {
        logger.debug(
          { err: errMsg(perErr), domain: cookie.domain, name: cookie.name },
          'cookie-sync: per-cookie inject failed',
        );
      }
    }
  }
}

/**
 * Map a chrome.cookies.Cookie payload (shipped by the extension) to
 * Playwright's expected cookie shape. Returns null when the payload
 * is missing required fields — caller filters nulls out.
 */
function mapToPlaywrightCookie(c: SyncableCookie): {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
} | null {
  if (!c.name || !c.domain) return null;
  const sameSite = mapSameSite(c.sameSite);
  return {
    name: c.name,
    value: c.value ?? '',
    domain: c.domain,
    path: c.path && c.path.length > 0 ? c.path : '/',
    secure: Boolean(c.secure),
    httpOnly: Boolean(c.httpOnly),
    ...(sameSite ? { sameSite } : {}),
    ...(c.expirationDate ? { expires: c.expirationDate } : {}),
  };
}

function mapSameSite(s?: string): 'Strict' | 'Lax' | 'None' | undefined {
  switch ((s ?? '').toLowerCase()) {
    case 'no_restriction':
    case 'none':
      return 'None';
    case 'lax':
      return 'Lax';
    case 'strict':
      return 'Strict';
    default:
      return undefined;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
