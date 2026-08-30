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

export const TEAM_PROJECTS_CONNECTION_ID_QUERY = 'SELECT CONNECTION_ID() AS connectionId';

export const TEAM_PROJECTS_TRANSACTION_SESSIONS_QUERY = `SELECT
  threads.PROCESSLIST_ID AS connectionId,
  threads.PROCESSLIST_DB AS databaseName,
  threads.INSTRUMENTED AS instrumented,
  MAX(CASE WHEN transactions.STATE = 'ACTIVE' THEN 1 ELSE 0 END) AS activeTransactionCount,
  (SELECT COUNT(*)
    FROM performance_schema.setup_instruments
    WHERE NAME = 'transaction' AND ENABLED = 'YES') AS transactionInstrumentEnabled,
  (SELECT COUNT(*)
    FROM performance_schema.setup_consumers
    WHERE NAME = 'events_transactions_current' AND ENABLED = 'YES') AS currentTransactionConsumerEnabled,
  (SELECT COUNT(*)
    FROM performance_schema.setup_consumers
    WHERE NAME = 'thread_instrumentation' AND ENABLED = 'YES') AS threadInstrumentationConsumerEnabled
FROM performance_schema.threads AS threads
LEFT JOIN performance_schema.events_transactions_current AS transactions
  ON transactions.THREAD_ID = threads.THREAD_ID
WHERE threads.PROCESSLIST_ID IN (?, ?)
  AND threads.TYPE = 'FOREGROUND'
GROUP BY
  threads.PROCESSLIST_ID,
  threads.PROCESSLIST_DB,
  threads.INSTRUMENTED
ORDER BY threads.PROCESSLIST_ID`;

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

function transactionObserverError(detail: string): Error {
  return new Error(`TASK14_TRANSACTION_OBSERVER_UNSUPPORTED: ${detail}`);
}

export function requireTeamProjectsConnectionId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw transactionObserverError('mysql connection id is missing or unsafe');
  }
  return value;
}

export function assertTeamProjectsTransactionSessions(
  rows: readonly unknown[],
  input: {
    connectionIds: readonly [unknown, unknown];
    schemaName: string;
    activeConnectionIds: readonly unknown[];
  },
): void {
  const connectionIds = input.connectionIds.map(requireTeamProjectsConnectionId) as [
    number,
    number,
  ];
  if (connectionIds[0] === connectionIds[1]) {
    throw transactionObserverError('mysql connection ids must be distinct');
  }
  const expectedConnectionIds = new Set(connectionIds);
  const activeConnectionIds = new Set(
    input.activeConnectionIds.map(requireTeamProjectsConnectionId),
  );
  if ([...activeConnectionIds].some((connectionId) => !expectedConnectionIds.has(connectionId))) {
    throw transactionObserverError('active connection id is not one of the observed sessions');
  }
  if (rows.length !== connectionIds.length) {
    throw transactionObserverError('observer did not return both endpoint sessions');
  }

  const observedConnectionIds = new Set<number>();
  for (const candidate of rows) {
    if (!candidate || typeof candidate !== 'object') {
      throw transactionObserverError('observer returned a malformed endpoint session');
    }
    const row = candidate as PreflightRow;
    const connectionId = requireTeamProjectsConnectionId(row.connectionId);
    if (!expectedConnectionIds.has(connectionId) || observedConnectionIds.has(connectionId)) {
      throw transactionObserverError('observer returned an unexpected or duplicate endpoint');
    }
    observedConnectionIds.add(connectionId);
    if (row.databaseName !== input.schemaName) {
      throw transactionObserverError('observed endpoint is not bound to the validated schema');
    }
    if (row.instrumented !== 'YES') {
      throw transactionObserverError('observed endpoint is not instrumented');
    }
    if (
      Number(row.transactionInstrumentEnabled) !== 1 ||
      Number(row.currentTransactionConsumerEnabled) !== 1 ||
      Number(row.threadInstrumentationConsumerEnabled) !== 1
    ) {
      throw transactionObserverError('transaction instrumentation or consumers are disabled');
    }
    const activeTransactionCount = Number(row.activeTransactionCount);
    if (
      !Number.isSafeInteger(activeTransactionCount) ||
      activeTransactionCount < 0 ||
      activeTransactionCount > 1 ||
      activeTransactionCount !== (activeConnectionIds.has(connectionId) ? 1 : 0)
    ) {
      throw transactionObserverError('active transaction state did not match the required state');
    }
  }
}

async function readTeamProjectsConnectionId(
  connection: SchemaAssertionConnection,
): Promise<number> {
  const row = firstObjectRow(await connection.query(TEAM_PROJECTS_CONNECTION_ID_QUERY));
  return requireTeamProjectsConnectionId(row?.connectionId);
}

async function assertObservedTransactionSessions(
  connection: SchemaAssertionConnection,
  input: {
    connectionIds: readonly [number, number];
    schemaName: string;
    activeConnectionIds: readonly number[];
  },
): Promise<void> {
  let rows: unknown[];
  try {
    rows = resultRows(
      await connection.query(TEAM_PROJECTS_TRANSACTION_SESSIONS_QUERY, [...input.connectionIds]),
    );
  } catch {
    throw transactionObserverError('transaction session observer query failed');
  }
  assertTeamProjectsTransactionSessions(rows, input);
}

export async function preflightTeamProjectsIntegrationDatabase(
  connection: SchemaAssertionConnection,
  target: ValidatedTeamProjectsIntegrationTarget,
  input: { observerProbeConnection: SchemaAssertionConnection },
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

  await assertConnectionTargetsValidatedSchema(input.observerProbeConnection, target);
  const observerConnectionId = await readTeamProjectsConnectionId(connection);
  const probeConnectionId = await readTeamProjectsConnectionId(input.observerProbeConnection);
  if (observerConnectionId === probeConnectionId) {
    throw transactionObserverError('mysql connection ids must be distinct');
  }

  let probeTransactionStarted = false;
  try {
    await input.observerProbeConnection.query('START TRANSACTION');
    probeTransactionStarted = true;
    await assertObservedTransactionSessions(connection, {
      connectionIds: [observerConnectionId, probeConnectionId],
      schemaName: target.schemaName,
      activeConnectionIds: [probeConnectionId],
    });
  } catch {
    throw transactionObserverError('known active probe transaction was not observed');
  } finally {
    if (probeTransactionStarted) {
      await input.observerProbeConnection.query('ROLLBACK');
    }
  }
  await assertObservedTransactionSessions(connection, {
    connectionIds: [observerConnectionId, probeConnectionId],
    schemaName: target.schemaName,
    activeConnectionIds: [],
  });

  return { isolationLevel: 'REPEATABLE-READ' };
}
