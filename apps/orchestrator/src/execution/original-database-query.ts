import { NoopLogger } from 'drizzle-orm/logger';
import { MySql2PreparedQuery } from 'drizzle-orm/mysql2/session';
import { npmVersion } from 'drizzle-orm/version';
import {
  captureOperationScopeVeto,
  currentOperationLifetime,
  startOwnedOperation,
} from './owned-operation.js';

const originalExecute = MySql2PreparedQuery.prototype.execute;
const originalNoopLog = NoopLogger.prototype.logQuery;
const originalArrayMap = Array.prototype.map;
const originalPromiseThen = Promise.prototype.then;

export interface QueryExecution<T> {
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
export function executeOriginalQuery<T>(
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

/** Hold the fixed prepared execution and original driver before caller catches.
 * The caller's dispatch scope is captured before creating the database child;
 * query construction cannot seal that scope and dispatch under the child's one. */
export async function runOwnedDatabaseQuery<T>(action: () => PromiseLike<T>): Promise<T> {
  const parent = currentOperationLifetime();
  if (!parent) return action();
  const originalVeto = captureOperationScopeVeto();
  return startOwnedOperation(
    parent.drain,
    'database',
    () => executeOriginalQuery(action, originalVeto).result,
    { parent: parent.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
  ).result;
}
