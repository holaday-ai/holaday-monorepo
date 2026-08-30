import { describe, expect, it, vi } from 'vitest';
import {
  PROJECT_TASK_FOREIGN_KEY_QUERY,
  type ProjectTaskForeignKeyRow,
  TEAM_PROJECTS_EMPTY_TABLES_QUERY,
  TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY,
  TEAM_PROJECTS_ISOLATION_QUERY,
  TEAM_PROJECTS_LOCK_OBSERVER_CAPABILITY_QUERY,
  TEAM_PROJECTS_LOCK_OBSERVER_VISIBILITY_QUERY,
  TEAM_PROJECTS_PERFORMANCE_SCHEMA_QUERY,
  assertConnectionTargetsValidatedSchema,
  assertExactProjectTaskForeignKey,
  parseTeamProjectsIntegrationTarget,
  preflightTeamProjectsIntegrationDatabase,
} from './team-project-integration-safety.js';

const exactForeignKey: ProjectTaskForeignKeyRow = {
  constraintName: 'fk_tasks_project_id_projects_id',
  tableName: 'tasks',
  columnName: 'project_id',
  referencedTableName: 'projects',
  referencedColumnName: 'id',
  deleteRule: 'SET NULL',
};

const TRANSACTION_OBSERVER_CAPABILITY_QUERY = `SELECT
  transactions.THREAD_ID AS transactionThreadId
FROM performance_schema.events_transactions_current AS transactions
INNER JOIN performance_schema.threads AS threads
  ON threads.THREAD_ID = transactions.THREAD_ID
WHERE 1 = 0`;

