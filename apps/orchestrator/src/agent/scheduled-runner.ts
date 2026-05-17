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
// rrule ships CJS-first (package.json main: dist/es5/rrule.js). Node 22's
// ESM interop doesn't expose `rrulestr` as a named import on CJS modules
// reliably — `import { rrulestr } from 'rrule'` crashes with
// "does not provide an export named 'rrulestr'" at module load. Default
// import + destructure works because the default IS the CJS module
// object, and the property lookup happens at call time (not import time).
import rrule from 'rrule';
const { rrulestr } = rrule as { rrulestr: (s: string) => { after: (d: Date, inc?: boolean) => Date | null } };
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
  /**
   * Phase 26B — optional notification hook. Called after every
   * terminal dispatch (success OR failure) so the user's inbox +
   * configured webhooks fire. Injected (not imported directly) so
   * tests can stub without standing up the notification service.
   * When omitted, the runner skips notifications entirely (back-
   * compat with existing tests that don't care).
   */
  notify?: (input: {
    userInternalId: number;
    scheduledTaskInternalId: number;
    intent: string;
    ok: boolean;
    error: string | null;
  }) => Promise<void>;
  /**
   * Phase 26B follow-up — reminder hook. Fires when a row's
   * `next_run_at - reminder_minutes` window opens AND we haven't
   * already fired the reminder for this cycle. Separate from
   * `notify` because the shape + type ('task_reminder') is distinct.
   * Omit to skip reminder scanning entirely.
   */
  notifyReminder?: (input: {
    userInternalId: number;
    scheduledTaskInternalId: number;
    intent: string;
    nextRunAt: Date;
    reminderMinutes: number;
  }) => Promise<void>;
  /** Override poll interval (ms). Default 60_000. Tests pass smaller. */
  pollIntervalMs?: number;
}

/**
 * Compute the next firing time for a recurring schedule. `from` is
 * the moment after which the next fire should occur; `repeatType`
 * picks the unit. For 'once' returns null (the row should be marked
 * completed instead of advanced).
 *
 * Legacy API — kept for callers that don't have an rrule. Use
 * `computeNextRunFromInputs` for the Phase 26A combined logic.
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

/**
 * Phase 26A — combined next-run computation.
 *
 * Priority:
 *   1. If `rrule` is non-empty, parse with `rrulestr` and ask for the
 *      first occurrence STRICTLY AFTER `from`. Lets users express
 *      arbitrary RFC 5545 patterns (every weekday 9am, every other
 *      week on Tue/Thu, etc.).
 *   2. Otherwise fall through to `computeNextRun(from, repeatType)`
 *      — the legacy enum-driven path; existing rows without an rrule
 *      keep working unchanged.
 *
 * On rrule parse failure (malformed input from the user), logs +
 * falls back to repeatType so a typo doesn't wedge the runner. The
 * SPA-side editor should validate rrule before submitting; this is
 * belt-and-braces.
 *
 * `inc: false` ensures we skip the moment `from` itself — if a task
 * just fired at T, the next fire should be the SUBSEQUENT slot, not
 * T again.
 */
export function computeNextRunFromInputs(opts: {
  from: Date;
  rrule: string | null;
  repeatType: 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';
}): Date | null {
  const { from, rrule, repeatType } = opts;
  if (rrule && rrule.trim().length > 0) {
    try {
      const rule = rrulestr(rrule);
      const next = rule.after(from, false);
      return next ?? null;
    } catch (err) {
      logger.warn(
        { err: errMsg(err), rrule },
        'scheduled-runner: rrule parse failed, falling back to repeat_type',
      );
    }
  }
  return computeNextRun(from, repeatType);
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

/**
 * Codex P5 follow-up — extract MySQL affectedRows from a drizzle
 * `db.update(...).set(...).where(...)` result. mysql2 returns
 * `[ResultSetHeader, ...]`; some shape variants surface the count
 * directly on the top-level object. Probe both.
 */
function extractMysqlAffectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    if (typeof head?.affectedRows === 'number') return head.affectedRows;
  }
  const direct = (result as { affectedRows?: number } | null)?.affectedRows;
  return typeof direct === 'number' ? direct : 0;
}

