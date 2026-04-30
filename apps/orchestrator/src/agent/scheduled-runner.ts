/**
 * Phase 16b — scheduled tasks runner.
 *
 * In-process polling loop (no BullMQ — Redis is up but the queue
 * dep isn't installed and v1 scale doesn't need it). Every 60s the
 * loop scans `scheduled_tasks` for active rows whose next_run_at is
 * in the past, fires the underlying agent task via `enqueueRun`,
 * then advances the row's next_run_at (or marks it completed for
 * one-shot triggers).
 *
 * Concurrency model: single-process. Multi-instance deployments
 * would race — gate this loop behind an env flag like
 * `SCHEDULED_RUNNER_ENABLED=1` and only one node sets it. Today
 * Vultr runs a single orchestrator pm2 process, so the bare loop
 * is safe.
 *
 * Runner is decoupled from the task-creation mutation: callers
 * pass a `dispatch` callback that builds a real task from the
 * intent string. This lets tests stub the dispatch without
 * importing the full tasks router graph.
 */

import { and, eq, lte } from 'drizzle-orm';
import { logger } from '../config/logger.js';
import { scheduledTasks } from '../db/schema/scheduled-tasks.js';

const DEFAULT_POLL_MS = 60_000;

export interface ScheduledRunnerDeps {
  /** Drizzle db handle. */
  db: typeof import('../db/client.js').db;
  /**
   * Called for each due row with the row's intent + userId so the
   * caller can create a real task. Return value is the new task's
   * internal bigint id (saved to last_task_id) or null on failure.
   * Errors should be caught inside the callback — the runner just
   * checks the resolved value.
   */
  dispatch: (row: {
    scheduledTaskId: number;
    userInternalId: number;
    intent: string;
  }) => Promise<number | null>;
  /** Override poll interval (ms). Default 60_000. Tests pass smaller. */
  pollIntervalMs?: number;
}

/**
 * Compute the next firing time for a recurring schedule. `from` is
 * the moment after which the next fire should occur; `repeatType`
 * picks the unit. For 'once' returns null (the row should be marked
 * completed instead of advanced).
 */
export function computeNextRun(
  from: Date,
  repeatType: 'once' | 'daily' | 'weekly' | 'monthly' | 'custom',
): Date | null {
  if (repeatType === 'once') return null;
  // 'custom' falls back to a simple +24h advance — full cron parsing
  // is not in scope for v1; the create endpoint rejects 'custom'
  // until we wire a parser.
  const next = new Date(from);
  if (repeatType === 'daily' || repeatType === 'custom') {
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  if (repeatType === 'weekly') {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  if (repeatType === 'monthly') {
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }
  return null;
}

let runnerInterval: NodeJS.Timeout | null = null;

/**
 * Start the polling loop. Idempotent: calling twice without an
 * intervening stop is a no-op so HMR / re-import doesn't double-
 * schedule. Returns the interval handle so callers can pass it back
 * to `stopScheduledRunner`.
 */
export function startScheduledRunner(deps: ScheduledRunnerDeps): NodeJS.Timeout {
  if (runnerInterval) return runnerInterval;
  const pollMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
  logger.info({ pollMs }, 'scheduled-runner: starting');
  // Fire once immediately on boot so a row that was due during a
  // restart doesn't sit waiting for the first interval tick.
  void tick(deps);
  runnerInterval = setInterval(() => {
    void tick(deps);
  }, pollMs);
  return runnerInterval;
}

export function stopScheduledRunner(): void {
  if (runnerInterval) {
    clearInterval(runnerInterval);
    runnerInterval = null;
    logger.info('scheduled-runner: stopped');
  }
}

async function tick(deps: ScheduledRunnerDeps): Promise<void> {
  const now = new Date();
  let due: Array<{
    id: number;
    userId: number;
    intent: string;
    repeatType: string;
  }>;
  try {
    due = await deps.db
      .select({
        id: scheduledTasks.id,
        userId: scheduledTasks.userId,
        intent: scheduledTasks.intent,
        repeatType: scheduledTasks.repeatType,
      })
      .from(scheduledTasks)
      .where(
        and(eq(scheduledTasks.status, 'active'), lte(scheduledTasks.nextRunAt, now)),
      );
  } catch (err) {
    logger.warn({ err: errMsg(err) }, 'scheduled-runner: scan failed');
    return;
  }
  if (due.length === 0) return;
  logger.info({ count: due.length }, 'scheduled-runner: firing due triggers');
  for (const row of due) {
    let dispatchedTaskId: number | null = null;
    try {
      dispatchedTaskId = await deps.dispatch({
        scheduledTaskId: row.id,
        userInternalId: row.userId,
        intent: row.intent,
      });
    } catch (err) {
      logger.warn(
        { err: errMsg(err), scheduledTaskId: row.id },
        'scheduled-runner: dispatch threw',
      );
    }
    // Advance regardless of dispatch success: a permanently-failing
    // dispatch shouldn't lock the row in a tight retry loop. The
    // user can pause from the UI to stop the bleeding.
    const nextRun = computeNextRun(
      now,
      row.repeatType as 'once' | 'daily' | 'weekly' | 'monthly' | 'custom',
    );
    try {
      if (nextRun === null) {
        // Once: mark completed.
        await deps.db
          .update(scheduledTasks)
          .set({
            status: 'completed',
            lastRunAt: now,
            ...(dispatchedTaskId !== null ? { lastTaskId: dispatchedTaskId } : {}),
          })
          .where(eq(scheduledTasks.id, row.id));
      } else {
        await deps.db
          .update(scheduledTasks)
          .set({
            nextRunAt: nextRun,
            lastRunAt: now,
            ...(dispatchedTaskId !== null ? { lastTaskId: dispatchedTaskId } : {}),
          })
          .where(eq(scheduledTasks.id, row.id));
      }
    } catch (err) {
      logger.warn(
        { err: errMsg(err), scheduledTaskId: row.id },
        'scheduled-runner: advance failed',
      );
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