describe('team project integration safety', () => {
  it('builds an explicit loopback mysql2 config without retaining the raw URI', () => {
    const target = parseTeamProjectsIntegrationTarget({
      rawUrl: 'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1',
      confirmDestroy: TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY,
    });

    expect(target.schemaName).toBe('holaday_team_projects_it_round1');
    expect(target.connectionConfig).toEqual({
      host: '127.0.0.1',
      port: 13306,
      user: 'task14_user',
      password: 'task14_pass',
      database: 'holaday_team_projects_it_round1',
      timezone: 'Z',
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
      multipleStatements: false,
      connectTimeout: 5_000,
    });
    expect(target.connectionConfig).not.toHaveProperty('uri');
  });

  it.each([
    [
      'the reviewer database and host override exploit',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1?database=production&host=prod.example.com',
    ],
    [
      'a hostname override',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1?hostname=prod.example.com',
    ],
    [
      'a port override',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1?port=3306',
    ],
    [
      'a socket override',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1?socketPath=/tmp/mysql.sock',
    ],
    [
      'a user override',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1?user=root',
    ],
    [
      'a password override',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1?password=secret',
    ],
    [
      'duplicate query keys',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1?database=one&database=two',
    ],
    [
      'an encoded query key',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1?%64atabase=production',
    ],
    [
      'a double-encoded query key',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1?%2564atabase=production',
    ],
    [
      'an unrelated query option',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1?ssl=true',
    ],
  ])('rejects %s before mysql2 sees the URL', (_label, rawUrl) => {
    expect(() =>
      parseTeamProjectsIntegrationTarget({
        rawUrl,
        confirmDestroy: TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY,
      }),
    ).toThrow('must not contain query parameters');
  });

  it.each([
    [
      'an encoded schema path',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_%72ound1',
    ],
    [
      'a double-encoded schema path',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_%2572ound1',
    ],
    [
      'an encoded path separator',
      'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1%2Fother',
    ],
  ])('rejects %s', (_label, rawUrl) => {
    expect(() =>
      parseTeamProjectsIntegrationTarget({
        rawUrl,
        confirmDestroy: TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY,
      }),
    ).toThrow('schema path must be unencoded');
  });

  it.each([
    ['the empty suffix', 'holaday_team_projects_it_'],
    ['a production token', 'holaday_team_projects_it_production_probe'],
    ['a staging token', 'holaday_team_projects_it_staging_probe'],
    ['a shared token', 'holaday_team_projects_it_shared_probe'],
    ['a nested path', 'holaday_team_projects_it_round1/other'],
    ['a trailing slash', 'holaday_team_projects_it_round1/'],
  ])('rejects %s in the schema path', (_label, path) => {
    expect(() =>
      parseTeamProjectsIntegrationTarget({
        rawUrl: `mysql://task14_user:task14_pass@127.0.0.1:13306/${path}`,
        confirmDestroy: TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY,
      }),
    ).toThrow('invalid isolated integration schema');
  });

  it.each([
    ['a non-loopback host', 'mysql://task14_user:task14_pass@db.example.com:13306'],
    ['a missing port', 'mysql://task14_user:task14_pass@127.0.0.1'],
    ['the default MySQL port', 'mysql://task14_user:task14_pass@127.0.0.1:3306'],
    ['an empty user', 'mysql://:task14_pass@127.0.0.1:13306'],
    ['an empty password', 'mysql://task14_user@127.0.0.1:13306'],
    ['an encoded user', 'mysql://task14%5Fuser:task14_pass@127.0.0.1:13306'],
    ['an encoded password', 'mysql://task14_user:task14%5Fpass@127.0.0.1:13306'],
  ])('rejects %s', (_label, authority) => {
    expect(() =>
      parseTeamProjectsIntegrationTarget({
        rawUrl: `${authority}/holaday_team_projects_it_round1`,
        confirmDestroy: TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY,
      }),
    ).toThrow();
  });

  it('requires the exact destructive confirmation value', () => {
    expect(() =>
      parseTeamProjectsIntegrationTarget({
        rawUrl: 'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1',
        confirmDestroy: 'almost-confirmed',
      }),
    ).toThrow('destructive confirmation mismatch');
  });

  it('checks SELECT DATABASE against the validated schema before a connection is usable', async () => {
    const target = parseTeamProjectsIntegrationTarget({
      rawUrl: 'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1',
      confirmDestroy: TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY,
    });
    const exactConnection = {
      query: vi.fn(async () => [[{ databaseName: 'holaday_team_projects_it_round1' }], []]),
    };
    const redirectedConnection = {
      query: vi.fn(async () => [[{ databaseName: 'production' }], []]),
    };

    await expect(assertConnectionTargetsValidatedSchema(exactConnection, target)).resolves.toBe(
      undefined,
    );
    await expect(
      assertConnectionTargetsValidatedSchema(redirectedConnection, target),
    ).rejects.toThrow('connected schema does not exactly match validated target');
    expect(exactConnection.query).toHaveBeenCalledWith('SELECT DATABASE() AS databaseName');
  });

  it('joins both information-schema sources using the exact constraint identity', () => {
    const sql = PROJECT_TASK_FOREIGN_KEY_QUERY.toLowerCase().replace(/\s+/g, ' ').trim();

    expect(sql).toContain('information_schema.referential_constraints as rc');
    expect(sql).toContain('information_schema.key_column_usage as kcu');
    expect(sql).toContain('kcu.constraint_schema = rc.constraint_schema');
    expect(sql).toContain('kcu.constraint_name = rc.constraint_name');
    expect(sql).toContain('kcu.table_name = rc.table_name');
    expect(sql).toContain('rc.constraint_schema = database()');
    expect(sql).toContain('kcu.table_schema = database()');
    expect(sql).toContain("rc.table_name = 'tasks'");
    expect(sql).toContain("rc.referenced_table_name = 'projects'");
  });

  it('accepts exactly the required tasks.project_id foreign key', () => {
    expect(() => assertExactProjectTaskForeignKey([exactForeignKey])).not.toThrow();
  });

  it.each([
    ['zero rows', []],
    ['an alternate tasks column', [{ ...exactForeignKey, columnName: 'session_id' }]],
    [
      'a mismatched referenced column',
      [{ ...exactForeignKey, referencedColumnName: 'external_id' }],
    ],
    ['a mismatched delete rule', [{ ...exactForeignKey, deleteRule: 'CASCADE' }]],
    [
      'multiple project foreign keys',
      [exactForeignKey, { ...exactForeignKey, constraintName: 'fk_tasks_alternate' }],
    ],
  ] as const)('rejects %s', (_label, rows) => {
    expect(() => assertExactProjectTaskForeignKey(rows)).toThrow(
      'integration database must have exactly tasks.project_id -> projects.id ON DELETE SET NULL',
    );
  });

  function validTarget() {
    return parseTeamProjectsIntegrationTarget({
      rawUrl: 'mysql://task14_user:task14_pass@127.0.0.1:13306/holaday_team_projects_it_round1',
      confirmDestroy: TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY,
    });
  }

  function preflightConnection(overrides?: {
    databaseName?: string;
    counts?: Record<string, number>;
    foreignKeys?: readonly ProjectTaskForeignKeyRow[];
    isolationLevel?: string;
    performanceSchemaEnabled?: number;
    visibleProbeSessions?: number;
    capabilityError?: Error;
    transactionCapabilityError?: Error;
  }) {
    return {
      query: vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
        if (sql === 'SELECT DATABASE() AS databaseName') {
          return [[{ databaseName: overrides?.databaseName ?? validTarget().schemaName }], []];
        }
        if (sql === TEAM_PROJECTS_EMPTY_TABLES_QUERY) {
          return [
            [
              overrides?.counts ?? {
                usersCount: 0,
                organizationsCount: 0,
                organizationMembersCount: 0,
                organizationInvitationsCount: 0,
                projectsCount: 0,
                projectMembersCount: 0,
                tasksCount: 0,
              },
            ],
            [],
          ];
        }
        if (sql === PROJECT_TASK_FOREIGN_KEY_QUERY) {
          return [[...(overrides?.foreignKeys ?? [exactForeignKey])], []];
        }
        if (sql === TEAM_PROJECTS_ISOLATION_QUERY) {
          return [[{ isolationLevel: overrides?.isolationLevel ?? 'REPEATABLE-READ' }], []];
        }
        if (sql === TEAM_PROJECTS_PERFORMANCE_SCHEMA_QUERY) {
          return [[{ performanceSchemaEnabled: overrides?.performanceSchemaEnabled ?? 1 }], []];
        }
        if (sql === TEAM_PROJECTS_LOCK_OBSERVER_CAPABILITY_QUERY) {
          if (overrides?.capabilityError) throw overrides.capabilityError;
          return [[], []];
        }
        if (sql === TRANSACTION_OBSERVER_CAPABILITY_QUERY) {
          if (overrides?.transactionCapabilityError) {
            throw overrides.transactionCapabilityError;
          }
          return [[], []];
        }
        if (sql === TEAM_PROJECTS_LOCK_OBSERVER_VISIBILITY_QUERY) {
          expect(parameters).toEqual([4321]);
          return [[{ visibleProbeSessions: overrides?.visibleProbeSessions ?? 1 }], []];
        }
        throw new Error(`unexpected preflight query: ${sql}`);
      }),
    };
  }

  it('preflights exact schema, emptiness, FK, isolation, and lock-observer capability before fixtures', async () => {
    const connection = preflightConnection();

    await expect(
      preflightTeamProjectsIntegrationDatabase(connection, validTarget(), {
        observerProbeThreadId: 4321,
      }),
    ).resolves.toEqual({ isolationLevel: 'REPEATABLE-READ' });
    expect(connection.query.mock.calls).toEqual([
      ['SELECT DATABASE() AS databaseName'],
      [TEAM_PROJECTS_EMPTY_TABLES_QUERY],
      [PROJECT_TASK_FOREIGN_KEY_QUERY],
      [TEAM_PROJECTS_ISOLATION_QUERY],
      [TEAM_PROJECTS_PERFORMANCE_SCHEMA_QUERY],
      [TEAM_PROJECTS_LOCK_OBSERVER_CAPABILITY_QUERY],
      [TRANSACTION_OBSERVER_CAPABILITY_QUERY],
      [TEAM_PROJECTS_LOCK_OBSERVER_VISIBILITY_QUERY, [4321]],
    ]);
    expect(connection.query.mock.calls.every(([sql]) => /^\s*select\b/i.test(sql))).toBe(true);
  });

  it('rejects a dirty schema before observer probing or any mutation', async () => {
    const connection = preflightConnection({
      counts: {
        usersCount: 1,
        organizationsCount: 0,
        organizationMembersCount: 0,
        organizationInvitationsCount: 0,
        projectsCount: 0,
        projectMembersCount: 0,
        tasksCount: 0,
      },
    });

    await expect(
      preflightTeamProjectsIntegrationDatabase(connection, validTarget(), {
        observerProbeThreadId: 4321,
      }),
    ).rejects.toThrow('integration database must be freshly migrated and empty');
    expect(connection.query).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['performance_schema disabled', { performanceSchemaEnabled: 0 }],
    ['probe session not visible', { visibleProbeSessions: 0 }],
    ['observer tables forbidden', { capabilityError: new Error('SELECT denied') }],
    [
      'transaction observer table forbidden',
      { transactionCapabilityError: new Error('SELECT denied') },
    ],
  ] as const)('fails the mandatory race gate when %s', async (_label, overrides) => {
    const connection = preflightConnection(overrides);

    await expect(
      preflightTeamProjectsIntegrationDatabase(connection, validTarget(), {
        observerProbeThreadId: 4321,
      }),
    ).rejects.toThrow('TASK14_LOCK_OBSERVER_UNSUPPORTED');
  });

  it('rejects the wrong deployed isolation level before observer probing', async () => {
    const connection = preflightConnection({ isolationLevel: 'READ-COMMITTED' });

    await expect(
      preflightTeamProjectsIntegrationDatabase(connection, validTarget(), {
        observerProbeThreadId: 4321,
      }),
    ).rejects.toThrow('must use the deployed REPEATABLE-READ isolation');
    expect(connection.query).toHaveBeenCalledTimes(4);
  });
});
