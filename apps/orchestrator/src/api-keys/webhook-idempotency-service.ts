/**
 * Phase 5d follow-up — webhook idempotency service.
 *
 * Pure logic split out of the route handler so the lookup +
 * claim + finalize + 409 detection can be tested without spinning
 * up an Express app or a real DB.
 *
 * # Atomic-claim contract (Codex P1 follow-up)
 *
 * The PREVIOUS flow was: lookup → (dispatch if miss) → record. That
 * had a race window where two parallel calls both saw "miss" → both
 * dispatched (creating two tasks) → only one record won the unique
 * index. Net effect: one Zapier retry could spawn duplicate tasks.
 *
 * The new flow is INSERT-first ("atomic claim"):
 *   1. `recordClaim` INSERTs a row with `task_id=''` (sentinel) +
 *      `response_json={}` BEFORE dispatch. The unique index on
 *      `(user_id, idempotency_key)` guarantees only one of N
 *      parallel callers wins the INSERT.
 *   2. The winner (`{kind: 'claimed'}`) proceeds to dispatch and
 *      then calls `finalizeClaim` to fill in the real task_id +
 *      response.
 *   3. Losers see `{kind: 'replay'}` (claim already finalized; same
 *      hash → return cached, different hash → caller 409s) OR
 *      `{kind: 'in_flight'}` (claim row exists but not yet
 *      finalized — claimant is mid-dispatch).
 *   4. Orphan recovery: if a `'claimed'` process crashes before
 *      `finalizeClaim`, the row sits with placeholder data forever.
 *      `recordClaim` treats a claim older than `CLAIM_STALE_AFTER_MS`
 *      as orphaned and atomically deletes it before retrying, so a
 *      legitimate retry days later isn't blocked by a corpse.
 *
 * Hash is SHA-256 of the request body, applied to a CANONICAL
 * representation: we sort object keys + drop undefined so two
 * structurally-equal bodies hash the same regardless of JSON
 * serialization order. This matters because Zapier sometimes
 * re-serializes a body via a JS dict that doesn't guarantee key
 * order; we don't want to false-trip a 409 on that.
 */

import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import type { Logger } from 'pino';
import { webhookIdempotency } from '../db/schema/webhook-idempotency.js';
import type { DB } from '../db/client.js';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * Sentinel `task_id` while a claim is in flight (before
 * `finalizeClaim` fills in the real one). Empty string is safe:
 * the column is `varchar(32) NOT NULL`, NOT NULL allows empty
 * string, and real external IDs are `tsk_<22 chars>` — never blank.
 */
export const CLAIM_PLACEHOLDER_TASK_ID = '';

/**
 * Sentinel `response_json` while a claim is in flight. Empty object
 * satisfies NOT NULL without leaking ambiguous data.
 */
export const CLAIM_PLACEHOLDER_RESPONSE: Record<string, unknown> = {};

/**
 * Claim older than this is treated as orphaned (the original
 * dispatcher crashed or hung) and `recordClaim` will atomically
 * delete-and-retake it. 60s comfortably exceeds the upper bound of
 * a single dispatch (task row INSERT + WS broadcast — usually
 * <100ms) without being so long that a legitimate user retry gets
 * blocked.
 */
export const CLAIM_STALE_AFTER_MS = 60_000;

export type LookupResult =
  | { kind: 'fresh' }
  | {
      kind: 'replay';
      conflictsWith: boolean;
      taskId: string;
      response: unknown;
    }
  | { kind: 'in_flight'; claimedAt: Date };

export type ClaimResult =
  | { kind: 'claimed' }
  | {
      kind: 'replay';
      conflictsWith: boolean;
      taskId: string;
      response: unknown;
    }
  | { kind: 'in_flight'; claimedAt: Date };

/**
 * Canonical-stringify: deterministic key order + drop undefined.
 * `JSON.stringify` is otherwise order-preserving but Node's
 * Object.keys order depends on insertion, so two
 * "logically equal" inputs from different serializers can hash
 * differently. Sorting flatly is fine because the body is a small
 * JSON object (prompt + optional roleId).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v === undefined) return null;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = (v as Record<string, unknown>)[k];
      }
      return out;
    }
    return v;
  });
}

export function hashBody(body: unknown): string {
  return createHash('sha256').update(canonicalize(body)).digest('hex');
}

export interface IdempotencyServiceDeps {
  db: DB;
  logger: Logger;
  /** Override-able for tests; defaults to Date.now(). */
  now?: () => Date;
}

