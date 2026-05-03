/**
 * Phase 24 RC follow-up — one-off cleanup for the "no queue" wreck.
 *
 * Before the global TaskQueue landed, a 30-task burst against the
 * 10-slot per-task BrowserPool let pool.allocate throw on tasks 11+,
 * fell back to a shared singleton, and 14 tasks raced the same Brave
 * on first screenshot. Their rows got persisted with reason like
 * "initial screenshot failed: ..." or "browser unavailable" or sat at
 * status='executing' indefinitely.
 *
 * BOSS asked to consolidate those rows behind a single, clear marker
 * so the test environment is clean before re-running RC. This script
 * walks every task that:
 *   - is currently 'executing' or 'failed'
 *   - was created within the last 12 hours (RC test window — a
 *     conservative cap so we don't touch unrelated history)
 *   - has an error_message containing one of the no-queue tells:
 *     "initial screenshot failed", "browser unavailable", or
 *     "PoolCapacityError"
 *
 * For each match, sets status='failed' (idempotent) and rewrites
 * error_message to "infra: no queue (Phase 24 RC follow-up cleanup)".
 * Prints a before/after row list so BOSS can audit what changed.
 *
 * Run on Vultr (where DATABASE_URL is already in process env):
 *   cd /opt/holaday-monorepo/apps/orchestrator
 *   pnpm exec tsx scripts/cleanup-no-queue-failures.ts
 *
 * Read-only dry run by default. Pass `--apply` to write changes.
 */

import { and, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';
import { tasks as tasksTable } from '../src/db/schema/index.js';

const CLEANUP_REASON = 'infra: no queue (Phase 24 RC follow-up cleanup)';
const WINDOW_HOURS = 12;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  // SELECT first — we want to print the affected set BEFORE writing
  // anything. Drizzle doesn't have a single-shot SELECT-then-UPDATE
  // with returning, and MySQL doesn't support RETURNING anyway, so
  // do it as two queries.
  const candidates = await db
    .select({
      id: tasksTable.id,
      externalId: tasksTable.externalId,
      status: tasksTable.status,
      errorMessage: tasksTable.errorMessage,
      createdAt: tasksTable.createdAt,
    })
    .from(tasksTable)
    .where(
      and(
        gte(tasksTable.createdAt, cutoff),
        inArray(tasksTable.status, ['executing', 'failed']),
        or(
          like(tasksTable.errorMessage, '%initial screenshot failed%'),
          like(tasksTable.errorMessage, '%browser unavailable%'),
          like(tasksTable.errorMessage, '%PoolCapacityError%'),
          like(tasksTable.errorMessage, '%no executor%'),
        ),
      ),
    );

  console.log(
    `[cleanup] window: last ${WINDOW_HOURS}h (since ${cutoff.toISOString()})`,
  );
  console.log(`[cleanup] candidates matched: ${candidates.length}`);
  for (const r of candidates) {
    const msgPreview = (r.errorMessage ?? '').slice(0, 100).replace(/\s+/g, ' ');
    console.log(
      `  - ${r.externalId}  status=${r.status}  created=${r.createdAt.toISOString()}  msg="${msgPreview}"`,
    );
  }

  if (candidates.length === 0) {
    console.log('[cleanup] nothing to do.');
    await pool.end();
    return;
  }

  if (!apply) {
    console.log('\n[cleanup] DRY RUN — pass --apply to actually rewrite these rows.');
    await pool.end();
    return;
  }

  // Single bulk UPDATE for atomicity (one round trip + a single
  // index seek per row). Updating completedAt too so the sidebar
  // sorts these out of the live-task bucket immediately.
  const ids = candidates.map((c) => c.id);
  const result = await db
    .update(tasksTable)
    .set({
      status: 'failed',
      errorMessage: CLEANUP_REASON,
      completedAt: sql`COALESCE(completed_at, CURRENT_TIMESTAMP(3))`,
    })
    .where(inArray(tasksTable.id, ids));

  console.log(`\n[cleanup] applied. drizzle result:`, result);

  // Quick verify — re-read the same rows and print the new state.
  const after = await db
    .select({
      externalId: tasksTable.externalId,
      status: tasksTable.status,
      errorMessage: tasksTable.errorMessage,
    })
    .from(tasksTable)
    .where(inArray(tasksTable.id, ids));

  console.log(`[cleanup] post-update state:`);
  for (const r of after) {
    console.log(
      `  - ${r.externalId}  status=${r.status}  msg="${(r.errorMessage ?? '').slice(0, 80)}"`,
    );
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('[cleanup] failed:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
