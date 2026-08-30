import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import * as schema from '../db/schema/index.js';
import { __organizationInvitationServiceInternals } from '../organizations/organization-invitation-service.js';
import { __organizationServiceInternals } from '../organizations/organization-service.js';
import { __projectAccessInternals } from './project-access.js';
import {
  compileSqlBoundary,
  createAffectedRowsOverride,
  createMysqlBoundaryRecorder,
  createMysqlRaceEndpoint,
  createSqlCheckpoint,
  instrumentMysqlConnection,
  matchesSqlBoundary,
  runBoundedCleanup,
  runMysqlLockObserverExecute,
  runWithActiveTimeout,
  sqlInvocation,
} from './team-project-race-harness.js';
import { __teamProjectServiceInternals } from './team-project-service.js';

const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });

function mysqlUtcDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(hour, minute, second, millisecond);
  return value;
}

describe('team project race harness exact SQL boundaries', () => {
  it.each(['query', 'execute'] as const)(
    'holds a matched %s only after the exact SQL and parameters execute',
    async (method) => {
      const compiled = __organizationServiceInternals
        .buildLockOrganizationMembersQuery(mockDb, 41, ['omem_actor_111111111111'])
        .toSQL();
      const boundary = compileSqlBoundary(compiled);
      const connection = {
        query: async (sql: string, parameters: unknown[]) => ({ method: 'query', sql, parameters }),
        execute: async (sql: string, parameters: unknown[]) => ({
          method: 'execute',
          sql,
          parameters,
        }),
      };
      const checkpoint = createSqlCheckpoint({
        label: `${method}-organization-member-lock`,
        phase: 'after',
        matches: (invocation) => matchesSqlBoundary(boundary, invocation),
      });
      const instrumented = instrumentMysqlConnection(connection, [checkpoint]);

      let settled = false;
      const pending = instrumented[method](compiled.sql, compiled.params);
      void pending.finally(() => {
        settled = true;
      });

      await checkpoint.waitUntilReached(250);
      await Promise.resolve();
      expect(settled).toBe(false);

      checkpoint.release();
      await expect(pending).resolves.toEqual({
        method,
        sql: compiled.sql,
        parameters: compiled.params,
      });
    },
  );

  it('rejects wrong tenant parameters, removed tenant predicates, and structurally similar SQL', () => {
    const compiled = __organizationServiceInternals
      .buildLockOrganizationMembersQuery(mockDb, 41, [
        'omem_actor_111111111111',
        'omem_target_222222222222',
      ])
      .toSQL();
    const boundary = compileSqlBoundary(compiled);
    const exact = sqlInvocation('execute', compiled.sql, compiled.params);
    const wrongTenant = sqlInvocation('execute', compiled.sql, [99, ...compiled.params.slice(1)]);
    const tenantUnscopedSql = compiled.sql.replace('`organization_id` = ? and ', '');
    const tenantUnscoped = sqlInvocation('execute', tenantUnscopedSql, compiled.params.slice(1));
    const similar = sqlInvocation(
      'execute',
      'select `id` from `organization_members` where `organization_id` = ? for update',
      [41],
    );

    expect(matchesSqlBoundary(boundary, exact)).toBe(true);
    expect(matchesSqlBoundary(boundary, wrongTenant)).toBe(false);
    expect(matchesSqlBoundary(boundary, tenantUnscoped)).toBe(false);
    expect(matchesSqlBoundary(boundary, similar)).toBe(false);
  });

  it('matches mysql2-encoded dates while allowing only declared generated update timestamps', () => {
    const acceptedAt = '2026-08-30 12:00:00.000';
    const compiledUpdatedAt = '2026-08-30 12:00:00.100';
    const boundary = compileSqlBoundary(
      {
        sql: 'UPDATE `organization_invitations` SET `accepted_at` = ?, `updated_at` = ? WHERE `id` = ? AND `expires_at` > ?',
        params: [acceptedAt, compiledUpdatedAt, 9, acceptedAt],
      },
      { dynamicDateParameterIndexes: [1] },
    );

    expect(
      matchesSqlBoundary(
        boundary,
        sqlInvocation('query', boundary.normalizedSql, [
          '2026-08-30 12:00:00.000',
          '2026-08-30 12:00:00.250',
          9,
          '2026-08-30 12:00:00.000',
        ]),
      ),
    ).toBe(true);
    expect(
      matchesSqlBoundary(
        boundary,
        sqlInvocation('query', boundary.normalizedSql, [
          '2026-08-30 12:00:00.001',
          '2026-08-30 12:00:00.250',
          9,
          '2026-08-30 12:00:00.000',
        ]),
      ),
    ).toBe(false);
    expect(
      matchesSqlBoundary(
        boundary,
        sqlInvocation('query', boundary.normalizedSql, [
          '2026-08-30 12:00:00.000',
          'not-a-runtime-date',
          9,
          '2026-08-30 12:00:00.000',
        ]),
      ),
    ).toBe(false);
  });

  it.each([
    ['year 0001 string', '0001-01-01 00:00:00.000'],
    ['year 0999 string', '0999-12-31 23:59:59.999'],
    ['invalid non-leap day', '2023-02-29 00:00:00.000'],
    ['invalid leap-month day', '2024-02-30 00:00:00.000'],
    ['invalid 30-day month', '2026-04-31 12:00:00.000'],
    ['month zero', '2026-00-01 00:00:00.000'],
    ['month thirteen', '2026-13-01 00:00:00.000'],
    ['day zero', '2026-01-00 00:00:00.000'],
    ['hour twenty-four', '2026-01-01 24:00:00.000'],
    ['year 10000 string', '10000-01-01 00:00:00.000'],
    ['upper-bound .500 string', '9999-12-31 23:59:59.500'],
    ['upper-bound .999 string', '9999-12-31 23:59:59.999'],
    ['year 0999 Date', mysqlUtcDate(999, 12, 31, 23, 59, 59, 999)],
    ['year 10000 Date', mysqlUtcDate(10_000, 1, 1)],
    ['upper-bound .500 Date', mysqlUtcDate(9999, 12, 31, 23, 59, 59, 500)],
    ['upper-bound .999 Date', mysqlUtcDate(9999, 12, 31, 23, 59, 59, 999)],
  ])('rejects %s as a compiled dynamic MySQL DATETIME slot', (_label, value) => {
    expect(() =>
      compileSqlBoundary(
        { sql: 'UPDATE `projects` SET `updated_at` = ?', params: [value] },
        { dynamicDateParameterIndexes: [0] },
      ),
    ).toThrow('dynamic SQL boundary parameter must reference a compiled MySQL date');
  });

  it.each([
    ['year 0001 string', '0001-01-01 00:00:00.000'],
    ['year 0999 string', '0999-12-31 23:59:59.999'],
    ['invalid non-leap day', '2023-02-29 00:00:00.000'],
    ['invalid leap-month day', '2024-02-30 00:00:00.000'],
    ['invalid 30-day month', '2026-04-31 12:00:00.000'],
    ['month zero', '2026-00-01 00:00:00.000'],
    ['month thirteen', '2026-13-01 00:00:00.000'],
    ['day zero', '2026-01-00 00:00:00.000'],
    ['hour twenty-four', '2026-01-01 24:00:00.000'],
    ['year 10000 string', '10000-01-01 00:00:00.000'],
    ['upper-bound .500 string', '9999-12-31 23:59:59.500'],
    ['upper-bound .999 string', '9999-12-31 23:59:59.999'],
    ['year 0999 Date', mysqlUtcDate(999, 12, 31, 23, 59, 59, 999)],
    ['year 10000 Date', mysqlUtcDate(10_000, 1, 1)],
    ['upper-bound .500 Date', mysqlUtcDate(9999, 12, 31, 23, 59, 59, 500)],
    ['upper-bound .999 Date', mysqlUtcDate(9999, 12, 31, 23, 59, 59, 999)],
  ])('rejects %s as a runtime dynamic MySQL DATETIME slot', (_label, value) => {
    const sql = 'UPDATE `projects` SET `updated_at` = ?';
    const boundary = compileSqlBoundary(
      { sql, params: ['2026-08-30 12:00:00.000'] },
      { dynamicDateParameterIndexes: [0] },
    );

    expect(matchesSqlBoundary(boundary, sqlInvocation('query', sql, [value]))).toBe(false);
  });

  it.each([
    ['lower-bound string', '1000-01-01 00:00:00.000'],
    ['valid leap-day string', '2024-02-29 23:59:59.999'],
    ['upper-bound string', '9999-12-31 23:59:59.499'],
    ['lower-bound Date', mysqlUtcDate(1000, 1, 1)],
    ['upper-bound Date', mysqlUtcDate(9999, 12, 31, 23, 59, 59, 499)],
  ])('accepts %s for a declared runtime MySQL DATETIME slot', (_label, value) => {
    const sql = 'UPDATE `projects` SET `updated_at` = ?';
    expect(() =>
      compileSqlBoundary({ sql, params: [value] }, { dynamicDateParameterIndexes: [0] }),
    ).not.toThrow();
    const boundary = compileSqlBoundary(
      { sql, params: ['2026-08-30 12:00:00.000'] },
      { dynamicDateParameterIndexes: [0] },
    );

    expect(matchesSqlBoundary(boundary, sqlInvocation('query', sql, [value]))).toBe(true);
  });

  it('recognizes every compiled production boundary used by invitation, organization, and project races', () => {
    const digest = 'a'.repeat(64);
    const compiledQueries = [
      __organizationInvitationServiceInternals
        .buildLockedActiveEnabledOrganizationByIdQuery(mockDb, 41)
        .toSQL(),
      __organizationInvitationServiceInternals
        .buildLockedInvitationByHashQuery(mockDb, 41, digest)
        .toSQL(),
      __organizationInvitationServiceInternals
        .buildLockedInvitationByExternalIdQuery(mockDb, 41, 'oinv_case_111111111111')
        .toSQL(),
      __organizationInvitationServiceInternals
        .buildLockedActiveActorMembershipQuery(mockDb, 7, 41)
        .toSQL(),
      __organizationServiceInternals
        .buildLockOrganizationMembersQuery(mockDb, 41, [
          'omem_actor_111111111111',
          'omem_target_222222222222',
        ])
        .toSQL(),
      __organizationServiceInternals.buildLockedProjectsQuery(mockDb, 41, [51, 52]).toSQL(),
      __organizationServiceInternals
        .buildLockedActiveProjectMembershipsQuery(mockDb, [51, 52])
        .toSQL(),
      __projectAccessInternals
        .buildProjectAccessSnapshotQuery(mockDb, {
          actorExternalId: 'usr_actor_111111111111',
          projectExternalId: 'prj_case_222222222222',
        })
        .toSQL(),
      __projectAccessInternals
        .buildLockedOrganizationQuery(mockDb, 41, 'org_case_111111111111')
        .toSQL(),
      __projectAccessInternals
        .buildLockedProjectQuery(mockDb, 51, 'prj_case_222222222222', 41)
        .toSQL(),
      __projectAccessInternals
        .buildLockedTargetOrganizationMemberQuery(mockDb, 41, 'omem_target_222222222222')
        .toSQL(),
      __projectAccessInternals.buildLockedProjectMembershipsQuery(mockDb, 51).toSQL(),
      __teamProjectServiceInternals
        .buildActiveTeamOrganizationMembershipQuery(
          mockDb,
          'usr_actor_111111111111',
          'org_case_111111111111',
        )
        .toSQL(),
      __teamProjectServiceInternals
        .buildTeamProjectListQuery(mockDb, 'usr_actor_111111111111', 'org_case_111111111111')
        .toSQL(),
      __teamProjectServiceInternals
        .buildTeamProjectCreatorQuery(mockDb, 'usr_actor_111111111111', 'org_case_111111111111')
        .toSQL(),
      __teamProjectServiceInternals
        .buildLockedTeamOrganizationQuery(mockDb, 'org_case_111111111111')
        .toSQL(),
      __teamProjectServiceInternals.buildActiveProjectMembersQuery(mockDb, 51).toSQL(),
    ];

    const boundaries = compiledQueries.map((query) => compileSqlBoundary(query));
    expect(new Set(boundaries.map((boundary) => boundary.normalizedSql)).size).toBe(
      compiledQueries.length,
    );
    for (const [index, query] of compiledQueries.entries()) {
      const boundary = boundaries[index];
      if (!boundary) throw new Error(`missing compiled boundary at index ${index}`);
      expect(matchesSqlBoundary(boundary, sqlInvocation('execute', query.sql, query.params))).toBe(
        true,
      );
      expect(
        matchesSqlBoundary(
          boundary,
          sqlInvocation('execute', `${query.sql} and 1 = 1`, query.params),
        ),
      ).toBe(false);
    }
  });
});

