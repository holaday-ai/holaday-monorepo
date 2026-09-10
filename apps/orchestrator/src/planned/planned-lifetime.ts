import {
  type OperationLifetime,
  currentOperationLifetime,
  startOwnedOperation,
} from '../execution/owned-operation.js';
import type { Context } from '../trpc/context.js';

/** Synchronous reservation is essential: a detached child must exist before its parent's ACK. */
export function withPlannedContext<C extends Context, T>(
  ctx: C,
  action: (bound: C) => Promise<T>,
): Promise<T> {
  const ambient = currentOperationLifetime();
  const inherited = ctx.executionLifetime;
  const controller = ctx.executionDrain;
  if (!controller) {
    if (inherited || ambient) throw new Error('PLANNED_DRAIN_CONTROLLER_REQUIRED');
    return action(ctx);
  }
  if (
    (inherited && inherited.drain !== controller.drain) ||
    (ambient && (ambient.drain !== inherited?.drain || ambient.owner !== inherited?.owner))
  ) {
    controller.drain.block();
    throw new Error('PLANNED_DRAIN_CONTEXT_MISMATCH');
  }
  if (controller.drain.snapshot().unknown > 0) throw new Error('PLANNED_DRAIN_UNKNOWN');
  if (!inherited) {
    return controller.runRoot((lifetime) => action({ ...ctx, executionLifetime: lifetime })).result;
  }
  return startOwnedOperation(
    controller.drain,
    'execution',
    (owner) =>
      action({
        ...ctx,
        executionLifetime: Object.freeze({ drain: controller.drain, owner }),
      }),
    { parent: inherited.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
  ).result;
}

/** Own the raw Promise, including a transaction's commit/rollback, before business catches. */
export async function runPlannedDatabase<T>(action: () => PromiseLike<T>): Promise<T> {
  return runPlannedOperation('database', action);
}

export async function runPlannedOperation<T>(
  kind: 'database' | 'scheduler' | 'execution',
  action: () => PromiseLike<T>,
): Promise<T> {
  const lifetime = currentOperationLifetime();
  if (!lifetime) return action();
  return startOwnedOperation(lifetime.drain, kind, async () => action(), {
    parent: lifetime.owner,
    errorOutcome: 'unknown',
    dispatch: 'immediate',
  }).result;
}

export function plannedOutcomeUnknown(): boolean {
  return (currentOperationLifetime()?.drain.snapshot().unknown ?? 0) > 0;
}

/** The caller must forward this exact server-only capability before its own ACK. */
export function callPlannedHook<T, R>(
  hook: (input: T, lifetime?: OperationLifetime) => Promise<R>,
  input: T,
): Promise<R> {
  if (plannedOutcomeUnknown()) throw new Error('PLANNED_DRAIN_UNKNOWN');
  return runPlannedOperation('execution', async () => {
    const lifetime = currentOperationLifetime();
    return lifetime ? hook(input, lifetime) : hook(input);
  });
}

export function retainPlannedUncertainty(): boolean {
  const lifetime = currentOperationLifetime();
  if (!lifetime) return false;
  lifetime.drain.markUnknown(lifetime.owner);
  return true;
}

/** Unscoped compatibility is unchanged; scoped writes require evidence, never guessed success. */
export function runPlannedWrite<T>(
  action: () => PromiseLike<T>,
  expected: { maxRows?: number; exactRows?: number; insertId?: boolean } = {},
): Promise<T> {
  return runPlannedDatabase(async () => {
    const result = await action();
    if (!currentOperationLifetime()) return result;
    const head: unknown = Array.isArray(result) ? result[0] : result;
    const rows =
      head && typeof head === 'object' && 'affectedRows' in head ? head.affectedRows : undefined;
    const id = head && typeof head === 'object' && 'insertId' in head ? head.insertId : undefined;
    if (
      typeof rows !== 'number' ||
      !Number.isSafeInteger(rows) ||
      rows < 0 ||
      rows > (expected.maxRows ?? Number.MAX_SAFE_INTEGER) ||
      (expected.exactRows !== undefined && rows !== expected.exactRows) ||
      (expected.insertId &&
        ((typeof id !== 'number' && typeof id !== 'bigint') ||
          !Number.isSafeInteger(Number(id)) ||
          Number(id) <= 0))
    ) {
      throw new Error('PLANNED_DRAIN_UNPROVEN_WRITE');
    }
    return result;
  });
}
