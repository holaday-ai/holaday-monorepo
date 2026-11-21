import { currentOperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';
import type { Context } from '../context.js';

/** Own the original background promise before the resolver returns, including
 * drain-only callers. Unconfigured callers retain their existing behavior. */
export async function runTaskBackground<C extends Context, T>(
  ctx: C,
  action: (ctx: C) => Promise<T>,
): Promise<T> {
  const maintenance = ctx.ordinaryMaintenance;
  const controller = maintenance ?? ctx.executionDrain;
  if (!controller) return action(ctx);
  const parent = currentOperationLifetime();
  if (
    (maintenance && maintenance !== ctx.executionDrain) ||
    !parent ||
    parent.drain !== controller.drain
  )
    throw new Error('MAINTENANCE_BACKGROUND_OWNER');
  return startOwnedOperation(
    parent.drain,
    'execution',
    async () => {
      const executionLifetime = currentOperationLifetime();
      if (!executionLifetime) throw new Error('MAINTENANCE_BACKGROUND_OWNER');
      return action({ ...ctx, executionLifetime });
    },
    { parent: parent.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
  ).result;
}