/**
 * Read the cache. Returns 'fresh' when there's no existing row OR
 * the row has expired (we treat expired the same as missing so a
 * day-late Zapier retry gets a fresh task instead of a stale
 * response). Returns 'replay' with conflictsWith=true for the
 * same key + different body case → caller surfaces 409. Returns
 * 'in_flight' for a row in claim state (sentinel task_id).
 */
export async function lookup(
  deps: IdempotencyServiceDeps,
  userInternalId: number,
  key: string,
  requestBody: unknown,
): Promise<LookupResult> {
  const nowFn = deps.now ?? (() => new Date());
  const [row] = await deps.db
    .select({
      requestHash: webhookIdempotency.requestHash,
      taskId: webhookIdempotency.taskId,
      responseJson: webhookIdempotency.responseJson,
      expiresAt: webhookIdempotency.expiresAt,
      createdAt: webhookIdempotency.createdAt,
    })
    .from(webhookIdempotency)
    .where(
      and(
        eq(webhookIdempotency.userId, userInternalId),
        eq(webhookIdempotency.idempotencyKey, key),
      ),
    )
    .limit(1);
  if (!row) return { kind: 'fresh' };
  // Treat expired rows as not-found. The cleanup cron will delete
  // them eventually; the lookup-time guard keeps semantics correct
  // in the gap before deletion.
  if (row.expiresAt.getTime() < nowFn().getTime()) {
    return { kind: 'fresh' };
  }
  // Claim-in-flight: task_id is still the sentinel, dispatch hasn't
  // finalized yet. Caller polls or returns 425.
  if (row.taskId === CLAIM_PLACEHOLDER_TASK_ID) {
    return { kind: 'in_flight', claimedAt: row.createdAt };
  }
  const incomingHash = hashBody(requestBody);
  const conflicts = incomingHash !== row.requestHash;
  return {
    kind: 'replay',
    conflictsWith: conflicts,
    taskId: row.taskId,
    response: row.responseJson,
  };
}

/**
 * Atomically claim an idempotency key. INSERTs a row with sentinel
 * task_id / response_json BEFORE dispatch — exactly one of N
 * parallel callers wins. The winner ('claimed') must call
 * `finalizeClaim` after a successful dispatch (or `releaseClaim` on
 * dispatch failure so retries work).
 *
 * On INSERT collision we re-read the existing row and dispatch the
 * caller to one of:
 *   - 'replay'    — the other side already finalized
 *   - 'in_flight' — the other side is still dispatching
 *   - 'claimed'   — the orphan-takeover path: existing claim is
 *                   older than `CLAIM_STALE_AFTER_MS` so we
 *                   atomically deleted it + re-INSERTed
 */
