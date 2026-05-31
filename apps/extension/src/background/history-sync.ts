/**
 * Phase 25 — extension browsing-history sync.
 *
 * Reads chrome.history.search for the last 30 days, aggregates per-host
 * (visit count + most recent timestamp), and POSTs the summary to
 * `${ORCHESTRATOR_HTTP}/extension/browsing-history`.
 *
 * **Privacy contract** — the extension NEVER uploads full URLs, query
 * strings, or page titles. Aggregation happens client-side: the
 * payload is `{ domain, visitCount, lastVisitAt }` tuples and nothing
 * else.
 *
 * Sync cadence is governed by `runHistorySync` in background/index.ts:
 *   - First successful WS welcome → run once (initial backfill)
 *   - Every 24h thereafter (gated on lastHistorySyncAt timestamp in
 *     chrome.storage.local, similar to cookie-sync's 30-min gate)
 *
 * Sister module of `cookie-sync.ts`: that one ships cookie VALUES so
 * the agent's Brave instance inherits logins. This one ships
 * aggregate visit counts so the site-config router can prefer configs
 * for the user's frequent destinations.
 */

import { getAccessToken } from '../shared/storage.js';
import { ORCHESTRATOR_HTTP } from '../shared/config.js';
import { withDeadline } from '../shared/deadline.js';

/**
 * Hard upload cap matches the server's MAX_HOSTS_PER_SYNC (see
 * apps/orchestrator/src/browsing-history/service.ts). The server
 * rejects the whole payload if the cap is exceeded; truncating
 * here ensures even an extreme browsing footprint succeeds —
 * we keep the top 500 by visit count.
 */
const MAX_HOSTS = 500;

/**
 * Look-back window. Matches the user-facing copy "最近 30 天" and the
 * chrome.history.search startTime parameter (ms epoch).
 */
const LOOKBACK_DAYS = 30;
const LOOKBACK_MS = LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

/**
 * chrome.history.search caps results at `maxResults` (default 100,
 * max 1000). The agent's heuristic uses unique-host count, not raw
 * visit count, so we request a generous pool then group client-side.
 * 5000 is plenty for typical 30-day browsing while still keeping the
 * read fast enough to run on SW boot.
 */
const HISTORY_MAX_RESULTS = 5000;
const HISTORY_SYNC_POST_TIMEOUT_MS = 8_000;

export interface BrowsingHostEntry {
  domain: string;
  visitCount: number;
  lastVisitAt: string; // ISO 8601
}

/**
 * Extract the bare host from a chrome history URL. Returns null when
 * the URL is unusable (chrome://, malformed, javascript:, etc.) so
 * the caller can drop it. The server-side filter rejects the same
 * cases as a defence-in-depth, but the client-side filter saves us
 * the round-trip cost.
 */
export function extractHost(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    if (!host.includes('.')) return null; // single-label / localhost
    return host;
  } catch {
    return null;
  }
}

function normalizeVisitCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function normalizeLastVisitTime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export function aggregateBrowsingHistoryItems(
  items: readonly Pick<chrome.history.HistoryItem, 'url' | 'visitCount' | 'lastVisitTime'>[],
): BrowsingHostEntry[] {
  const acc = new Map<string, { visitCount: number; lastVisitAt: number }>();
  for (const item of items) {
    if (!item.url) continue;
    const host = extractHost(item.url);
    if (!host) continue;
    const visit = normalizeVisitCount(item.visitCount);
    const last = normalizeLastVisitTime(item.lastVisitTime);
    if (visit <= 0 || last <= 0) continue;
    const existing = acc.get(host);
    if (!existing) {
      acc.set(host, { visitCount: visit, lastVisitAt: last });
    } else {
      existing.visitCount += visit;
      if (last > existing.lastVisitAt) existing.lastVisitAt = last;
    }
  }

  const entries: BrowsingHostEntry[] = [];
  for (const [domain, agg] of acc) {
    entries.push({
      domain,
      visitCount: agg.visitCount,
      lastVisitAt: new Date(agg.lastVisitAt).toISOString(),
    });
  }
  entries.sort((a, b) => b.visitCount - a.visitCount);
  return entries.slice(0, MAX_HOSTS);
}

