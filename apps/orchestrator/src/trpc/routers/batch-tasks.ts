/**
 * Phase 5b — batch tasks tRPC router.
 *
 * Endpoints:
 *   create  → insert batch + items, kick off executor (fire-and-forget)
 *   list    → user's batches, newest first
 *   detail  → batch + ordered items
 *   cancel  → flip status to 'cancelled' so the executor drains
 *
 * Concurrency is set per-plan at create time:
 *   free  → 1
 *   basic → 3
 *   pro   → 5
 *
 * The user CAN'T raise concurrency above their plan; lowering it is
 * accepted but defaults to the plan cap. Storing the value on the
 * batch row means a downgrade mid-batch doesn't retroactively shrink
 * the budget they paid for.
 */

import { newExternalId, type PlanId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  executeBatch,
  isResumableBatchStatus,
  insertBatch,
  summarizeBatchItemStatuses,
} from '../../agent/batch-executor.js';
import { readAffectedRows } from '../../db/mysql-result.js';
import { batchTaskItems, batchTasks } from '../../db/schema/batch-tasks.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { broadcastToUser } from '../../ws/server.js';
import type { Context } from '../context.js';
import { protectedProcedure, router } from '../trpc.js';

const CONCURRENCY_BY_PLAN: Record<PlanId, number> = {
  free: 1,
  basic: 3,
  pro: 5,
};

const MAX_BATCH_ITEMS = 50; // hard ceiling; ~25 min × 50 = 20h worst-case

type AuthenticatedContext = Context & { userId: string };

function startBatchExecution(ctx: AuthenticatedContext, batchExternalId: string): void {
  void (async () => {
    const { tasksRouter } = await import('./tasks.js');
    await executeBatch(batchExternalId, {
      db: ctx.db,
      logger: ctx.logger,
      broadcastToUser,
      dispatch: async ({ prompt, clientRequestId }) => {
        const result = await tasksRouter
          .createCaller(ctx)
          .create({ intent: prompt, clientRequestId });
        const [task] = await ctx.db
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.externalId, result.taskId))
          .limit(1);
        if (!task) {
          throw new Error(`dispatch returned taskId=${result.taskId} but row not found`);
        }
        return { taskInternalId: task.id, taskExternalId: result.taskId };
      },
    });
  })().catch((err) => {
    ctx.logger.error(
      { err: err instanceof Error ? err.message : String(err), batchExternalId },
      'batch-executor: top-level crash',
    );
  });
}

async function requireUser(
  ctx: { db: typeof import('../../db/client.js').db; userId: string },
): Promise<{ id: number; externalId: string; planId: PlanId }> {
  const [row] = await ctx.db
    .select({ id: users.id, externalId: users.externalId, plan: users.plan })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  }
  // `plan` is a varchar — coerce to PlanId, default to 'free' for
  // legacy / pre-Phase-10 rows that might carry a freer value.
  const planId: PlanId =
    row.plan === 'basic' || row.plan === 'pro' ? row.plan : 'free';
  return { id: row.id, externalId: row.externalId, planId };
}