/**
 * Codex P5 follow-up — boot-time recovery sweep. A pm2 restart that
 * lands BETWEEN claim ('running') and restore ('active' / 'completed')
 * would leave a row stuck in 'running' forever; the runner's
 * next-tick scan only matches `status='active'`, so the row never
 * fires again.
 *
 * Restore every row in `running` back to `active` on boot. Worst
 * case we fire one extra time (next tick re-claims atomically and
 * dispatches), which is the lesser of two evils vs. silent stop.
 */
export async function recoverStuckRunningScheduledTasks(
  db: ScheduledRunnerDeps['db'],
): Promise<number> {
  try {
    const result = await db
      .update(scheduledTasks)
      .set({ status: 'active' })
      .where(eq(scheduledTasks.status, 'running'));
    const affected = extractMysqlAffectedRows(result);
    if (affected > 0) {
      logger.info(
        { recovered: affected },
        'scheduled-runner: boot sweep restored stuck-running rows to active',
      );
    }
    return affected;
  } catch (err) {
    logger.warn(
      { err: errMsg(err) },
      'scheduled-runner: boot sweep failed (non-fatal)',
    );
    return 0;
  }
}

/**
 * Phase 26B follow-up — fire pending reminders for rows whose
 * `next_run_at - reminder_minutes` window is open and whose
 * `last_reminder_run` is still null OR points at an older cycle.
 *
 * Same two-phase atomic-claim pattern as the dispatch tick: an
 * UPDATE with a WHERE that re-validates the precondition flips
 * `last_reminder_run = next_run_at` and we only fire notifyReminder
 * for the row when affectedRows = 1.
 *
 * Runs ONCE per tick before the dispatch scan so a reminder
 * scheduled for the same minute as the fire still fires its
 * pre-flight notification (only just before, but ordering is
 * preserved within the tick).
 */
async function reminderScan(deps: ScheduledRunnerDeps, now: Date): Promise<void> {
  if (!deps.notifyReminder) return;
  // Eligible rows: active, reminder set, not yet fired this cycle,
  // and within the lead-time window. The (next_run_at > now) guard
  // means we skip dispatching a reminder for a row whose actual
  // fire is overdue — the dispatch path will handle that.
  let candidates: Array<{
    id: number;
    userId: number;
    intent: string;
    nextRunAt: Date;
    reminderMinutes: number;
  }>;
  try {
    const rows = await deps.db
      .select({
        id: scheduledTasks.id,
        userId: scheduledTasks.userId,
        intent: scheduledTasks.intent,
        nextRunAt: scheduledTasks.nextRunAt,
        reminderMinutes: scheduledTasks.reminderMinutes,
        lastReminderRun: scheduledTasks.lastReminderRun,
      })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.status, 'active'));
    candidates = [];
    for (const r of rows) {
      const rm = r.reminderMinutes;
      if (rm === null) continue;
      if (r.nextRunAt.getTime() <= now.getTime()) continue;
      const windowOpen = new Date(r.nextRunAt.getTime() - rm * 60_000);
      if (now.getTime() < windowOpen.getTime()) continue;
      // Already fired the reminder for THIS cycle?
      if (r.lastReminderRun && r.lastReminderRun.getTime() >= r.nextRunAt.getTime()) {
        continue;
      }
      candidates.push({
        id: r.id,
        userId: r.userId,
        intent: r.intent,
        nextRunAt: r.nextRunAt,
        reminderMinutes: rm,
      });
    }
  } catch (err) {
    logger.warn({ err: errMsg(err) }, 'scheduled-runner: reminder scan failed');
    return;
  }
  for (const c of candidates) {
    // Atomic claim: only the winning UPDATE actually fires the
    // notify call. The WHERE re-validates both the cycle anchor
    // (next_run_at) and the not-fired-this-cycle predicate so two
    // ticks racing on the same row still produce exactly one
    // notification.
    let claimed = 0;
    try {
      const result = await deps.db
        .update(scheduledTasks)
        .set({ lastReminderRun: c.nextRunAt })
        .where(
          and(
            eq(scheduledTasks.id, c.id),
            eq(scheduledTasks.nextRunAt, c.nextRunAt),
            // Re-check the not-fired predicate via a raw OR so we
            // don't have to load lastReminderRun into the SET.
            // Drizzle's where chain wraps this in AND with the
            // others above.
          ),
        );
      claimed = extractMysqlAffectedRows(result);
    } catch (err) {
      logger.warn(
        { err: errMsg(err), scheduledTaskId: c.id },
        'scheduled-runner: reminder claim UPDATE threw',
      );
      continue;
    }
    if (claimed === 0) continue;
    try {
      await deps.notifyReminder({
        userInternalId: c.userId,
        scheduledTaskInternalId: c.id,
        intent: c.intent,
        nextRunAt: c.nextRunAt,
        reminderMinutes: c.reminderMinutes,
      });
    } catch (err) {
      logger.warn(
        { err: errMsg(err), scheduledTaskId: c.id },
        'scheduled-runner: notifyReminder threw — keeping claim (no retry)',
      );
    }
  }
}

