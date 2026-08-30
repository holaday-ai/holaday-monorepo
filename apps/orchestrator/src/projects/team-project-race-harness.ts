import { isDeepStrictEqual } from 'node:util';

export type SqlCheckpointPhase = 'before' | 'after';
export type MysqlSqlMethod = 'query' | 'execute';
export type MysqlSqlOutcome = 'pending' | 'success' | 'rejected';
export type MysqlTransactionAction = 'begin' | 'commit' | 'rollback';

export type SanitizedSqlParameter =
  | { kind: 'fixture-id'; value: string }
  | { kind: 'generated-external-id'; prefix: string; length: number }
  | { kind: 'sql-literal'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'redacted-string'; length: number }
  | { kind: 'redacted-binary'; byteLength: number }
  | { kind: 'redacted-date' }
  | { kind: 'redacted-object' }
  | { kind: 'undefined' };

const rawParametersKey = Symbol('team-project-race-raw-parameters');
const boundaryMatchesKey = Symbol('team-project-race-boundary-matches');
const SAFE_SQL_LITERALS = new Set([
  'active',
  'inactive',
  'owner',
  'admin',
  'manager',
  'member',
  'lead',
  'viewer',
]);

export interface MysqlSqlInvocation {
  method: MysqlSqlMethod;
  normalizedSql: string;
  parameters: readonly SanitizedSqlParameter[];
  [rawParametersKey]: readonly unknown[];
}

export interface SqlBoundary {
  normalizedSql: string;
  parameterCount: number;
  [boundaryMatchesKey]: (parameters: readonly unknown[]) => boolean;
}

export interface SqlCheckpoint {
  release(): void;
  waitUntilReached(timeoutMs: number): Promise<void>;
  wasReached(): boolean;
  /** Internal test-harness hook invoked by the instrumented mysql2 connection. */
  notify(phase: SqlCheckpointPhase, invocation: MysqlSqlInvocation): Promise<void>;
}

export interface SqlResultOverride {
  transform(invocation: MysqlSqlInvocation, result: unknown): unknown;
}

export type MysqlBoundaryEvent =
  | { kind: 'transaction'; action: MysqlTransactionAction }
  | {
      kind: 'sql';
      method: MysqlSqlMethod;
      normalizedSql: string;
      parameters: readonly SanitizedSqlParameter[];
      outcome: MysqlSqlOutcome;
    };

export interface MysqlSqlAttempt {
  settle(outcome: Exclude<MysqlSqlOutcome, 'pending'>): void;
}

export interface MysqlBoundaryRecorder {
  readonly events: readonly MysqlBoundaryEvent[];
  transactionActions(): MysqlTransactionAction[];
  sqlInvocations(): Array<Extract<MysqlBoundaryEvent, { kind: 'sql' }>>;
  /** Internal test-harness hook. */
  recordSql(invocation: MysqlSqlInvocation, outcome?: Exclude<MysqlSqlOutcome, 'pending'>): void;
  /** Internal runtime-interception hook. */
  recordSqlAttempt(invocation: MysqlSqlInvocation): MysqlSqlAttempt;
  /** Internal test-harness hook. */
  recordTransaction(action: MysqlTransactionAction): void;
}

export type BoundedCleanupAction = {
  label: string;
  run: () => unknown | Promise<unknown>;
  onTimeout?: () => unknown | Promise<unknown>;
  onFailure?: () => unknown | Promise<unknown>;
};

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

type ObservedOutcome<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

