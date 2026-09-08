import { drizzle } from 'drizzle-orm/mysql2';
import type { Connection } from 'mysql2/promise';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '../db/client.js';
import {
  type CoreAdmission,
  type CoreTaskHead,
  prepareCoreAdmission,
} from './core-task-admission.js';
import { persistCoreSettlement, recoverCoreAdmission } from './core-task-recovery.js';
import { CoreTaskRepository } from './core-task-repository.js';
import { type CoreSettlement, prepareCoreSettlement } from './core-task-settlement.js';

const legacy: CoreTaskHead = {
  status: 'awaiting_user',
  executionId: null,
  executionRevision: 0,
  recordVersion: 0,
};
function admission() {
  return prepareCoreAdmission({
    scope: { taskId: 'tsk_synthetic', userId: 7 },
    before: legacy,
    requirements: {
      initialRequest: '整理合成资料',
      userTurns: ['合成修改'],
      phase: 'revise',
      workflow: null,
      referencePlan: null,
      fileIds: [],
    },
  });
}
function settlement(op: CoreAdmission = admission()) {
  return prepareCoreSettlement({
    admission: op,
    status: 'completed',
    result: { summary: '合成结果' },
    generation: { completeness: 'complete', stopReason: 'end_turn' },
    verification: {
      taskId: op.scope.taskId,
      executionId: op.executionId,
      executionRevision: op.executionRevision,
      passed: true,
      tier: 'llm',
      semanticStatus: 'pass',
      inputCoverage: { complete: true, codes: [] },
      checks: [],
    },
  });
}
function unsettledHead(op: CoreSettlement) {
  return {
    status: 'executing',
    executionId: op.executionId,
    executionRevision: op.executionRevision,
    recordVersion: op.expectedRecordVersion,
    commitId: null,
  };
}
function committed(op: CoreSettlement) {
  return {
    ...unsettledHead(op),
    status: op.status,
    recordVersion: op.recordVersion,
    commitId: op.commitId,
  };
}
const fault = () => {
  throw new Error('SYNTHETIC_PRIVATE_DRIVER_DETAIL');
};
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('not initialized');
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
type Read = Awaited<ReturnType<CoreTaskRepository['readSettlement']>>;
type Write = { persisted: boolean };
type Step<T> = T | (() => T | Promise<T>);

