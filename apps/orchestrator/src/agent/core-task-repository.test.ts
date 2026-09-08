import { drizzle } from 'drizzle-orm/mysql2';
import type { Connection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { prepareCoreAdmission } from './core-task-admission.js';
import { CoreTaskRepository } from './core-task-repository.js';

const scope = { taskId: 'tsk_synthetic', userId: 7 };
const requirements = {
  initialRequest: '整理合成资料',
  userTurns: ['补充条件'],
  phase: 'revise' as const,
  workflow: null,
  referencePlan: '合成方案',
  fileIds: ['file_synthetic'],
};
const legacy = {
  status: 'awaiting_user',
  executionId: null,
  executionRevision: 0,
  recordVersion: 0,
};
const operation = (before = legacy) => prepareCoreAdmission({ scope, before, requirements });

// Only replace mysql2 transport. The actual Drizzle queries and transaction
// implementation run, including BEGIN/COMMIT/ROLLBACK and row decoding.
function fixture(
  options: {
    affected?: unknown;
    eventError?: boolean;
    commitError?: boolean;
    rowId?: number | null;
    head?: unknown[] | null;
  } = {},
) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (query: { sql: string }, params: unknown[] = []) => {
      queries.push({ sql: query.sql, params });
      if (query.sql.startsWith('select `id`'))
        return [options.rowId === null ? [] : [[options.rowId ?? 19]], []];
      if (query.sql.startsWith('select'))
        return [options.head === null ? [] : [options.head ?? ['awaiting_user', null, 0, 0]], []];
      if (query.sql.startsWith('update'))
        return [{ affectedRows: 'affected' in options ? options.affected : 1, insertId: 0 }, []];
      if (query.sql.startsWith('insert') && options.eventError)
        throw new Error('synthetic event transport failure');
      if (query.sql === 'commit' && options.commitError)
        throw new Error('synthetic commit response lost');
      return [{ affectedRows: 1, insertId: 19 }, []];
    },
  };
  const db = drizzle(client as unknown as Connection) as unknown as DB;
  return { repo: new CoreTaskRepository(db), queries };
}

