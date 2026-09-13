import { NoopLogger } from 'drizzle-orm/logger';
import { MySql2PreparedQuery } from 'drizzle-orm/mysql2/session';
import { npmVersion } from 'drizzle-orm/version';
import type { DrainController } from '../execution/drain-controller.js';
import {
  captureOperationScopeVeto,
  currentOperationLifetime,
  startOwnedOperation,
} from '../execution/owned-operation.js';

const originalExecute = MySql2PreparedQuery.prototype.execute;
const originalNoopLog = NoopLogger.prototype.logQuery;
const originalArrayMap = Array.prototype.map;
const originalPromiseThen = Promise.prototype.then;

interface QueryExecution<T> {
  result: Promise<T>;
  isDriverDuplicate(error: unknown): boolean;
}

function hasOnlyDataProperties(value: object): boolean {
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor && 'value' in descriptor;
  });
}

function dataMethod(receiver: object, key: string): (...args: unknown[]) => unknown {
  let cursor: object | null = receiver;
  for (let depth = 0; cursor && depth < 16; depth++, cursor = Object.getPrototypeOf(cursor)) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (!descriptor) continue;
    if ('value' in descriptor && typeof descriptor.value === 'function') return descriptor.value;
    break;
  }
  throw new Error('WEBHOOK_DATABASE_CONTRACT');
}

/** This fixed Drizzle version reaches client.query synchronously after prepare,
 * provided there are no placeholder encoders or custom query logger callbacks.
 * Do not assimilate QueryPromise: its later then() would reopen a veto gap. */
function executeOriginalQuery<T>(
  action: () => PromiseLike<T>,
  originalVeto: () => void = () => {},
): QueryExecution<T> {
  const lifetime = currentOperationLifetime();
  if (!lifetime) throw new Error('WEBHOOK_DRAIN_AUTHORITY');
  const veto = captureOperationScopeVeto();
  const query = action() as PromiseLike<T> & { prepare?: () => unknown };
  if (npmVersion !== '0.38.4' || typeof query.prepare !== 'function')
    throw new Error('WEBHOOK_DATABASE_CONTRACT');
  const prepared = query.prepare();
  if (!(prepared instanceof MySql2PreparedQuery) || prepared.execute !== originalExecute)
    throw new Error('WEBHOOK_DATABASE_CONTRACT');
  // These are fixed-version internal fields, inspected without running callbacks.
  const fields = Object.getOwnPropertyDescriptors(prepared);
  if (!hasOnlyDataProperties(prepared)) throw new Error('WEBHOOK_DATABASE_CONTRACT');
  for (const key of ['query', 'rawQuery']) {
    const value = fields[key]?.value;
    if (
      !value ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      !hasOnlyDataProperties(value) ||
      typeof Object.getOwnPropertyDescriptor(value, 'sql')?.value !== 'string'
    )
      throw new Error('WEBHOOK_DATABASE_CONTRACT');
    Object.freeze(value);
  }
  const client = fields.client?.value;
  if (!client || typeof client !== 'object') throw new Error('WEBHOOK_DATABASE_CONTRACT');
  const originalQuery = dataMethod(client, 'query');
  const queryLogger = fields.logger?.value;
  const params = fields.params?.value;
  const ownLog = queryLogger && Object.getOwnPropertyDescriptor(queryLogger, 'logQuery');
  const prototypeLog = Object.getOwnPropertyDescriptor(NoopLogger.prototype, 'logQuery');
  if (
    !(queryLogger instanceof NoopLogger) ||
    Object.getPrototypeOf(queryLogger) !== NoopLogger.prototype ||
    (ownLog
      ? !('value' in ownLog) || ownLog.value !== originalNoopLog
      : !prototypeLog || !('value' in prototypeLog) || prototypeLog.value !== originalNoopLog) ||
    Reflect.ownKeys(queryLogger).some((key) => key !== 'logQuery') ||
    !Array.isArray(params) ||
    Object.getPrototypeOf(params) !== Array.prototype ||
    Reflect.ownKeys(params).length !== params.length + 1
  )
    throw new Error('WEBHOOK_DATABASE_CONTRACT');
  for (let index = 0; index < params.length; index++) {
    const item = Object.getOwnPropertyDescriptor(params, String(index));
    if (
      !item ||
      !('value' in item) ||
      (item.value !== null && !['string', 'number', 'boolean'].includes(typeof item.value))
    )
      throw new Error('WEBHOOK_DATABASE_CONTRACT');
  }
  // Pin this prepared call's inert logger and array operations before the last
  // guard. map must not consult a custom constructor/@@species after the veto.
  if (!ownLog) Object.defineProperty(queryLogger, 'logQuery', { value: originalNoopLog });
  Object.freeze(queryLogger);
  Object.defineProperties(params, {
    map: { value: originalArrayMap },
    constructor: { value: undefined },
  });
  Object.freeze(params);
  let used = false;
  let raw: Promise<unknown> | undefined;
  let rejected = false;
  let driverError: unknown;
  // Only this newly prepared query is rebound. The pool/session/global client
  // is untouched. The delegate returns the exact original driver Promise.
  Object.defineProperty(prepared, 'client', {
    value: Object.freeze({
      query(...args: unknown[]) {
        if (used) throw new Error('WEBHOOK_DATABASE_REDISPATCH');
        used = true;
        lifetime.drain.assertDispatch(lifetime.owner);
        veto();
        originalVeto();
        const receipt = Reflect.apply(originalQuery, client, args);
        if (!(receipt instanceof Promise)) throw new Error('WEBHOOK_DATABASE_RECEIPT');
        raw = receipt;
        Reflect.apply(originalPromiseThen, receipt, [
          undefined,
          (error: unknown) => {
            rejected = true;
            driverError = error;
          },
        ]);
        return receipt;
      },
    }),
    writable: false,
    configurable: false,
  });
  Object.freeze(prepared);
  // Last original-scope veto, after SQL construction/prepare and all inspections.
  lifetime.drain.assertDispatch(lifetime.owner);
  veto();
  originalVeto();
  const execution = Reflect.apply(originalExecute, prepared, []) as Promise<T>;
  const result = (async () => {
    let value!: T;
    let failed = false;
    let failure: unknown;
    try {
      value = await execution;
    } catch (error) {
      failed = true;
      failure = error;
    }
    // Keep both the SDK execution and its original raw receipt alive even if a
    // mapper/SDK failure finishes first. Neither a response nor catch clears it.
    if (raw) {
      try {
        await raw;
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    } else if (!failed) throw new Error('WEBHOOK_DATABASE_RECEIPT');
    if (failed) throw failure;
    return value;
  })();
  return {
    result,
    isDriverDuplicate: (error) =>
      rejected && driverError === error && (error as { code?: string })?.code === 'ER_DUP_ENTRY',
  };
}

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
