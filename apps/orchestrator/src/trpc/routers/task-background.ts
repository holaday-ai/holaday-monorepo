import { currentOperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';
import type { Context } from '../context.js';

/** Own the original background promise before the resolver returns. Native and
 * unconfigured callers retain their existing adapters and behavior. */
export async function runTaskBackground<C extends Context, T>(
  ctx: C,
  action: (ctx: C) => Promise<T>,
): Promise<T> {
  const maintenance = ctx.ordinaryMaintenance;
  if (!maintenance) return action(ctx);
  const parent = currentOperationLifetime();
  if (maintenance !== ctx.executionDrain || !parent || parent.drain !== maintenance.drain)
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
