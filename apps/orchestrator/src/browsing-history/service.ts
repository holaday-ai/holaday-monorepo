/**
 * Phase 25 — browsing-history aggregate service.
 *
 * The Chrome extension hits `POST /api/extension/browsing-history`
 * with the user's 30-day per-domain visit summary. This module is the
 * boring middle layer that:
 *   1. Validates the wire payload (zod)
 *   2. Filters obviously-junk domains (chrome://, about:, IPs, IDN
 *      punycode that looks malformed)
 *   3. Truncates per upload limit
 *   4. Performs an atomic replace on `user_site_stats` for the user
 *      (delete old rows + bulk insert new) so a follow-up sync from
 *      the extension is the single source of truth — no stale rows
 *      from a domain the user no longer visits sticking around.
 *
 * The replace-style upsert is intentional: the extension uploads the
 * COMPLETE 30-day window each sync. A partial-update path (only the
 * delta) would need versioning + conflict resolution that we don't
 * need for a once-a-day cadence. The trade-off is one INSERT batch
 * of typically <100 rows per sync — comfortably under the MySQL
 * extended-insert limit.
 *
 * Privacy contract: only `domain` + `visitCount` + `lastVisitAt` are
 * accepted. Full URLs / titles are rejected by the schema.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import { userSiteStats, type NewUserSiteStat } from '../db/schema/user-site-stats.js';

/**
 * Per-sync hard cap. A user's 30-day window typically yields 20-80
 * unique hosts (CDF from a small sample of internal accounts). 500
 * is a generous ceiling — enough to absorb tab-hoarders or someone
 * who installed the extension after years of browsing, while still
 * keeping the replace INSERT manageable.
 */
export const MAX_HOSTS_PER_SYNC = 500;

/**
 * Maximum visit_count we'll accept. INT UNSIGNED ranges to ~4.3B but
 * we clamp here so a buggy client doesn't write absurd values that
 * pollute future "user spends most time on…" heuristics.
 */
const MAX_VISIT_COUNT = 1_000_000;

/**
 * Wire schema for a single host entry. Domain validation is
 * intentionally permissive — RFC 1035 says up to 253 chars total
 * with labels of 1-63 chars separated by dots; modern IDN can push
 * the limit further via punycode. We allow A-Z 0-9 . - _ since
 * underscore appears in some legacy hostnames, and let the
 * shouldIngestDomain filter discard the truly garbage values
 * (chrome://, IPs, etc.) downstream.
 */
const hostEntrySchema = z.object({
  domain: z.string().min(1).max(253),
  visitCount: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_VISIT_COUNT)
    .default(0),
  /**
   * ISO 8601 string preferred — z.coerce.date accepts both ISO strings
   * and numeric epoch ms, matching what the extension might send (the
   * chrome.history API returns ms-since-epoch numbers).
   */
  lastVisitAt: z.coerce.date().optional().nullable(),
});

export const browsingHistorySchema = z.object({
  domains: z.array(hostEntrySchema).max(MAX_HOSTS_PER_SYNC),
});

export type BrowsingHistoryPayload = z.infer<typeof browsingHistorySchema>;
export type HostEntry = z.infer<typeof hostEntrySchema>;

/**
 * Domain ingestion filter. We refuse anything that:
 *   - Starts with a known non-web scheme prefix (chrome://, about:,
 *     file:, extension:) — Chrome's history table can contain these
 *     and they're not useful for "user frequently visits X".
 *   - Is a bare IP literal (v4 or v6) — typically localhost / lan,
 *     not consumer-facing sites.
 *   - Contains whitespace or control characters — corrupt input.
 *   - Has no dot at all — single-label hostnames (intranet) aren't
 *     useful for site-config routing.
 *
 * Returns a normalised lowercase domain on accept, `null` on reject.
 * Idempotent: re-running on already-normalised input is a no-op.
 */
