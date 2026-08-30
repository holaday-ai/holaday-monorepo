import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema/index.js';
import {
  createTeamProjectInsertIdCapture,
  matchesCreatorLeadInsertInvocation,
} from './team-project-persistence-harness.js';
import {
  createAffectedRowsOverride,
  createMysqlBoundaryRecorder,
  instrumentMysqlConnection,
  sqlInvocation,
} from './team-project-race-harness.js';
import { __teamProjectServiceInternals } from './team-project-service.js';

const compileDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });

describe('team project persistence creator-lead harness', () => {
  it('captures the authoritative project id from the real production-derived project insert result', async () => {
    const capture = createTeamProjectInsertIdCapture({
      actorUserId: 17,
      organizationId: 30,
      name: 'Launch',
      description: null,
    });
    const compiled = __teamProjectServiceInternals
      .buildTeamProjectInsert(compileDb, {
        externalId: 'prj_ABCDEFGHJKLMNPQRSTUV2',
        userId: 17,
        organizationId: 30,
        name: 'Launch',
        description: null,
      })
      .toSQL();
    const execute = vi.fn(
      async (_sql?: unknown, _parameters?: readonly unknown[]) =>
        [{ affectedRows: 1, insertId: 81 }, []] as const,
    );
    const connection = instrumentMysqlConnection({ execute }, [], [capture]);

    expect(capture.projectId()).toBeUndefined();
    await connection.execute(compiled.sql, compiled.params);

    expect(execute).toHaveBeenCalledOnce();
    expect(capture.projectId()).toBe(81);
    expect(capture.requireProjectId()).toBe(81);
  });

  it('overrides only the real creator-lead INSERT result and records a rollback', async () => {
    const actorUserId = 17;
    const projectId = 81;
    const compiled = __teamProjectServiceInternals
      .buildTeamProjectCreatorMembershipInsert(compileDb, {
        externalId: 'pmem_ABCDEFGHJKLMNPQRSTUV2',
        projectId,
        userId: actorUserId,
      })
      .toSQL();
    const execute = vi.fn(
      async (_sql?: unknown, _parameters?: readonly unknown[]) =>
        [{ affectedRows: 1, insertId: 91 }, []] as const,
    );
    const recorder = createMysqlBoundaryRecorder();
    const override = createAffectedRowsOverride({
      matches: (invocation) =>
        matchesCreatorLeadInsertInvocation(invocation, { actorUserId, projectId }),
      affectedRows: 0,
    });
    const connection = instrumentMysqlConnection(
      {
        beginTransaction: async () => undefined,
        rollback: async () => undefined,
        execute,
      },
      [],
      [override],
      recorder,
    );

    await connection.beginTransaction();
    const result = await connection.execute(compiled.sql, compiled.params);
    await connection.rollback();

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(compiled.sql, compiled.params);
    expect(result[0]).toMatchObject({ affectedRows: 0, insertId: 91 });
    expect(recorder.transactionActions()).toEqual(['begin', 'rollback']);
    expect(recorder.sqlInvocations()).toEqual([
      expect.objectContaining({
        parameters: [
          { kind: 'generated-external-id', prefix: 'pmem', length: 26 },
          { kind: 'number', value: 81 },
          { kind: 'number', value: actorUserId },
          { kind: 'sql-literal', value: 'lead' },
          { kind: 'sql-literal', value: 'active' },
        ],
      }),
    ]);
  });

  it('rejects mutated, wrong-user, wrong-role, and non-insert invocations', () => {
    const actorUserId = 17;
    const projectId = 81;
    const compiled = __teamProjectServiceInternals
      .buildTeamProjectCreatorMembershipInsert(compileDb, {
        externalId: 'pmem_ABCDEFGHJKLMNPQRSTUV2',
        projectId,
        userId: actorUserId,
      })
      .toSQL();
    const matches = (sql: string, parameters: readonly unknown[]) =>
      matchesCreatorLeadInsertInvocation(sqlInvocation('execute', sql, parameters), {
        actorUserId,
        projectId,
      });

    expect(matches(compiled.sql, compiled.params)).toBe(true);
    expect(matches(`${compiled.sql} ON DUPLICATE KEY UPDATE status = ?`, compiled.params)).toBe(
      false,
    );
    expect(
      matches(
        compiled.sql,
        compiled.params.map((value, index) => (index === 1 ? 82 : value)),
      ),
    ).toBe(false);
    expect(
      matches(
        compiled.sql,
        compiled.params.map((value, index) => (index === 2 ? 99 : value)),
      ),
    ).toBe(false);
    expect(
      matches(
        compiled.sql,
        compiled.params.map((value, index) => (index === 3 ? 'member' : value)),
      ),
    ).toBe(false);
    expect(matches('SELECT 1', [])).toBe(false);
  });
});
