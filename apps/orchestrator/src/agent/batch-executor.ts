/**
 * Phase 5b — batch executor.
 *
 * Orchestrates one batch row: walks its items in seq order, dispatches
 * up to `batch.concurrency` simultaneously via the existing
 * `tasksRouter.createCaller(ctx).create({intent})` path, polls the
 * resulting task rows until each settles, then updates the batch
 * counters + broadcasts WS progress.
 *
 * The "executor" is just a coroutine kicked off fire-and-forget from
 * the batchTasks.create mutation — there's no daemon thread or queue;
 * each batch's promise lives inside the orchestrator process for the
 * duration of the run. A pm2 restart mid-batch leaves the batch row
 * in `running` status with some items still in `pending` — the next
 * boot doesn't auto-resume (no daemon to do it), and the user can
 * cancel + re-submit. Single-instance, low-volume v1 sizing.
 *
 * Failure semantics:
 *   - tasks.create throws (quota / concurrency cap / DB blip) →
 *     item status='failed' with the error message captured. Other
 *     items continue.
 *   - Underlying task terminal=failed / partial_success / timeout →
 *     item status mirrors that outcome for the detail UI; partial_success
 *     still counts toward the parent "partial" batch result.
 *   - Underlying task terminal=cancelled → item status='cancelled'.
 *   - User cancels mid-flight → remaining un-dispatched items move
 *     to status='cancelled'. Already-dispatched tasks finish naturally.
 *   - Batch status at end: 'completed' if every item completed,
 *     'partial' otherwise (mix of completed + failed + cancelled).
 *
 * No retries inside the batch — the existing tasks.* infrastructure
 * has its own retry layers, and a stuck item should surface to the
 * user, not silently re-dispatch.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { ServerMessage } from '@holaday/shared-types';
import {
  batchTaskItems,
  batchTasks,
  type BatchTask,
  type BatchTaskItem,
} from '../db/schema/batch-tasks.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import type { DB } from '../db/client.js';
import { isTaskTerminalStatus } from '../task-status.js';

/** How often we re-check a dispatched task for terminal status. */
const POLL_INTERVAL_MS = 2_000;
/**
 * Hard cap so a stuck task doesn't pin the executor's concurrency
 * slot forever. supercar's SUPERCAR_TIMEOUT_MS is 10 min; generate /
 * scrape lanes can run a bit longer. 25 min is a generous ceiling
 * for v1; if a task takes longer the executor marks it failed locally
 * but the underlying task continues — it's just decoupled from the
 * batch state.
 */
const MAX_WAIT_MS = 25 * 60 * 1000;

export interface BatchExecutorDeps {
  db: DB;
  logger: Logger;
  broadcastToUser: (userId: string, msg: ServerMessage) => void;
  /**
   * Dispatch one prompt for a user. Returns the new task's internal +
   * external id. Tests stub this; production wires through
   * tasksRouter.createCaller(ctx).create({intent}).
   *
   * Throws on quota / concurrency / DB failures. The executor catches
   * and marks the item failed; sibling items continue.
   */
  dispatch: (input: {
    userInternalId: number;
    userExternalId: string;
    prompt: string;
  }) => Promise<{ taskInternalId: number; taskExternalId: string }>;
}

/**
 * Kick off execution of one batch. Returns a promise that resolves
 * when the batch settles (all items terminal OR cancellation
 * propagated). Caller is fire-and-forget; the mutation responds
 * immediately with the batchId.
 *
 * Idempotent at the row level: if called twice with the same
 * batchId, both runs do the same thing (re-reading the items list
 * + skipping items that already left 'pending'). Cheap protection
 * against pm2 race or accidental double-kick.
 */
