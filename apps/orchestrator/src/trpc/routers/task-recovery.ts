/**
 * Batch 10.2 — read-only failure recovery context for one task.
 *
 * The failed-task card needs two facts `tasks.detail` does not carry:
 *   1. Refund status from the platform-failure refund ledger
 *      (`quota_refunds`, migration 0063) so the user sees whether the
 *      quota spent on the failed run came back.
 *   2. The task's original input attachments (`task_files.kind='input'`)
 *      so 「重新执行」 can resend the same files with the same intent.
 *
 * Read-only: no quota, ledger, or file rows are written here. The retry
 * itself still goes through `tasks.create`, which charges and links files
 * exactly as a fresh submission does.
 */

import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { quotaRefunds } from '../../db/schema/quota-refunds.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { tasks as tasksTable } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { SWEEP_WINDOW_MS, platformFailureReason } from '../../quota/platform-failure-refunds.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * - `refunded`        ledger row claimed; quota is back.
 * - `pending`         platform-side failure inside the sweep window; the
 *                     minute-level sweeper will refund it.
 * - `not_refundable`  failure caused by the request/content or a user
 *                     cancellation — the ledger never refunds these.
 * - `contact_support` platform-side failure that aged out of the automatic
 *                     sweep window without a refund.
 * - `not_charged`     no ledger row: follow-ups, unmetered accounts, or a
 *                     task created before the ledger existed.
 */
export type TaskRefundState =
  | 'refunded'
  | 'pending'
  | 'not_refundable'
  | 'contact_support'
  | 'not_charged';

export function deriveTaskRefundState(
  task: { status: string; errorCode: string | null; errorMessage: string | null },
  ledger: { chargedAt: Date; refundedAt: Date | null } | null,
  now: number = Date.now(),
): TaskRefundState {
  if (!ledger) return 'not_charged';
  if (ledger.refundedAt) return 'refunded';
  // Same predicate the sweeper uses, so the card never promises a refund
  // the ledger will not issue (cancellations and content failures included).
  if (!platformFailureReason(task)) return 'not_refundable';
  return ledger.chargedAt.getTime() > now - SWEEP_WINDOW_MS ? 'pending' : 'contact_support';
}

export interface RetryInputFile {
  fileId: string;
  filename: string;
  mimetype: string;
}

/**
 * Splits a task's input attachments into the ones a retry can resend and a
 * count of the ones that can no longer be read (expired or removed).
 * `tasks.create` accepts at most five `fileIds`, so extra rows are dropped
 * and counted as unavailable rather than failing the retry outright.
 */
export function retryableInputFiles(
  rows: ReadonlyArray<{
    externalId: string;
    filename: string;
    mimetype: string;
    status: string;
    expiresAt: Date | null;
  }>,
  now: number = Date.now(),
  max = 5,
): { files: RetryInputFile[]; unavailableCount: number } {
  const files: RetryInputFile[] = [];
  let unavailableCount = 0;
  for (const row of rows) {
    const readable =
      row.status === 'active' && (row.expiresAt === null || row.expiresAt.getTime() > now);
    if (!readable || files.length >= max) {
      unavailableCount += 1;
      continue;
    }
    files.push({ fileId: row.externalId, filename: row.filename, mimetype: row.mimetype });
  }
  return { files, unavailableCount };
}

export const taskRecoveryRouter = router({
  failureContext: protectedProcedure
    .input(z.object({ taskId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({
          id: tasksTable.id,
          externalId: tasksTable.externalId,
          status: tasksTable.status,
          errorCode: tasksTable.errorCode,
          errorMessage: tasksTable.errorMessage,
        })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.externalId, input.taskId),
            eq(tasksTable.userId, userRow.id),
            eq(tasksTable.origin, ctx.taskOrigin),
          ),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }

      const [ledger] = await ctx.db
        .select({ chargedAt: quotaRefunds.chargedAt, refundedAt: quotaRefunds.refundedAt })
        .from(quotaRefunds)
        .where(
          and(
            eq(quotaRefunds.taskExternalId, taskRow.externalId),
            eq(quotaRefunds.userId, userRow.id),
          ),
        )
        .limit(1);

      const inputRows = await ctx.db
        .select({
          externalId: taskFiles.externalId,
          filename: taskFiles.filename,
          mimetype: taskFiles.mimetype,
          status: taskFiles.status,
          expiresAt: taskFiles.expiresAt,
        })
        .from(taskFiles)
        .where(
          and(
            eq(taskFiles.userId, userRow.id),
            eq(taskFiles.taskId, taskRow.id),
            eq(taskFiles.kind, 'input'),
          ),
        )
        .orderBy(asc(taskFiles.id));

      const { files, unavailableCount } = retryableInputFiles(inputRows);
      return {
        taskId: taskRow.externalId,
        refund: {
          state: deriveTaskRefundState(taskRow, ledger ?? null),
          refundedAt: ledger?.refundedAt ?? null,
        },
        inputFiles: files,
        unavailableInputCount: unavailableCount,
      };
    }),
});

export const __taskRecoveryInternals = { deriveTaskRefundState, retryableInputFiles };
