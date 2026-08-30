import type { ConnectionOptions } from 'mysql2/promise';

export const TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY =
  'DESTROY_FRESH_HOLADAY_TEAM_PROJECTS_IT_DATABASE';

export type ValidatedTeamProjectsIntegrationTarget = {
  schemaName: string;
  connectionConfig: Readonly<ConnectionOptions>;
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SAFE_CREDENTIAL = /^[A-Za-z0-9._~-]+$/;
const SAFE_SCHEMA = /^holaday_team_projects_it_[a-z0-9](?:[a-z0-9_]*[a-z0-9])?$/;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}

export function parseTeamProjectsIntegrationTarget(input: {
  rawUrl: string;
  confirmDestroy: string | undefined;
}): ValidatedTeamProjectsIntegrationTarget {
  if (input.confirmDestroy !== TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY) {
    throw new Error('destructive confirmation mismatch for team-project integration database');
  }
  if (
    input.rawUrl !== input.rawUrl.trim() ||
    containsControlCharacter(input.rawUrl) ||
    input.rawUrl.length === 0
  ) {
    throw new Error('integration database URL contains invalid whitespace or control characters');
  }

  let parsed: URL;
  try {
    parsed = new URL(input.rawUrl);
  } catch {
    throw new Error('integration database URL is not a valid URL');
  }
  if (parsed.protocol !== 'mysql:') {
    throw new Error('integration database URL must use mysql protocol');
  }
  if (parsed.search.length > 0) {
    throw new Error('integration database URL must not contain query parameters');
  }
  if (parsed.hash.length > 0) {
    throw new Error('integration database URL must not contain a fragment');
  }
  if (parsed.pathname.includes('%')) {
    throw new Error('integration database schema path must be unencoded');
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('integration database host must be explicit loopback');
  }
  if (!parsed.port) {
    throw new Error('integration database must use an explicit non-default port');
  }
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535 || port === 3306) {
    throw new Error('integration database must use an explicit non-default port');
  }
  if (
    !parsed.username ||
    !parsed.password ||
    parsed.username.includes('%') ||
    parsed.password.includes('%') ||
    !SAFE_CREDENTIAL.test(parsed.username) ||
    !SAFE_CREDENTIAL.test(parsed.password)
  ) {
    throw new Error('integration database credentials must be non-empty unencoded safe values');
  }

  const schemaName = parsed.pathname.slice(1);
  if (
    schemaName.length > 64 ||
    !SAFE_SCHEMA.test(schemaName) ||
    /(?:prod|production|stage|staging|shared)/i.test(schemaName)
  ) {
    throw new Error('invalid isolated integration schema');
  }

  return {
    schemaName,
    connectionConfig: {
      host: parsed.hostname === '[::1]' ? '::1' : parsed.hostname,
      port,
      user: parsed.username,
      password: parsed.password,
      database: schemaName,
      timezone: 'Z',
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
      multipleStatements: false,
      connectTimeout: 5_000,
    },
  };
}

