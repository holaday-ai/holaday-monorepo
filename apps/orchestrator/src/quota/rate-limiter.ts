/**
 * Phase 21a — per-user task-creation rate limit.
 *
 * Sliding-window counter (in-memory, process-local). One bucket per
 * external user id. Each `tryAcquire(userId)` records the current
 * timestamp; entries older than the window are pruned; if the
 * remaining count is at the limit, returns false.
 *
 * Why in-memory not Redis: the orchestrator runs as a single PM2
 * process. A token-bucket here is precise per-process. If we ever
 * scale horizontally, this needs Redis-backed.
 *
 * The limit only fires for users in QUOTA_BYPASS_USERS today — that
 * was the original requirement after BOSS's 155-task flood. To
 * extend to all users, drop the bypass-only check at the call site
 * (tasks.ts) and apply globally.
 */

interface Bucket {
  /** Sorted-ascending submission timestamps in ms. */
  hits: number[];
}

const BUCKETS = new Map<string, Bucket>();

export interface RateLimit {
  /** Window length in ms. e.g. 60_000 for "per minute". */
  windowMs: number;
  /** Max submissions allowed inside the window. */
  max: number;
}

export interface AcquireResult {
  ok: boolean;
  /** Current submission count in window after this attempt. */
  count: number;
  /** When the next slot will free up (ms epoch). 0 if ok=true. */
  retryAfterMs: number;
}

/**
 * Try to record a submission. Returns ok=true if the user is under
 * the limit (and records the timestamp); ok=false if they're at or
 * over (no record taken — caller should reject).
 */
export function tryAcquire(userId: string, limit: RateLimit): AcquireResult {
  const now = Date.now();
  const cutoff = now - limit.windowMs;

  const bucket: Bucket = BUCKETS.get(userId) ?? { hits: [] };
  // Prune expired
  while (bucket.hits.length > 0 && bucket.hits[0]! < cutoff) {
    bucket.hits.shift();
  }

  if (bucket.hits.length >= limit.max) {
    BUCKETS.set(userId, bucket);
    const oldest = bucket.hits[0] ?? now;
    return {
      ok: false,
      count: bucket.hits.length,
      retryAfterMs: Math.max(0, oldest + limit.windowMs - now),
    };
  }

  bucket.hits.push(now);
  BUCKETS.set(userId, bucket);
  return { ok: true, count: bucket.hits.length, retryAfterMs: 0 };
}

/** Test helper: clear all buckets. */
export function _resetAllBucketsForTesting(): void {
  BUCKETS.clear();
}
