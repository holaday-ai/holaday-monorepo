/**
 * Phase 24 RC follow-up — global pool-capacity-aware task queue.
 *
 * Bridges `tasks.create` to the per-task BrowserPool: when 30 tasks
 * land at once but the pool only has 10 slots, the queue keeps the
 * extra 20 in `status='queued'` instead of letting them race the
 * shared singleton and crash on `initial screenshot failed`.
 *
 * Single global FIFO. NOT per-user — per-user concurrency is gated
 * upstream at admit time (`getActiveTaskCount` + plan limits). This
 * queue's only job is to throttle pool dispatch.
 *
 * Dispatch is fired on three triggers:
 *   1. enqueue() — try immediate dispatch via queueMicrotask.
 *   2. signalSlotFreed() — call from the pool-release path
 *      (`tasks.ts` runFn .finally) so the next queued task fires
 *      with no measurable wait.
 *   3. periodic tick — safety net for missed signals (5s default).
 *
 * Each tryDispatch fires AT MOST ONE task. Pool capacity is reflected
 * by the injected `canDispatch()` predicate; dispatching a task does
 * NOT itself decrement pool capacity (the runFn's pool.allocate does
 * that). Pacing is naturally driven by the per-call signals — N
 * signals drain at most N tasks, regardless of the pool's actual
 * state at signal time.
 *
 * Hard caps:
 *   - depth: 100 (enqueue rejects, caller surfaces "system busy")
 *   - per-task queue timeout: 10 min (worker fires onTimeout, drops it)
 */

import type { DrainController } from '../execution/drain-controller.js';
import type { OperationLifetime } from '../execution/owned-operation.js';
import {
  type QueueReservation,
  assertQueueDispatch,
  callQueueCallback,
  reserveQueueLifetime,
} from './task-queue-lifetime.js';

export interface QueuedTaskInput {
  /** Server-only live capability, never reconstructed from task/user IDs. */
  executionLifetime?: OperationLifetime;
  taskId: string;
  userId: string;
  /** The actual work — fired AFTER onStart resolves. */
  runFn: (lifetime?: OperationLifetime) => Promise<void>;
  /**
   * Called when this task transitions queued → executing. Caller
   * uses this to update the DB row's status + broadcast WS frames.
   */
  onStart: (lifetime?: OperationLifetime) => Promise<void> | void;
  /**
   * Called when the task ages past `queueTimeoutMs` without being
   * dispatched. Caller uses this to mark the DB row failed with a
   * `queue timeout` reason and broadcast a terminal frame.
   */
  onTimeout?: (lifetime?: OperationLifetime) => Promise<void> | void;
}

export type EnqueueResult =
  | { kind: 'dispatched'; position: number }
  | { kind: 'queued'; position: number }
  | { kind: 'rejected'; reason: string };

export interface TaskQueueConfig {
  executionDrain?: DrainController;
  /** Returns true when a slot is available right now. Usually wraps `pool.canAllocate()`. */
  canDispatch: () => boolean;
  /**
   * Pool capacity — used as the queue-internal pacing ceiling so a
   * 30-task burst can't fire 30 dispatches in one microtask flush
   * before the first runFn even reaches `pool.allocate`. The queue
   * tracks `inFlight` (dispatched but not yet release-signalled) and
   * never lets it exceed this number, even if `canDispatch()` keeps
   * returning true.
   */
  capacity: number;
  /** Periodic-tick interval (ms). Safety net for missed signals. */
  tickMs: number;
  /** Reject enqueue when queue length reaches this. */
  maxDepth: number;
  /** Per-task max wait in queue before onTimeout fires. */
  queueTimeoutMs: number;
  /** Test seam — override Date.now. */
  now?: () => number;
  /** Optional logger; falls back to no-op. */
  logger?: (level: 'info' | 'warn', msg: string, ctx?: Record<string, unknown>) => void;
}

