import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gte, lt, sum } from 'drizzle-orm';
import { z } from 'zod';
import { llmCalls } from '../../db/schema/llm-calls.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * Query endpoint for billing / cost-panel reads. Scoped to the caller's
 * own rows — users cannot see each other's LLM spend. Admin/org view is
 * a Phase 1 concern.
 *
 * Paging: descending id cursor (cursor = id of the last row you saw;
 * return rows with id < cursor). `limit` capped at 500.
 */

const listInput = z.object({
  /** Filter by task external id; if task unknown or not owned, returns empty. */
  taskExternalId: z.string().optional(),
  /** ISO timestamp; inclusive lower bound on created_at. */
  since: z.string().datetime().optional(),
  /** ISO timestamp; exclusive upper bound on created_at. */
  until: z.string().datetime().optional(),
  /** Cursor = id of last row from previous page. */
  cursor: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(500).default(50),
});

export const llmCallsRouter = router({
  list: protectedProcedure.input(listInput).query(async ({ ctx, input }) => {
    const [userRow] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!userRow) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }

    let taskInternalId: number | null = null;
    if (input.taskExternalId) {
      const [taskRow] = await ctx.db
        .select({ id: tasks.id, userId: tasks.userId })
        .from(tasks)
        .where(eq(tasks.externalId, input.taskExternalId))
        .limit(1);
      if (!taskRow || taskRow.userId !== userRow.id) {
        // Task unknown or not owned by caller → empty result, not an error.
        return { rows: [], totals: zeroTotals(), nextCursor: null as number | null };
      }
      taskInternalId = taskRow.id;
    }

    const baseConditions = [eq(llmCalls.userId, userRow.id)];
    if (taskInternalId !== null) baseConditions.push(eq(llmCalls.taskId, taskInternalId));
    if (input.since) baseConditions.push(gte(llmCalls.createdAt, new Date(input.since)));
    if (input.until) baseConditions.push(lt(llmCalls.createdAt, new Date(input.until)));

    const pageConditions = [...baseConditions];
    if (input.cursor) pageConditions.push(lt(llmCalls.id, input.cursor));

    const rowsRaw = await ctx.db
      .select({
        id: llmCalls.id,
        externalId: llmCalls.externalId,
        taskExternalId: tasks.externalId,
        model: llmCalls.model,
        provider: llmCalls.provider,
        purpose: llmCalls.purpose,
        promptTokens: llmCalls.promptTokens,
        completionTokens: llmCalls.completionTokens,
        cacheReadTokens: llmCalls.cacheReadTokens,
        cacheWriteTokens: llmCalls.cacheWriteTokens,
        costUsd: llmCalls.costUsd,
        latencyMs: llmCalls.latencyMs,
        status: llmCalls.status,
        errorMessage: llmCalls.errorMessage,
        createdAt: llmCalls.createdAt,
      })
      .from(llmCalls)
      .leftJoin(tasks, eq(tasks.id, llmCalls.taskId))
      .where(and(...pageConditions))
      .orderBy(desc(llmCalls.id))
      .limit(input.limit);

    const rows = rowsRaw.map((r) => ({
      ...r,
      // MySQL DECIMAL comes back as string; normalize to number for clients.
      costUsd: Number(r.costUsd),
    }));

    // Totals are across the full filter (not paged), so the UI can show
    // "X calls / $Y total" that's stable while paging.
    const [totalsRow] = await ctx.db
      .select({
        totalCalls: count(llmCalls.id),
        totalInputTokens: sum(llmCalls.promptTokens),
        totalOutputTokens: sum(llmCalls.completionTokens),
        totalCacheReadTokens: sum(llmCalls.cacheReadTokens),
        totalCacheWriteTokens: sum(llmCalls.cacheWriteTokens),
        totalCostUsd: sum(llmCalls.costUsd),
      })
      .from(llmCalls)
      .where(and(...baseConditions));

    const nextCursor = rows.length === input.limit ? (rows[rows.length - 1]?.id ?? null) : null;

    return {
      rows,
      totals: {
        totalCalls: totalsRow?.totalCalls ?? 0,
        totalInputTokens: toNum(totalsRow?.totalInputTokens),
        totalOutputTokens: toNum(totalsRow?.totalOutputTokens),
        totalCacheReadTokens: toNum(totalsRow?.totalCacheReadTokens),
        totalCacheWriteTokens: toNum(totalsRow?.totalCacheWriteTokens),
        totalCostUsd: toNum(totalsRow?.totalCostUsd),
      },
      nextCursor,
    };
  }),
});

function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function zeroTotals() {
  return {
    totalCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCostUsd: 0,
  };
}