export function normaliseDomain(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (raw.length === 0) return null;
  if (/[\s\x00-\x1f]/.test(raw)) return null;
  if (
    raw.startsWith('chrome://') ||
    raw.startsWith('about:') ||
    raw.startsWith('file:') ||
    raw.startsWith('chrome-extension://') ||
    raw.startsWith('moz-extension://')
  ) {
    return null;
  }
  // IPv4 literal
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return null;
  // IPv6 literal (loose: contains a colon)
  if (raw.includes(':') && /[a-f0-9]+:/.test(raw)) return null;
  // Strip leading scheme + path if the extension forgot to extract host
  let host = raw;
  const schemeMatch = host.match(/^https?:\/\//);
  if (schemeMatch) host = host.slice(schemeMatch[0].length);
  const slashIdx = host.indexOf('/');
  if (slashIdx !== -1) host = host.slice(0, slashIdx);
  // Strip leading www.
  if (host.startsWith('www.')) host = host.slice(4);
  // Must contain at least one dot AND not start/end with dot
  if (!host.includes('.')) return null;
  if (host.startsWith('.') || host.endsWith('.')) return null;
  // Final length cap (post-strip)
  if (host.length > 253) return null;
  return host;
}

export interface IngestResult {
  /** Rows actually written after dedupe + filter. */
  ingested: number;
  /** Rows the input contained but we filtered out. */
  rejected: number;
  /** Sample (max 10) of the most-visited domains, for the response. */
  topDomains: string[];
}

/**
 * Atomically replace this user's site-stat snapshot. The extension
 * always uploads the full 30-day window, so we delete-then-insert
 * inside a transaction — simpler than per-row upserts, and the row
 * count is bounded by MAX_HOSTS_PER_SYNC.
 *
 * Order:
 *   1. Normalise + filter input → dedupe-by-domain (keep MAX visit)
 *   2. DELETE FROM user_site_stats WHERE user_id = ?
 *   3. BULK INSERT the survivors
 * All inside a single transaction so concurrent reads see either the
 * old snapshot or the new one — never an empty intermediate state.
 */
export async function replaceUserSiteStats(
  db: DB,
  userId: number,
  payload: BrowsingHistoryPayload,
): Promise<IngestResult> {
  // Dedupe by normalised domain, keeping the max visitCount + latest
  // lastVisitAt. The extension shouldn't produce dupes in practice
  // (it groups client-side), but defending here means a buggy client
  // can't make the unique index trip and reject the whole batch.
  const accumulated = new Map<string, { visitCount: number; lastVisitAt: Date | null }>();
  let rejected = 0;
  for (const entry of payload.domains) {
    const norm = normaliseDomain(entry.domain);
    if (!norm) {
      rejected += 1;
      continue;
    }
    const existing = accumulated.get(norm);
    const visit = Math.min(entry.visitCount ?? 0, MAX_VISIT_COUNT);
    const last = entry.lastVisitAt ?? null;
    if (!existing) {
      accumulated.set(norm, { visitCount: visit, lastVisitAt: last });
      continue;
    }
    accumulated.set(norm, {
      visitCount: Math.max(existing.visitCount, visit),
      lastVisitAt:
        last && (!existing.lastVisitAt || last > existing.lastVisitAt)
          ? last
          : existing.lastVisitAt,
    });
  }

  const rows: NewUserSiteStat[] = [];
  for (const [domain, agg] of accumulated) {
    rows.push({
      userId,
      domain,
      visitCount: agg.visitCount,
      lastVisitAt: agg.lastVisitAt,
      source: 'extension',
    });
  }

  await db.transaction(async (tx) => {
    await tx.delete(userSiteStats).where(eq(userSiteStats.userId, userId));
    if (rows.length > 0) {
      // drizzle-mysql's insert handles ~10k row chunks fine; we cap
      // input at 500 above so a single statement is always enough.
      await tx.insert(userSiteStats).values(rows);
    }
  });

  const top = [...accumulated.entries()]
    .sort((a, b) => b[1].visitCount - a[1].visitCount)
    .slice(0, 10)
    .map(([d]) => d);
  return { ingested: rows.length, rejected, topDomains: top };
}

/**
 * Read-only summary helper. Returns this user's stored domain count
 * (used by the popup's "已同步 N 个常用网站" line). Cheap — bounded
 * by MAX_HOSTS_PER_SYNC per user.
 */
export async function countUserSiteStats(db: DB, userId: number): Promise<number> {
  const rows = await db
    .select({ id: userSiteStats.id })
    .from(userSiteStats)
    .where(eq(userSiteStats.userId, userId));
  return rows.length;
}