export async function recordClaim(
  deps: IdempotencyServiceDeps,
  userInternalId: number,
  key: string,
  requestBody: unknown,
): Promise<ClaimResult> {
  const nowFn = deps.now ?? (() => new Date());
  const hash = hashBody(requestBody);
  try {
    await deps.db.insert(webhookIdempotency).values({
      userId: userInternalId,
      idempotencyKey: key,
      requestHash: hash,
      taskId: CLAIM_PLACEHOLDER_TASK_ID,
      // Drizzle's json column accepts any JSON-serialisable; cast
      // through `unknown` to satisfy the typed insert API.
      responseJson: CLAIM_PLACEHOLDER_RESPONSE as Parameters<
        typeof deps.db.insert
      >[0] extends never
        ? never
        : object,
      expiresAt: new Date(nowFn().getTime() + IDEMPOTENCY_TTL_MS),
    });
    return { kind: 'claimed' };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'ER_DUP_ENTRY') throw err;
    // Collision — re-read the existing row to decide replay vs
    // in_flight vs orphan-takeover.
    const [row] = await deps.db
      .select({
        requestHash: webhookIdempotency.requestHash,
        taskId: webhookIdempotency.taskId,
        responseJson: webhookIdempotency.responseJson,
        expiresAt: webhookIdempotency.expiresAt,
        createdAt: webhookIdempotency.createdAt,
      })
      .from(webhookIdempotency)
      .where(
        and(
          eq(webhookIdempotency.userId, userInternalId),
          eq(webhookIdempotency.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (!row) {
      // Race: DUP fired but the row was deleted (cleanup cron) before
      // our re-read. Surface as in_flight so caller retries.
      return { kind: 'in_flight', claimedAt: nowFn() };
    }
    if (row.expiresAt.getTime() < nowFn().getTime()) {
      // Expired row — should have been swept; our INSERT still
      // hit the unique index because cleanup hadn't run yet. Try
      // to delete-and-retake. If delete succeeds we recurse once;
      // otherwise surface as in_flight.
      const reclaimed = await tryReclaim(
        deps,
        userInternalId,
        key,
        row.createdAt,
        hash,
        nowFn,
      );
      if (reclaimed) return { kind: 'claimed' };
      return { kind: 'in_flight', claimedAt: row.createdAt };
    }
    if (row.taskId === CLAIM_PLACEHOLDER_TASK_ID) {
      // Real claim in flight — or an orphan from a crashed dispatcher.
      const ageMs = nowFn().getTime() - row.createdAt.getTime();
      if (ageMs > CLAIM_STALE_AFTER_MS) {
        // Orphan: take it over.
        const reclaimed = await tryReclaim(
          deps,
          userInternalId,
          key,
          row.createdAt,
          hash,
          nowFn,
        );
        if (reclaimed) {
          deps.logger.info(
            {
              userInternalId,
              idempotencyKey: key,
              orphanedAgeMs: ageMs,
            },
            'webhook-idempotency: orphan claim taken over (previous dispatcher crashed before finalize)',
          );
          return { kind: 'claimed' };
        }
        // Couldn't reclaim — someone else (probably the original
        // claimant finalizing right now) touched it. Look up again
        // to find the resolved state.
        const after = await lookup(deps, userInternalId, key, requestBody);
        if (after.kind === 'replay') return after;
        return { kind: 'in_flight', claimedAt: row.createdAt };
      }
      return { kind: 'in_flight', claimedAt: row.createdAt };
    }
    // Row has real task_id — replay.
    const conflicts = row.requestHash !== hash;
    return {
      kind: 'replay',
      conflictsWith: conflicts,
      taskId: row.taskId,
      response: row.responseJson,
    };
  }
}

/**
 * Atomically delete a stale claim and re-INSERT ours. Qualifying
 * the DELETE on `task_id = '' (placeholder)` is enough for race
 * safety: the unique index on `(user_id, idempotency_key)`
 * guarantees at most one row exists, and a concurrent finalize that
 * flipped `task_id` to a real value between our SELECT and this
 * DELETE will simply make the predicate match zero rows (the row
 * is no longer in placeholder state). On a zero-match DELETE we
 * fall back to the lookup path.
 */
async function tryReclaim(
  deps: IdempotencyServiceDeps,
  userInternalId: number,
  key: string,
  _observedCreatedAt: Date,
  hash: string,
  nowFn: () => Date,
): Promise<boolean> {
  try {
    const delResult = await deps.db
      .delete(webhookIdempotency)
      .where(
        and(
          eq(webhookIdempotency.userId, userInternalId),
          eq(webhookIdempotency.idempotencyKey, key),
          eq(webhookIdempotency.taskId, CLAIM_PLACEHOLDER_TASK_ID),
        ),
      );
    const affected =
      (delResult as unknown as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) return false;
    // DELETE succeeded; now INSERT our claim. On the off chance
    // someone else also took the orphan we'd get DUP again here —
    // surface that as "lost the race" so caller's recordClaim
    // collision branch handles it via a fresh lookup.
    try {
      await deps.db.insert(webhookIdempotency).values({
        userId: userInternalId,
        idempotencyKey: key,
        requestHash: hash,
        taskId: CLAIM_PLACEHOLDER_TASK_ID,
        responseJson: CLAIM_PLACEHOLDER_RESPONSE as Parameters<
          typeof deps.db.insert
        >[0] extends never
          ? never
          : object,
        expiresAt: new Date(nowFn().getTime() + IDEMPOTENCY_TTL_MS),
      });
      return true;
    } catch {
      return false;
    }
  } catch (err) {
    deps.logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'webhook-idempotency: orphan reclaim failed (non-fatal)',
    );
    return false;
  }
}

/**
 * Replace a claim's placeholder with the real task_id + response.
 * Idempotent: re-running it is harmless (UPDATE matches same row).
 * Best-effort: a failed UPDATE logs but doesn't propagate — the
 * caller's HTTP response has already been computed.
 */
export async function finalizeClaim(
  deps: IdempotencyServiceDeps,
  userInternalId: number,
  key: string,
  taskId: string,
  response: unknown,
): Promise<boolean> {
  try {
    const result = await deps.db
      .update(webhookIdempotency)
      .set({
        taskId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseJson: response as any,
      })
      .where(
        and(
          eq(webhookIdempotency.userId, userInternalId),
          eq(webhookIdempotency.idempotencyKey, key),
          // Guard: only flip the placeholder. If another process
          // already finalized (unlikely but possible after an
          // orphan-takeover), this UPDATE matches zero rows and
          // we keep their finalized state.
          eq(webhookIdempotency.taskId, CLAIM_PLACEHOLDER_TASK_ID),
        ),
      );
    const affected =
      (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
    return affected > 0;
  } catch (err) {
    deps.logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        userInternalId,
        idempotencyKey: key,
      },
      'webhook-idempotency: finalizeClaim failed (non-fatal — caller already responded)',
    );
    return false;
  }
}

