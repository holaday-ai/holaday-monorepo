import { drizzle } from 'drizzle-orm/mysql2';
import type { Connection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { prepareCoreAdmission } from './core-task-admission.js';
import { CoreTaskRepository } from './core-task-repository.js';
import { prepareCoreSettlement } from './core-task-settlement.js';

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
    updateError?: boolean;
    affectedSequence?: number[];
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
      if (query.sql.startsWith('update')) {
        if (options.updateError) throw new Error('SYNTHETIC_PRIVATE_DB_PARAMETER');
        return [
          {
            affectedRows:
              options.affectedSequence?.shift() ?? ('affected' in options ? options.affected : 1),
            insertId: 0,
          },
          [],
        ];
      }
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
  it('patches suggestions only for the same owner, completed execution and record version', async () => {
    const admission = operation();
    const op = prepareCoreSettlement({
      admission,
      status: 'completed',
      result: { summary: '合成正文' },
      generation: { completeness: 'complete', stopReason: 'end_turn' },
      verification: {
        taskId: scope.taskId,
        executionId: admission.executionId,
        executionRevision: admission.executionRevision,
        passed: true,
        tier: 'llm',
        semanticStatus: 'pass',
        inputCoverage: { complete: true, codes: [] },
        checks: [],
      },
    });
    const { repo, queries } = fixture();
    expect(await repo.persistSuggestions(op, ['整理后续执行清单'])).toBe(true);
    const patch = queries.find((query) => query.sql.startsWith('update'));
    expect(patch?.sql).toContain('`execution_revision` = ?');
    expect(patch?.sql).toContain('`core_record_version` = ?');
    expect(patch?.params.slice(-6)).toEqual([
      scope.taskId,
      7,
      'completed',
      op.executionId,
      op.executionRevision,
      op.recordVersion,
    ]);
  });
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

function settlementOperation(
  status: 'completed' | 'failed' | 'awaiting_user' | 'partial_success' = 'completed',
) {
  const admission = operation();
  const common = {
    admission,
    verification: {
      taskId: scope.taskId,
      executionId: admission.executionId,
      executionRevision: admission.executionRevision,
      passed: status !== 'failed',
      tier: 'llm' as const,
      semanticStatus: 'pass' as const,
      inputCoverage: { complete: true, codes: [] },
      checks: [],
    },
  };
  if (status === 'awaiting_user')
    return prepareCoreSettlement({
      ...common,
      status,
      result: { question: '合成确认问题', planText: '合成计划' },
      generation: { completeness: 'complete', stopReason: 'awaiting_user' },
    });
  if (status === 'failed')
    return prepareCoreSettlement({
      ...common,
      status,
      result: { reason: 'SYNTHETIC_REJECTED_CANDIDATE' },
      generation: { completeness: 'partial', stopReason: 'quality_rejected' },
    });
  return prepareCoreSettlement({
    ...common,
    status,
    result: { summary: '合成已核验结果' },
    generation:
      status === 'partial_success'
        ? { completeness: 'partial', stopReason: 'continuation_limit' }
        : { completeness: 'complete', stopReason: 'end_turn' },
  });
}

describe('core settlement database boundary', () => {
  it('writes status, safe body and verification in the same UPDATE and commits with the identity-only event', async () => {
    const op = settlementOperation();
    const { repo, queries } = fixture();
    expect(await repo.settle(op)).toEqual({ persisted: true });
    const updates = queries.filter((q) => q.sql.startsWith('update'));
    expect(updates).toHaveLength(1);
    const update = updates[0];
    if (!update) throw new Error('missing settlement update');
    for (const field of [
      'status',
      'result',
      'verification_json',
      'verification_passed',
      'failure_level',
      'core_record_version',
      'completed_at',
      'awaiting_question',
      'awaiting_kind',
    ])
      expect(update.sql.split(' where ')[0]).toContain(`\`${field}\` =`);
    expect(update.sql.split(' where ')[1]).toBe(
      "((`tasks`.`external_id` = ? and `tasks`.`user_id` = ?) and `tasks`.`status` = ? and `tasks`.`execution_id` = ? and `tasks`.`execution_revision` = ? and `tasks`.`core_record_version` = ? and JSON_TYPE(`tasks`.`result`) = 'OBJECT' and JSON_TYPE(JSON_EXTRACT(`tasks`.`result`, '$.coreRequirements')) = 'OBJECT')",
    );
    expect(update.params.slice(-6)).toEqual([
      'tsk_synthetic',
      7,
      'executing',
      op.executionId,
      1,
      1,
    ]);
    const jsonValues = update.params
      .filter((p) => typeof p === 'string' && p.startsWith('{'))
      .map((p) => JSON.parse(String(p)));
    expect(jsonValues).toContainEqual({ summary: '合成已核验结果', tickCount: 1 });
    expect(jsonValues).toContainEqual(op.verification);
    expect(update.sql).toContain(
      "JSON_SET(CAST(? AS JSON), '$.coreRequirements', JSON_EXTRACT(`tasks`.`result`, '$.coreRequirements'))",
    );
    const event = queries.find((q) => q.sql.startsWith('insert'));
    if (!event) throw new Error('missing settlement event');
    expect(event.params).toContain('core.settled');
    const payload = event.params.find((p) => typeof p === 'string' && p.startsWith('{'));
    expect(JSON.parse(String(payload))).toEqual({
      status: 'completed',
      executionId: op.executionId,
      executionRevision: 1,
      recordVersion: 2,
      commitId: op.commitId,
    });
    expect(event.params.join(' ')).not.toContain('合成已核验结果');
    expect(queries[0]?.sql).toBe('begin');
    expect(queries.at(-1)?.sql).toBe('commit');
  });

  it('retains no failed candidate in either the result or event and replaces old result content', async () => {
    const { repo, queries } = fixture();
    await repo.settle(settlementOperation('failed'));
    const update = queries.find((q) => q.sql.startsWith('update'));
    if (!update) throw new Error('missing settlement update');
    expect(JSON.stringify(queries)).not.toContain('SYNTHETIC_REJECTED_CANDIDATE');
    expect(update.params).toContain(JSON.stringify({ tickCount: 1, reason: '质量校验未通过' }));
    // Base is the new allowed payload, never JSON_SET(oldResult, ...) retaining an old summary.
    expect(update.sql).toContain('`result` = JSON_SET(CAST(? AS JSON),');
  });

  it.each(['partial_success', 'awaiting_user'] as const)(
    'atomically writes the %s boundary',
    async (status) => {
      const op = settlementOperation(status);
      const { repo, queries } = fixture();
      expect(await repo.settle(op)).toEqual({ persisted: true });
      const update = queries.find((q) => q.sql.startsWith('update'));
      if (!update) throw new Error('missing settlement update');
      expect(update.params).toContain(status);
      expect(update.params).toContain(JSON.stringify(op.verification));
      if (status === 'awaiting_user') {
        expect(update.params).toContain('合成确认问题');
        expect(update.params).toContain('clarification');
      } else expect(op.verificationPassed).toBe(false);
    },
  );

  it.each([{ updateError: true }, { eventError: true }])(
    'rolls back all terminal state when a transaction write fails: %j',
    async (options) => {
      const { repo, queries } = fixture(options);
      const error = await repo.settle(settlementOperation()).catch((value) => value);
      expect(error.message).toBe('CORE_SETTLEMENT_UNCONFIRMED');
      expect(error.cause).toBeUndefined();
      expect(queries.at(-1)?.sql).toBe('rollback');
      expect(queries.some((q) => q.sql === 'commit')).toBe(false);
    },
  );

  it('does not convert a lost commit response into success or definite failure', async () => {
    const { repo, queries } = fixture({ commitError: true });
    await expect(repo.settle(settlementOperation())).rejects.toThrow('CORE_SETTLEMENT_UNCONFIRMED');
    expect(queries.filter((q) => q.sql.startsWith('update'))).toHaveLength(1);
  });

  it('does not insert an event for a refused old execution, cancellation or repeated operation', async () => {
    const op = settlementOperation();
    const { repo, queries } = fixture({ affectedSequence: [1, 0] });
    expect(await repo.settle(op)).toEqual({ persisted: true });
    expect(await repo.settle(op)).toEqual({ persisted: false });
    expect(queries.filter((q) => q.sql.startsWith('insert'))).toHaveLength(1);
    // The SQL guards above, not this transport fixture, decide stale identity in real MySQL.
  });

  it.each([undefined, 2, -1, '1'])(
    'rolls back on an invalid affected row count %j',
    async (affected) => {
      const { repo, queries } = fixture({ affected });
      await expect(repo.settle(settlementOperation())).rejects.toThrow(
        'CORE_SETTLEMENT_WRITE_INVALID',
      );
      expect(queries.at(-1)?.sql).toBe('rollback');
      expect(queries.some((q) => q.sql.startsWith('insert'))).toBe(false);
    },
  );

  it('rolls back when the task internal ID cannot be safely resolved for the event', async () => {
    const { repo, queries } = fixture({ rowId: null });
    await expect(repo.settle(settlementOperation())).rejects.toThrow(
      'CORE_SETTLEMENT_WRITE_INVALID',
    );
    expect(queries.at(-1)?.sql).toBe('rollback');
  });

  it('refuses copied or modified settlement capsules without querying the database', async () => {
    const { repo, queries } = fixture();
    await expect(repo.settle({ ...settlementOperation() })).rejects.toThrow(
      'CORE_SETTLEMENT_INVALID',
    );
    expect(queries).toEqual([]);
  });

  it('reconciles only a scoped execution head plus a four-field receipt, not a body or full verification', async () => {
    const op = settlementOperation();
    const receipt = {
      schemaVersion: 1,
      executionId: op.executionId,
      executionRevision: 1,
      commitId: op.commitId,
    };
    const { repo, queries } = fixture({
      head: ['completed', op.executionId, 1, 2, JSON.stringify(receipt)],
    });
    expect(await repo.readSettlement(scope)).toEqual({
      status: 'completed',
      executionId: op.executionId,
      executionRevision: 1,
      recordVersion: 2,
      commitId: op.commitId,
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]?.params).toEqual(['tsk_synthetic', 7, 1]);
    expect(queries[0]?.sql).not.toContain('`result`');
    expect(queries[0]?.sql).not.toContain('`intent`');
    for (const field of ['schemaVersion', 'executionId', 'executionRevision', 'commitId'])
      expect(queries[0]?.sql).toContain(`'$.${field}'`);
    expect(queries[0]?.sql).not.toContain('select *');
  });

  it('keeps an executing or legacy head readable without a current terminal receipt', async () => {
    expect(
      await fixture({ head: ['executing', 'synthetic_exec', 3, 4, null] }).repo.readSettlement(
        scope,
      ),
    ).toEqual({
      status: 'executing',
      executionId: 'synthetic_exec',
      executionRevision: 3,
      recordVersion: 4,
      commitId: null,
    });
    expect(
      await fixture({ head: ['completed', null, 0, 0, null] }).repo.readSettlement(scope),
    ).toEqual({
      status: 'completed',
      executionId: null,
      executionRevision: 0,
      recordVersion: 0,
      commitId: null,
    });
    expect(await fixture({ head: null }).repo.readSettlement(scope)).toBeNull();
  });

  it.each([
    null,
    '{bad json',
    {},
    {
      schemaVersion: 1,
      executionId: 'other',
      executionRevision: 1,
      commitId: '70c0168e-57e9-491e-bf79-ed0844240316',
    },
  ])('fails closed for missing or invalid current settlement metadata %j', async (receipt) => {
    await expect(
      fixture({ head: ['completed', 'synthetic_exec', 1, 2, receipt] }).repo.readSettlement(scope),
    ).rejects.toThrow('CORE_SETTLEMENT_READ_UNAVAILABLE');
  });

  it('does not expose driver data when a settlement read fails', async () => {
    const client = {
      query: async () => {
        throw new Error('SYNTHETIC_PRIVATE_DB_PARAMETER');
      },
    };
    const db = drizzle(client as unknown as Connection) as unknown as DB;
    const error = await new CoreTaskRepository(db).readSettlement(scope).catch((value) => value);
    expect(error.message).toBe('CORE_SETTLEMENT_READ_UNAVAILABLE');
    expect(error.cause).toBeUndefined();
  });
});
