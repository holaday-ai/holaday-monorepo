import { TRPCError, initTRPC } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema/users.js';
import {
  httpProcedureParent,
  originalHttpLifetime,
  withHttpProcedure,
} from '../execution/http-drain.js';
import { currentOperationLifetime, startOwnedOperation } from '../execution/owned-operation.js';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const middleware = t.middleware;
// The Express adapter returns void and resolves its internal HTTP promise on
// response finish. Own the actual procedure promise independently, including
// async input parsing and protected/admin middleware. Not a global DB proxy.
export const publicProcedure = t.procedure.use(async ({ ctx, next }) => {
  const original = originalHttpLifetime(ctx.req);
  if (!original) return next(); // Non-HTTP callers retain their own entry gates.
  const controller = ctx.executionDrain;
  if (!controller || original.drain !== controller.drain)
    throw new TRPCError({ code: 'SERVICE_UNAVAILABLE' });
  try {
    const parent = httpProcedureParent(ctx.req, ctx.executionLifetime);
    return await startOwnedOperation(
      controller.drain,
      'request',
      async (owner) => {
        // Use the exact ALS object for trusted same-request nested callers.
        const executionLifetime = currentOperationLifetime();
        const result = await withHttpProcedure(() => next({ ctx: { executionLifetime } }));
        // tRPC represents exceptions as fulfilled error results. Conservatively
        // retain every such outcome until classified/reconciled; an error code
        // is not proof that a resolver made no partial changes. This also retains
        // pure validation/auth failures and is NOT precise business-phase coverage.
        if (!result.ok) controller.drain.markUnknown(owner);
        return result;
      },
      { parent: parent.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
    ).result;
  } catch {
    throw new TRPCError({ code: 'SERVICE_UNAVAILABLE' });
  }
});

export const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
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
