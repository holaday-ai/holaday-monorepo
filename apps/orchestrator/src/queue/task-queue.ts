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

export interface QueuedTaskInput {
  taskId: string;
  userId: string;
  /** The actual work — fired AFTER onStart resolves. */
  runFn: () => Promise<void>;
  /**
   * Called when this task transitions queued → executing. Caller
   * uses this to update the DB row's status + broadcast WS frames.
   */
  onStart: () => Promise<void> | void;
  /**
   * Called when the task ages past `queueTimeoutMs` without being
   * dispatched. Caller uses this to mark the DB row failed with a
   * `queue timeout` reason and broadcast a terminal frame.
   */
  onTimeout?: () => Promise<void> | void;
}

export type EnqueueResult =
  | { kind: 'dispatched'; position: number }
  | { kind: 'queued'; position: number }
  | { kind: 'rejected'; reason: string };

export interface TaskQueueConfig {
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
  stop(): void;
}

interface QueuedEntry extends QueuedTaskInput {
  enqueuedAt: number;
}

export function createTaskQueue(cfg: TaskQueueConfig): TaskQueue {
  const queue: QueuedEntry[] = [];
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
  const log = cfg.logger ?? ((): void => {});

  function reapTimedOut(): void {
    const cutoff = now() - cfg.queueTimeoutMs;
    let i = 0;
    while (i < queue.length) {
      const t = queue[i];
      if (t && t.enqueuedAt < cutoff) {
        queue.splice(i, 1);
        log('warn', 'task-queue: queue timeout, dropping', {
          taskId: t.taskId,
          userId: t.userId,
          ageMs: now() - t.enqueuedAt,
        });
        try {
          void t.onTimeout?.();
        } catch (err) {
          log('warn', 'task-queue: onTimeout threw', {
            taskId: t.taskId,
            err: String(err),
          });
        }
      } else {
        i++;
      }
    }
  }

  function tryDispatch(): void {
    if (stopped) return;
    reapTimedOut();
    if (queue.length === 0) return;
    if (!cfg.canDispatch()) return;
    if (inFlight >= cfg.capacity) return;
    const t = queue.shift();
    if (!t) return;
    inFlight += 1;
    log('info', 'task-queue: dispatching', {
      taskId: t.taskId,
      userId: t.userId,
      waitedMs: now() - t.enqueuedAt,
      remainingDepth: queue.length,
      inFlight,
    });
    void (async (): Promise<void> => {
      try {
        await t.onStart();
        await t.runFn();
      } catch (err) {
        log('warn', 'task-queue: dispatch threw', {
          taskId: t.taskId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })();
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
      const entry: QueuedEntry = {
        ...input,
        enqueuedAt: now(),
      };
      queue.push(entry);
      const position = queue.length;
      // 'dispatched' = the head item we just pushed AND a slot is free
      // RIGHT NOW (both pool predicate and queue's own pacing pass).
      // Anything queued behind earlier items is reported as 'queued'
      // even if a slot is technically free, because those earlier
      // items get the slot first.
      const willDispatch =
        position === 1 && cfg.canDispatch() && inFlight < cfg.capacity;
      // Schedule the actual dispatch on the next microtask so the
      // caller can return to its handler before runFn fires.
      queueMicrotask(tryDispatch);
      if (willDispatch) {
        return { kind: 'dispatched', position };
      }
      log('info', 'task-queue: queued', {
        taskId: input.taskId,
        userId: input.userId,
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
    stop(): void {
      stopped = true;
      clearInterval(tickTimer);
    },
  };
}
