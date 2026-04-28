/**
 * Phase 13 Dim 5 — memory management.
 *
 * tRPC surface backing the /settings AI-记忆 page. Three procedures:
 *   - list:        return all valid memory rows for the caller
 *   - delete:      remove a single row by external id
 *   - clear:       remove all rows for the caller (confirmation modal)
 *
 * Read-only path also feeds future "memory leakage to a shared
 * session" features. We deliberately do NOT expose a `create` —
 * the agent populates the table, not the user.
 */

import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { executionMemory } from '../../db/schema/execution-memory.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

export const memoryRouter = router({
  /** List the caller's memory rows (skips expired). Newest-first. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    const rows = await ctx.db
      .select()
      .from(executionMemory)
      .where(eq(executionMemory.userId, user.id));
    const now = Date.now();
    const valid = rows.filter(
      (r) => r.expiresAt == null || r.expiresAt.getTime() > now,
    );
    valid.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return {
      memories: valid.map((r) => ({
        externalId: r.externalId,
        category: r.category,
        keyName: r.keyName,
        value: r.value,
        expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }),

  /** Delete one memory row owned by the caller. */
  delete: protectedProcedure
    .input(z.object({ externalId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      // Drizzle MySQL `delete` returns ResultSetHeader; we use a
      // composite WHERE so a token leaked across users still can't
      // delete someone else's memory.
      await ctx.db
        .delete(executionMemory)
        .where(
          and(
            eq(executionMemory.externalId, input.externalId),
            eq(executionMemory.userId, user.id),
          ),
        );
      return { ok: true as const };
    }),

  /** Wipe every memory row for the caller. */
  clear: protectedProcedure.mutation(async ({ ctx }) => {
    const [user] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    await ctx.db
      .delete(executionMemory)
      .where(eq(executionMemory.userId, user.id));
    return { ok: true as const };
  }),
});
