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
import { z } from 'zod';
import { logger } from '../config/logger.js';
import type { db as DbHandle } from '../db/client.js';
import { pendingCookies } from '../db/schema/pending-cookies.js';
import { users } from '../db/schema/users.js';
import { decryptCookieJson, encryptCookieJson } from './cookie-crypto.js';

/**
 * Domains the extension is allowed to sync cookies for. Mirrors the
 * extension's curated TRACKED_DOMAINS list — but enforced HERE, not
 * just there, so a tampered or cloned extension can't widen the
 * scope. A cookie's `domain` may include a leading dot or be a
 * subdomain (e.g. `.tmall.com`, `login.taobao.com`); we accept any
 * value that ends with `.<base>` or equals `<base>`.
 *
 * Ordered roughly by traffic — irrelevant for correctness, but the
 * `endsWith` loop below short-circuits on the first match.
 */
const ALLOWED_BASE_DOMAINS = [
  'jd.com',
  'taobao.com',
  'tmall.com',
  'pinduoduo.com',
  'ctrip.com',
  'qunar.com',
  'fliggy.com',
  'zhipin.com',
  'liepin.com',
  'lagou.com',
  'xiaohongshu.com',
  'weibo.com',
  'zhihu.com',
  'meituan.com',
  'dianping.com',
  'xueqiu.com',
  'tianyancha.com',
  'qcc.com',
  'github.com',
] as const;

/**
 * zod schema for an inbound cookie. Caps lengths so a malformed
 * payload can't blow up the JSON column or the CDP cookie-add
 * (Chrome's own limit is ~4096 bytes per cookie).
 */
export const syncableCookieSchema = z.object({
  domain: z.string().min(1).max(253),
  name: z.string().min(1).max(256),
  value: z.string().max(4096),
  path: z.string().max(256).optional(),
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: z.string().max(32).optional(),
  expirationDate: z.number().optional(),
});

export type SyncableCookie = z.infer<typeof syncableCookieSchema>;

/**
 * Domain-whitelist check. `cookieDomain` may have a leading dot or
 * be a subdomain — we strip the dot and accept exact match or
 * `.<base>` suffix. Invalid hostnames (uppercase, embedded slashes,
 * etc.) fail closed.
 */
export function isAllowedCookieDomain(cookieDomain: string): boolean {
  const d = cookieDomain.trim().toLowerCase().replace(/^\./, '');
  if (!d || /[^a-z0-9.-]/.test(d)) return false;
  for (const base of ALLOWED_BASE_DOMAINS) {
    if (d === base || d.endsWith(`.${base}`)) return true;
  }
  return false;
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
 *
 * Spec B rollout — dual-write phase. We write the four envelope-
 * encryption columns AND the legacy `cookies_json` column. The new
 * read path prefers encrypted; the old read path (if rolled back to)
 * still finds plaintext in cookies_json. Once the 30-day soak ends
 * the next migration will drop cookies_json and the second branch
 * here becomes a no-op to delete.
 */
export async function upsertPendingCookies(
  db: typeof DbHandle,
  userInternalId: number,
  cookies: readonly SyncableCookie[],
): Promise<{ count: number }> {
  const json = JSON.stringify(cookies);
  const enc = encryptCookieJson(json);
  await db
    .insert(pendingCookies)
    .values({
      userId: userInternalId,
      cookiesJson: json,
      encryptedBlob: enc.encryptedBlob,
      encryptionIv: enc.encryptionIv,
      encryptionTag: enc.encryptionTag,
      encryptedKey: enc.encryptedKey,
      cookieCount: cookies.length,
    })
    .onDuplicateKeyUpdate({
      set: {
        cookiesJson: json,
        encryptedBlob: enc.encryptedBlob,
        encryptionIv: enc.encryptionIv,
        encryptionTag: enc.encryptionTag,
        encryptedKey: enc.encryptedKey,
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
    .select({
      id: pendingCookies.id,
      cookiesJson: pendingCookies.cookiesJson,
      encryptedBlob: pendingCookies.encryptedBlob,
      encryptionIv: pendingCookies.encryptionIv,
      encryptionTag: pendingCookies.encryptionTag,
      encryptedKey: pendingCookies.encryptedKey,
    })
    .from(pendingCookies)
    .where(eq(pendingCookies.userId, userRow.id))
    .limit(1);
  if (!row) return 0;

  // Spec B — prefer the encrypted columns when present, fall back to
  // legacy plaintext. Decrypt failure (auth tag mismatch, wrong key,
  // corrupted blob) drops the row + logs rather than returning stale
  // data; the user's next sync repopulates.
  let payloadJson: string | null = null;
  if (
    row.encryptedBlob &&
    row.encryptionIv &&
    row.encryptionTag &&
    row.encryptedKey
  ) {
    try {
      payloadJson = decryptCookieJson({
        encryptedBlob: row.encryptedBlob,
        encryptionIv: row.encryptionIv,
        encryptionTag: row.encryptionTag,
        encryptedKey: row.encryptedKey,
      });
    } catch (err) {
      logger.warn(
        { err: errMsg(err), userExternalId: opts.userExternalId },
        'cookie-sync: encrypted payload failed to decrypt; dropping row',
      );
      await opts.db.delete(pendingCookies).where(eq(pendingCookies.id, row.id));
      return 0;
    }
  } else if (row.cookiesJson) {
    payloadJson = row.cookiesJson;
  } else {
    // Empty row (no plaintext, no ciphertext) — drop and skip.
    await opts.db.delete(pendingCookies).where(eq(pendingCookies.id, row.id));
    return 0;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
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