describe('core admission database boundary', () => {
  it('restricts the actual CAS to SQL NULL or object result roots so requirements cannot silently vanish', async () => {
    const { repo, queries } = fixture();
    await repo.admit(operation());
    const update = queries.find((q) => q.sql.startsWith('update'));
    expect(update?.sql.split(' where ')[1]).toContain(
      "(`tasks`.`result` is null or JSON_TYPE(`tasks`.`result`) = 'OBJECT')",
    );
  });

  it('saves requirements, identity and event within one guarded transaction', async () => {
    const op = operation();
    const { repo, queries } = fixture();
    expect(await repo.admit(op)).toEqual({ persisted: true });
    const update = queries.find((q) => q.sql.startsWith('update'));
    expect(update).toBeDefined();
    const guard = update?.sql.split(' where ')[1];
    expect(guard).toBe(
      "(`tasks`.`external_id` = ? and `tasks`.`user_id` = ? and `tasks`.`status` = ? and `tasks`.`execution_id` is null and `tasks`.`execution_revision` = ? and `tasks`.`core_record_version` = ? and (`tasks`.`result` is null or JSON_TYPE(`tasks`.`result`) = 'OBJECT'))",
    );
    expect(update?.params.slice(-5)).toEqual(['tsk_synthetic', 7, 'awaiting_user', 0, 0]);
    expect(update?.sql).toContain(
      "JSON_SET(COALESCE(`tasks`.`result`, JSON_OBJECT()), '$.coreRequirements', CAST(? AS JSON))",
    );
    expect(update?.params).toContain(op.executionId);
    const accepted = update?.params.find((p) => typeof p === 'string' && p.startsWith('{'));
    expect(JSON.parse(String(accepted))).toEqual(requirements);
    const event = queries.find((q) => q.sql.startsWith('insert'));
    expect(event).toBeDefined();
    expect(event?.params).toContain(19);
    const payload = event?.params.find((p) => typeof p === 'string' && p.startsWith('{'));
    expect(JSON.parse(String(payload))).toEqual({
      executionId: op.executionId,
      executionRevision: 1,
      recordVersion: 1,
    });
    expect(queries[0]?.sql).toBe('begin');
    expect(queries.at(-1)?.sql).toBe('commit');
    expect(queries.findIndex((q) => q.sql.startsWith('insert'))).toBeGreaterThan(
      queries.findIndex((q) => q.sql.startsWith('update')),
    );
  });

  it('matches the prior execution as well as status and both versions on subsequent admission', async () => {
    const op = prepareCoreAdmission({
      scope,
      requirements,
      before: {
        status: 'awaiting_user',
        executionId: 'old_exec',
        executionRevision: 3,
        recordVersion: 8,
      },
    });
    const { repo, queries } = fixture();
    await repo.admit(op);
    const update = queries.find((q) => q.sql.startsWith('update'));
    expect(update?.sql).toContain('`tasks`.`execution_id` = ?');
    expect(update?.params.slice(-6)).toEqual([
      'tsk_synthetic',
      7,
      'awaiting_user',
      'old_exec',
      3,
      8,
    ]);
    expect(update?.params).toContain(4);
    expect(update?.params).toContain(9);
  });

  it('does not append an accepted event when the CAS rejects a stale or cancelled row', async () => {
    const { repo, queries } = fixture({ affected: 0 });
    expect(await repo.admit(operation())).toEqual({ persisted: false });
    expect(queries.some((q) => q.sql.startsWith('insert'))).toBe(false);
  });

  it.each([undefined, 2, -1, '1'])(
    'fails closed for an unexpected affected-row result %j',
    async (affected) => {
      const { repo, queries } = fixture({ affected });
      await expect(repo.admit(operation())).rejects.toThrow('CORE_ADMISSION_WRITE_INVALID');
      expect(queries.at(-1)?.sql).toBe('rollback');
      expect(queries.some((q) => q.sql.startsWith('insert'))).toBe(false);
    },
  );

  it('rolls back the accepted state when the event cannot be inserted', async () => {
    const { repo, queries } = fixture({ eventError: true });
    await expect(repo.admit(operation())).rejects.toThrow();
    expect(queries.at(-1)?.sql).toBe('rollback');
    expect(queries.some((q) => q.sql === 'commit')).toBe(false);
  });

  it('does not report success or a definite non-commit after losing the commit response', async () => {
    const { repo, queries } = fixture({ commitError: true });
    await expect(repo.admit(operation())).rejects.toThrow();
    expect(queries.filter((q) => q.sql.startsWith('update'))).toHaveLength(1);
    expect(queries.some((q) => q.sql === 'commit')).toBe(true);
  });

  it('rolls back if the accepted task id cannot be resolved for its event', async () => {
    const { repo, queries } = fixture({ rowId: null });
    await expect(repo.admit(operation())).rejects.toThrow('CORE_ADMISSION_WRITE_INVALID');
    expect(queries.at(-1)?.sql).toBe('rollback');
  });

  it('rejects a copied capability before any database operation', async () => {
    const { repo, queries } = fixture();
    await expect(repo.admit({ ...operation() })).rejects.toThrow('CORE_ADMISSION_INVALID');
    expect(queries).toEqual([]);
  });

  it('reads only a scoped execution head, never task or user content', async () => {
    const { repo, queries } = fixture();
    expect(await repo.readHead(scope)).toEqual(legacy);
    expect(queries).toEqual([
      {
        sql: 'select `status`, `execution_id`, `execution_revision`, `core_record_version` from `tasks` where (`tasks`.`external_id` = ? and `tasks`.`user_id` = ?) limit ?',
        params: ['tsk_synthetic', 7, 1],
      },
    ]);
  });

  it('does not substitute an empty legacy head for a missing task', async () => {
    expect(await fixture({ head: null }).repo.readHead(scope)).toBeNull();
  });

  it('refuses malformed database identity instead of treating it as legacy', async () => {
    await expect(
      fixture({ head: ['awaiting_user', null, 4, 8] }).repo.readHead(scope),
    ).rejects.toThrow('CORE_ADMISSION_INVALID');
  });

  it('validates scope before reading', async () => {
    const { repo, queries } = fixture();
    await expect(repo.readHead({ ...scope, userId: 0 })).rejects.toThrow('CORE_ADMISSION_INVALID');
    expect(queries).toEqual([]);
  });

  it('does not expose driver query parameters or cause when the head read fails', async () => {
    const client = {
      query: async () => {
        throw new Error('SYNTHETIC_SCOPE_MARKER');
      },
    };
    const db = drizzle(client as unknown as Connection) as unknown as DB;
    const error = await new CoreTaskRepository(db).readHead(scope).catch((value) => value);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('CORE_EXECUTION_READ_UNAVAILABLE');
    expect(error.cause).toBeUndefined();
    expect(String(error)).not.toContain('SYNTHETIC_SCOPE_MARKER');
  });
});