/**
 * Drop a claim row whose dispatch failed (quota, TRPC error,
 * unexpected throw). Without this, the failed claim sits with
 * placeholder data for 24h and any retry of the same key gets
 * stuck on `in_flight` until orphan timeout. Releasing returns
 * the slot to "fresh" so the caller's next retry behaves like a
 * brand-new request.
 *
 * Idempotent: a successful finalize first → this delete matches
 * zero rows → we don't accidentally drop a real row.
 */
export async function releaseClaim(
  deps: IdempotencyServiceDeps,
  userInternalId: number,
  key: string,
): Promise<boolean> {
  try {
    const result = await deps.db
      .delete(webhookIdempotency)
      .where(
        and(
          eq(webhookIdempotency.userId, userInternalId),
          eq(webhookIdempotency.idempotencyKey, key),
          eq(webhookIdempotency.taskId, CLAIM_PLACEHOLDER_TASK_ID),
        ),
      );
    const affected =
      (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
    return affected > 0;
  } catch (err) {
    deps.logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        userInternalId,
        idempotencyKey: key,
      },
      'webhook-idempotency: releaseClaim failed (non-fatal — claim row will be orphan-swept later)',
    );
    return false;
  }
}

/**
 * Sweep expired rows. Runs from a cron-like interval; safe to call
 * concurrently with `lookup` because the lookup itself checks
 * `expires_at` so a row about to be deleted is already treated as
 * missing.
 */
export async function cleanup(deps: IdempotencyServiceDeps): Promise<number> {
  const nowFn = deps.now ?? (() => new Date());
  try {
    const result = await deps.db
      .delete(webhookIdempotency)
      .where(lt(webhookIdempotency.expiresAt, nowFn()));
    const affected =
      (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
    if (affected > 0) {
      deps.logger.info(
        { deleted: affected },
        'webhook-idempotency: cleanup swept expired rows',
      );
    }
    return affected;
  } catch (err) {
    deps.logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'webhook-idempotency: cleanup failed (non-fatal)',
    );
    return 0;
  }
}

/**
 * Start the periodic cleanup loop. Returns the interval handle for
 * orderly shutdown. Idempotent: caller in index.ts may invoke twice
 * across HMR; the existing handle is preserved.
 */
let cleanupInterval: NodeJS.Timeout | null = null;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000; // 1h

export function startIdempotencyCleanup(deps: IdempotencyServiceDeps): NodeJS.Timeout {
  if (cleanupInterval) return cleanupInterval;
  // Fire once on boot so a long-running stale row from a prior run
  // gets swept without waiting an hour.
  void cleanup(deps);
  cleanupInterval = setInterval(() => {
    void cleanup(deps);
  }, CLEANUP_INTERVAL_MS);
  return cleanupInterval;
}

export function stopIdempotencyCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
