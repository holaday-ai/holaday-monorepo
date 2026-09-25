import type { DrainController } from '../execution/drain-controller.js';
import {
  captureOperationScopeVeto,
  currentOperationLifetime,
  startOwnedOperation,
} from '../execution/owned-operation.js';

import { type QueryExecution, executeOriginalQuery } from '../execution/original-database-query.js';

/** Original server-side authority only; request fields cannot supply a lifetime. */
export async function runWebhookRequest(
  controller: DrainController | undefined,
  action: () => Promise<void>,
): Promise<void> {
  const inherited = currentOperationLifetime();
  if (!controller) {
    if (inherited) throw new Error('WEBHOOK_DRAIN_AUTHORITY');
    return action();
  }
  if (!inherited) return controller.runRoot(action).result;
  if (inherited.drain !== controller.drain) throw new Error('WEBHOOK_DRAIN_AUTHORITY');
  return startOwnedOperation(controller.drain, 'request', action, {
    parent: inherited.owner,
    errorOutcome: 'unknown',
    dispatch: 'immediate',
  }).result;
}

/** Invoke the raw query inside its child, before any caller catch/ACK can detach it. */
export async function webhookDatabase<T>(action: () => PromiseLike<T>): Promise<T> {
  const lifetime = currentOperationLifetime();
  if (!lifetime) return action();
  return startOwnedOperation(
    lifetime.drain,
    'database',
    () => executeOriginalQuery(action).result,
    {
      parent: lifetime.owner,
      errorOutcome: 'unknown',
      dispatch: 'immediate',
    },
  ).result;
}

export function webhookIsUncertain(): boolean {
  const snapshot = currentOperationLifetime()?.drain.snapshot();
  return !!snapshot && (snapshot.unknown > 0 || snapshot.mode === 'blocked');
}

/** Cleanup shares the same fixed Drizzle/raw-driver adapter, but may delete a
 * bounded batch rather than the webhook's single-row claim. No receipt => unknown. */
export async function drainedCleanupDelete<T>(
  action: () => PromiseLike<T>,
  maxRows = Number.MAX_SAFE_INTEGER,
): Promise<T> {
  const lifetime = currentOperationLifetime();
  if (!lifetime) return action();
  if (webhookIsUncertain()) throw new Error('CLEANUP_DRAIN_UNCERTAIN');
  const originalVeto = captureOperationScopeVeto();
  return startOwnedOperation(
    lifetime.drain,
    'database',
    async () => {
      const result = await executeOriginalQuery(action, originalVeto).result;
      const affected = Array.isArray(result) ? result[0]?.affectedRows : undefined;
      if (!Number.isSafeInteger(affected) || affected < 0 || affected > maxRows)
        throw new Error('CLEANUP_RECEIPT_UNKNOWN');
      return result;
    },
    { parent: lifetime.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
  ).result;
}

/** A fixed single-row write needs an actual driver receipt, not an absent ACK
 * coerced to zero. Only the claim INSERT's duplicate-key response is known. */
export async function webhookWrite<T>(
  action: () => PromiseLike<T>,
  claimInsert = false,
): Promise<T> {
  const lifetime = currentOperationLifetime();
  if (!lifetime) return action();
  if (webhookIsUncertain()) throw new Error('WEBHOOK_DRAIN_UNCERTAIN');
  const outcome = await startOwnedOperation(
    lifetime.drain,
    'database',
    async () => {
      let execution: QueryExecution<T>;
      try {
        execution = executeOriginalQuery(action);
      } catch {
        // A builder/guard failure has not supplied a driver duplicate receipt.
        throw new Error('WEBHOOK_DATABASE_PREPARE');
      }
      let result: T;
      try {
        result = await execution.result;
      } catch (error) {
        if (claimInsert && execution.isDriverDuplicate(error)) return { ok: false as const, error };
        throw new Error('WEBHOOK_DATABASE_EXECUTION');
      }
      const affected = Array.isArray(result) ? result[0]?.affectedRows : undefined;
      if (!Number.isSafeInteger(affected) || affected < (claimInsert ? 1 : 0) || affected > 1)
        throw new Error('WEBHOOK_WRITE_RECEIPT_UNKNOWN');
      return { ok: true as const, result };
    },
    { parent: lifetime.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
  ).result;
  if (!outcome.ok) throw outcome.error;
  return outcome.result;
}
