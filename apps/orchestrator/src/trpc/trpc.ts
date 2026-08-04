import { TRPCError, initTRPC } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema/users.js';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});

/**
 * Phase 27 — admin gate. Builds on protectedProcedure: requires a
 * valid session AND that the session user's `users.role = 'admin'`.
 * Returns FORBIDDEN (not UNAUTHORIZED) when the user is signed in
 * but lacks the role, so the SPA can distinguish "log in" from
 * "you don't have access" in its error toast.
 *
 * The lookup is a single indexed read keyed by externalId; cheap
 * enough to run per request rather than caching the role in the
 * session.
 */
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const [row] = await ctx.db
    .select({ role: users.role, status: users.status })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  if (!row || row.role !== 'admin' || row.status !== 'active') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'admin access required' });
  }
  return next({ ctx });
});