function observe<T>(promise: Promise<T>): Promise<ObservedOutcome<T>> {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function observeWithin<T>(
  observed: Promise<ObservedOutcome<T>>,
  timeoutMs: number,
): Promise<ObservedOutcome<T> | { status: 'timed-out' }> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      observed,
      new Promise<{ status: 'timed-out' }>((resolve) => {
        timeout = setTimeout(() => resolve({ status: 'timed-out' }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runWithActiveTimeout<T>(
  operation: Promise<T>,
  input: {
    label: string;
    timeoutMs: number;
    settleTimeoutMs: number;
    onTimeout: () => unknown | Promise<unknown>;
  },
): Promise<T> {
  const observedOperation = observe(operation);
  const initial = await observeWithin(observedOperation, input.timeoutMs);
  if (initial.status === 'fulfilled') return initial.value;
  if (initial.status === 'rejected') throw initial.reason;

  const observedAbort = observe(Promise.resolve().then(input.onTimeout));
  const abort = await observeWithin(observedAbort, input.settleTimeoutMs);
  const settlement = await observeWithin(observedOperation, input.settleTimeoutMs);
  const details: string[] = [`${input.label} timed out after ${input.timeoutMs}ms`];
  if (abort.status === 'timed-out') {
    details.push(`abort did not settle within ${input.settleTimeoutMs}ms`);
  } else if (abort.status === 'rejected') {
    details.push(`abort failed: ${errorMessage(abort.reason)}`);
  }
  if (settlement.status === 'timed-out') {
    details.push(`operation did not settle within ${input.settleTimeoutMs}ms`);
  } else {
    details.push('operation settled after abort');
  }
  throw new Error(details.join('; '));
}

export async function runMysqlLockObserverExecute<T>(input: {
  label: string;
  execute: () => Promise<T>;
  destroy: () => unknown | Promise<unknown>;
  timeoutMs: number;
  settleTimeoutMs: number;
}): Promise<T> {
  try {
    return await runWithActiveTimeout(Promise.resolve().then(input.execute), {
      label: input.label,
      timeoutMs: input.timeoutMs,
      settleTimeoutMs: input.settleTimeoutMs,
      onTimeout: input.destroy,
    });
  } catch (error) {
    const message = errorMessage(error);
    const detail = message.startsWith(`${input.label} timed out after `)
      ? message
      : `${input.label} failed: ${message}`;
    const unsupported = new Error(`TASK14_LOCK_OBSERVER_UNSUPPORTED: ${detail}`);
    unsupported.cause = error;
    throw unsupported;
  }
}

export async function runBoundedCleanup(
  actions: readonly BoundedCleanupAction[],
  timeoutMs: number,
): Promise<void> {
  const failures: string[] = [];
  for (const action of actions) {
    const observedAction = observe(Promise.resolve().then(action.run));
    const outcome = await observeWithin(observedAction, timeoutMs);
    if (outcome.status === 'timed-out') {
      failures.push(`${action.label} timed out after ${timeoutMs}ms`);
      if (action.onTimeout) {
        const abort = await observeWithin(
          observe(Promise.resolve().then(action.onTimeout)),
          timeoutMs,
        );
        if (abort.status === 'timed-out') {
          failures.push(`${action.label} timeout handler timed out after ${timeoutMs}ms`);
        } else if (abort.status === 'rejected') {
          failures.push(`${action.label} timeout handler failed: ${errorMessage(abort.reason)}`);
        }
        const settlement = await observeWithin(observedAction, timeoutMs);
        if (settlement.status === 'fulfilled') {
          failures.push(`${action.label} settled after timeout handler`);
        } else if (settlement.status === 'rejected') {
          failures.push(
            `${action.label} rejected after timeout handler: ${errorMessage(settlement.reason)}`,
          );
        } else {
          failures.push(
            `${action.label} did not settle within ${timeoutMs}ms after timeout handler`,
          );
        }
      }
    } else if (outcome.status === 'rejected') {
      failures.push(`${action.label} failed: ${errorMessage(outcome.reason)}`);
      if (action.onFailure) {
        const recovery = await observeWithin(
          observe(Promise.resolve().then(action.onFailure)),
          timeoutMs,
        );
        if (recovery.status === 'timed-out') {
          failures.push(`${action.label} failure handler timed out after ${timeoutMs}ms`);
        } else if (recovery.status === 'rejected') {
          failures.push(`${action.label} failure handler failed: ${errorMessage(recovery.reason)}`);
        }
      }
    }
  }
  if (failures.length > 0) throw new Error(`cleanup failures: ${failures.join('; ')}`);
}

export function normalizeSql(sql: unknown): string {
  const text =
    typeof sql === 'string'
      ? sql
      : sql &&
          typeof sql === 'object' &&
          'normalizedSql' in sql &&
          typeof sql.normalizedSql === 'string'
        ? sql.normalizedSql
        : sql && typeof sql === 'object' && 'sql' in sql && typeof sql.sql === 'string'
          ? sql.sql
          : '';
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function extractParameters(sql: unknown, parameters: unknown): readonly unknown[] {
  if (Array.isArray(parameters)) return parameters;
  if (sql && typeof sql === 'object' && 'values' in sql && Array.isArray(sql.values)) {
    return sql.values;
  }
  return [];
}

function sanitizeParameter(value: unknown): SanitizedSqlParameter {
  if (value === null) return { kind: 'null' };
  if (value === undefined) return { kind: 'undefined' };
  if (typeof value === 'number') return { kind: 'number', value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'string') {
    if (
      value.length <= 32 &&
      /^(?:usr|org|omem|oinv|prj|pmem)_[a-z0-9_]*[a-z0-9]_[0-9a-f]{12}$/i.test(value)
    ) {
      return { kind: 'fixture-id', value };
    }
    const generatedExternalId = /^(usr|org|omem|oinv|prj|pmem)_[A-Za-z2-9]{21}$/.exec(value);
    if (generatedExternalId?.[1]) {
      return {
        kind: 'generated-external-id',
        prefix: generatedExternalId[1],
        length: value.length,
      };
    }
    if (SAFE_SQL_LITERALS.has(value)) return { kind: 'sql-literal', value };
    return { kind: 'redacted-string', length: value.length };
  }
  if (value instanceof Date) return { kind: 'redacted-date' };
  if (ArrayBuffer.isView(value)) {
    return { kind: 'redacted-binary', byteLength: value.byteLength };
  }
  return { kind: 'redacted-object' };
}

export function sqlInvocation(
  method: MysqlSqlMethod,
  sql: unknown,
  parameters?: unknown,
): MysqlSqlInvocation {
  const rawParameters = [...extractParameters(sql, parameters)];
  return {
    method,
    normalizedSql: normalizeSql(sql),
    parameters: rawParameters.map(sanitizeParameter),
    [rawParametersKey]: rawParameters,
  };
}

export function compileSqlBoundary(compiled: {
  sql: string;
  params: readonly unknown[];
}): SqlBoundary {
  const expectedParameters = [...compiled.params];
  return {
    normalizedSql: normalizeSql(compiled.sql),
    parameterCount: expectedParameters.length,
    [boundaryMatchesKey]: (parameters) => isDeepStrictEqual(parameters, expectedParameters),
  };
}

export function matchesSqlBoundary(boundary: SqlBoundary, invocation: MysqlSqlInvocation): boolean {
  return (
    invocation.normalizedSql === boundary.normalizedSql &&
    invocation[rawParametersKey].length === boundary.parameterCount &&
    boundary[boundaryMatchesKey](invocation[rawParametersKey])
  );
}

export function createSqlCheckpoint(input: {
  label: string;
  phase: SqlCheckpointPhase;
  matches: (invocation: MysqlSqlInvocation) => boolean;
}): SqlCheckpoint {
  const reached = deferred();
  const released = deferred();
  let didReach = false;

  return {
    async notify(phase, invocation) {
      if (didReach || phase !== input.phase || !input.matches(invocation)) return;
      didReach = true;
      reached.resolve();
      await released.promise;
    },
    release() {
      released.resolve();
    },
    wasReached() {
      return didReach;
    },
    async waitUntilReached(timeoutMs) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          reached.promise,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error(`SQL checkpoint timed out: ${input.label}`)),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}

export function createAffectedRowsOverride(input: {
  matches: (invocation: MysqlSqlInvocation) => boolean;
  affectedRows: number;
}): SqlResultOverride {
  let used = false;
  return {
    transform(invocation, result) {
      if (used || !input.matches(invocation) || !Array.isArray(result)) return result;
      const [header, ...rest] = result;
      if (!header || typeof header !== 'object') return result;
      used = true;
      return [{ ...header, affectedRows: input.affectedRows }, ...rest];
    },
  };
}

export function createMysqlBoundaryRecorder(): MysqlBoundaryRecorder {
  const events: MysqlBoundaryEvent[] = [];
  const appendSqlEvent = (invocation: MysqlSqlInvocation, outcome: MysqlSqlOutcome) => {
    const event: Extract<MysqlBoundaryEvent, { kind: 'sql' }> = {
      kind: 'sql',
      method: invocation.method,
      normalizedSql: invocation.normalizedSql,
      parameters: invocation.parameters.map((parameter) => ({ ...parameter })),
      outcome,
    };
    events.push(event);
    return event;
  };
  return {
    events,
    recordSql(invocation, outcome = 'success') {
      appendSqlEvent(invocation, outcome);
    },
    recordSqlAttempt(invocation) {
      const event = appendSqlEvent(invocation, 'pending');
      let settled = false;
      return {
        settle(outcome) {
          if (settled) throw new Error('SQL attempt outcome was already recorded');
          settled = true;
          event.outcome = outcome;
        },
      };
    },
    recordTransaction(action) {
      events.push({ kind: 'transaction', action });
    },
    transactionActions() {
      return events
        .filter(
          (event): event is Extract<MysqlBoundaryEvent, { kind: 'transaction' }> =>
            event.kind === 'transaction',
        )
        .map((event) => event.action);
    },
    sqlInvocations() {
      return events.filter(
        (event): event is Extract<MysqlBoundaryEvent, { kind: 'sql' }> => event.kind === 'sql',
      );
    },
  };
}

function transactionActionFromSql(normalizedSql: string): MysqlTransactionAction | undefined {
  if (normalizedSql === 'begin' || normalizedSql.startsWith('start transaction')) return 'begin';
  if (normalizedSql === 'commit') return 'commit';
  if (normalizedSql === 'rollback') return 'rollback';
  return undefined;
}

/**
 * Wraps a mysql2 PromiseConnection at its query boundary. The underlying query/execute call is
 * always real; checkpoints only pause JavaScript before or after it for deterministic races.
 */
export function instrumentMysqlConnection<Connection extends object>(
  connection: Connection,
  checkpoints: readonly SqlCheckpoint[],
  resultOverrides: readonly SqlResultOverride[] = [],
  recorder?: MysqlBoundaryRecorder,
): Connection {
  return new Proxy(connection, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if ((property === 'query' || property === 'execute') && typeof value === 'function') {
        return async (...args: unknown[]) => {
          const invocation = sqlInvocation(property, args[0], args[1]);
          for (const checkpoint of checkpoints) await checkpoint.notify('before', invocation);
          const attempt = recorder?.recordSqlAttempt(invocation);
          let result: unknown;
          try {
            result = await Reflect.apply(value, target, args);
          } catch (error) {
            attempt?.settle('rejected');
            throw error;
          }
          attempt?.settle('success');
          const transactionAction = transactionActionFromSql(invocation.normalizedSql);
          if (transactionAction) recorder?.recordTransaction(transactionAction);
          for (const override of resultOverrides) result = override.transform(invocation, result);
          for (const checkpoint of checkpoints) await checkpoint.notify('after', invocation);
          return result;
        };
      }
      if (
        (property === 'beginTransaction' || property === 'commit' || property === 'rollback') &&
        typeof value === 'function'
      ) {
        return async (...args: unknown[]) => {
          const result = await Reflect.apply(value, target, args);
          recorder?.recordTransaction(
            property === 'beginTransaction' ? 'begin' : (property as MysqlTransactionAction),
          );
          return result;
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function createMysqlRaceEndpoint<Connection extends object>(input: {
  connection: Connection;
  checkpoints: readonly SqlCheckpoint[];
  resultOverrides?: readonly SqlResultOverride[];
}): { connection: Connection; recorder: MysqlBoundaryRecorder } {
  const recorder = createMysqlBoundaryRecorder();
  return {
    connection: instrumentMysqlConnection(
      input.connection,
      input.checkpoints,
      input.resultOverrides,
      recorder,
    ),
    recorder,
  };
}