export async function executeBatch(
  batchExternalId: string,
  deps: BatchExecutorDeps,
): Promise<void> {
  const { db, logger } = deps;

  // Load batch + owner.
  const [batch] = await db
    .select()
    .from(batchTasks)
    .where(eq(batchTasks.externalId, batchExternalId))
    .limit(1);
  if (!batch) {
    logger.warn({ batchExternalId }, 'batch-executor: batch row not found');
    return;
  }
  const [owner] = await db
    .select({ externalId: users.externalId, id: users.id })
    .from(users)
    .where(eq(users.id, batch.userId))
    .limit(1);
  if (!owner) {
    logger.warn({ batchExternalId, userId: batch.userId }, 'batch-executor: owner not found');
    return;
  }

  // Codex P5 follow-up — atomic flip pending → running. The earlier
  // read-then-write (`if (batch.status === 'pending')`) had a race
  // with a parallel executeBatch invocation OR with a user-cancel
  // that lands between our SELECT and UPDATE. Now the WHERE clause
  // includes `status='pending'` so the UPDATE is a no-op if anyone
  // else moved the row first; we don't care about the affectedRows
  // result here (idempotent — already-running is fine).
  await db
    .update(batchTasks)
    .set({ status: 'running' })
    .where(and(eq(batchTasks.id, batch.id), eq(batchTasks.status, 'pending')));

  // Concurrency-bounded fanout. We re-read item rows on each pass so
  // a user-cancel between iterations is observed.
  const concurrency = Math.max(1, batch.concurrency);
  const inFlight = new Map<number, Promise<void>>(); // item.id → promise

  while (true) {
    // Re-check batch status for cancellation. Live select so a
    // user-cancel mid-flight propagates immediately.
    const [current] = await db
      .select({ status: batchTasks.status })
      .from(batchTasks)
      .where(eq(batchTasks.id, batch.id))
      .limit(1);
    if (!current) break; // batch was deleted mid-flight
    if (current.status === 'cancelled') {
      // Mark all still-pending items cancelled, drain in-flight.
      await db
        .update(batchTaskItems)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(
          and(
            eq(batchTaskItems.batchId, batch.id),
            eq(batchTaskItems.status, 'pending'),
          ),
        );
      // Wait for in-flight items to settle so we don't leak their
      // promises. They'll mark themselves completed/failed in the DB.
      await Promise.allSettled(inFlight.values());
      await finalizeBatch(batch.id, deps);
      return;
    }

    // Pull next batch of items that need dispatching: status='pending'
    // ordered by seq. Limit to (concurrency - inFlight.size) so we
    // don't over-fetch.
    const slotsOpen = concurrency - inFlight.size;
    if (slotsOpen > 0) {
      const pending = await db
        .select()
        .from(batchTaskItems)
        .where(
          and(
            eq(batchTaskItems.batchId, batch.id),
            eq(batchTaskItems.status, 'pending'),
          ),
        )
        .orderBy(batchTaskItems.seq)
        .limit(slotsOpen);
      for (const item of pending) {
        const promise = runItem(batch, item, owner, deps).finally(() => {
          inFlight.delete(item.id);
        });
        inFlight.set(item.id, promise);
      }
    }

    if (inFlight.size === 0) break; // nothing to do
    // Wait for at least one item to finish before iterating.
    await Promise.race(inFlight.values());
  }

  await finalizeBatch(batch.id, deps);
}

/**
 * Process a single item: dispatch → poll → mark terminal. Catches
 * its own errors so a sibling failure can't take down the executor.
 */
