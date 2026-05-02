/**
 * Phase 21b — per-user, per-mode active-task tracker.
 *
 * In-memory counts of how many tasks each user has running in each
 * execution mode (browser vs generate). The DB's `tasks.status`
 * column gives us a TOTAL count via QuotaService.getActiveTaskCount,
 * but doesn't carry the execution mode — and adding a column would
 * be a schema migration. The tracker is updated at task admit
 * (trackStart) and again at task end (trackEnd).
 *
 * Process-local. Survives only as long as the orchestrator runs;
 * a restart clears it. That's fine because the boot sweep also
 * fails any in-flight tasks at restart, so the in-memory count
 * starting at 0 matches reality.
 *
 * The bypass-user concurrency caps (BYPASS_BROWSER_CONCURRENCY=10,
 * BYPASS_GENERATE_CONCURRENCY=20) are enforced via these counts;
 * non-bypass users are still gated by the DB-total path because
 * their plan caps (1/3/5) don't distinguish modes.
 */

import type { ExecutionMode } from '../agent/intent-classifier.js';

interface ModeBuckets {
  browser: Set<string>;
  generate: Set<string>;
}

const TRACKER = new Map<string, ModeBuckets>();

function getOrInit(userId: string): ModeBuckets {
  let b = TRACKER.get(userId);
  if (!b) {
    b = { browser: new Set(), generate: new Set() };
    TRACKER.set(userId, b);
  }
  return b;
}

/** Record that a task just began running for this user in this mode. */
export function trackStart(userId: string, taskId: string, mode: ExecutionMode): void {
  const b = getOrInit(userId);
  b[mode].add(taskId);
}

/**
 * Record that a task ended (success or failure). Removes from both
 * buckets unconditionally — caller doesn't need to remember which
 * mode the task was started in.
 */
export function trackEnd(userId: string, taskId: string): void {
  const b = TRACKER.get(userId);
  if (!b) return;
  b.browser.delete(taskId);
  b.generate.delete(taskId);
  if (b.browser.size === 0 && b.generate.size === 0) {
    TRACKER.delete(userId);
  }
}

/** Current count of active tasks for this user in this mode. */
export function getActiveByMode(userId: string, mode: ExecutionMode): number {
  return TRACKER.get(userId)?.[mode].size ?? 0;
}

/** Test helper. */
export function _resetForTesting(): void {
  TRACKER.clear();
}
