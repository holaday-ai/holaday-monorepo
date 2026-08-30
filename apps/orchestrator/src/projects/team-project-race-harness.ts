export type SqlCheckpointPhase = 'before' | 'after';

export interface SqlCheckpoint {
  release(): void;
  waitUntilReached(timeoutMs: number): Promise<void>;
  wasReached(): boolean;
  /** Internal test-harness hook invoked by the instrumented mysql2 connection. */
  notify(phase: SqlCheckpointPhase, normalizedSql: string): Promise<void>;
}

export interface SqlResultOverride {
  transform(normalizedSql: string, result: unknown): unknown;
}

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

export function normalizeSql(sql: unknown): string {
  const text =
    typeof sql === 'string'
      ? sql
      : sql && typeof sql === 'object' && 'sql' in sql && typeof sql.sql === 'string'
        ? sql.sql
        : '';
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isOrganizationLockSql(sql: unknown): boolean {
  const normalized = normalizeSql(sql);
  return normalized.includes('from `organizations`') && normalized.includes('for update');
}

export function isOrganizationMembershipSnapshotSql(sql: unknown): boolean {
  const normalized = normalizeSql(sql);
  return (
    normalized.includes('from `organization_members` inner join `organizations`') &&
    normalized.includes('inner join `users`') &&
    !normalized.includes('for update')
  );
}

export function isProjectAccessSnapshotSql(sql: unknown): boolean {
  const normalized = normalizeSql(sql);
  return (
    normalized.includes('from `projects` inner join `users`') &&
    normalized.includes('left join `organizations`') &&
    !normalized.includes('for update')
  );
}

export function createSqlCheckpoint(input: {
  label: string;
  phase: SqlCheckpointPhase;
  matches: (normalizedSql: string) => boolean;
}): SqlCheckpoint {
  const reached = deferred();
  const released = deferred();
  let didReach = false;

  return {
    async notify(phase, normalizedSql) {
      if (didReach || phase !== input.phase || !input.matches(normalizedSql)) return;
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
  matches: (normalizedSql: string) => boolean;
  affectedRows: number;
}): SqlResultOverride {
  let used = false;
  return {
    transform(normalizedSql, result) {
      if (used || !input.matches(normalizedSql) || !Array.isArray(result)) return result;
      const [header, ...rest] = result;
      if (!header || typeof header !== 'object') return result;
      used = true;
      return [{ ...header, affectedRows: input.affectedRows }, ...rest];
    },
  };
}

/**
 * Wraps a mysql2 PromiseConnection at its query boundary. The underlying query/execute call is
 * always real; checkpoints only pause JavaScript before or after it for deterministic races.
 */
export function instrumentMysqlConnection<Connection extends object>(
  connection: Connection,
  checkpoints: readonly SqlCheckpoint[],
  resultOverrides: readonly SqlResultOverride[] = [],
): Connection {
  return new Proxy(connection, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if ((property === 'query' || property === 'execute') && typeof value === 'function') {
        return async (...args: unknown[]) => {
          const sql = normalizeSql(args[0]);
          for (const checkpoint of checkpoints) await checkpoint.notify('before', sql);
          let result = await Reflect.apply(value, target, args);
          for (const override of resultOverrides) result = override.transform(sql, result);
          for (const checkpoint of checkpoints) await checkpoint.notify('after', sql);
          return result;
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