async function runItem(
  batch: BatchTask,
  item: BatchTaskItem,
  owner: { externalId: string; id: number },
  deps: BatchExecutorDeps,
): Promise<void> {
  const { db, logger } = deps;
  // Codex P5 follow-up — atomic claim on the item row. The earlier
  // unconditional `UPDATE ... SET status='running' WHERE id=?` would
  // double-dispatch if two executeBatch invocations both grabbed the
  // same item (e.g. an HMR reload that didn't fully tear down the
  // first run, or a hypothetical multi-instance scale-out). Now the
  // WHERE includes `status='pending'` so only one writer wins; the
  // loser sees affectedRows=0 and bails BEFORE calling dispatch.
  let claimAffected = 0;
  try {
    const claim = await db
      .update(batchTaskItems)
      .set({ status: 'running' })
      .where(
        and(
          eq(batchTaskItems.id, item.id),
          eq(batchTaskItems.status, 'pending'),
        ),
      );
    claimAffected = extractMysqlAffectedRows(claim);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), batchItemId: item.externalId },
      'batch-executor: item claim UPDATE threw',
    );
    return;
  }
  if (claimAffected === 0) {
    // Already running or terminal — another writer owns it. Don't
    // dispatch, don't broadcast — let the other owner finish.
    return;
  }
  await broadcastItemUpdate(batch, item.id, 'running', deps, owner.externalId);

  let taskInternalId: number | null = null;
  let taskExternalId: string | null = null;
  try {
    const res = await deps.dispatch({
      userInternalId: owner.id,
      userExternalId: owner.externalId,
      prompt: item.prompt,
    });
    taskInternalId = res.taskInternalId;
    taskExternalId = res.taskExternalId;
    await db
      .update(batchTaskItems)
      .set({ taskId: taskInternalId })
      .where(eq(batchTaskItems.id, item.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { batchId: batch.externalId, itemSeq: item.seq, err: msg },
      'batch-executor: dispatch failed',
    );
    await db
      .update(batchTaskItems)
      .set({
        status: 'failed',
        errorMessage: msg.slice(0, 1000),
        completedAt: new Date(),
      })
      .where(eq(batchTaskItems.id, item.id));
    await broadcastItemUpdate(batch, item.id, 'failed', deps, owner.externalId, {
      errorMessage: msg.slice(0, 200),
    });
    return;
  }

  // Poll the dispatched task until terminal.
  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      logger.warn(
        {
          batchId: batch.externalId,
          itemSeq: item.seq,
          taskId: taskExternalId,
          waitedMs: Date.now() - startedAt,
        },
        'batch-executor: item poll timed out — marking failed (task may still finish)',
      );
      await db
        .update(batchTaskItems)
        .set({
          status: 'failed',
          errorMessage: 'batch poll timeout — task still running on backend',
          completedAt: new Date(),
        })
        .where(eq(batchTaskItems.id, item.id));
      await broadcastItemUpdate(batch, item.id, 'failed', deps, owner.externalId, {
        errorMessage: 'batch poll timeout',
        ...(taskExternalId ? { taskExternalId } : {}),
      });
      return;
    }
    const [tRow] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskInternalId))
      .limit(1);
    if (tRow && isTaskTerminalStatus(tRow.status)) {
      const itemStatus = taskTerminalStatusToBatchItemStatus(tRow.status);
      const ok = itemStatus === 'completed';
      const errorMessage = ok ? null : `task ended with status=${tRow.status}`;
      await db
        .update(batchTaskItems)
        .set({
          status: itemStatus,
          completedAt: new Date(),
          ...(errorMessage ? { errorMessage } : {}),
        })
        .where(eq(batchTaskItems.id, item.id));
      await broadcastItemUpdate(
        batch,
        item.id,
        itemStatus,
        deps,
        owner.externalId,
        {
          ...(taskExternalId ? { taskExternalId } : {}),
          ...(errorMessage ? { errorMessage } : {}),
        },
      );
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Recompute parent counters + status from the items table and
 * broadcast a final progress event. Always called once per
 * executeBatch run (happy path AND cancellation path).
 */
async function finalizeBatch(batchInternalId: number, deps: BatchExecutorDeps): Promise<void> {
  const { db } = deps;
  // Re-read items to compute fresh counters.
  const items = await db
    .select({ id: batchTaskItems.id, status: batchTaskItems.status })
    .from(batchTaskItems)
    .where(eq(batchTaskItems.batchId, batchInternalId));
  const counts = summarizeBatchItemStatuses(items);
  const [batch] = await db
    .select()
    .from(batchTasks)
    .where(eq(batchTasks.id, batchInternalId))
    .limit(1);
  if (!batch) return;
  // Preserve a user-pressed cancellation; only flip to completed /
  // partial when status is still 'running'.
  let nextStatus = batch.status;
  if (batch.status === 'running') {
    nextStatus = counts.failed === 0 && counts.cancelled === 0 ? 'completed' : 'partial';
  }
  await db
    .update(batchTasks)
    .set({
      itemsTotal: counts.total,
      itemsDone: counts.done,
      itemsFailed: counts.failed,
      status: nextStatus,
      ...(nextStatus !== 'running' ? { completedAt: new Date() } : {}),
    })
    .where(eq(batchTasks.id, batchInternalId));
  // Final broadcast — same shape as per-item updates but no `item`.
  const [owner] = await db
    .select({ externalId: users.externalId })
    .from(users)
    .where(eq(users.id, batch.userId))
    .limit(1);
  if (owner) {
    deps.broadcastToUser(owner.externalId, {
      type: 'server.batch.progress',
      batchId: batch.externalId,
      status: nextStatus as 'pending' | 'running' | 'completed' | 'partial' | 'cancelled',
      itemsTotal: counts.total,
      itemsDone: counts.done,
      itemsFailed: counts.failed,
      itemsCancelled: counts.cancelled,
    });
  }
}

/**
 * Push a server.batch.progress frame to the owning user when an
 * item changes state. Re-reads the parent's counters so the frame
 * carries a consistent snapshot; callers don't need to maintain a
 * running tally.
 */
async function broadcastItemUpdate(
  batch: BatchTask,
  itemInternalId: number,
  itemStatus:
    | 'pending'
    | 'running'
    | 'completed'
    | 'partial_success'
    | 'failed'
    | 'cancelled',
  deps: BatchExecutorDeps,
  userExternalId: string,
  extras?: { taskExternalId?: string; errorMessage?: string },
): Promise<void> {
  const { db } = deps;
  const [item] = await db
    .select()
    .from(batchTaskItems)
    .where(eq(batchTaskItems.id, itemInternalId))
    .limit(1);
  if (!item) return;
  // Snapshot the running counters.
  const items = await db
    .select({ status: batchTaskItems.status })
    .from(batchTaskItems)
    .where(eq(batchTaskItems.batchId, batch.id));
  const counts = summarizeBatchItemStatuses(items);
  deps.broadcastToUser(userExternalId, {
    type: 'server.batch.progress',
    batchId: batch.externalId,
    status: 'running',
    itemsTotal: counts.total,
    itemsDone: counts.done,
    itemsFailed: counts.failed,
    itemsCancelled: counts.cancelled,
    item: {
      batchItemId: item.externalId,
      seq: item.seq,
      status: itemStatus,
      ...(extras?.taskExternalId ? { taskId: extras.taskExternalId } : {}),
      ...(extras?.errorMessage ? { errorMessage: extras.errorMessage } : {}),
    },
  });
}

export function summarizeBatchItemStatuses(
  items: ReadonlyArray<{ status: string }>,
): {
  total: number;
  done: number;
  failed: number;
  cancelled: number;
  terminal: number;
} {
  let done = 0;
  let failed = 0;
  let cancelled = 0;
  for (const item of items) {
    if (item.status === 'completed') done += 1;
    else if (item.status === 'failed' || item.status === 'partial_success') failed += 1;
    else if (item.status === 'cancelled') cancelled += 1;
  }
  return {
    total: items.length,
    done,
    failed,
    cancelled,
    terminal: done + failed + cancelled,
  };
}

function taskTerminalStatusToBatchItemStatus(status: string):
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'cancelled' {
  if (status === 'completed') return 'completed';
  if (status === 'partial_success') return 'partial_success';
  if (status === 'cancelled') return 'cancelled';
  return 'failed';
}

/**
 * Codex P5 follow-up — extract MySQL affectedRows from a drizzle
 * update result. Mirrors the helper in scheduled-runner.ts +
 * task-repository.ts; lifted here so the executor can run the same
 * atomic-claim pattern.
 */
function extractMysqlAffectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    if (typeof head?.affectedRows === 'number') return head.affectedRows;
  }
  const direct = (result as { affectedRows?: number } | null)?.affectedRows;
  return typeof direct === 'number' ? direct : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Phase 5b — concurrency-bounded fanout helper. Extracted from the
 * executor's main loop so the scheduling logic can be unit-tested
 * without a DB. Identical semantics:
 *   - At most `concurrency` tasks running at once
 *   - Items processed in input-array order (deterministic dispatch)
 *   - Each `run(item)` is awaited independently; thrown errors are
 *     captured per item and DO NOT propagate to sibling promises
 *   - Returns a parallel array of per-item results: { ok: true } or
 *     { ok: false; error: string }
 *
 * Pure of any side effects beyond `run` invocations — good for tests.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<void>,
): Promise<Array<{ ok: true } | { ok: false; error: string }>> {
  const limit = Math.max(1, concurrency);
  const results = new Array<{ ok: true } | { ok: false; error: string } | undefined>(items.length);
  let nextIndex = 0;
  const workers: Promise<void>[] = [];
  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      const item = items[i]!;
      try {
        await run(item, i);
        results[i] = { ok: true };
      } catch (err) {
        results[i] = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }
  for (let n = 0; n < Math.min(limit, items.length); n++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results.map((r) => r ?? { ok: false, error: 'never-ran' });
}

/**
 * Helper for the tRPC create mutation: insert the batch row + the
 * items in one go, then return the batch's external id. Caller is
 * responsible for kicking off `executeBatch(externalId, deps)` after
 * the rows are committed.
 *
 * `concurrencyFromPlan` is the per-plan default (Free=1 / Basic=3 /
 * Pro=5); callers may pass a lower value (the SPA's form caps to 5)
 * but raising it is rejected to keep a single source of truth.
 */
export async function insertBatch(
  db: DB,
  opts: {
    userInternalId: number;
    name: string | null;
    prompts: string[];
    concurrency: number;
    batchExternalId: string;
    itemExternalIdFactory: () => string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await tx.insert(batchTasks).values({
      externalId: opts.batchExternalId,
      userId: opts.userInternalId,
      name: opts.name,
      concurrency: opts.concurrency,
      status: 'pending',
      itemsTotal: opts.prompts.length,
    });
    // Drizzle's `.insert().values()` doesn't return the inserted id
    // directly on mysql2; re-look up by external_id for the FK.
    void result;
    const [parent] = await tx
      .select({ id: batchTasks.id })
      .from(batchTasks)
      .where(eq(batchTasks.externalId, opts.batchExternalId))
      .limit(1);
    if (!parent) throw new Error('insertBatch: parent vanished after insert');
    await tx.insert(batchTaskItems).values(
      opts.prompts.map((prompt, idx) => ({
        externalId: opts.itemExternalIdFactory(),
        batchId: parent.id,
        seq: idx,
        prompt,
        status: 'pending' as const,
      })),
    );
  });
}

// Re-export for the test file's convenience.
export { POLL_INTERVAL_MS, MAX_WAIT_MS };

// Suppress unused-import noise for `inArray` (kept for future bulk
// queries on cancel; not currently called but the test file imports
// the module and lints all of it).
void inArray;
