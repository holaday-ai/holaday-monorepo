/**
 * Per-user vision-loop task queue.
 *
 * Phase D wired up a single PlaywrightExecutor that owns one Page.
 * Firing two vision-loop tasks for the same user concurrently races
 * on that Page — they'd both try to click / type / screenshot
 * interleaved and neither would finish correctly. F3 makes the
 * concurrency explicit with a FIFO serialiser per user.
 *
 * Shape: a singleton manager holding a map of pending queues keyed by
 * externalUserId. `enqueue(userId, fn)` either starts `fn` immediately
 * (when the user has no in-flight task) or pushes it for later. When
 * the current in-flight task resolves, the next pending task starts.
 *
 * `fn` IS the work — a function returning Promise<Outcome>. The queue
 * isn't opinionated about what Outcome is, so `tasks.create` can hand
 * over its own persist-then-broadcast closure.
 *
 * `onQueued(position)` fires synchronously on enqueue with the new
 * task's 1-indexed position behind any in-flight + pending work for
 * the same user (1 = running NOW, 2 = next up, …). Caller uses this
 * to push a `server.task.queued` WS frame to the popup.
 *
 * The queue is strictly per-user — different users don't block each
 * other. `size(userId)` and `totalSize()` are exposed for tests and
 * future dashboards.
 */

/**
 * One queued task's closure. Resolves when the vision loop terminates
 * (completed / failed / paused / cancelled). Never throws: loop
 * errors are caught by tasks.create wrapping it.
 */
export type QueuedTaskFn = () => Promise<unknown>;

interface QueuedEntry {
  run: QueuedTaskFn;
  /** Resolved when THIS task's run() completes. Per-task settlement
   *  so enqueue() doesn't block callers until the whole user queue
   *  drains — only until their own task finishes. */
  settle: () => void;
}

export interface VisionLoopTaskQueue {
  /**
   * Enqueue a task for the given user. If another task is in flight
   * for this user, the returned promise resolves only after ALL
   * earlier pending tasks + this one finish — callers should not
   * await it synchronously in request handlers. `onQueued` fires
   * with the 1-indexed position (1 = running now, 2 = queued behind
   * one, etc.) BEFORE the first potential caller await.
   */
  enqueue(userId: string, run: QueuedTaskFn, onQueued?: (position: number) => void): Promise<void>;
  /** Number of tasks CURRENTLY queued or running for a given user. */
  size(userId: string): number;
  /** Number of tasks queued across ALL users (including running). */
  totalSize(): number;
}

export function createVisionLoopTaskQueue(): VisionLoopTaskQueue {
  // userId → { running: boolean; pending: QueuedEntry[] }.
  // Running counts as "in the queue" for the purposes of size()
  // because the popup wants "is there work in flight or waiting".
  const state = new Map<string, { running: boolean; pending: QueuedEntry[] }>();

  async function drain(userId: string): Promise<void> {
    const bucket = state.get(userId);
    if (!bucket) return;
    while (bucket.pending.length > 0) {
      const next = bucket.pending.shift();
      if (!next) break;
      try {
        await next.run();
      } catch {
        // Errors in user-provided run() are their problem; keep draining.
      } finally {
        // Settle THIS task's enqueue() promise regardless of success —
        // the caller just cares that their task has finished running,
        // not whether it threw.
        next.settle();
      }
    }
    bucket.running = false;
    if (bucket.pending.length === 0) state.delete(userId);
  }

  return {
    enqueue(userId, run, onQueued): Promise<void> {
      return new Promise<void>((resolve) => {
        let bucket = state.get(userId);
        if (!bucket) {
          bucket = { running: false, pending: [] };
          state.set(userId, bucket);
        }
        // 1-indexed position: (running ? 1 : 0) + already-pending + 1.
        const positionBeforePush = (bucket.running ? 1 : 0) + bucket.pending.length + 1;
        bucket.pending.push({ run, settle: resolve });
        try {
          onQueued?.(positionBeforePush);
        } catch {
          // Caller's callback shouldn't derail the queue — swallow.
        }
        if (bucket.running) {
          // Another task is draining; it'll pick this one up + settle
          // its entry when finished. Nothing else to do here.
          return;
        }
        bucket.running = true;
        // Kick drain WITHOUT awaiting — we return the per-task promise
        // immediately and drain's loop resolves each entry in turn.
        void drain(userId);
      });
    },
    size(userId) {
      const bucket = state.get(userId);
      if (!bucket) return 0;
      return (bucket.running ? 1 : 0) + bucket.pending.length;
    },
    totalSize() {
      let n = 0;
      for (const b of state.values()) n += (b.running ? 1 : 0) + b.pending.length;
      return n;
    },
  };
}

/**
 * Module-level singleton. `tasks.create` funnels every vision-loop
 * task through this instance so per-user serialisation is automatic;
 * tests that want an isolated queue create their own via
 * `createVisionLoopTaskQueue()`.
 */
export const visionLoopTaskQueue = createVisionLoopTaskQueue();