describe('team project race harness instrumentation', () => {
  it('exposes the recorder-instrumented endpoint for direct transaction and SQL methods', async () => {
    const rawConnection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      query: async (_sql?: unknown, _parameters?: readonly unknown[]) => [[], []] as const,
      execute: async (_sql?: unknown, _parameters?: readonly unknown[]) =>
        [{ affectedRows: 1 }, []] as const,
    };
    const endpoint = createMysqlRaceEndpoint({
      connection: rawConnection,
      checkpoints: [],
      resultOverrides: [],
    });

    await endpoint.connection.beginTransaction();
    await endpoint.connection.execute(
      'UPDATE organizations SET team_projects_enabled = ? WHERE id = ?',
      [false, 41],
    );
    await endpoint.connection.commit();
    await endpoint.connection.beginTransaction();
    await endpoint.connection.query('SELECT id FROM organizations WHERE id = ? FOR UPDATE', [41]);
    await endpoint.connection.rollback();

    expect(endpoint.recorder.transactionActions()).toEqual([
      'begin',
      'commit',
      'begin',
      'rollback',
    ]);
    expect(endpoint.recorder.sqlInvocations()).toEqual([
      expect.objectContaining({ method: 'execute' }),
      expect.objectContaining({ method: 'query' }),
    ]);
  });

  it('records one SQL attempt before delegate settlement and marks its successful outcome', async () => {
    let resolveExecute = (_result: readonly unknown[]): void => {};
    const delegateResult = new Promise<readonly unknown[]>((resolve) => {
      resolveExecute = resolve;
    });
    const recorder = createMysqlBoundaryRecorder();
    const connection = instrumentMysqlConnection(
      {
        execute: async (_sql?: unknown, _parameters?: readonly unknown[]) => delegateResult,
      },
      [],
      [],
      recorder,
    );

    const pending = connection.execute('UPDATE organization_members SET role = ? WHERE id = ?', [
      'member',
      41,
    ]);
    await Promise.resolve();

    expect(recorder.sqlInvocations()).toEqual([
      expect.objectContaining({
        method: 'execute',
        outcome: 'pending',
        parameters: [
          { kind: 'sql-literal', value: 'member' },
          { kind: 'number', value: 41 },
        ],
      }),
    ]);

    resolveExecute([{ affectedRows: 1 }, []]);
    await expect(pending).resolves.toEqual([{ affectedRows: 1 }, []]);
    expect(recorder.sqlInvocations()).toHaveLength(1);
    expect(recorder.sqlInvocations()[0]).toMatchObject({ outcome: 'success' });
  });

  it('reports zero affected rows once only after the matched real update result', async () => {
    const calls: string[] = [];
    const connection = {
      execute: async (sql: string, _parameters?: readonly unknown[]) => {
        calls.push(sql);
        return [{ affectedRows: 1, marker: sql }, []] as const;
      },
    };
    const exactSql = 'UPDATE `organization_members` SET `role` = ? WHERE `id` = ?';
    const boundary = compileSqlBoundary({ sql: exactSql, params: ['member', 7] });
    const override = createAffectedRowsOverride({
      matches: (invocation) => matchesSqlBoundary(boundary, invocation),
      affectedRows: 0,
    });
    const instrumented = instrumentMysqlConnection(connection, [], [override]);

    const first = await instrumented.execute(exactSql, ['member', 7]);
    const second = await instrumented.execute(exactSql, ['member', 7]);

    expect(calls).toEqual([exactSql, exactSql]);
    expect(first[0]).toMatchObject({ affectedRows: 0 });
    expect(second[0]).toMatchObject({ affectedRows: 1 });
  });

  it('records successful transaction boundaries and only sanitized SQL parameters', async () => {
    const recorder = createMysqlBoundaryRecorder();
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      execute: async (_sql?: unknown, _parameters?: readonly unknown[]) =>
        [{ affectedRows: 1 }, []] as const,
    };
    const instrumented = instrumentMysqlConnection(connection, [], [], recorder);

    await instrumented.beginTransaction();
    await instrumented.execute('SELECT ? AS member_id, ? AS secret', [
      'omem_actor_111111111111',
      'sensitive-invitation-value',
    ]);
    await instrumented.commit();
    await instrumented.beginTransaction();
    await instrumented.rollback();

    expect(recorder.transactionActions()).toEqual(['begin', 'commit', 'begin', 'rollback']);
    expect(recorder.sqlInvocations()).toEqual([
      expect.objectContaining({
        parameters: [
          { kind: 'fixture-id', value: 'omem_actor_111111111111' },
          { kind: 'redacted-string', length: 26 },
        ],
      }),
    ]);
    expect(JSON.stringify(recorder.events)).not.toContain('sensitive-invitation-value');
  });

  it('records Drizzle transaction SQL boundaries without treating savepoints as endpoint commits', async () => {
    const recorder = createMysqlBoundaryRecorder();
    const connection = instrumentMysqlConnection(
      {
        query: async (_sql?: unknown, _parameters?: readonly unknown[]) => [[], []] as const,
      },
      [],
      [],
      recorder,
    );

    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION READ ONLY');
    await connection.query('SAVEPOINT sp1');
    await connection.query('ROLLBACK TO SAVEPOINT sp1');
    await connection.query('COMMIT');
    await connection.query('BEGIN');
    await connection.query('ROLLBACK');

    expect(recorder.transactionActions()).toEqual(['begin', 'commit', 'begin', 'rollback']);
  });
});