/**
 * Read 30-day history and aggregate per host. Returns the top
 * MAX_HOSTS by visit count, sorted descending so consumers can take
 * a slice if they want fewer.
 *
 * Best-effort: any chrome.history error returns an empty array so
 * the caller's catch path stays simple (sync is non-critical).
 */
export async function collectBrowsingHistory(): Promise<BrowsingHostEntry[]> {
  const startTime = Date.now() - LOOKBACK_MS;
  let items: chrome.history.HistoryItem[] = [];
  try {
    items = await chrome.history.search({
      text: '', // empty = all URLs in the window
      startTime,
      maxResults: HISTORY_MAX_RESULTS,
    });
  } catch (err) {
    console.warn('[holaday] history-sync: chrome.history.search failed', err);
    return [];
  }

  return aggregateBrowsingHistoryItems(items);
}

export interface BrowsingSyncResponse {
  ingested: number;
  rejected: number;
  topDomains: string[];
}

/**
 * chrome.storage key the SW writes after each successful sync. The
 * popup reads this directly (no SW message round-trip) to render
 * "已同步 N 个常用网站" without waiting on a sync to be in flight.
 */
const HISTORY_SYNC_SUMMARY_KEY = 'holaday.history.lastSyncSummary';

export interface HistorySyncSummary {
  ingested: number;
  topDomains: string[];
  at: number; // ms epoch
}

async function persistSummary(summary: HistorySyncSummary): Promise<void> {
  try {
    await chrome.storage.local.set({ [HISTORY_SYNC_SUMMARY_KEY]: summary });
  } catch {
    /* non-fatal */
  }
}

/**
 * Read the most-recent sync summary written by `runHistorySync`. The
 * popup uses this to show "已同步 N 个常用网站" without piercing the
 * SW. Returns null when no sync has ever succeeded.
 */
export async function readHistorySyncSummary(): Promise<HistorySyncSummary | null> {
  try {
    const v = (await chrome.storage.local.get(HISTORY_SYNC_SUMMARY_KEY))[HISTORY_SYNC_SUMMARY_KEY];
    if (
      v &&
      typeof v === 'object' &&
      typeof (v as { ingested?: unknown }).ingested === 'number'
    ) {
      return v as HistorySyncSummary;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * POST aggregated entries to the orchestrator. Returns null when
 * unauthenticated. Throws on non-2xx with a short message so the
 * caller can log + continue.
 */
export async function syncHistoryToServer(
  entries: readonly BrowsingHostEntry[],
): Promise<BrowsingSyncResponse | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const res = await withDeadline(
    fetch(`${ORCHESTRATOR_HTTP}/extension/browsing-history`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ domains: entries }),
    }),
    HISTORY_SYNC_POST_TIMEOUT_MS,
    'history_sync_post_timeout',
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`history-sync HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as BrowsingSyncResponse;
}

/**
 * One-shot collect + ship. The caller (background/index.ts) gates
 * call frequency via the `lastHistorySyncAt` timestamp in
 * chrome.storage.local so we don't spam the server on every SW wake.
 *
 * Returns the server response or `null` when unauthenticated /
 * history empty. Caller treats null as a no-op and doesn't update
 * the gate timestamp.
 */
export async function runHistorySync(): Promise<BrowsingSyncResponse | null> {
  const entries = await collectBrowsingHistory();
  if (entries.length === 0) return null;
  const res = await syncHistoryToServer(entries);
  if (res) {
    void persistSummary({
      ingested: res.ingested,
      topDomains: res.topDomains,
      at: Date.now(),
    });
  }
  return res;
}