// These are database-port fault scripts for coordinator timing. The real SQL/
// transaction composition is covered separately below, never claimed as real MySQL.
function script(reads: Step<Read>[], writes: Step<Write>[] = [fault]) {
  const trace: Array<{ action: 'read' | 'write'; at: number; operation?: CoreSettlement }> = [];
  const next = async <T>(steps: Step<T>[]) => {
    const step = steps.shift();
    if (step === undefined) throw new Error('unexpected extra database attempt');
    return typeof step === 'function' ? await (step as () => T | Promise<T>)() : step;
  };
  return {
    trace,
    repo: {
      settle: async (op: CoreSettlement) => {
        trace.push({ action: 'write', at: Date.now(), operation: op });
        return next(writes);
      },
      readSettlement: async () => {
        trace.push({ action: 'read', at: Date.now() });
        return next(reads);
      },
    },
  };
}
async function finish<T>(promise: Promise<T>) {
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('bounded admission recovery', () => {
  it('recognizes accepted requirements without dispatching or resubmitting admission', async () => {
    const op = admission();
    const calls: number[] = [];
    const repo = {
      readHead: async () => {
        calls.push(Date.now());
        return {
          status: 'executing',
          executionId: op.executionId,
          executionRevision: 1,
          recordVersion: 1,
        };
      },
      admit: async () => {
        throw new Error('must never resubmit an admission');
      },
    };
    const pending = recoverCoreAdmission(repo, op);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toEqual([]);
    expect(await finish(pending)).toEqual({ kind: 'committed', dispatchAllowed: false });
    expect(calls).toEqual([1000]);
  });

  it('reports the exact unchanged previous head as not committed without resubmission', async () => {
    expect(
      await finish(recoverCoreAdmission({ readHead: async () => legacy }, admission())),
    ).toEqual({ kind: 'not_committed', dispatchAllowed: false });
  });

  it.each(['cancelled', 'paused'])('stops for a %s task without retrying', async (status) => {
    const op = admission();
    expect(
      await finish(
        recoverCoreAdmission(
          {
            readHead: async () => ({
              status,
              executionId: op.executionId,
              executionRevision: 1,
              recordVersion: 1,
            }),
          },
          op,
        ),
      ),
    ).toEqual({ kind: 'stale', dispatchAllowed: false });
  });

  it('does not confuse a newer admitted execution with the original admission', async () => {
    expect(
      await finish(
        recoverCoreAdmission(
          {
            readHead: async () => ({
              status: 'executing',
              executionId: 'later_exec',
              executionRevision: 2,
              recordVersion: 3,
            }),
          },
          admission(),
        ),
      ),
    ).toEqual({ kind: 'stale', dispatchAllowed: false });
  });

  it('recognizes its admitted round even when that round already reached an awaiting boundary', async () => {
    const op = admission();
    expect(
      await finish(
        recoverCoreAdmission(
          {
            readHead: async () => ({
              status: 'awaiting_user',
              executionId: op.executionId,
              executionRevision: 1,
              recordVersion: 2,
            }),
          },
          op,
        ),
      ),
    ).toEqual({ kind: 'committed', dispatchAllowed: false });
  });

  it('retries only a read failure, at 1 second then 3 seconds, without exposing the error', async () => {
    const op = admission();
    const calls: number[] = [];
    const repo = {
      readHead: async () => {
        calls.push(Date.now());
        if (calls.length === 1) return fault();
        return {
          status: 'executing',
          executionId: op.executionId,
          executionRevision: 1,
          recordVersion: 1,
        };
      },
    };
    expect(await finish(recoverCoreAdmission(repo, op))).toEqual({
      kind: 'committed',
      dispatchAllowed: false,
    });
    expect(calls).toEqual([1000, 4000]);
  });

  it('bounds repeated recovery calls to the same two reads and preserves unknown', async () => {
    const calls: number[] = [];
    const op = admission();
    const repo = {
      readHead: async () => {
        calls.push(Date.now());
        return fault();
      },
    };
    const first = recoverCoreAdmission(repo, op);
    const second = recoverCoreAdmission(repo, op);
    expect(await finish(first)).toEqual({ kind: 'unknown', dispatchAllowed: false });
    expect(await second).toEqual({ kind: 'unknown', dispatchAllowed: false });
    expect(await finish(recoverCoreAdmission(repo, op))).toEqual({
      kind: 'unknown',
      dispatchAllowed: false,
    });
    expect(calls).toEqual([1000, 4000]);
  });

  it('ends a never-returning read at the shared deadline without waiting forever', async () => {
    const gate = deferred<CoreTaskHead | null>();
    const calls: number[] = [];
    const pending = recoverCoreAdmission(
      {
        readHead: () => {
          calls.push(Date.now());
          return gate.promise;
        },
      },
      admission(),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toEqual({ kind: 'unknown', dispatchAllowed: false });
    expect(calls).toEqual([1000]);
    gate.resolve(legacy);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects copied admission operations before reading any state', async () => {
    let reads = 0;
    await expect(
      recoverCoreAdmission(
        {
          readHead: async () => {
            reads++;
            return legacy;
          },
        },
        { ...admission() },
      ),
    ).rejects.toThrow('CORE_ADMISSION_INVALID');
    expect(reads).toBe(0);
  });
});

/** State lives below the actual Drizzle transaction and actual repository.
 * This deliberately small transport decodes emitted SET/WHERE parameters;
 * it is not a MySQL engine or a substitute for the isolated DB release gate.
 */
function transactionalTransport(
  commitFaults: Array<'ok' | 'before' | 'after' | (() => Promise<void>)>,
) {
  type Row = Record<string, unknown> & {
    result: Record<string, unknown>;
    verification_json: Record<string, unknown> | null;
  };
  let row: Row = {
    external_id: 'tsk_synthetic',
    user_id: 7,
    status: 'awaiting_user',
    execution_id: null,
    execution_revision: 0,
    core_record_version: 0,
    result: {},
    verification_json: null,
  };
  let staged: Row | null = null;
  let stagedEvents: unknown[] = [];
  const events: unknown[] = [];
  const queries: string[] = [];
  const client = {
    query: async (query: { sql: string }, params: unknown[] = []) => {
      const sql = query.sql;
      queries.push(sql);
      const header = [{ affectedRows: 1, insertId: 19 }, []];
      if (sql === 'begin') {
        staged = structuredClone(row);
        stagedEvents = [];
        return header;
      }
      if (sql === 'rollback') {
        staged = null;
        stagedEvents = [];
        return header;
      }
      if (sql === 'commit') {
        const behavior = commitFaults.shift();
        if (behavior === 'before') return fault();
        if (typeof behavior === 'function') await behavior();
        if (!staged) throw new Error('missing transaction');
        row = staged;
        staged = null;
        events.push(...stagedEvents);
        stagedEvents = [];
        if (behavior === 'after') return fault();
        return header;
      }
      if (sql.startsWith('update')) {
        if (!staged) throw new Error('write outside transaction');
        const [set = '', where = ''] = sql.split(' where ');
        const assignments = [...set.matchAll(/`([a-z_]+)` = /g)];
        let consumed = 0;
        const values: Record<string, unknown> = {};
        for (let i = 0; i < assignments.length; i++) {
          const match = assignments[i];
          if (!match?.[1]) throw new Error('missing assignment');
          const fragment = set.slice(match.index, assignments[i + 1]?.index ?? set.length);
          const count = (fragment.match(/\?/g) ?? []).length;
          if (count === 1) values[match[1]] = params[consumed];
          else if (count !== 0) throw new Error('unsupported multi-parameter assignment');
          consumed += count;
        }
        const guards = [...where.matchAll(/`tasks`\.`([a-z_]+)` = \?/g)];
        const matches =
          guards.every((match, i) => staged?.[match[1] ?? ''] === params[consumed + i]) &&
          (!where.includes('`tasks`.`execution_id` is null') || staged.execution_id === null);
        if (!matches) return [{ affectedRows: 0, insertId: 0 }, []];
        const payload = JSON.parse(String(values.result));
        values.result = set.includes('COALESCE')
          ? { ...staged.result, coreRequirements: payload }
          : { ...payload, coreRequirements: staged.result.coreRequirements };
        if (values.verification_json !== undefined)
          values.verification_json = JSON.parse(String(values.verification_json));
        staged = { ...staged, ...values };
        return header;
      }
      if (sql.startsWith('select `id`')) return [[[19]], []];
      if (sql.startsWith('select')) {
        if (params[0] !== row.external_id || params[1] !== row.user_id) return [[], []];
        const head = [
          row.status,
          row.execution_id,
          row.execution_revision,
          row.core_record_version,
        ];
        if (sql.includes('JSON_OBJECT')) {
          const verification = row.verification_json;
          head.push(
            verification && row.status !== 'executing'
              ? JSON.stringify({
                  schemaVersion: verification.schemaVersion,
                  executionId: verification.executionId,
                  executionRevision: verification.executionRevision,
                  commitId: verification.commitId,
                })
              : null,
          );
        }
        return [[head], []];
      }
      if (sql.startsWith('insert')) {
        if (!staged) throw new Error('event outside transaction');
        const payload = params.find((value) => typeof value === 'string' && value.startsWith('{'));
        stagedEvents.push(JSON.parse(String(payload)));
        return header;
      }
      throw new Error('unexpected SQL');
    },
  };
  const db = drizzle(client as unknown as Connection) as unknown as DB;
  return { repo: new CoreTaskRepository(db), events, queries, state: () => structuredClone(row) };
}

describe('recovery through the real repository transaction', () => {
  it('recognizes a genuinely committed admission after the transport loses its commit response', async () => {
    const op = admission();
    const db = transactionalTransport(['after']);
    await expect(db.repo.admit(op)).rejects.toThrow('CORE_ADMISSION_UNCONFIRMED');
    expect(db.state().result.coreRequirements).toEqual(op.requirements);
    expect(await finish(recoverCoreAdmission(db.repo, op))).toEqual({
      kind: 'committed',
      dispatchAllowed: false,
    });
    expect(db.events).toHaveLength(1);
    expect(db.queries.filter((sql) => sql.startsWith('update'))).toHaveLength(1);
  });

  it('recognizes a committed result after response loss without writing the body or event again', async () => {
    const op = admission();
    const db = transactionalTransport(['ok', 'after']);
    await db.repo.admit(op);
    const candidate = settlement(op);
    expect(await finish(persistCoreSettlement(db.repo, candidate))).toEqual({ kind: 'committed' });
    expect(db.state().result.summary).toBe('合成结果');
    expect(db.state().verification_json?.commitId).toBe(candidate.commitId);
    expect(db.events).toHaveLength(2); // One admission and one settlement, not two settlements.
    expect(db.queries.filter((sql) => sql.startsWith('update'))).toHaveLength(2);
    expect(db.queries.some((sql) => sql === 'rollback')).toBe(true); // After-commit rollback cannot undo commit.
  });

  it('retries after a real transaction rollback and commits exactly one terminal event', async () => {
    const op = admission();
    const db = transactionalTransport(['ok', 'before', 'ok']);
    await db.repo.admit(op);
    const candidate = settlement(op);
    expect(await finish(persistCoreSettlement(db.repo, candidate))).toEqual({ kind: 'committed' });
    expect(db.state().verification_json?.commitId).toBe(candidate.commitId);
    expect(db.events).toHaveLength(2);
    expect(db.queries.filter((sql) => sql.startsWith('update'))).toHaveLength(3);
    expect(db.queries.filter((sql) => sql === 'rollback')).toHaveLength(1);
  });

  it('allows a late database commit without turning the previously returned unknown into success', async () => {
    const op = admission();
    const gate = deferred<void>();
    const db = transactionalTransport(['ok', () => gate.promise]);
    await db.repo.admit(op);
    const candidate = settlement(op);
    const pending = persistCoreSettlement(db.repo, candidate);
    await vi.advanceTimersByTimeAsync(15_000);
    const outcome = await pending;
    expect(outcome).toEqual({ kind: 'unknown' });
    expect(db.events).toHaveLength(1);
    gate.resolve();
    await vi.runAllTimersAsync();
    expect(db.state().verification_json?.commitId).toBe(candidate.commitId);
    expect(db.events).toHaveLength(2);
    expect(outcome).toEqual({ kind: 'unknown' });
    expect(await persistCoreSettlement(db.repo, candidate)).toEqual({ kind: 'unknown' });
    expect(db.queries.filter((sql) => sql.startsWith('update'))).toHaveLength(2);
  });
});

describe('bounded settlement persistence', () => {
  it.each(['initial_write', 'retry_write', 'settlement_read', 'admission_read'] as const)(
    'rechecks the deadline when resuming from a confirmed %s',
    async (phase) => {
      let now = 0;
      let writes = 0;
      let reads = 0;
      const accepted = admission();
      const candidate = settlement(accepted);
      const crossDeadlineAfterResolution = <T>(value: T) => {
        // The adapter resolves in time, but another microtask holds the event
        // loop past the deadline before the recovery coordinator resumes.
        queueMicrotask(() =>
          queueMicrotask(() => {
            now = 15_001;
          }),
        );
        return Promise.resolve(value);
      };
      const clock = { now: () => now };
      const pending =
        phase === 'admission_read'
          ? recoverCoreAdmission(
              {
                readHead: () => {
                  reads++;
                  return crossDeadlineAfterResolution({
                    status: 'executing',
                    executionId: accepted.executionId,
                    executionRevision: accepted.executionRevision,
                    recordVersion: accepted.recordVersion,
                  });
                },
              },
              accepted,
              clock,
            )
          : persistCoreSettlement(
              {
                settle: () => {
                  writes++;
                  if (phase === 'initial_write' || (phase === 'retry_write' && writes === 2))
                    return crossDeadlineAfterResolution({ persisted: true });
                  return Promise.reject(new Error('SYNTHETIC_UNCONFIRMED'));
                },
                readSettlement: () => {
                  reads++;
                  return phase === 'settlement_read'
                    ? crossDeadlineAfterResolution(committed(candidate))
                    : Promise.resolve(unsettledHead(candidate));
                },
              },
              candidate,
              clock,
            );
      expect(await finish(pending)).toEqual(
        phase === 'admission_read'
          ? { kind: 'unknown', dispatchAllowed: false }
          : { kind: 'unknown' },
      );
      expect(writes).toBe(phase === 'admission_read' ? 0 : phase === 'retry_write' ? 2 : 1);
      expect(reads).toBe(phase === 'initial_write' ? 0 : 1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not start database work if the event loop crosses the deadline before the queued action runs', async () => {
    let now = 0;
    const { repo, trace } = script([], [{ persisted: true }]);
    const pending = persistCoreSettlement(repo, settlement(), { now: () => now });
    now = 15_001;
    expect(await finish(pending)).toEqual({ kind: 'unknown' });
    expect(trace).toEqual([]);
  });

  it('aborts a stalled cancellable wait when its shared deadline ends', async () => {
    const { repo, trace } = script([]);
    let aborted = false;
    const pending = persistCoreSettlement(repo, settlement(), {
      wait: async (_ms, signal) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
          },
          { once: true },
        );
        return new Promise<void>(() => {});
      },
    });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toEqual({ kind: 'unknown' });
    expect(aborted).toBe(true);
    expect(trace.map((item) => item.action)).toEqual(['write']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not declare an inconsistent status with the exact commitId to be an unrelated winning commit', async () => {
    const op = settlement();
    const inconsistent = { ...committed(op), status: 'failed' };
    const { repo } = script([inconsistent, inconsistent]);
    expect(await finish(persistCoreSettlement(repo, op))).toEqual({ kind: 'unknown' });
  });

  it.each([
    {},
    [],
    { ...legacy, commitId: null },
    {
      status: 'executing',
      executionId: null,
      executionRevision: 1,
      recordVersion: 1,
      commitId: null,
    },
  ])('does not retry on malformed or regressed state %j', async (head) => {
    const { repo, trace } = script([head as Read, head as Read]);
    expect(await finish(persistCoreSettlement(repo, settlement()))).toEqual({ kind: 'unknown' });
    expect(trace.filter((item) => item.action === 'write')).toHaveLength(1);
  });
  it('reports a normal confirmed write without a recovery read', async () => {
    const { repo, trace } = script([], [{ persisted: true }]);
    expect(await finish(persistCoreSettlement(repo, settlement()))).toEqual({ kind: 'committed' });
    expect(trace.map(({ action, at }) => ({ action, at }))).toEqual([{ action: 'write', at: 0 }]);
  });

  it.each([fault, { persisted: false }])(
    'reads its exact receipt after an uncertain or refused write',
    async (write) => {
      const op = settlement();
      const { repo, trace } = script([committed(op)], [write]);
      expect(await finish(persistCoreSettlement(repo, op))).toEqual({ kind: 'committed' });
      expect(trace.map(({ action, at }) => ({ action, at }))).toEqual([
        { action: 'write', at: 0 },
        { action: 'read', at: 1000 },
      ]);
    },
  );

  it('retries the same capsule only after an authoritative unchanged head', async () => {
    const op = settlement();
    const { repo, trace } = script(
      [unsettledHead(op), unsettledHead(op)],
      [fault, fault, { persisted: true }],
    );
    expect(await finish(persistCoreSettlement(repo, op))).toEqual({ kind: 'committed' });
    expect(trace.map(({ action, at }) => ({ action, at }))).toEqual([
      { action: 'write', at: 0 },
      { action: 'read', at: 1000 },
      { action: 'write', at: 2000 },
      { action: 'read', at: 5000 },
      { action: 'write', at: 8000 },
    ]);
    expect(
      trace.filter((item) => item.action === 'write').every((item) => item.operation === op),
    ).toBe(true);
  });

  it('does not call an unresolved retry not_committed using the old pre-write snapshot', async () => {
    const op = settlement();
    const { repo, trace } = script([unsettledHead(op), unsettledHead(op)], [fault, fault, fault]);
    expect(await finish(persistCoreSettlement(repo, op))).toEqual({ kind: 'unknown' });
    expect(trace.filter((item) => item.action === 'read')).toHaveLength(2);
    expect(trace.filter((item) => item.action === 'write')).toHaveLength(3);
  });

  it('never writes again when both authoritative reads fail', async () => {
    const { repo, trace } = script([fault, fault]);
    expect(await finish(persistCoreSettlement(repo, settlement()))).toEqual({ kind: 'unknown' });
    expect(trace.map(({ action, at }) => ({ action, at }))).toEqual([
      { action: 'write', at: 0 },
      { action: 'read', at: 1000 },
      { action: 'read', at: 4000 },
    ]);
  });

  it.each(['cancelled', 'paused'])('does not overwrite a %s task', async (status) => {
    const op = settlement();
    const { repo, trace } = script([{ ...unsettledHead(op), status }]);
    expect(await finish(persistCoreSettlement(repo, op))).toEqual({ kind: 'stale' });
    expect(trace.filter((item) => item.action === 'write')).toHaveLength(1);
  });

  it('does not accept the same status from a different result commit', async () => {
    const op = settlement();
    const other = settlement();
    const { repo, trace } = script([{ ...committed(op), commitId: other.commitId }]);
    expect(await finish(persistCoreSettlement(repo, op))).toEqual({ kind: 'stale' });
    expect(trace.filter((item) => item.action === 'write')).toHaveLength(1);
  });

  it('refuses an old operation when a newer execution is current', async () => {
    const op = settlement();
    const { repo } = script([
      {
        ...unsettledHead(op),
        executionRevision: 2,
        recordVersion: 3,
        executionId: 'new_execution',
      },
    ]);
    expect(await finish(persistCoreSettlement(repo, op))).toEqual({ kind: 'stale' });
  });

  it('treats an ID conflict within the same revision as unknown, not a successful receipt', async () => {
    const op = settlement();
    const conflict = { ...committed(op), executionId: 'conflicting_execution' };
    const { repo, trace } = script([conflict, conflict]);
    expect(await finish(persistCoreSettlement(repo, op))).toEqual({ kind: 'unknown' });
    expect(trace.filter((item) => item.action === 'write')).toHaveLength(1);
  });

  it('does not accept a matching commitId when the final status or record version differs', async () => {
    const op = settlement();
    const inconsistent = { ...committed(op), recordVersion: 0 };
    const { repo } = script([inconsistent, inconsistent]);
    expect(await finish(persistCoreSettlement(repo, op))).toEqual({ kind: 'unknown' });
  });

  it('shares the initial write and recovery budget across concurrent and repeated calls', async () => {
    const op = settlement();
    const { repo, trace } = script([unsettledHead(op)], [fault, { persisted: true }]);
    const first = persistCoreSettlement(repo, op);
    const second = persistCoreSettlement(repo, op);
    expect(await finish(first)).toEqual({ kind: 'committed' });
    expect(await second).toEqual({ kind: 'committed' });
    expect(await finish(persistCoreSettlement(repo, op))).toEqual({ kind: 'committed' });
    expect(trace.filter((item) => item.action === 'write')).toHaveLength(2);
  });

  it('cannot hang forever or start a concurrent retry while the initial write is pending', async () => {
    const op = settlement();
    const gate = deferred<Write>();
    const { repo, trace } = script([], [() => gate.promise]);
    const pending = persistCoreSettlement(repo, op);
    await vi.advanceTimersByTimeAsync(14_999);
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ kind: 'unknown' });
    gate.resolve({ persisted: true });
    await vi.runAllTimersAsync();
    expect(await persistCoreSettlement(repo, op)).toEqual({ kind: 'unknown' });
    expect(trace.map((item) => item.action)).toEqual(['write']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares a deadline across a slow failed write and a stalled recovery read', async () => {
    const op = settlement();
    const readGate = deferred<Read>();
    const { repo, trace } = script(
      [() => readGate.promise],
      [
        () =>
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('SYNTHETIC_SLOW_WRITE')), 12_000),
          ),
      ],
    );
    const pending = persistCoreSettlement(repo, op);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toEqual({ kind: 'unknown' });
    expect(trace.map(({ action, at }) => ({ action, at }))).toEqual([
      { action: 'write', at: 0 },
      { action: 'read', at: 13_000 },
    ]);
  });

  it('returns the fresh not_committed observation when there is no time for the next retry delay', async () => {
    const op = settlement();
    const { repo, trace } = script([
      () => new Promise((resolve) => setTimeout(() => resolve(unsettledHead(op)), 13_500)),
    ]);
    expect(await finish(persistCoreSettlement(repo, op))).toEqual({ kind: 'not_committed' });
    expect(Date.now()).toBe(14_500);
    expect(trace.filter((item) => item.action === 'write')).toHaveLength(1);
  });

  it('does not restart the budget after a retry begins near its deadline', async () => {
    const op = settlement();
    const writeGate = deferred<Write>();
    const { repo, trace } = script(
      [unsettledHead(op)],
      [
        () =>
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('SYNTHETIC_SLOW_WRITE')), 10_000),
          ),
        () => writeGate.promise,
      ],
    );
    const pending = persistCoreSettlement(repo, op);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toEqual({ kind: 'unknown' });
    expect(trace.map(({ action, at }) => ({ action, at }))).toEqual([
      { action: 'write', at: 0 },
      { action: 'read', at: 11_000 },
      { action: 'write', at: 12_000 },
    ]);
  });

  it('rejects a copied settlement before attempting database IO', async () => {
    const { repo, trace } = script([]);
    await expect(persistCoreSettlement(repo, { ...settlement() })).rejects.toThrow(
      'CORE_SETTLEMENT_INVALID',
    );
    expect(trace).toEqual([]);
  });
});