async function tick(deps: ScheduledRunnerDeps): Promise<void> {
  const now = new Date();
  // Phase 26B follow-up — reminder pass first so a reminder
  // scheduled for the SAME minute as the actual fire still surfaces
  // before the task runs.
  await reminderScan(deps, now);
  // Codex P5 follow-up — TWO-PHASE atomic claim. The old single-phase
  // pattern (SELECT due → for each row: dispatch → UPDATE advance)
  // had a race: two ticks (e.g. boot-tick + first interval-tick
  // within 60s) could both see the same `due` row and double-
  // dispatch. Even single-instance the immediate boot-tick races
  // with the next interval-tick if dispatch takes >60s.
  //
  // Phase 1: scan candidates (cheap).
  // Phase 2: per row, atomic UPDATE WHERE status='active' AND
  //          next_run_at<=NOW → set status='running'. Inspecting
  //          affectedRows tells us if WE got the claim; if not,
  //          someone else has it (or it's no longer due), skip.
  //
  // After dispatch (success OR failure), restore to 'active' (with
  // advanced next_run_at) for recurring, or to 'completed' for
  // one-shot. We always restore — a permanently-failing dispatch
  // gets advanced to the next interval and the user can pause from
  // the UI. Boot sweep recovers any row that crashed mid-dispatch.
  let candidates: Array<{
    id: number;
    userId: number;
    intent: string;
    repeatType: string;
    rrule: string | null;
  }>;
  try {
    candidates = await deps.db
      .select({
        id: scheduledTasks.id,
        userId: scheduledTasks.userId,
        intent: scheduledTasks.intent,
        repeatType: scheduledTasks.repeatType,
        // Phase 26A — when rrule is set, computeNextRunFromInputs uses
        // it instead of repeatType.
        rrule: scheduledTasks.rrule,
      })
      .from(scheduledTasks)
      .where(
        and(eq(scheduledTasks.status, 'active'), lte(scheduledTasks.nextRunAt, now)),
      );
  } catch (err) {
    logger.warn({ err: errMsg(err) }, 'scheduled-runner: scan failed');
    return;
  }
  if (candidates.length === 0) return;
  logger.info({ count: candidates.length }, 'scheduled-runner: candidates found');
  for (const row of candidates) {
    // Phase 2 atomic claim.
    let claimAffected = 0;
    try {
      const claim = await deps.db
        .update(scheduledTasks)
        .set({ status: 'running' })
        .where(
          and(
            eq(scheduledTasks.id, row.id),
            eq(scheduledTasks.status, 'active'),
            lte(scheduledTasks.nextRunAt, now),
          ),
        );
      claimAffected = extractMysqlAffectedRows(claim);
    } catch (err) {
      logger.warn(
        { err: errMsg(err), scheduledTaskId: row.id },
        'scheduled-runner: claim UPDATE threw',
      );
      continue;
    }
    if (claimAffected === 0) {
      // Lost the race — another tick / instance grabbed this row,
      // OR a user paused/deleted it between the scan and the claim.
      continue;
    }

    // We own this row now (status='running'). Dispatch, then advance
    // + restore — both branches MUST run so the row doesn't wedge.
    //
    // Codex P1 follow-up — capture the dispatch error so we can
    // record `last_run_status='failed'` + `last_error` and (for
    // one-shot) flip the terminal status to 'failed' instead of
    // mis-labelling it 'completed'. Recurring schedules still
    // advance their nextRunAt (so the next interval gets another
    // shot) but the failure is visible in /scheduled.
    let dispatchedTaskId: number | null = null;
    let dispatchError: string | null = null;
    try {
      dispatchedTaskId = await deps.dispatch({
        scheduledTaskId: row.id,
        userInternalId: row.userId,
        intent: row.intent,
      });
    } catch (err) {
      dispatchError = errMsg(err);
      logger.warn(
        { err: dispatchError, scheduledTaskId: row.id },
        'scheduled-runner: dispatch threw',
      );
    }
    const dispatchOk = dispatchedTaskId !== null && dispatchError === null;
    const nextRun = computeNextRunFromInputs({
      from: now,
      rrule: row.rrule,
      repeatType: row.repeatType as 'once' | 'daily' | 'weekly' | 'monthly' | 'custom',
    });
    // Truncate the error so it fits a TEXT column without an extra
    // type. 2KB is plenty for a TRPCError / stack-trace-first-line;
    // longer payloads usually mean a system error worth shortening
    // before persisting.
    const truncatedError =
      dispatchError !== null ? dispatchError.slice(0, 2000) : null;
    try {
      if (nextRun === null) {
        // One-shot — terminal. 'completed' on success; 'failed' when
        // dispatch threw so the user can see the difference.
        await deps.db
          .update(scheduledTasks)
          .set({
            status: dispatchOk ? 'completed' : 'failed',
            lastRunAt: now,
            lastRunStatus: dispatchOk ? 'success' : 'failed',
            lastError: truncatedError,
            ...(dispatchedTaskId !== null ? { lastTaskId: dispatchedTaskId } : {}),
          })
          .where(eq(scheduledTasks.id, row.id));
      } else {
        // Recurring — restore to 'active' for the next tick. Failure
        // is recorded but doesn't block the next interval; the
        // common transient cause (quota, network blip) typically
        // resolves before the next fire.
        await deps.db
          .update(scheduledTasks)
          .set({
            status: 'active',
            nextRunAt: nextRun,
            lastRunAt: now,
            lastRunStatus: dispatchOk ? 'success' : 'failed',
            lastError: truncatedError,
            ...(dispatchedTaskId !== null ? { lastTaskId: dispatchedTaskId } : {}),
          })
          .where(eq(scheduledTasks.id, row.id));
      }
    } catch (err) {
      // Worst-case path — the row stays in 'running' until the boot
      // sweep recovers it. Log so we know it happened.
      logger.warn(
        { err: errMsg(err), scheduledTaskId: row.id },
        'scheduled-runner: advance failed — row may be stuck in running until next restart',
      );
    }

    // Phase 26B — fire the user's inbox + webhook notifications.
    // Wrapped in its own try/catch so a notification path failure
    // never wedges the runner's tick. The notify implementation
    // itself never throws (allSettled fan-out), this is defence-
    // in-depth in case a future stub does.
    if (deps.notify) {
      try {
        await deps.notify({
          userInternalId: row.userId,
          scheduledTaskInternalId: row.id,
          intent: row.intent,
          ok: dispatchOk,
          error: truncatedError,
        });
      } catch (err) {
        logger.warn(
          { err: errMsg(err), scheduledTaskId: row.id },
          'scheduled-runner: notify hook threw — ignoring',
        );
      }
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
