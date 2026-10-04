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

import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
// rrule ships CJS-first (package.json main: dist/es5/rrule.js). Node 22's
// ESM interop doesn't expose `rrulestr` as a named import on CJS modules
// reliably — `import { rrulestr } from 'rrule'` crashes with
// "does not provide an export named 'rrulestr'" at module load. Default
// import + destructure works because the default IS the CJS module
// object, and the property lookup happens at call time (not import time).
import rrule from 'rrule';
const { rrulestr } = rrule as {
  rrulestr: (s: string) => { after: (d: Date, inc?: boolean) => Date | null };
};
import { accountClosureAllowsExecution } from '../account-closure/repository.js';
import { logger } from '../config/logger.js';
import { scheduledTasks } from '../db/schema/scheduled-tasks.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import type { ExecutionAdmission } from '../execution/execution-admission.js';
import type { OperationLifetime } from '../execution/owned-operation.js';
import {
  callScheduledHook,
  retainScheduledUncertainty,
  runScheduledOperation,
} from './scheduled-lifetime.js';

const DEFAULT_POLL_MS = 60_000;
const TERMINAL_TASK_STATUSES = ['completed', 'partial_success', 'failed', 'cancelled'] as const;

/**
 * Input of the `notify` hook.
 *
 * `phase: 'dispatch'` — the runner tried to start the task (ok = a task was
 * created / an inline job finished; skipped = deliberately not started).
 * `phase: 'task_terminal'` — Batch 10.3: the task created by a dispatch
 * reached a terminal state (`outcome`). The streak / preference fields let
 * the hook apply `decideTaskOutcomeNotification` without another DB read.
 */
export interface ScheduledOutcomeNotifyInput {
  userInternalId: number;
  scheduledTaskInternalId: number;
  intent: string;
  ok: boolean;
  error: string | null;
  skipped?: boolean;
  phase?: 'dispatch' | 'task_terminal';
  /** Set when phase='task_terminal' (or an inline job completed). */
  outcome?: 'success' | 'failed' | 'cancelled';
  consecutiveFailures?: number;
  failureNotifyThreshold?: number;
  notifyOnSuccess?: boolean;
}