export const batchTasksRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(100).default(50),
          cursor: z
            .object({
              id: z.number().int().positive(),
              createdAt: z.coerce.date(),
            })
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
    const user = await requireUser(ctx);
    const limit = input?.limit ?? 50;
    const whereParts = [eq(batchTasks.userId, user.id)];
    if (input?.cursor) {
      whereParts.push(
        or(
          lt(batchTasks.createdAt, input.cursor.createdAt),
          and(
            eq(batchTasks.createdAt, input.cursor.createdAt),
            lt(batchTasks.id, input.cursor.id),
          ),
        )!,
      );
    }
    const rows = await ctx.db
      .select({
        id: batchTasks.id,
        externalId: batchTasks.externalId,
        name: batchTasks.name,
        status: batchTasks.status,
        concurrency: batchTasks.concurrency,
        itemsTotal: batchTasks.itemsTotal,
        itemsDone: batchTasks.itemsDone,
        itemsReview: batchTasks.itemsReview,
        itemsFailed: batchTasks.itemsFailed,
        createdAt: batchTasks.createdAt,
        completedAt: batchTasks.completedAt,
      })
      .from(batchTasks)
      .where(and(...whereParts))
      .orderBy(desc(batchTasks.createdAt), desc(batchTasks.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    for (const batch of page) {
      if (isResumableBatchStatus(batch.status)) {
        startBatchExecution(ctx, batch.externalId);
      }
    }
    const batchIds = page.map((r) => r.id);
    const countsByBatch = new Map<
      number,
      ReturnType<typeof summarizeBatchItemStatuses>
    >();
    if (batchIds.length > 0) {
      const itemRows = await ctx.db
        .select({
          batchId: batchTaskItems.batchId,
          status: batchTaskItems.status,
        })
        .from(batchTaskItems)
        .where(inArray(batchTaskItems.batchId, batchIds));
      const statusesByBatch = new Map<number, Array<{ status: string }>>();
      for (const item of itemRows) {
        const bucket = statusesByBatch.get(item.batchId) ?? [];
        bucket.push({ status: item.status });
        statusesByBatch.set(item.batchId, bucket);
      }
      for (const [id, statuses] of statusesByBatch) {
        countsByBatch.set(id, summarizeBatchItemStatuses(statuses));
      }
    }
    const items = page.map((r) => {
      const counts = countsByBatch.get(r.id) ?? {
        total: r.itemsTotal,
        done: r.itemsDone,
        review: r.itemsReview,
        failed: r.itemsFailed,
        cancelled: 0,
      };
      return {
        batchId: r.externalId,
        name: r.name,
        status: r.status,
        concurrency: r.concurrency,
        itemsTotal: counts.total,
        itemsDone: counts.done,
        itemsReview: counts.review,
        itemsFailed: counts.failed,
        itemsCancelled: counts.cancelled,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      };
    });
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? { id: last.id, createdAt: last.createdAt } : null,
    };
  }),

  detail: protectedProcedure
    .input(z.object({ batchId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const user = await requireUser(ctx);
      const [batch] = await ctx.db
        .select()
        .from(batchTasks)
        .where(
          and(eq(batchTasks.externalId, input.batchId), eq(batchTasks.userId, user.id)),
        )
        .limit(1);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'batch not found' });
      }
      if (isResumableBatchStatus(batch.status)) {
        startBatchExecution(ctx, batch.externalId);
      }
      // Items + their underlying task external_id (so SPA can deep-
      // link to the per-task view).
      const items = await ctx.db
        .select({
          externalId: batchTaskItems.externalId,
          seq: batchTaskItems.seq,
          prompt: batchTaskItems.prompt,
          status: batchTaskItems.status,
          errorMessage: batchTaskItems.errorMessage,
          createdAt: batchTaskItems.createdAt,
          completedAt: batchTaskItems.completedAt,
          taskInternalId: batchTaskItems.taskId,
        })
        .from(batchTaskItems)
        .where(eq(batchTaskItems.batchId, batch.id))
        .orderBy(batchTaskItems.seq);
      const taskInternalIds = items
        .map((i) => i.taskInternalId)
        .filter((v): v is number => v !== null);
      const tasksById = new Map<number, string>();
      // Codex P5 follow-up — use inArray for the multi-id case
      // instead of the per-id fallback loop. The earlier code's
      // `where(undefined)` branch on the N>1 path was a full-table
      // scan via the empty predicate; even though we filtered the
      // results client-side, MySQL returned the entire tasks table
      // first. inArray emits `WHERE id IN (?, ?, ...)` which uses
      // the PRIMARY index. One query, indexed read.
      if (taskInternalIds.length > 0) {
        const taskRows = await ctx.db
          .select({ id: tasks.id, externalId: tasks.externalId })
          .from(tasks)
          .where(inArray(tasks.id, taskInternalIds));
        for (const r of taskRows) tasksById.set(r.id, r.externalId);
      }
      const counts = summarizeBatchItemStatuses(items);
      return {
        batchId: batch.externalId,
        name: batch.name,
        status: batch.status,
        concurrency: batch.concurrency,
        itemsTotal: counts.total,
        itemsDone: counts.done,
        itemsReview: counts.review,
        itemsFailed: counts.failed,
        itemsCancelled: counts.cancelled,
        createdAt: batch.createdAt,
        completedAt: batch.completedAt,
        items: items.map((i) => ({
          batchItemId: i.externalId,
          seq: i.seq,
          prompt: i.prompt,
          status: i.status,
          errorMessage: i.errorMessage,
          taskId:
            i.taskInternalId !== null ? (tasksById.get(i.taskInternalId) ?? null) : null,
          createdAt: i.createdAt,
          completedAt: i.completedAt,
        })),
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().max(200).optional(),
        prompts: z
          .array(z.string().trim().min(1).max(2000))
          .min(1)
          .max(MAX_BATCH_ITEMS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await requireUser(ctx);
      // De-dupe identical prompts (keep order, drop subsequent dupes)
      // — common when a user pastes a list with accidental repeats.
      const seen = new Set<string>();
      const prompts: string[] = [];
      for (const p of input.prompts) {
        if (seen.has(p)) continue;
        seen.add(p);
        prompts.push(p);
      }
      const concurrency = CONCURRENCY_BY_PLAN[user.planId];
      const batchExternalId = newExternalId('batch');
      await insertBatch(ctx.db, {
        userInternalId: user.id,
        name: input.name ?? null,
        prompts,
        concurrency,
        batchExternalId,
        itemExternalIdFactory: () => newExternalId('batchItem'),
      });

      startBatchExecution(ctx, batchExternalId);

      return { batchId: batchExternalId, itemsTotal: prompts.length, concurrency };
    }),

  cancel: protectedProcedure
    .input(z.object({ batchId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = await requireUser(ctx);
      // Codex P5 follow-up — status guard. Earlier the UPDATE
      // unconditionally wrote `status='cancelled'` on whatever row
      // matched, which would silently demote an already-completed
      // batch back to cancelled (losing the completedAt timestamp
      // semantic + confusing the SPA's terminal-status guard). Now
      // we only flip when status IN ('pending', 'running'); on
      // affectedRows=0 we re-read the row to distinguish "not found"
      // (404) from "already terminal" (200 ok / 400 depending on
      // which terminal).
      const result = await ctx.db
        .update(batchTasks)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(
          and(
            eq(batchTasks.externalId, input.batchId),
            eq(batchTasks.userId, user.id),
            inArray(batchTasks.status, ['pending', 'running']),
          ),
        );
      const affected = readAffectedRows(result);
      if (affected) {
        // Happy path — executor sees status='cancelled' on its next
        // iteration and drains.
        return { ok: true as const, alreadyTerminal: false as const };
      }
      // Zero affected → either the row doesn't exist or it's already
      // in a terminal state. Read once to differentiate.
      const [row] = await ctx.db
        .select({ status: batchTasks.status })
        .from(batchTasks)
        .where(
          and(eq(batchTasks.externalId, input.batchId), eq(batchTasks.userId, user.id)),
        )
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'batch not found' });
      }
      if (row.status === 'cancelled') {
        // Already cancelled — idempotent. SPA gets a clean ok.
        return { ok: true as const, alreadyTerminal: true as const };
      }
      // Terminal but not cancelled (completed / partial). Refuse
      // with a clear reason so the SPA can show "已结束 (xxx)".
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `批量任务已结束（${row.status}），无法取消`,
      });
    }),
});
