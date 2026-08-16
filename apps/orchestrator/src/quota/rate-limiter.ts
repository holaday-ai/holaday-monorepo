/**
 * Shared process-local sliding-window rate limiter.
 *
 * One bucket per namespaced subject. Each `tryAcquire(userId)` records
 * the current timestamp; entries older than the window are pruned; if
 * the remaining count is at the limit, returns false. Inactive buckets
 * are opportunistically evicted so one-time callers do not accumulate.
 *
 * Why in-memory not Redis: the orchestrator runs as a single PM2
 * process. A token-bucket here is precise per-process. If we ever
 * scale horizontally, this needs Redis-backed.
 */

interface Bucket {
  /** Sorted-ascending submission timestamps in ms. */
  hits: number[];
  /** Bucket can be discarded after its newest accepted hit leaves the window. */
  expiresAt: number;
}

const BUCKETS = new Map<string, Bucket>();
const BUCKET_EVICTION_INTERVAL_MS = 60_000;
let nextBucketEvictionAt = 0;

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
  evictInactiveBuckets(now);

  const bucket: Bucket = BUCKETS.get(userId) ?? { hits: [], expiresAt: now + limit.windowMs };
  // Prune expired
  while ((bucket.hits[0] ?? Number.POSITIVE_INFINITY) < cutoff) {
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
  bucket.expiresAt = now + limit.windowMs;
  BUCKETS.set(userId, bucket);
  return { ok: true, count: bucket.hits.length, retryAfterMs: 0 };
}

function evictInactiveBuckets(now: number): void {
  if (now < nextBucketEvictionAt) return;
  nextBucketEvictionAt = now + BUCKET_EVICTION_INTERVAL_MS;
  for (const [key, bucket] of BUCKETS) {
    if (bucket.expiresAt < now) BUCKETS.delete(key);
  }
}

/** Test helper: clear all buckets. */
export function _resetAllBucketsForTesting(): void {
  BUCKETS.clear();
  nextBucketEvictionAt = 0;
}

/** Test helper: inspect whether inactive buckets are bounded. */
export function _bucketCountForTesting(): number {
  return BUCKETS.size;
}