describe('team project race harness bounded lifecycle', () => {
  it('actively destroys and settles a wedged performance-schema execute', async () => {
    let rejectExecute = (_error: Error): void => {};
    const executeResult = new Promise<never>((_resolve, reject) => {
      rejectExecute = reject;
    });
    let executeCalls = 0;
    let destroyCalls = 0;

    await expect(
      runMysqlLockObserverExecute({
        label: 'performance-schema lock observer',
        execute: () => {
          executeCalls += 1;
          return executeResult;
        },
        destroy: () => {
          destroyCalls += 1;
          rejectExecute(new Error('observer connection destroyed'));
        },
        timeoutMs: 10,
        settleTimeoutMs: 50,
      }),
    ).rejects.toThrow(
      'TASK14_LOCK_OBSERVER_UNSUPPORTED: performance-schema lock observer timed out after 10ms; operation settled after abort',
    );
    expect(executeCalls).toBe(1);
    expect(destroyCalls).toBe(1);
  });

  it('classifies an immediate performance-schema execute rejection as unsupported', async () => {
    await expect(
      runMysqlLockObserverExecute({
        label: 'performance-schema lock observer',
        execute: async () => {
          throw new Error('observer permission revoked');
        },
        destroy: () => undefined,
        timeoutMs: 10,
        settleTimeoutMs: 50,
      }),
    ).rejects.toThrow(
      'TASK14_LOCK_OBSERVER_UNSUPPORTED: performance-schema lock observer failed: observer permission revoked',
    );
  });

  it('actively aborts and observes operation settlement after a timeout', async () => {
    let rejectOperation = (_error: Error): void => {};
    const operation = new Promise<never>((_resolve, reject) => {
      rejectOperation = reject;
    });
    let abortCalls = 0;

    await expect(
      runWithActiveTimeout(operation, {
        label: 'blocked race endpoint',
        timeoutMs: 10,
        settleTimeoutMs: 50,
        onTimeout: () => {
          abortCalls += 1;
          rejectOperation(new Error('connection destroyed'));
        },
      }),
    ).rejects.toThrow('blocked race endpoint timed out after 10ms; operation settled after abort');
    expect(abortCalls).toBe(1);
  });

  it('bounds and reports both abort and operation-settlement failures', async () => {
    const startedAt = Date.now();
    await expect(
      runWithActiveTimeout(new Promise<never>(() => {}), {
        label: 'wedged endpoint',
        timeoutMs: 5,
        settleTimeoutMs: 15,
        onTimeout: async () => {
          throw new Error('destroy failed');
        },
      }),
    ).rejects.toThrow(
      'wedged endpoint timed out after 5ms; abort failed: destroy failed; operation did not settle within 15ms',
    );
    expect(Date.now() - startedAt).toBeLessThan(250);
  });

  it('runs every cleanup action with a bound and reports failures without swallowing them', async () => {
    const calls: string[] = [];
    await expect(
      runBoundedCleanup(
        [
          {
            label: 'release checkpoint',
            run: () => {
              calls.push('release');
            },
          },
          {
            label: 'rollback manual transaction',
            run: async () => {
              calls.push('rollback');
              throw new Error('rollback rejected');
            },
          },
          {
            label: 'close admin',
            run: () => new Promise<never>(() => {}),
          },
        ],
        15,
      ),
    ).rejects.toThrow(
      'cleanup failures: rollback manual transaction failed: rollback rejected; close admin timed out after 15ms',
    );
    expect(calls).toEqual(['release', 'rollback']);
  });

  it('re-observes a cleanup action that fulfills after its timeout handler aborts it', async () => {
    let resolveAction = (): void => {};
    const action = new Promise<void>((resolve) => {
      resolveAction = resolve;
    });

    await expect(
      runBoundedCleanup(
        [
          {
            label: 'late successful close',
            run: () => action,
            onTimeout: resolveAction,
          },
        ],
        10,
      ),
    ).rejects.toThrow(
      'cleanup failures: late successful close timed out after 10ms; late successful close settled after timeout handler',
    );
  });

  it('re-observes and reports a cleanup action that rejects after its timeout handler aborts it', async () => {
    let rejectAction = (_error: Error): void => {};
    const action = new Promise<void>((_resolve, reject) => {
      rejectAction = reject;
    });

    await expect(
      runBoundedCleanup(
        [
          {
            label: 'late rejected rollback',
            run: () => action,
            onTimeout: () => rejectAction(new Error('rollback rejected after destroy')),
          },
        ],
        10,
      ),
    ).rejects.toThrow(
      'cleanup failures: late rejected rollback timed out after 10ms; late rejected rollback rejected after timeout handler: rollback rejected after destroy',
    );
  });

  it('reports when a timed-out cleanup action remains pending after its timeout handler', async () => {
    await expect(
      runBoundedCleanup(
        [
          {
            label: 'permanently wedged admin close',
            run: () => new Promise<never>(() => {}),
            onTimeout: () => undefined,
          },
        ],
        10,
      ),
    ).rejects.toThrow(
      'cleanup failures: permanently wedged admin close timed out after 10ms; permanently wedged admin close did not settle within 10ms after timeout handler',
    );
  });

  it('destroys an endpoint when graceful close rejects and still reports both failures', async () => {
    let destroyCalls = 0;
    await expect(
      runBoundedCleanup(
        [
          {
            label: 'close endpoint',
            run: async () => {
              throw new Error('end rejected');
            },
            onFailure: () => {
              destroyCalls += 1;
              throw new Error('destroy rejected');
            },
          },
        ],
        15,
      ),
    ).rejects.toThrow(
      'cleanup failures: close endpoint failed: end rejected; close endpoint failure handler failed: destroy rejected',
    );
    expect(destroyCalls).toBe(1);
  });

  it('releases a checkpoint in finally when an observer fails', async () => {
    const checkpoint = createSqlCheckpoint({
      label: 'observer-finally',
      phase: 'before',
      matches: () => true,
    });
    const pending = checkpoint.notify('before', sqlInvocation('query', 'SELECT 1'));
    await checkpoint.waitUntilReached(50);

    await expect(
      (async () => {
        try {
          throw new Error('observer unavailable');
        } finally {
          checkpoint.release();
        }
      })(),
    ).rejects.toThrow('observer unavailable');
    await expect(pending).resolves.toBeUndefined();
  });
});