export interface TaskQueue {
  enqueue(input: QueuedTaskInput): EnqueueResult;
  signalSlotFreed(): void;
  size(): number;
  snapshot(): Array<{ taskId: string; userId: string; enqueuedAt: number }>;
  /** Stops future dispatch, waits current callbacks; queued entries still prevent drain idle. */
  stop(): Promise<void>;
}

interface QueuedEntry extends QueuedTaskInput {
  enqueuedAt: number;
}

export function createTaskQueue(cfg: TaskQueueConfig): TaskQueue {
  const queue: QueuedEntry[] = [];
  const reservations = new WeakMap<QueuedEntry, QueueReservation>();
  const controller = cfg.executionDrain;
  const callbacks = new Set<Promise<void>>();
  let stopped = false;
  // Tasks dispatched by THIS queue that haven't yet had
  // `signalSlotFreed` called for them. Decremented to 0-floor on
  // each signal; incremented on every successful dispatch. Bounded
  // by `cfg.capacity` to prevent burst over-dispatch (the underlying
  // pool's `canDispatch` predicate is a snapshot — between dispatch
  // and allocate, it can keep returning true and we'd otherwise drain
  // the entire queue into a single capacity slot).
  let inFlight = 0;
  const now = (): number => cfg.now?.() ?? Date.now();
  const log = (level: 'info' | 'warn', message: string, context: Record<string, unknown>): void => {
    try {
      cfg.logger?.(level, message, context);
    } catch {
      /* Diagnostics cannot change queue admission or completion. */
    }
  };

  function canProceed(t?: QueuedEntry): boolean {
    if (stopped) return false;
    const snapshot = controller?.drain.snapshot();
    if (snapshot && (snapshot.mode === 'blocked' || snapshot.unknown > 0)) return false;
    try {
      const reservation = t ? reservations.get(t) : undefined;
      if (reservation) assertQueueDispatch(reservation);
      return true;
    } catch {
      return false;
    }
  }

  function call(t: QueuedEntry, phase: 'onStart' | 'runFn' | 'onTimeout'): Promise<void> | void {
    const callback = t[phase];
    if (!callback) return;
    const reservation = reservations.get(t);
    // Preserve the unscoped zero-argument receiver and dispatch timing.
    return reservation
      ? callQueueCallback(reservation, (life) => callback.call(t, life))
      : callback.call(t);
  }

  function track(t: QueuedEntry, action: () => Promise<void>): void {
    const reservation = reservations.get(t);
    let done!: () => void;
    const barrier = new Promise<void>((resolve) => {
      done = resolve;
    });
    // Register before invoking user code: a callback may synchronously call stop().
    callbacks.add(barrier);
    void (async () => {
      try {
        await action();
      } catch {
        // Includes unexpected callback/logging failures, without dropping the physical owner.
        if (reservation) {
          const { drain, owner } = reservation.lifetime;
          drain.markUnknown(owner);
        }
      } finally {
        try {
          await reservation?.finish();
        } finally {
          reservations.delete(t);
          callbacks.delete(barrier);
          done();
        }
      }
    })();
  }

  function reapTimedOut(): void {
    const cutoff = now() - cfg.queueTimeoutMs;
    let i = 0;
    while (i < queue.length) {
      const t = queue[i];
      if (!canProceed(t)) return;
      if (t && t.enqueuedAt < cutoff) {
        queue.splice(i, 1);
        track(t, async () => {
          log('warn', 'task-queue: queue timeout, dropping', {
            taskId: t.taskId,
            userId: t.userId,
            ageMs: now() - t.enqueuedAt,
          });
          try {
            await call(t, 'onTimeout');
          } catch (err) {
            const reservation = reservations.get(t);
            if (reservation) reservation.lifetime.drain.markUnknown(reservation.lifetime.owner);
            log('warn', 'task-queue: onTimeout threw', { taskId: t.taskId, err: String(err) });
          }
        });
      } else {
        i++;
      }
    }
  }

  function tryDispatch(): void {
    if (!canProceed()) return;
    reapTimedOut();
    if (queue.length === 0) return;
    if (!cfg.canDispatch()) return;
    if (inFlight >= cfg.capacity) return;
    if (!canProceed(queue[0])) return;
    const t = queue.shift();
    if (!t) return;
    inFlight += 1;
    track(t, async (): Promise<void> => {
      log('info', 'task-queue: dispatching', {
        taskId: t.taskId,
        userId: t.userId,
        waitedMs: now() - t.enqueuedAt,
        remainingDepth: queue.length,
        inFlight,
      });
      let started = false;
      try {
        await call(t, 'onStart');
        started = true;
        await call(t, 'runFn');
      } catch (err) {
        const reservation = reservations.get(t);
        if (reservation) reservation.lifetime.drain.markUnknown(reservation.lifetime.owner);
        log('warn', 'task-queue: dispatch threw', {
          taskId: t.taskId,
          err: err instanceof Error ? err.message : String(err),
        });
        // If onStart fails, runFn never gets a chance to release the
        // browser slot or call signalSlotFreed(). Clear the queue's
        // own in-flight token here so one bad DB transition cannot
        // stall every queued task behind it.
        if (!started) {
          if (inFlight > 0) inFlight -= 1;
          queueMicrotask(tryDispatch);
        }
      }
    });
  }

  const tickTimer = setInterval(tryDispatch, cfg.tickMs);
  if (typeof tickTimer.unref === 'function') tickTimer.unref();

  return {
    enqueue(input: QueuedTaskInput): EnqueueResult {
      if (stopped) {
        return { kind: 'rejected', reason: '系统重启中，请稍后再试' };
      }
      if (queue.length >= cfg.maxDepth) {
        log('warn', 'task-queue: rejected (queue full)', {
          taskId: input.taskId,
          userId: input.userId,
          depth: queue.length,
        });
        return { kind: 'rejected', reason: '系统繁忙：任务队列已满，请稍后再试' };
      }
      // Prepare all fallible input/clock/capacity reads before owning or accepting work.
      let entry: QueuedEntry;
      let willDispatch: boolean;
      try {
        entry = { ...input, enqueuedAt: now() };
        willDispatch = queue.length === 0 && cfg.canDispatch() && inFlight < cfg.capacity;
      } catch {
        return { kind: 'rejected', reason: '系统重启中，请稍后再试' };
      }
      if (stopped) return { kind: 'rejected', reason: '系统重启中，请稍后再试' };
      let reservation: QueueReservation | undefined;
      try {
        reservation = reserveQueueLifetime(controller, entry.executionLifetime);
      } catch {
        return { kind: 'rejected', reason: '系统重启中，请稍后再试' };
      }
      if (reservation) reservations.set(entry, reservation);
      queue.push(entry);
      const position = queue.length;
      // 'dispatched' = the head item we just pushed AND a slot is free
      // RIGHT NOW (both pool predicate and queue's own pacing pass).
      // Anything queued behind earlier items is reported as 'queued'
      // even if a slot is technically free, because those earlier
      // items get the slot first.
      // Schedule the actual dispatch on the next microtask so the
      // caller can return to its handler before runFn fires.
      queueMicrotask(tryDispatch);
      if (willDispatch) {
        return { kind: 'dispatched', position };
      }
      log('info', 'task-queue: queued', {
        taskId: entry.taskId,
        userId: entry.userId,
        position,
      });
      return { kind: 'queued', position };
    },
    signalSlotFreed(): void {
      if (stopped) return;
      // 0-floor: callers may signal for slots the queue never
      // dispatched (e.g. boot-time existing in-flight tasks). We
      // never want inFlight to go negative.
      if (inFlight > 0) inFlight -= 1;
      queueMicrotask(tryDispatch);
    },
    size(): number {
      return queue.length;
    },
    snapshot(): Array<{ taskId: string; userId: string; enqueuedAt: number }> {
      return queue.map((t) => ({
        taskId: t.taskId,
        userId: t.userId,
        enqueuedAt: t.enqueuedAt,
      }));
    },
    stop(): Promise<void> {
      stopped = true;
      clearInterval(tickTimer);
      return Promise.allSettled([...callbacks]).then(() => {});
    },
  };
}
