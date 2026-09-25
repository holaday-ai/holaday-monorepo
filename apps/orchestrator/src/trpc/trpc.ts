import { TRPCError, initTRPC } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema/users.js';
import type { DrainOwner } from '../execution/execution-drain.js';
import {
  httpProcedureParent,
  originalHttpLifetime,
  withHttpProcedure,
} from '../execution/http-drain.js';
import { runOwnedDatabaseQuery } from '../execution/original-database-query.js';
import { currentOperationLifetime, startOwnedOperation } from '../execution/owned-operation.js';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

// Only the two fixed gates below may produce a known rejection. Bind its
// original object to this exact procedure owner, not to an error code or ID:
// an outer resolver may catch a nested denial, do work, and rethrow that error.
const gateRejections = new WeakMap<TRPCError, DrainOwner>();
const taskInputRejections = new WeakMap<Error, DrainOwner>();
/** Only for the audited, side-effect-free task schemas before business entry.
 * Bind the original parser error (tRPC retains it as cause), not BAD_REQUEST text. */
export function pureTaskInput<I, O>(schema: {
  _input: I;
  _output: O;
  parseAsync(value: unknown): Promise<O>;
}) {
  return {
    _input: schema._input,
    _output: schema._output,
    async parseAsync(value: unknown): Promise<O> {
      try {
        return await schema.parseAsync(value);
      } catch (error) {
        const lifetime = currentOperationLifetime();
        if (lifetime && error instanceof Error) taskInputRejections.set(error, lifetime.owner);
        throw error;
      }
    },
  };
}
function gateRejection(code: 'UNAUTHORIZED' | 'FORBIDDEN', message?: string): TRPCError {
  const error = new TRPCError({ code, message });
  const lifetime = currentOperationLifetime();
  if (lifetime) gateRejections.set(error, lifetime.owner);
  return error;
}

export const router = t.router;
export const middleware = t.middleware;
// The Express adapter returns void and resolves its internal HTTP promise on
// response finish. Own the actual procedure promise independently, including
// async input parsing and protected/admin middleware. Not a global DB proxy.
export const publicProcedure = t.procedure.use(async ({ ctx, next }) => {
  const original = originalHttpLifetime(ctx.req);
  if (!original && !ctx.ordinaryMaintenance) return next(); // Native callers retain existing gates.
  const controller = ctx.executionDrain;
  if (
    !controller ||
    (original && original.drain !== controller.drain) ||
    (ctx.ordinaryMaintenance && ctx.ordinaryMaintenance !== controller)
  )
    throw new TRPCError({ code: 'SERVICE_UNAVAILABLE' });
  try {
    const invoke = async (owner: DrainOwner) => {
      const executionLifetime = currentOperationLifetime();
      const result = await withHttpProcedure(() => next({ ctx: { executionLifetime } }));
      if (
        !result.ok &&
        gateRejections.get(result.error) !== owner &&
        !(
          ctx.ordinaryMaintenance &&
          result.error.cause instanceof Error &&
          taskInputRejections.get(result.error.cause) === owner
        )
      )
        controller.drain.markUnknown(owner);
      return result;
    };
    if (!original) {
      const ambient = currentOperationLifetime();
      if (
        (ctx.executionLifetime && ctx.executionLifetime !== ambient) ||
        (ambient && ambient.drain !== controller.drain)
      )
        throw new Error('MAINTENANCE_CALLER_CONTEXT_MISMATCH');
      if (!ambient) return await controller.runRoot((life) => invoke(life.owner)).result;
      return await startOwnedOperation(controller.drain, 'request', invoke, {
        parent: ambient.owner,
        errorOutcome: 'unknown',
        dispatch: 'immediate',
      }).result;
    }
    const parent = httpProcedureParent(ctx.req, ctx.executionLifetime);
    return await startOwnedOperation(controller.drain, 'request', invoke, {
      parent: parent.owner,
      errorOutcome: 'unknown',
      dispatch: 'immediate',
    }).result;
  } catch {
    throw new TRPCError({ code: 'SERVICE_UNAVAILABLE' });
  }
});

export const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw gateRejection('UNAUTHORIZED');
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
  const [row] = await runOwnedDatabaseQuery(() =>
    ctx.db
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1),
  );
  if (!row || row.role !== 'admin' || row.status !== 'active') {
    throw gateRejection('FORBIDDEN', 'admin access required');
  }
  return next({ ctx });
});
