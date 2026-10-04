import type { PlanId } from '@holaday/shared-types';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { CORE_LOCAL_FAILURE_COPY } from '../agent/core-task-settlement.js';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { quotaRefunds } from '../db/schema/quota-refunds.js';
import { tasks } from '../db/schema/tasks.js';

/** Failure causes on our side (model provider, timeouts, restarts, missing config). */
const PLATFORM_ERROR_CODES: ReadonlySet<string> = new Set([
  'provider_error',
  'PROVIDER_ERROR',
  'timeout',
  'TIMEOUT',
  'EXECUTION_TIMEOUT',
  'ORCHESTRATOR_RESTART',
  'CORE_GENERATION_FAILED',
  'REGION_SERVICE_NOT_CONFIGURED',
  'MODEL_PROVIDER_NOT_CONFIGURED',
  'MODEL_MIGRATION_IN_PROGRESS',
  'FIRECRAWL_NOT_CONFIGURED',
]);

/** Core settlements store a fixed reason: generation-only and local failures are ours. */
const PLATFORM_CORE_REASONS: ReadonlySet<string> = new Set([
  '生成未完成，请稍后重试',
  ...Object.values(CORE_LOCAL_FAILURE_COPY),
]);

export function platformFailureReason(task: {
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
}): string | null {
  if (task.status !== 'failed') return null;
  if (task.errorCode === 'CORE_EXECUTION_FAILED')
    return task.errorMessage && PLATFORM_CORE_REASONS.has(task.errorMessage)
      ? 'CORE_PLATFORM_FAILURE'
      : null;
  return task.errorCode && PLATFORM_ERROR_CODES.has(task.errorCode) ? task.errorCode : null;
}

export interface QuotaRefunder {
  refund(userId: number, plan: PlanId, isOpus: boolean): Promise<void>;
}

/** Best-effort charge record for a task that just consumed quota. Idempotent per task. */
export async function recordQuotaCharge(
  db: DB,
  charge: { taskExternalId: string; userId: number; plan: PlanId; isOpus: boolean },
): Promise<void> {
  await db
    .insert(quotaRefunds)
    .values({
      taskExternalId: charge.taskExternalId,
      userId: charge.userId,
      plan: charge.plan,
      isOpus: charge.isOpus,
    })
    .onDuplicateKeyUpdate({ set: { taskExternalId: charge.taskExternalId } });
}

/** Failures older than this are no longer swept for automatic refunds. */
export const SWEEP_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * Refunds each charged task that failed for a platform reason exactly once.
 * Covers every failure writer (core settlement, legacy lanes, the zombie
 * reaper and the restart sweep) from one place. User cancellations
 * (status 'cancelled') and content/quality failures are never refunded.
 */
export async function sweepPlatformFailureRefunds(
  db: DB,
  quota: QuotaRefunder,
  options: { now?: () => number; limit?: number } = {},
): Promise<number> {
  const now = options.now ?? Date.now;
  const rows = await db
    .select({
      id: quotaRefunds.id,
      userId: quotaRefunds.userId,
      plan: quotaRefunds.plan,
      isOpus: quotaRefunds.isOpus,
      status: tasks.status,
      errorCode: tasks.errorCode,
      errorMessage: tasks.errorMessage,
    })
    .from(quotaRefunds)
    .innerJoin(tasks, eq(tasks.externalId, quotaRefunds.taskExternalId))
    .where(
      and(
        isNull(quotaRefunds.refundedAt),
        gt(quotaRefunds.chargedAt, new Date(now() - SWEEP_WINDOW_MS)),
        eq(tasks.status, 'failed'),
      ),
    )
    .limit(options.limit ?? 100);
  let refunded = 0;
  for (const row of rows) {
    const reason = platformFailureReason(row);
    if (!reason) continue;
    const claim = await db
      .update(quotaRefunds)
      .set({ refundedAt: new Date(now()), refundReason: reason })
      .where(and(eq(quotaRefunds.id, row.id), isNull(quotaRefunds.refundedAt)));
    if (readAffectedRows(claim) !== 1) continue;
    await quota.refund(row.userId, row.plan as PlanId, row.isOpus);
    refunded += 1;
  }
  return refunded;
}

/**
 * Immediate refund for a task whose own lane already knows the failure was on
 * our side (e.g. media generation). Same exactly-once ledger as the sweeper.
 */
export async function refundTaskOnce(
  db: DB,
  quota: QuotaRefunder,
  taskExternalId: string,
  reason: string,
  now: () => number = Date.now,
): Promise<boolean> {
  const [row] = await db
    .select({
      id: quotaRefunds.id,
      userId: quotaRefunds.userId,
      plan: quotaRefunds.plan,
      isOpus: quotaRefunds.isOpus,
    })
    .from(quotaRefunds)
    .where(and(eq(quotaRefunds.taskExternalId, taskExternalId), isNull(quotaRefunds.refundedAt)))
    .limit(1);
  if (!row) return false;
  const claim = await db
    .update(quotaRefunds)
    .set({ refundedAt: new Date(now()), refundReason: reason.slice(0, 64) })
    .where(and(eq(quotaRefunds.id, row.id), isNull(quotaRefunds.refundedAt)));
  if (readAffectedRows(claim) !== 1) return false;
  await quota.refund(row.userId, row.plan as PlanId, row.isOpus);
  return true;
}