type SchemaAssertionConnection = {
  query(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
};

function resultRows(result: unknown): unknown[] {
  const rows = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(rows) ? rows : [];
}

export async function assertConnectionTargetsValidatedSchema(
  connection: SchemaAssertionConnection,
  target: ValidatedTeamProjectsIntegrationTarget,
): Promise<void> {
  const result = await connection.query('SELECT DATABASE() AS databaseName');
  const first = resultRows(result)[0];
  const databaseName =
    first && typeof first === 'object' && 'databaseName' in first ? first.databaseName : undefined;
  if (databaseName !== target.schemaName) {
    throw new Error('connected schema does not exactly match validated target');
  }
}

export const TEAM_PROJECTS_EMPTY_TABLES_QUERY = `SELECT
  (SELECT COUNT(*) FROM users) AS usersCount,
  (SELECT COUNT(*) FROM organizations) AS organizationsCount,
  (SELECT COUNT(*) FROM organization_members) AS organizationMembersCount,
  (SELECT COUNT(*) FROM organization_invitations) AS organizationInvitationsCount,
  (SELECT COUNT(*) FROM projects) AS projectsCount,
  (SELECT COUNT(*) FROM project_members) AS projectMembersCount,
  (SELECT COUNT(*) FROM tasks) AS tasksCount`;

export const TEAM_PROJECTS_ISOLATION_QUERY = 'SELECT @@transaction_isolation AS isolationLevel';

export const TEAM_PROJECTS_PERFORMANCE_SCHEMA_QUERY =
  'SELECT @@performance_schema AS performanceSchemaEnabled';

export const TEAM_PROJECTS_LOCK_OBSERVER_CAPABILITY_QUERY = `SELECT
  requesting.PROCESSLIST_ID AS waitingThreadId,
  blocking.PROCESSLIST_ID AS blockingThreadId
FROM performance_schema.data_lock_waits AS waits
INNER JOIN performance_schema.threads AS requesting
  ON requesting.THREAD_ID = waits.REQUESTING_THREAD_ID
INNER JOIN performance_schema.threads AS blocking
  ON blocking.THREAD_ID = waits.BLOCKING_THREAD_ID
WHERE 1 = 0`;

export const TEAM_PROJECTS_TRANSACTION_OBSERVER_CAPABILITY_QUERY = `SELECT
  transactions.THREAD_ID AS transactionThreadId
FROM performance_schema.events_transactions_current AS transactions
INNER JOIN performance_schema.threads AS threads
  ON threads.THREAD_ID = transactions.THREAD_ID
WHERE 1 = 0`;

export const TEAM_PROJECTS_ACTIVE_TRANSACTION_COUNT_QUERY = `SELECT
  COUNT(*) AS activeTransactionCount
FROM performance_schema.events_transactions_current AS transactions
INNER JOIN performance_schema.threads AS threads
  ON threads.THREAD_ID = transactions.THREAD_ID
WHERE threads.PROCESSLIST_ID IN (?, ?)
  AND transactions.STATE = 'ACTIVE'`;

export const TEAM_PROJECTS_LOCK_OBSERVER_VISIBILITY_QUERY = `SELECT
  COUNT(*) AS visibleProbeSessions
FROM performance_schema.threads
WHERE PROCESSLIST_ID = ?`;

export const PROJECT_TASK_FOREIGN_KEY_QUERY = `
  SELECT
    rc.CONSTRAINT_NAME AS constraintName,
    kcu.TABLE_NAME AS tableName,
    kcu.COLUMN_NAME AS columnName,
    kcu.REFERENCED_TABLE_NAME AS referencedTableName,
    kcu.REFERENCED_COLUMN_NAME AS referencedColumnName,
    rc.DELETE_RULE AS deleteRule
  FROM information_schema.REFERENTIAL_CONSTRAINTS AS rc
  INNER JOIN information_schema.KEY_COLUMN_USAGE AS kcu
    ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
    AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
    AND kcu.TABLE_NAME = rc.TABLE_NAME
  WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
    AND kcu.TABLE_SCHEMA = DATABASE()
    AND rc.TABLE_NAME = 'tasks'
    AND rc.REFERENCED_TABLE_NAME = 'projects'
`;

export type ProjectTaskForeignKeyRow = {
  constraintName: string;
  tableName: string;
  columnName: string;
  referencedTableName: string;
  referencedColumnName: string;
  deleteRule: string;
};

export function assertExactProjectTaskForeignKey(rows: readonly ProjectTaskForeignKeyRow[]): void {
  const [foreignKey] = rows;
  if (
    rows.length !== 1 ||
    !foreignKey ||
    foreignKey.tableName !== 'tasks' ||
    foreignKey.columnName !== 'project_id' ||
    foreignKey.referencedTableName !== 'projects' ||
    foreignKey.referencedColumnName !== 'id' ||
    foreignKey.deleteRule !== 'SET NULL'
  ) {
    throw new Error(
      'integration database must have exactly tasks.project_id -> projects.id ON DELETE SET NULL',
    );
  }
}

type PreflightRow = Record<string, unknown>;

function firstObjectRow(result: unknown): PreflightRow | undefined {
  const row = resultRows(result)[0];
  return row && typeof row === 'object' ? (row as PreflightRow) : undefined;
}

export async function preflightTeamProjectsIntegrationDatabase(
  connection: SchemaAssertionConnection,
  target: ValidatedTeamProjectsIntegrationTarget,
  input: { observerProbeThreadId: number },
): Promise<{ isolationLevel: 'REPEATABLE-READ' }> {
  await assertConnectionTargetsValidatedSchema(connection, target);

  const counts = firstObjectRow(await connection.query(TEAM_PROJECTS_EMPTY_TABLES_QUERY));
  const countFields = [
    'usersCount',
    'organizationsCount',
    'organizationMembersCount',
    'organizationInvitationsCount',
    'projectsCount',
    'projectMembersCount',
    'tasksCount',
  ] as const;
  if (!counts || countFields.some((field) => Number(counts[field]) !== 0)) {
    throw new Error('integration database must be freshly migrated and empty');
  }

  const foreignKeys = resultRows(await connection.query(PROJECT_TASK_FOREIGN_KEY_QUERY));
  assertExactProjectTaskForeignKey(foreignKeys as ProjectTaskForeignKeyRow[]);

  const isolation = firstObjectRow(await connection.query(TEAM_PROJECTS_ISOLATION_QUERY));
  if (isolation?.isolationLevel !== 'REPEATABLE-READ') {
    throw new Error('integration database must use the deployed REPEATABLE-READ isolation');
  }

  const performanceSchema = firstObjectRow(
    await connection.query(TEAM_PROJECTS_PERFORMANCE_SCHEMA_QUERY),
  );
  const enabled = performanceSchema?.performanceSchemaEnabled;
  if (!(enabled === 1 || enabled === '1' || enabled === 'ON')) {
    throw new Error('TASK14_LOCK_OBSERVER_UNSUPPORTED: performance_schema is disabled');
  }

  try {
    await connection.query(TEAM_PROJECTS_LOCK_OBSERVER_CAPABILITY_QUERY);
  } catch {
    throw new Error(
      'TASK14_LOCK_OBSERVER_UNSUPPORTED: performance_schema lock-wait tables are not queryable',
    );
  }

  try {
    await connection.query(TEAM_PROJECTS_TRANSACTION_OBSERVER_CAPABILITY_QUERY);
  } catch {
    throw new Error(
      'TASK14_LOCK_OBSERVER_UNSUPPORTED: performance_schema transaction observer is not queryable',
    );
  }

  let visibility: PreflightRow | undefined;
  try {
    visibility = firstObjectRow(
      await connection.query(TEAM_PROJECTS_LOCK_OBSERVER_VISIBILITY_QUERY, [
        input.observerProbeThreadId,
      ]),
    );
  } catch {
    throw new Error(
      'TASK14_LOCK_OBSERVER_UNSUPPORTED: observer cannot inspect independent sessions',
    );
  }
  if (Number(visibility?.visibleProbeSessions) !== 1) {
    throw new Error(
      'TASK14_LOCK_OBSERVER_UNSUPPORTED: observer cannot inspect independent sessions',
    );
  }

  return { isolationLevel: 'REPEATABLE-READ' };
}
