import { TRPCError } from '@trpc/server';
import { type OperationLifetime, startOwnedOperation } from '../execution/owned-operation.js';
import { middleware } from './trpc.js';

/** Mount after pure input parsing and before the first business await. */
export const taskDrainMiddleware = middleware(async ({ ctx, next }) => {
  const controller = ctx.executionDrain;
  if (!controller) {
    if (ctx.executionLifetime) throw unavailable();
    return next();
  }
  const action = async (lifetime: OperationLifetime) => {
    const result = await next({ ctx: { executionLifetime: lifetime } });
    // tRPC returns handler errors as data. After business entry, do not infer
    // absence of partial side effects from a user-facing error code.
    if (!result.ok) lifetime.drain.markUnknown(lifetime.owner);
    return result;
  };
  try {
    const inherited = ctx.executionLifetime;
    if (!inherited) return await controller.runRoot(action).result;
    if (inherited.drain !== controller.drain) {
      controller.drain.block();
      throw unavailable();
    }
    return await startOwnedOperation(
      controller.drain,
      'request',
      (owner) => action(Object.freeze({ drain: controller.drain, owner })),
      {
        parent: inherited.owner,
        errorOutcome: 'unknown',
        dispatch: 'immediate',
      },
    ).result;
  } catch {
    throw unavailable();
  }
});

function unavailable(): TRPCError {
  return new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: '服务正在维护，请稍后再试。' });
}
