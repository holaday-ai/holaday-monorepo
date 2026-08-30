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
