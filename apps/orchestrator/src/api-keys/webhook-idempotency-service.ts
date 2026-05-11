/**
 * Phase 5d follow-up — webhook idempotency service.
 *
 * Pure logic split out of the route handler so the lookup +
 * insert + 409 detection can be tested without spinning up an
 * Express app or a real DB.
 *
 * Contract:
 *   lookup(userInternalId, key, requestBody) → 'fresh' | { replay }
 *   - 'fresh': caller proceeds with normal dispatch + must call
 *     `record` after success
 *   - 'replay': caller returns the cached response immediately;
 *     conflictsWith=true means the key was reused with a different
 *     body → caller should 409
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

export type LookupResult =
  | { kind: 'fresh' }
  | {
      kind: 'replay';
      conflictsWith: boolean;
      taskId: string;
      response: unknown;
    };

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
 * same key + different body case → caller surfaces 409.
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
 * Persist a fresh idempotency row. Returns true on success, false
 * on unique-violation race (two parallel webhook calls with the
 * same key landed in the same millisecond — the second `record`
 * loses + the second caller can lookup again to get the first's
 * cached response). Other DB errors propagate.
 */
export async function record(
  deps: IdempotencyServiceDeps,
  userInternalId: number,
  key: string,
  requestBody: unknown,
  taskId: string,
  response: unknown,
): Promise<boolean> {
  const nowFn = deps.now ?? (() => new Date());
  const hash = hashBody(requestBody);
  try {
    await deps.db.insert(webhookIdempotency).values({
      userId: userInternalId,
      idempotencyKey: key,
      requestHash: hash,
      taskId,
      // Drizzle's json column accepts any JSON-serialisable; cast
      // through `unknown` to satisfy the typed insert API.
      responseJson: response as Parameters<
        typeof deps.db.insert
      >[0] extends never
        ? never
        : object,
      expiresAt: new Date(nowFn().getTime() + IDEMPOTENCY_TTL_MS),
    });
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ER_DUP_ENTRY') {
      deps.logger.info(
        { key, userInternalId },
        'webhook-idempotency: insert race (parallel calls with same key) — second caller will read first call\'s row',
      );
      return false;
    }
    throw err;
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