export interface ScheduledRunnerDeps {
  /** Optional until closed boot and every producer are wired together. */
  executionDrain?: ExecutionAdmission;
  /** Drizzle db handle. */
  db: typeof import('../db/client.js').db;
  /**
   * Called for each due row with the row's intent + userId so the
   * caller can create a real task. Return value is the new task's
   * internal bigint id (saved to last_task_id) or null on failure.
   * Errors should be caught inside the callback — the runner just
   * checks the resolved value.
   */
  dispatch: (
    row: {
      scheduledTaskId: number;
      userInternalId: number;
      intent: string;
    },
    lifetime?: OperationLifetime,
  ) => Promise<number | null | { skipped: true; note: string } | { completed: true }>;
  /**
   * Phase 26B — optional notification hook. Called after every
   * terminal dispatch (success OR failure) so the user's inbox +
   * configured webhooks fire. Injected (not imported directly) so
   * tests can stub without standing up the notification service.
   * When omitted, the runner skips notifications entirely (back-
   * compat with existing tests that don't care).
   */
  notify?: (
    input: ScheduledOutcomeNotifyInput,
    lifetime?: OperationLifetime,
  ) => Promise<void>;
  /**
   * Phase 26B follow-up — reminder hook. Fires when a row's
   * `next_run_at - reminder_minutes` window opens AND we haven't
   * already fired the reminder for this cycle. Separate from
   * `notify` because the shape + type ('task_reminder') is distinct.
   * Omit to skip reminder scanning entirely.
   */
  notifyReminder?: (
    input: {
      userInternalId: number;
      scheduledTaskInternalId: number;
      intent: string;
      nextRunAt: Date;
      reminderMinutes: number;
    },
    lifetime?: OperationLifetime,
  ) => Promise<void>;
  /** Override poll interval (ms). Default 60_000. Tests pass smaller. */
  pollIntervalMs?: number;
  /**
   * Batch 10.3 — run the terminal-outcome settle pass at the end of every
   * tick (fold finished tasks into the failure streak + `task_terminal`
   * notifications). Production wiring enables it; off keeps the tick's DB
   * footprint identical to the pre-10.3 runner.
   */
  settleTaskOutcomes?: boolean;
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
let runnerPending: Promise<void> | null = null;
let runnerGeneration = Symbol();

/**
 * Start the polling loop. Idempotent: calling twice without an
 * intervening stop is a no-op so HMR / re-import doesn't double-
 * schedule. Returns the interval handle so callers can pass it back
 * to `stopScheduledRunner`.
 */
export function startScheduledRunner(deps: ScheduledRunnerDeps): NodeJS.Timeout {
  if (runnerInterval) return runnerInterval;
  const generation = Symbol();
  runnerGeneration = generation;
  const pollMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
  logger.info({ pollMs }, 'scheduled-runner: starting');
  // Fire once immediately on boot so a row that was due during a
  // restart doesn't sit waiting for the first interval tick.
  const run = (recover: boolean): Promise<void> => {
    if (generation !== runnerGeneration || runnerPending) return Promise.resolve();
    // Reserve before invoking any dependency; stop may run before dispatch.
    const pending = Promise.resolve()
      .then(async () => {
        if (generation !== runnerGeneration) return;
        // A new recovery sweep could replay a previous ambiguous dispatch.
        // Retain the schedule and wait for reconciliation, never retry to clear it.
        if (deps.executionDrain?.drain.snapshot().unknown) return;
        try {
          const pass = async () => {
            if (recover) await recoverStuckRunningScheduledTasks(deps.db);
            if (deps.executionDrain?.drain.snapshot().unknown) return;
            await tick(deps);
          };
          if (deps.executionDrain) {
            await deps.executionDrain.runRoot(() => runScheduledOperation('scheduler', pass))
              .result;
          } else {
            await pass();
          }
        } catch (err) {
          logger.warn({ err: errMsg(err) }, 'scheduled-runner: tick failed closed');
        }
      })
      .finally(() => {
        if (runnerPending === pending) runnerPending = null;
      });
    runnerPending = pending;
    return pending;
  };
  void run(false).catch((err) => {
    logger.error({ err: errMsg(err) }, 'scheduled-runner: unexpected tick rejection');
  });
  runnerInterval = setInterval(() => {
    void run(true).catch((err) => {
      logger.error({ err: errMsg(err) }, 'scheduled-runner: unexpected tick rejection');
    });
  }, pollMs);
  return runnerInterval;
}

/** Stop future ticks immediately; wait for this poll pass, not its detached task children. */
export function stopScheduledRunner(): Promise<void> {
  runnerGeneration = Symbol();
  if (runnerInterval) {
    clearInterval(runnerInterval);
    runnerInterval = null;
    logger.info('scheduled-runner: stopped');
  }
  return runnerPending ?? Promise.resolve();
}

/**
 * Codex P5 follow-up — extract MySQL affectedRows from a drizzle
 * `db.update(...).set(...).where(...)` result. mysql2 returns
 * `[ResultSetHeader, ...]`; some shape variants surface the count
 * directly on the top-level object. Probe both.
 */
function extractMysqlAffectedRows(result: unknown, maxRows = Number.MAX_SAFE_INTEGER): number {
  const observed = Array.isArray(result)
    ? (result[0] as { affectedRows?: unknown } | null)?.affectedRows
    : (result as { affectedRows?: unknown } | null)?.affectedRows;
  if (
    typeof observed !== 'number' ||
    !Number.isSafeInteger(observed) ||
    observed < 0 ||
    observed > maxRows
  ) {
    // Unknown is not a winning CAS. Preserve legacy extraction only outside
    // an owned pass; scoped callers must not dispatch from an untrusted ACK.
    if (retainScheduledUncertainty() && maxRows === 1) return 0;
  }
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
    const result = await runScheduledOperation('database', async () =>
      db
        .update(scheduledTasks)
        .set({ status: 'active' })
        .where(
          and(
            eq(scheduledTasks.status, 'running'),
            sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${scheduledTasks.userId} AND ${users.status} = 'active')`,
          ),
        ),
    );
    const affected = extractMysqlAffectedRows(result);
    if (affected > 0) {
      logger.info(
        { recovered: affected },
        'scheduled-runner: boot sweep restored stuck-running rows to active',
      );
    }
    return affected;
  } catch (err) {
    logger.warn({ err: errMsg(err) }, 'scheduled-runner: boot sweep failed (non-fatal)');
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
    const rows = await runScheduledOperation('database', async () =>
      deps.db
        .select({
          id: scheduledTasks.id,
          userId: scheduledTasks.userId,
          intent: scheduledTasks.intent,
          nextRunAt: scheduledTasks.nextRunAt,
          reminderMinutes: scheduledTasks.reminderMinutes,
          lastReminderRun: scheduledTasks.lastReminderRun,
        })
        .from(scheduledTasks)
        .where(eq(scheduledTasks.status, 'active')),
    );
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
      const result = await runScheduledOperation('database', async () =>
        deps.db
          .update(scheduledTasks)
          .set({ lastReminderRun: c.nextRunAt })
          .where(
            and(
              eq(scheduledTasks.id, c.id),
              eq(scheduledTasks.status, 'active'),
              eq(scheduledTasks.nextRunAt, c.nextRunAt),
              // Re-check the not-fired predicate in the UPDATE itself.
              // Without this, two overlapping ticks can both select the
              // same cycle and both deliver the reminder.
              or(
                isNull(scheduledTasks.lastReminderRun),
                lt(scheduledTasks.lastReminderRun, c.nextRunAt),
              ),
            ),
          ),
      );
      claimed = extractMysqlAffectedRows(result, 1);
    } catch (err) {
      logger.warn(
        { err: errMsg(err), scheduledTaskId: c.id },
        'scheduled-runner: reminder claim UPDATE threw',
      );
      continue;
    }
    if (claimed === 0) continue;
    if (!(await scheduledOwnerAllowsExecution(deps, c.userId, c.id, 'reminder'))) continue;
    try {
      await callScheduledHook(deps.notifyReminder, {
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
    consecutiveFailures?: number | null;
    failureNotifyThreshold?: number | null;
    notifyOnSuccess?: boolean | null;
  }>;
  try {
    candidates = await runScheduledOperation('database', async () =>
      deps.db
        .select({
          id: scheduledTasks.id,
          userId: scheduledTasks.userId,
          intent: scheduledTasks.intent,
          repeatType: scheduledTasks.repeatType,
          // Phase 26A — when rrule is set, computeNextRunFromInputs uses
          // it instead of repeatType.
          rrule: scheduledTasks.rrule,
          // Batch 10.3 — outcome notification preferences + streak. Only this
          // runner mutates the streak while the row is claimed, so the
          // finalize below can write the next value directly.
          consecutiveFailures: scheduledTasks.consecutiveFailures,
          failureNotifyThreshold: scheduledTasks.failureNotifyThreshold,
          notifyOnSuccess: scheduledTasks.notifyOnSuccess,
        })
        .from(scheduledTasks)
        .where(and(eq(scheduledTasks.status, 'active'), lte(scheduledTasks.nextRunAt, now))),
    );
  } catch (err) {
    logger.warn({ err: errMsg(err) }, 'scheduled-runner: scan failed');
    return;
  }
  if (candidates.length === 0) {
    await settleScheduledTaskOutcomes(deps);
    return;
  }
  logger.info({ count: candidates.length }, 'scheduled-runner: candidates found');
  for (const row of candidates) {
    // Phase 2 atomic claim.
    let claimAffected = 0;
    try {
      const claim = await runScheduledOperation('database', async () =>
        deps.db
          .update(scheduledTasks)
          .set({ status: 'running' })
          .where(
            and(
              eq(scheduledTasks.id, row.id),
              eq(scheduledTasks.status, 'active'),
              lte(scheduledTasks.nextRunAt, now),
            ),
          ),
      );
      claimAffected = extractMysqlAffectedRows(claim, 1);
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
    if (!(await scheduledOwnerAllowsExecution(deps, row.userId, row.id, 'dispatch'))) {
      // The durable immediate-effects pass owns the running→paused change and
      // restoration ledger. Leaving the transient claim untouched here avoids
      // dispatch and prevents an unrecorded restoration.
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
    let skipNote: string | null = null; // 「跳过」语义（如非交易日）→ last_run_status='skipped'
    let completedInline = false; // 同步完成、无 task 行（如 A股简报）→ 直接计为成功
    try {
      const result = await callScheduledHook(deps.dispatch, {
        scheduledTaskId: row.id,
        userInternalId: row.userId,
        intent: row.intent,
      });
      if (
        !(typeof result === 'number' && Number.isSafeInteger(result) && result > 0) &&
        !(
          typeof result === 'object' &&
          result !== null &&
          'skipped' in result &&
          result.skipped === true &&
          typeof result.note === 'string'
        ) &&
        !(
          typeof result === 'object' &&
          result !== null &&
          'completed' in result &&
          result.completed === true
        )
      ) {
        retainScheduledUncertainty();
      }
      if (typeof result === 'object' && result !== null) {
        if ('skipped' in result) skipNote = result.note;
        else completedInline = true;
      } else {
        dispatchedTaskId = result;
      }
    } catch (err) {
      dispatchError = errMsg(err);
      logger.warn(
        { err: dispatchError, scheduledTaskId: row.id },
        'scheduled-runner: dispatch threw',
      );
    }
    const skipped = skipNote !== null;
    const dispatchOk =
      skipped || completedInline || (dispatchedTaskId !== null && dispatchError === null);
    // Batch 10.3 — failure streak. A dispatch failure extends it; an inline
    // completion resets it; a created task leaves it untouched until the
    // settle pass sees the task's terminal state (pending_task_id).
    const previousStreak = Math.max(0, Number(row.consecutiveFailures ?? 0) || 0);
    const nextStreak = !dispatchOk ? previousStreak + 1 : completedInline ? 0 : previousStreak;
    const streakColumns = {
      consecutiveFailures: nextStreak,
      pendingTaskId: dispatchOk && !skipped && !completedInline ? dispatchedTaskId : null,
    };
    const nextRun = computeNextRunFromInputs({
      from: now,
      rrule: row.rrule,
      repeatType: row.repeatType as 'once' | 'daily' | 'weekly' | 'monthly' | 'custom',
    });
    // Truncate the error so it fits a TEXT column without an extra
    // type. 2KB is plenty for a TRPCError / stack-trace-first-line;
    // longer payloads usually mean a system error worth shortening
    // before persisting.
    const truncatedError = dispatchError !== null ? dispatchError.slice(0, 2000) : null;
    let finalizeWon = false;
    try {
      finalizeWon = await runScheduledOperation('database', async () =>
        deps.db.transaction(async (tx) => {
          // Linearize freeze vs terminal finalization on the owner row. The
          // lock is released before any notification/webhook side effect.
          const [owner] = await runScheduledOperation('database', async () =>
            tx
              .select({ status: users.status })
              .from(users)
              .where(eq(users.id, row.userId))
              .limit(1)
              .for('update'),
          );
          if (owner?.status !== 'active') return false;
          const finalize =
            nextRun === null
              ? await runScheduledOperation('database', async () =>
                  tx
                    .update(scheduledTasks)
                    .set({
                      status: dispatchOk ? 'completed' : 'failed',
                      lastRunAt: now,
                      lastRunStatus: skipped ? 'skipped' : dispatchOk ? 'success' : 'failed',
                      lastError: skipped ? skipNote : truncatedError,
                      ...(dispatchedTaskId !== null ? { lastTaskId: dispatchedTaskId } : {}),
                      ...streakColumns,
                    })
                    .where(
                      and(eq(scheduledTasks.id, row.id), eq(scheduledTasks.status, 'running')),
                    ),
                )
              : await runScheduledOperation('database', async () =>
                  tx
                    .update(scheduledTasks)
                    .set({
                      status: 'active',
                      nextRunAt: nextRun,
                      lastRunAt: now,
                      lastRunStatus: skipped ? 'skipped' : dispatchOk ? 'success' : 'failed',
                      lastError: skipped ? skipNote : truncatedError,
                      ...(dispatchedTaskId !== null ? { lastTaskId: dispatchedTaskId } : {}),
                      ...streakColumns,
                    })
                    .where(
                      and(eq(scheduledTasks.id, row.id), eq(scheduledTasks.status, 'running')),
                    ),
                );
          return extractMysqlAffectedRows(finalize, 1) === 1;
        }),
      );
    } catch (err) {
      // Worst-case path — the row stays in 'running' until the boot
      // sweep recovers it. Log so we know it happened.
      logger.warn(
        { err: errMsg(err), scheduledTaskId: row.id },
        'scheduled-runner: advance failed — row may be stuck in running until next restart',
      );
    }
    if (!finalizeWon) continue;

    // Phase 26B — fire the user's inbox + webhook notifications.
    // Wrapped in its own try/catch so a notification path failure
    // never wedges the runner's tick. The notify implementation
    // itself never throws (allSettled fan-out), this is defence-
    // in-depth in case a future stub does.
    if (
      deps.notify &&
      (await scheduledOwnerAllowsExecution(deps, row.userId, row.id, 'notification'))
    ) {
      try {
        await callScheduledHook(deps.notify, {
          userInternalId: row.userId,
          scheduledTaskInternalId: row.id,
          intent: row.intent,
          ok: dispatchOk && !skipped,
          error: skipped ? skipNote : truncatedError,
          ...(skipped ? { skipped: true } : {}),
          phase: 'dispatch',
          ...(completedInline ? { outcome: 'success' as const } : {}),
          ...(!dispatchOk ? { outcome: 'failed' as const } : {}),
          consecutiveFailures: nextStreak,
          failureNotifyThreshold: Number(row.failureNotifyThreshold ?? 1) || 1,
          notifyOnSuccess: row.notifyOnSuccess === true,
        });
      } catch (err) {
        logger.warn(
          { err: errMsg(err), scheduledTaskId: row.id },
          'scheduled-runner: notify hook threw — ignoring',
        );
      }
    }
  }
  await settleScheduledTaskOutcomes(deps);
}

/**
 * Batch 10.3 — fold the terminal state of tasks created by earlier dispatches
 * into the failure streak and fire `task_terminal` notifications.
 *
 * A row is settled exactly once per dispatched task: the CAS UPDATE clears
 * `pending_task_id` only while it still points at that task, so a concurrent
 * re-dispatch (which overwrites the pointer) or a second runner cannot double
 * count. The join also requires the task to belong to the schedule owner.
 * Never throws — a settle failure must not wedge the dispatch tick.
 */
export async function settleScheduledTaskOutcomes(deps: ScheduledRunnerDeps): Promise<number> {
  if (deps.settleTaskOutcomes !== true) return 0;
  if (deps.executionDrain?.drain.snapshot().unknown) return 0;
  let rows: Array<{
    id: number;
    userId: number;
    intent: string;
    pendingTaskId: number | null;
    consecutiveFailures: number | null;
    failureNotifyThreshold: number | null;
    notifyOnSuccess: boolean | null;
    taskStatus: string;
    taskError: string | null;
  }>;
  try {
    rows = await runScheduledOperation('database', async () =>
      deps.db
        .select({
          id: scheduledTasks.id,
          userId: scheduledTasks.userId,
          intent: scheduledTasks.intent,
          pendingTaskId: scheduledTasks.pendingTaskId,
          consecutiveFailures: scheduledTasks.consecutiveFailures,
          failureNotifyThreshold: scheduledTasks.failureNotifyThreshold,
          notifyOnSuccess: scheduledTasks.notifyOnSuccess,
          taskStatus: tasks.status,
          taskError: tasks.errorMessage,
        })
        .from(scheduledTasks)
        .innerJoin(
          tasks,
          and(eq(tasks.id, scheduledTasks.pendingTaskId), eq(tasks.userId, scheduledTasks.userId)),
        )
        .where(
          and(
            isNotNull(scheduledTasks.pendingTaskId),
            inArray(tasks.status, [...TERMINAL_TASK_STATUSES]),
          ),
        )
        .limit(100),
    );
  } catch (err) {
    logger.warn({ err: errMsg(err) }, 'scheduled-runner: settle scan failed');
    return 0;
  }
  let settled = 0;
  for (const row of rows) {
    if (row.pendingTaskId === null) continue;
    const failed = row.taskStatus === 'failed';
    const cancelled = row.taskStatus === 'cancelled';
    const previousStreak = Math.max(0, Number(row.consecutiveFailures ?? 0) || 0);
    const nextStreak = failed ? previousStreak + 1 : cancelled ? previousStreak : 0;
    const error = failed ? (row.taskError ?? '任务执行失败').slice(0, 2000) : null;
    let won = false;
    try {
      const result = await runScheduledOperation('database', async () =>
        deps.db
          .update(scheduledTasks)
          .set({
            pendingTaskId: null,
            consecutiveFailures: nextStreak,
            ...(failed ? { lastRunStatus: 'failed', lastError: error } : {}),
          })
          .where(
            and(
              eq(scheduledTasks.id, row.id),
              eq(scheduledTasks.pendingTaskId, row.pendingTaskId as number),
            ),
          ),
      );
      won = extractMysqlAffectedRows(result, 1) === 1;
    } catch (err) {
      logger.warn({ err: errMsg(err), scheduledTaskId: row.id }, 'scheduled-runner: settle failed');
      continue;
    }
    if (!won) continue;
    settled += 1;
    if (
      !deps.notify ||
      !(await scheduledOwnerAllowsExecution(deps, row.userId, row.id, 'notification'))
    ) {
      continue;
    }
    try {
      await callScheduledHook(deps.notify, {
        userInternalId: row.userId,
        scheduledTaskInternalId: row.id,
        intent: row.intent,
        ok: !failed && !cancelled,
        error,
        phase: 'task_terminal',
        outcome: failed ? 'failed' : cancelled ? 'cancelled' : 'success',
        consecutiveFailures: nextStreak,
        failureNotifyThreshold: Number(row.failureNotifyThreshold ?? 1) || 1,
        notifyOnSuccess: row.notifyOnSuccess === true,
      });
    } catch (err) {
      logger.warn(
        { err: errMsg(err), scheduledTaskId: row.id },
        'scheduled-runner: terminal notify hook threw — ignoring',
      );
    }
  }
  return settled;
}

async function scheduledOwnerAllowsExecution(
  deps: ScheduledRunnerDeps,
  userId: number,
  scheduledTaskId: number,
  boundary: 'reminder' | 'dispatch' | 'notification',
): Promise<boolean> {
  try {
    return await runScheduledOperation('database', async () =>
      accountClosureAllowsExecution(deps.db, userId),
    );
  } catch (err) {
    logger.warn(
      { err: errMsg(err), scheduledTaskId, boundary },
      'scheduled-runner: owner gate failed closed',
    );
    return false;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
