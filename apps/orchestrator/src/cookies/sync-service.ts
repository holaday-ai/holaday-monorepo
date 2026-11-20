import { env } from '../config/env.js';
/** Retired legacy transport helpers, retained for compatibility tests and cleanup.
 * Runtime ingress and pool injection are disabled. Writers are ciphertext-only;
 * readers never load or fall back to the retired plaintext column.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { eq, sql } from 'drizzle-orm';
import type { BrowserContext } from 'playwright';
import { z } from 'zod';
import {
  assertBrowserSettlementOpen,
  runBrowserOperation,
} from '../agent/vision-loop/browser-operation.js';
import { logger } from '../config/logger.js';
import type { db as DbHandle } from '../db/client.js';
import { pendingCookies } from '../db/schema/pending-cookies.js';
import { users } from '../db/schema/users.js';
import { currentOperationLifetime, startOwnedOperation } from '../execution/owned-operation.js';
import { decryptCookieJson, encryptCookieJson } from './cookie-crypto.js';

function assertCookieDispatch() {
  assertBrowserSettlementOpen();
  const lifetime = currentOperationLifetime();
  if (lifetime) {
    lifetime.drain.assertDispatch(lifetime.owner);
    if (lifetime.drain.snapshot().unknown > 0) throw new Error('COOKIE_OPERATION_UNKNOWN');
  }
  return lifetime;
}

/** Private raw boundary; a caller timeout cannot release this database operation. */
async function runCookieDatabase<T>(action: () => PromiseLike<T>, deletion = false): Promise<T> {
  const lifetime = assertCookieDispatch();
  if (!lifetime) return action();
  return startOwnedOperation(
    lifetime.drain,
    'database',
    async () => {
      const result = await action();
      if (deletion) {
        const head: unknown = Array.isArray(result) ? result[0] : result;
        const affectedRows =
          head && typeof head === 'object' && 'affectedRows' in head
            ? head.affectedRows
            : undefined;
        if (affectedRows !== 0 && affectedRows !== 1) throw new Error('COOKIE_DELETE_ACK_UNKNOWN');
      }
      return result;
    },
    { parent: lifetime.owner, dispatch: 'immediate', errorOutcome: 'unknown' },
  ).result;
}

async function deletePendingCookie(db: typeof DbHandle, id: number): Promise<void> {
  await runCookieDatabase(() => db.delete(pendingCookies).where(eq(pendingCookies.id, id)), true);
}

async function addCookieBatch(
  context: BrowserContext,
  cookies: Parameters<BrowserContext['addCookies']>[0],
): Promise<void> {
  // Validate the original caller's scope too: the raw child has its own ALS scope.
  const assertCaller = AsyncLocalStorage.bind(assertCookieDispatch);
  assertCaller();
  let denied: { error: unknown } | undefined;
  await runBrowserOperation(() => {
    const add = context.addCookies;
    try {
      assertCaller();
    } catch (error) {
      denied = { error };
      return;
    }
    return add.call(context, cookies);
  });
  // No SDK was dispatched: propagate control refusal outside unknown classification.
  if (denied) throw denied.error;
}

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
  'ly.com',
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
 * Compatibility encryption helper: never writes the retired plaintext column.
 * Production HTTP and automatic injection are disabled; new imports require a site grant.
 */
export async function upsertPendingCookies(
  db: typeof DbHandle,
  userInternalId: number,
  cookies: readonly SyncableCookie[],
): Promise<{ count: number }> {
  if (env.BROWSER_SESSION_IMPORT_V2 || env.BROWSER_PROFILE_PERSIST_V1)
    throw new Error('legacy_cookie_sync_disabled');
  const json = JSON.stringify(cookies);
  const enc = encryptCookieJson(json);
  await db
    .insert(pendingCookies)
    .values({
      userId: userInternalId,
      cookiesJson: null,
      encryptedBlob: enc.encryptedBlob,
      encryptionIv: enc.encryptionIv,
      encryptionTag: enc.encryptionTag,
      encryptedKey: enc.encryptedKey,
      cookieCount: cookies.length,
    })
    .onDuplicateKeyUpdate({
      set: {
        cookiesJson: null,
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
  if (env.BROWSER_SESSION_IMPORT_V2 || env.BROWSER_PROFILE_PERSIST_V1) return 0;
  const [userRow] = await runCookieDatabase(() =>
    opts.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalId, opts.userExternalId))
      .limit(1),
  );
  if (!userRow) return 0;
  const [row] = await runCookieDatabase(() =>
    opts.db
      .select({
        id: pendingCookies.id,
        encryptedBlob: pendingCookies.encryptedBlob,
        encryptionIv: pendingCookies.encryptionIv,
        encryptionTag: pendingCookies.encryptionTag,
        encryptedKey: pendingCookies.encryptedKey,
      })
      .from(pendingCookies)
      .where(eq(pendingCookies.userId, userRow.id))
      .limit(1),
  );
  if (!row) return 0;

  // Compatibility encrypted rows only. Plaintext has no runtime fallback. Decrypt failure (auth tag mismatch, wrong key,
  // corrupted blob) drops the row + logs rather than returning stale
  // data; the user's next sync repopulates.
  let payloadJson: string | null = null;
  if (row.encryptedBlob && row.encryptionIv && row.encryptionTag && row.encryptedKey) {
    try {
      payloadJson = decryptCookieJson({
        encryptedBlob: row.encryptedBlob,
        encryptionIv: row.encryptionIv,
        encryptionTag: row.encryptionTag,
        encryptedKey: row.encryptedKey,
      });
    } catch {
      logger.warn(
        { reason: 'cookie_operation_failed', userExternalId: opts.userExternalId },
        'cookie-sync: encrypted payload failed to decrypt; dropping row',
      );
      await deletePendingCookie(opts.db, row.id);
      return 0;
    }
  } else {
    // Empty row (no plaintext, no ciphertext) — drop and skip.
    await deletePendingCookie(opts.db, row.id);
    return 0;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    logger.warn(
      { reason: 'cookie_operation_failed', userExternalId: opts.userExternalId },
      'cookie-sync: pending row had invalid JSON; dropping',
    );
    await deletePendingCookie(opts.db, row.id);
    return 0;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    await deletePendingCookie(opts.db, row.id);
    return 0;
  }

  const cookies = parsed as SyncableCookie[];
  await injectCookies(opts.context, cookies);

  // Clear AFTER injection so a mid-loop throw leaves the row for the
  // next allocate to retry.
  await deletePendingCookie(opts.db, row.id);
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
    await addCookieBatch(context, playwrightCookies);
  } catch {
    // An owned ambiguous submission must be reconciled, not retried or deleted.
    assertCookieDispatch();
    // Single shot fails on the first invalid cookie — fall back to
    // per-cookie loop so one bad entry doesn't poison the batch.
    logger.warn(
      { reason: 'cookie_operation_failed', batchSize: playwrightCookies.length },
      'cookie-sync: bulk addCookies failed, falling back to per-cookie',
    );
    for (const cookie of playwrightCookies) {
      try {
        await addCookieBatch(context, [cookie]);
      } catch {
        assertCookieDispatch();
        logger.debug(
          { reason: 'cookie_operation_failed' },
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
