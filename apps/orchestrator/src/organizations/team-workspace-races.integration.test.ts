import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import {
  __projectAccessInternals,
  removeProjectMemberWithAccess,
} from '../projects/project-access.js';
import {
  TEAM_PROJECTS_ACTIVE_TRANSACTION_COUNT_QUERY,
  assertConnectionTargetsValidatedSchema,
  parseTeamProjectsIntegrationTarget,
  preflightTeamProjectsIntegrationDatabase,
} from '../projects/team-project-integration-safety.js';
import { assertInvitationReplayMemberWrite } from '../projects/team-project-invitation-race-harness.js';
import { assertForeignReportingLineIsolationEvidence } from '../projects/team-project-organization-race-harness.js';
import {
  type Task14RaceCaseName,
  task14FixtureExternalId,
} from '../projects/team-project-race-fixtures.js';
import {
  type MysqlBoundaryRecorder,
  type SqlBoundary,
  type SqlCheckpoint,
  type SqlResultOverride,
  compileSqlBoundary,
  createAffectedRowsOverride,
  createMysqlRaceEndpoint,
  createSqlCheckpoint,
  matchesSqlBoundary,
  runBoundedCleanup,
  runMysqlLockObserverExecute,
  runWithActiveTimeout,
} from '../projects/team-project-race-harness.js';
import {
  __teamProjectServiceInternals,
  createTeamProject,
  getTeamProjectWithAccess,
  listProjectMembersWithAccess,
  listTeamProjects,
} from '../projects/team-project-service.js';
import {
  assertDisabledOrganizationRow,
  assertInvitationPendingRow,
  assertInvitationTerminalRow,
} from '../projects/team-project-terminal-state-harness.js';
import {
  __organizationInvitationServiceInternals,
  acceptInvitation,
  revokeInvitation,
} from './organization-invitation-service.js';
import {
  __organizationServiceInternals,
  deactivateMember,
  updateMemberRole,
  updateReportingLine,
} from './organization-service.js';

const BARRIER_TIMEOUT_MS = 10_000;
const LOCK_WAIT_TIMEOUT_MS = 10_000;
const OPERATION_TIMEOUT_MS = 15_000;
const CLEANUP_TIMEOUT_MS = 5_000;
const MYSQL_LOCK_WAIT_TIMEOUT_SECONDS = 10;

type MysqlConnection = Awaited<ReturnType<typeof mysql.createConnection>>;

type Endpoint = {
  connection: MysqlConnection;
  db: DB;
  threadId: number;
  recorder: MysqlBoundaryRecorder;
};

type OperationOutcome<T = unknown> =
  | { ok: true; value: T; durationMs: number }
  | { ok: false; error: unknown; durationMs: number };

type RaceEvidence = {
  case: string;
  lockWaitMs: number | null;
  firstDurationMs: number | null;
  secondDurationMs: number | null;
  deadlocks: number;
  finalActiveOwners?: number;
  finalActiveLeads?: number;
};

type UserFixture = { id: number; externalId: string };
type OrganizationFixture = { id: number; externalId: string };
type OrganizationMemberFixture = {
  id: number;
  externalId: string;
  userId: number;
};
type ProjectFixture = { id: number; externalId: string };
type ProjectMemberFixture = { id: number; externalId: string };

function requireIntegrationEnvironment() {
  const rawUrl = process.env.TEAM_PROJECTS_INTEGRATION_DATABASE_URL;
  if (!rawUrl) {
    throw new Error('TEAM_PROJECTS_INTEGRATION_DATABASE_URL is required for this integration file');
  }
  return parseTeamProjectsIntegrationTarget({
    rawUrl,
    confirmDestroy: process.env.TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY,
  });
}

const integrationTarget = requireIntegrationEnvironment();
const compileDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
const evidence: RaceEvidence[] = [];
const openConnections = new Set<MysqlConnection>();
const openCheckpoints = new Set<SqlCheckpoint>();
let admin: MysqlConnection;
let isolationLevel = '';

async function insertRow(sql: string, values: readonly unknown[]): Promise<number> {
  const [result] = await admin.execute<mysql.ResultSetHeader>(sql, [...values]);
  if (result.affectedRows !== 1 || result.insertId <= 0) {
    throw new Error('integration fixture insert did not affect exactly one row');
  }
  return result.insertId;
}

async function createUser(caseName: Task14RaceCaseName, key: string): Promise<UserFixture> {
  const external = task14FixtureExternalId(caseName, 'users', key);
  const id = await insertRow(
    'INSERT INTO users (external_id, email, password_hash) VALUES (?, ?, ?)',
    [external, `${external}@team-workspace.integration.test`, 'integration-test-only'],
  );
  return { id, externalId: external };
}

async function createOrganization(
  ownerUserId: number,
  caseName: Task14RaceCaseName,
  key = 'primary',
  teamProjectsEnabled = true,
): Promise<OrganizationFixture> {
  const external = task14FixtureExternalId(caseName, 'organizations', key);
  const id = await insertRow(
    'INSERT INTO organizations (external_id, name, owner_user_id, status, team_projects_enabled) VALUES (?, ?, ?, ?, ?)',
    [external, `Integration ${caseName} ${key}`, ownerUserId, 'active', teamProjectsEnabled],
  );
  return { id, externalId: external };
}

async function createOrganizationMember(input: {
  caseName: Task14RaceCaseName;
  key: string;
  organizationId: number;
  userId: number;
  role: 'owner' | 'admin' | 'manager' | 'member';
  status?: 'active' | 'inactive';
  managerUserId?: number | null;
}): Promise<OrganizationMemberFixture> {
  const external = task14FixtureExternalId(input.caseName, 'organization_members', input.key);
  const id = await insertRow(
    'INSERT INTO organization_members (external_id, organization_id, user_id, role, manager_user_id, status) VALUES (?, ?, ?, ?, ?, ?)',
    [
      external,
      input.organizationId,
      input.userId,
      input.role,
      input.managerUserId ?? null,
      input.status ?? 'active',
    ],
  );
  return { id, externalId: external, userId: input.userId };
}

async function createProject(input: {
  caseName: Task14RaceCaseName;
  key?: string;
  ownerUserId: number;
  organizationId: number;
}): Promise<ProjectFixture> {
  const key = input.key ?? 'primary';
  const external = task14FixtureExternalId(input.caseName, 'projects', key);
  const id = await insertRow(
    'INSERT INTO projects (external_id, user_id, organization_id, name) VALUES (?, ?, ?, ?)',
    [external, input.ownerUserId, input.organizationId, `Integration project ${input.caseName}`],
  );
  return { id, externalId: external };
}

async function createProjectMember(input: {
  caseName: Task14RaceCaseName;
  key: string;
  projectId: number;
  userId: number;
  role: 'lead' | 'member' | 'viewer';
  status?: 'active' | 'inactive';
}): Promise<ProjectMemberFixture> {
  const external = task14FixtureExternalId(input.caseName, 'project_members', input.key);
  const id = await insertRow(
    'INSERT INTO project_members (external_id, project_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)',
    [external, input.projectId, input.userId, input.role, input.status ?? 'active'],
  );
  return { id, externalId: external };
}

async function createInvitation(input: {
  caseName: Task14RaceCaseName;
  key?: string;
  organizationId: number;
  invitedByUserId: number;
  role?: 'admin' | 'manager' | 'member';
  managerUserId?: number | null;
  secret: string;
}): Promise<{ id: number; externalId: string }> {
  const external = task14FixtureExternalId(
    input.caseName,
    'organization_invitations',
    input.key ?? 'primary',
  );
  const digest = createHash('sha256').update(input.secret).digest('hex');
  const id = await insertRow(
    'INSERT INTO organization_invitations (external_id, organization_id, token_hash, role, manager_user_id, invited_by_user_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY))',
    [
      external,
      input.organizationId,
      digest,
      input.role ?? 'member',
      input.managerUserId ?? null,
      input.invitedByUserId,
    ],
  );
  return { id, externalId: external };
}

function pauseAfterBoundary(label: string, boundary: SqlBoundary): SqlCheckpoint {
  const checkpoint = createSqlCheckpoint({
    label,
    phase: 'after',
    matches: (invocation) => matchesSqlBoundary(boundary, invocation),
  });
  openCheckpoints.add(checkpoint);
  return checkpoint;
}

function organizationMemberLockBoundary(
  organizationId: number,
  memberExternalIds: readonly string[],
): SqlBoundary {
  const sortedIds = [...new Set(memberExternalIds)].sort((left, right) =>
    left.localeCompare(right),
  );
  return compileSqlBoundary(
    __organizationServiceInternals
      .buildLockOrganizationMembersQuery(compileDb, organizationId, sortedIds)
      .toSQL(),
  );
}

async function openEndpoint(
  checkpoints: readonly SqlCheckpoint[] = [],
  resultOverrides: readonly SqlResultOverride[] = [],
): Promise<Endpoint> {
  const connection = await mysql.createConnection({ ...integrationTarget.connectionConfig });
  openConnections.add(connection);
  try {
    await assertConnectionTargetsValidatedSchema(connection, integrationTarget);
    await connection.query(
      `SET SESSION innodb_lock_wait_timeout = ${MYSQL_LOCK_WAIT_TIMEOUT_SECONDS}`,
    );
    const [[thread]] = await connection.query<Array<mysql.RowDataPacket & { threadId: number }>>(
      'SELECT CONNECTION_ID() AS threadId',
    );
    if (!thread) throw new Error('integration connection id unavailable');
    const endpoint = createMysqlRaceEndpoint({
      connection,
      checkpoints,
      resultOverrides,
    });
    const db = drizzle(endpoint.connection, {
      schema,
      mode: 'default',
      casing: 'snake_case',
    }) as unknown as DB;
    return {
      connection: endpoint.connection,
      db,
      threadId: Number(thread.threadId),
      recorder: endpoint.recorder,
    };
  } catch (error) {
    openConnections.delete(connection);
    connection.destroy();
    throw error;
  }
}

async function capture<T>(operation: Promise<T>): Promise<OperationOutcome<T>> {
  const startedAt = performance.now();
  try {
    return { ok: true, value: await operation, durationMs: performance.now() - startedAt };
  } catch (error) {
    return { ok: false, error, durationMs: performance.now() - startedAt };
  }
}

function errorField(error: unknown, key: string): unknown {
  return error && typeof error === 'object' && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

function expectDomainError(outcome: OperationOutcome, code: string): void {
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(errorField(outcome.error, 'code')).toBe(code);
}

function deadlockCount(outcomes: readonly OperationOutcome[]): number {
  return outcomes.filter(
    (outcome) =>
      !outcome.ok &&
      (errorField(outcome.error, 'code') === 'ER_LOCK_DEADLOCK' ||
        errorField(outcome.error, 'errno') === 1213),
  ).length;
}

async function waitForLockWait(waitingThreadId: number, blockingThreadId: number): Promise<number> {
  const startedAt = performance.now();
  const deadline = startedAt + LOCK_WAIT_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const remainingMs = Math.max(1, Math.ceil(deadline - performance.now()));
    const [rows] = await runMysqlLockObserverExecute({
      label: 'performance-schema lock-wait observer execute',
      execute: () =>
        admin.execute<mysql.RowDataPacket[]>(
          `SELECT requesting.PROCESSLIST_ID AS waitingThreadId,
              blocking.PROCESSLIST_ID AS blockingThreadId
       FROM performance_schema.data_lock_waits AS waits
       INNER JOIN performance_schema.threads AS requesting
         ON requesting.THREAD_ID = waits.REQUESTING_THREAD_ID
       INNER JOIN performance_schema.threads AS blocking
         ON blocking.THREAD_ID = waits.BLOCKING_THREAD_ID
       WHERE requesting.PROCESSLIST_ID = ?
         AND blocking.PROCESSLIST_ID = ?`,
          [waitingThreadId, blockingThreadId],
        ),
      destroy: () => admin.destroy(),
      timeoutMs: Math.min(CLEANUP_TIMEOUT_MS, remainingMs),
      settleTimeoutMs: CLEANUP_TIMEOUT_MS,
    });
    if (rows.length > 0) return performance.now() - startedAt;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('expected MySQL row-lock wait was not observed before the bounded deadline');
}

async function runOrganizationLockRace(input: {
  caseName: Task14RaceCaseName;
  firstBoundary: SqlBoundary;
  first: (db: DB) => Promise<unknown>;
  second: (db: DB) => Promise<unknown>;
  firstResultOverrides?: readonly SqlResultOverride[];
  secondResultOverrides?: readonly SqlResultOverride[];
}): Promise<{
  first: OperationOutcome;
  second: OperationOutcome;
  lockWaitMs: number;
  firstRecorder: MysqlBoundaryRecorder;
  secondRecorder: MysqlBoundaryRecorder;
}> {
  const firstPause = pauseAfterBoundary(`${input.caseName}-first-held`, input.firstBoundary);
  const firstEndpoint = await openEndpoint([firstPause], input.firstResultOverrides);
  const secondEndpoint = await openEndpoint([], input.secondResultOverrides);
  const firstPromise = capture(input.first(firstEndpoint.db));
  let secondPromise: Promise<OperationOutcome> | undefined;
  let operationsSettled = false;
  try {
    await firstPause.waitUntilReached(BARRIER_TIMEOUT_MS);
    secondPromise = capture(input.second(secondEndpoint.db));
    const lockWaitMs = await waitForLockWait(secondEndpoint.threadId, firstEndpoint.threadId);
    firstPause.release();
    const [first, second] = await runWithActiveTimeout(Promise.all([firstPromise, secondPromise]), {
      label: input.caseName,
      timeoutMs: OPERATION_TIMEOUT_MS,
      settleTimeoutMs: CLEANUP_TIMEOUT_MS,
      onTimeout: () => {
        firstEndpoint.connection.destroy();
        secondEndpoint.connection.destroy();
      },
    });
    const [transactionRows] = await runMysqlLockObserverExecute({
      label: `${input.caseName} transaction-state observer execute`,
      execute: () =>
        admin.execute<Array<mysql.RowDataPacket & { activeTransactionCount: number }>>(
          TEAM_PROJECTS_ACTIVE_TRANSACTION_COUNT_QUERY,
          [firstEndpoint.threadId, secondEndpoint.threadId],
        ),
      destroy: () => admin.destroy(),
      timeoutMs: CLEANUP_TIMEOUT_MS,
      settleTimeoutMs: CLEANUP_TIMEOUT_MS,
    });
    operationsSettled = true;
    if (Number(transactionRows[0]?.activeTransactionCount ?? -1) !== 0) {
      throw new Error('race operation left a mysql2 session inside a transaction');
    }
    return {
      first,
      second,
      lockWaitMs,
      firstRecorder: firstEndpoint.recorder,
      secondRecorder: secondEndpoint.recorder,
    };
  } finally {
    firstPause.release();
    if (!operationsSettled) {
      const pendingOperations: Promise<OperationOutcome[]> = Promise.all(
        secondPromise ? [firstPromise, secondPromise] : [firstPromise],
      );
      await runWithActiveTimeout(pendingOperations, {
        label: `${input.caseName} failure cleanup`,
        timeoutMs: CLEANUP_TIMEOUT_MS,
        settleTimeoutMs: CLEANUP_TIMEOUT_MS,
        onTimeout: () => {
          firstEndpoint.connection.destroy();
          secondEndpoint.connection.destroy();
        },
      });
    }
  }
}

async function databaseRows<T extends mysql.RowDataPacket>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const [rows] = await admin.execute<T[]>(sql, [...values]);
  return rows;
}

async function assertDatabaseEmpty(): Promise<void> {
  const [row] = await databaseRows<
    mysql.RowDataPacket & {
      usersCount: number;
      organizationsCount: number;
      organizationMembersCount: number;
      organizationInvitationsCount: number;
      projectsCount: number;
      projectMembersCount: number;
      tasksCount: number;
    }
  >(`
    SELECT
      (SELECT COUNT(*) FROM users) AS usersCount,
      (SELECT COUNT(*) FROM organizations) AS organizationsCount,
      (SELECT COUNT(*) FROM organization_members) AS organizationMembersCount,
      (SELECT COUNT(*) FROM organization_invitations) AS organizationInvitationsCount,
      (SELECT COUNT(*) FROM projects) AS projectsCount,
      (SELECT COUNT(*) FROM project_members) AS projectMembersCount,
      (SELECT COUNT(*) FROM tasks) AS tasksCount
  `);
  if (!row || Object.values(row).some((value) => Number(value) !== 0)) {
    throw new Error('race integration database must be freshly migrated and empty');
  }
}

async function cleanupDatabase(): Promise<void> {
  await admin.query('DELETE FROM tasks');
  await admin.query('DELETE FROM project_members');
  await admin.query('DELETE FROM projects');
  await admin.query('DELETE FROM organization_invitations');
  await admin.query('DELETE FROM organization_members');
  await admin.query('DELETE FROM organizations');
  await admin.query('DELETE FROM users');
}

async function createReportingFixture(caseName: Task14RaceCaseName) {
  const owner = await createUser(caseName, 'owner');
  const manager = await createUser(caseName, 'manager');
  const subordinate = await createUser(caseName, 'subordinate');
  const organization = await createOrganization(owner.id, caseName);
  await createOrganizationMember({
    caseName,
    key: 'owner',
    organizationId: organization.id,
    userId: owner.id,
    role: 'owner',
  });
  const managerMembership = await createOrganizationMember({
    caseName,
    key: 'manager',
    organizationId: organization.id,
    userId: manager.id,
    role: 'manager',
  });
  const subordinateMembership = await createOrganizationMember({
    caseName,
    key: 'subordinate',
    organizationId: organization.id,
    userId: subordinate.id,
    role: 'member',
    managerUserId: null,
  });
  const project = await createProject({
    caseName,
    ownerUserId: owner.id,
    organizationId: organization.id,
  });
  await createProjectMember({
    caseName,
    key: 'owner-lead',
    projectId: project.id,
    userId: owner.id,
    role: 'lead',
  });
  const managerProjectMembership = await createProjectMember({
    caseName,
    key: 'manager-member',
    projectId: project.id,
    userId: manager.id,
    role: 'member',
  });
  return {
    owner,
    manager,
    organization,
    managerMembership,
    subordinateMembership,
    managerProjectMembership,
  };
}

async function createTwoOwnerFixture(caseName: Task14RaceCaseName) {
  const ownerA = await createUser(caseName, 'owner-a');
  const ownerB = await createUser(caseName, 'owner-b');
  const organization = await createOrganization(ownerA.id, caseName);
  const membershipA = await createOrganizationMember({
    caseName,
    key: 'owner-a',
    organizationId: organization.id,
    userId: ownerA.id,
    role: 'owner',
  });
  const membershipB = await createOrganizationMember({
    caseName,
    key: 'owner-b',
    organizationId: organization.id,
    userId: ownerB.id,
    role: 'owner',
  });
  return { ownerA, ownerB, organization, membershipA, membershipB };
}

async function activeOwnerCount(organizationId: number): Promise<number> {
  const [row] = await databaseRows<mysql.RowDataPacket & { rowCount: number }>(
    "SELECT COUNT(*) AS rowCount FROM organization_members WHERE organization_id = ? AND role = 'owner' AND status = 'active'",
    [organizationId],
  );
  return Number(row?.rowCount ?? 0);
}

async function activeLeadCount(projectId: number): Promise<number> {
  const [row] = await databaseRows<mysql.RowDataPacket & { rowCount: number }>(
    "SELECT COUNT(*) AS rowCount FROM project_members WHERE project_id = ? AND role = 'lead' AND status = 'active'",
    [projectId],
  );
  return Number(row?.rowCount ?? 0);
}

async function createProjectReadFixture(caseName: Task14RaceCaseName) {
  const owner = await createUser(caseName, 'owner');
  const reader = await createUser(caseName, 'reader');
  const organization = await createOrganization(owner.id, caseName);
  await createOrganizationMember({
    caseName,
    key: 'owner',
    organizationId: organization.id,
    userId: owner.id,
    role: 'owner',
  });
  const readerOrganizationMembership = await createOrganizationMember({
    caseName,
    key: 'reader',
    organizationId: organization.id,
    userId: reader.id,
    role: 'member',
  });
  const project = await createProject({
    caseName,
    ownerUserId: owner.id,
    organizationId: organization.id,
  });
  await createProjectMember({
    caseName,
    key: 'owner-lead',
    projectId: project.id,
    userId: owner.id,
    role: 'lead',
  });
  const readerProjectMembership = await createProjectMember({
    caseName,
    key: 'reader-viewer',
    projectId: project.id,
    userId: reader.id,
    role: 'viewer',
  });
  return {
    owner,
    reader,
    organization,
    readerOrganizationMembership,
    project,
    readerProjectMembership,
  };
}

async function createProjectWriteRaceFixture(caseName: Task14RaceCaseName) {
  const actor = await createUser(caseName, 'actor');
  const leadA = await createUser(caseName, 'lead-a');
  const leadB = await createUser(caseName, 'lead-b');
  const organization = await createOrganization(actor.id, caseName);
  await createOrganizationMember({
    caseName,
    key: 'actor',
    organizationId: organization.id,
    userId: actor.id,
    role: 'owner',
  });
  const leadAOrganizationMembership = await createOrganizationMember({
    caseName,
    key: 'lead-a',
    organizationId: organization.id,
    userId: leadA.id,
    role: 'member',
  });
  await createOrganizationMember({
    caseName,
    key: 'lead-b',
    organizationId: organization.id,
    userId: leadB.id,
    role: 'member',
  });
  const project = await createProject({
    caseName,
    ownerUserId: actor.id,
    organizationId: organization.id,
  });
  await createProjectMember({
    caseName,
    key: 'actor-member',
    projectId: project.id,
    userId: actor.id,
    role: 'member',
  });
  const leadAProjectMembership = await createProjectMember({
    caseName,
    key: 'lead-a',
    projectId: project.id,
    userId: leadA.id,
    role: 'lead',
  });
  const leadBProjectMembership = await createProjectMember({
    caseName,
    key: 'lead-b',
    projectId: project.id,
    userId: leadB.id,
    role: 'lead',
  });
  return {
    actor,
    leadA,
    leadB,
    organization,
    leadAOrganizationMembership,
    project,
    leadAProjectMembership,
    leadBProjectMembership,
  };
}

beforeAll(async () => {
  admin = await mysql.createConnection({ ...integrationTarget.connectionConfig });
  await assertConnectionTargetsValidatedSchema(admin, integrationTarget);
  await admin.query(`SET SESSION innodb_lock_wait_timeout = ${MYSQL_LOCK_WAIT_TIMEOUT_SECONDS}`);
  const observerProbe = await mysql.createConnection({ ...integrationTarget.connectionConfig });
  try {
    await assertConnectionTargetsValidatedSchema(observerProbe, integrationTarget);
    const [[probeThread]] = await observerProbe.query<
      Array<mysql.RowDataPacket & { threadId: number }>
    >('SELECT CONNECTION_ID() AS threadId');
    if (!probeThread) throw new Error('observer probe connection id unavailable');
    const preflight = await preflightTeamProjectsIntegrationDatabase(admin, integrationTarget, {
      observerProbeThreadId: Number(probeThread.threadId),
    });
    isolationLevel = preflight.isolationLevel;
  } finally {
    await runBoundedCleanup(
      [
        {
          label: 'close observer preflight probe',
          run: () => observerProbe.end(),
          onTimeout: () => observerProbe.destroy(),
          onFailure: () => observerProbe.destroy(),
        },
      ],
      CLEANUP_TIMEOUT_MS,
    );
  }
});

beforeEach(async () => {
  await assertDatabaseEmpty();
});

afterEach(async () => {
  const checkpoints = [...openCheckpoints];
  const connections = [...openConnections];
  openCheckpoints.clear();
  openConnections.clear();
  await runBoundedCleanup(
    [
      ...checkpoints.map((checkpoint, index) => ({
        label: `release checkpoint ${index + 1}`,
        run: () => checkpoint.release(),
      })),
      ...connections.map((connection, index) => ({
        label: `close race endpoint ${index + 1}`,
        run: () => connection.end(),
        onTimeout: () => connection.destroy(),
        onFailure: () => connection.destroy(),
      })),
      {
        label: 'clean disposable integration schema rows',
        run: cleanupDatabase,
        onTimeout: () => admin.destroy(),
        onFailure: () => admin.destroy(),
      },
    ],
    CLEANUP_TIMEOUT_MS,
  );
});

afterAll(async () => {
  try {
    const aggregate = {
      cases: evidence.length,
      deadlocks: evidence.reduce((sum, item) => sum + item.deadlocks, 0),
      isolationLevel,
      lockWaitMs: evidence.map((item) =>
        item.lockWaitMs === null ? null : Math.round(item.lockWaitMs),
      ),
      unavailableLockWaitCases: evidence
        .filter((item) => item.lockWaitMs === null)
        .map((item) => item.case),
      operationDurationMs: evidence.map((item) => ({
        case: item.case,
        first: item.firstDurationMs === null ? null : Number(item.firstDurationMs.toFixed(3)),
        second: item.secondDurationMs === null ? null : Number(item.secondDurationMs.toFixed(3)),
      })),
      finalActiveOwners: evidence
        .map((item) => item.finalActiveOwners)
        .filter((value): value is number => value !== undefined),
      finalActiveLeads: evidence
        .map((item) => item.finalActiveLeads)
        .filter((value): value is number => value !== undefined),
    };
    expect(aggregate.cases).toBe(18);
    expect(aggregate.deadlocks).toBe(0);
    expect(aggregate.finalActiveOwners).toEqual([1, 1, 1]);
    expect(aggregate.finalActiveLeads).toEqual([1, 1]);
    expect(aggregate.unavailableLockWaitCases).toEqual([
      'local-target-foreign-manager',
      'foreign-target-local-manager',
      'project-list-versus-create',
      'project-get-versus-deactivation',
      'project-roster-versus-deactivation',
    ]);
    expect(
      aggregate.operationDurationMs.every(
        (item) => item.first !== null && item.first > 0 && item.second !== null && item.second > 0,
      ),
    ).toBe(true);
    expect(JSON.stringify(aggregate)).not.toMatch(/token|hash/i);
    console.info(`TASK14_RACE_EVIDENCE ${JSON.stringify(aggregate)}`);
  } finally {
    if (admin) {
      await runBoundedCleanup(
        [
          {
            label: 'close race admin connection',
            run: () => admin.end(),
            onTimeout: () => admin.destroy(),
            onFailure: () => admin.destroy(),
          },
        ],
        CLEANUP_TIMEOUT_MS,
      );
    }
  }
});

describe.sequential('team workspace MySQL invitation races', () => {
  it('serializes replay so one acceptance commits and the losing transaction rolls back', async () => {
    const caseName = 'invitation-replay';
    const owner = await createUser(caseName, 'owner');
    const invitee = await createUser(caseName, 'invitee');
    const organization = await createOrganization(owner.id, caseName);
    await createOrganizationMember({
      caseName,
      key: 'owner',
      organizationId: organization.id,
      userId: owner.id,
      role: 'owner',
    });
    const secret = randomBytes(32).toString('base64url');
    const invitationDigest = createHash('sha256').update(secret).digest('hex');
    const invitation = await createInvitation({
      caseName,
      organizationId: organization.id,
      invitedByUserId: owner.id,
      secret,
    });
    let consumeQueryCount = 0;
    const operationNow = new Date();
    const invitationLockBoundary = compileSqlBoundary(
      __organizationInvitationServiceInternals
        .buildLockedInvitationByHashQuery(compileDb, organization.id, invitationDigest)
        .toSQL(),
    );
    const consumeBoundary = compileSqlBoundary(
      __organizationInvitationServiceInternals
        .buildConsumeInvitationQuery(compileDb, invitation.id, operationNow)
        .toSQL(),
      { dynamicDateParameterIndexes: [1] },
    );
    const consumeRecorder: SqlResultOverride = {
      transform(invocation, result) {
        if (matchesSqlBoundary(consumeBoundary, invocation)) consumeQueryCount += 1;
        return result;
      },
    };

    const race = await runOrganizationLockRace({
      caseName,
      firstBoundary: invitationLockBoundary,
      firstResultOverrides: [consumeRecorder],
      secondResultOverrides: [consumeRecorder],
      first: (db) =>
        acceptInvitation({
          db,
          actorExternalId: invitee.externalId,
          token: secret,
          now: () => operationNow,
        }),
      second: (db) =>
        acceptInvitation({
          db,
          actorExternalId: invitee.externalId,
          token: secret,
          now: () => operationNow,
        }),
    });

    expect(race.first.ok).toBe(true);
    if (race.first.ok) expect(race.first.value).toMatchObject({ status: 'joined' });
    expectDomainError(race.second, 'INVITATION_NOT_AVAILABLE');
    const invitationRows = await databaseRows<
      mysql.RowDataPacket & { acceptedAt: Date | null; revokedAt: Date | null }
    >(
      'SELECT accepted_at AS acceptedAt, revoked_at AS revokedAt FROM organization_invitations WHERE id = ?',
      [invitation.id],
    );
    assertInvitationTerminalRow(invitationRows, 'accepted');
    expect(consumeQueryCount).toBe(1);
    const members = await databaseRows<
      mysql.RowDataPacket & { status: string; role: string; pairCount: number }
    >(
      `SELECT status, role, COUNT(*) OVER () AS pairCount
       FROM organization_members
       WHERE organization_id = ? AND user_id = ?`,
      [organization.id, invitee.id],
    );
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ status: 'active', role: 'member', pairCount: 1 });
    assertInvitationReplayMemberWrite({
      winner: race.firstRecorder,
      loser: race.secondRecorder,
      expectedKind: 'create',
      organizationId: organization.id,
      actorUserId: invitee.id,
      role: 'member',
      managerUserId: null,
      acceptedAt: operationNow,
    });
    expect(race.firstRecorder.transactionActions()).toEqual(['begin', 'commit']);
    expect(race.secondRecorder.transactionActions()).toEqual(['begin', 'rollback']);
    expect(deadlockCount([race.first, race.second])).toBe(0);
    evidence.push({
      case: 'invitation-replay',
      lockWaitMs: race.lockWaitMs,
      firstDurationMs: race.first.durationMs,
      secondDurationMs: race.second.durationMs,
      deadlocks: 0,
    });
  });

  it.each([['accept-first', 'accept'] as const, ['revoke-first', 'revoke'] as const])(
    'keeps accept versus revoke terminally consistent for %s',
    async (caseName, firstKind) => {
      const owner = await createUser(caseName, 'owner');
      const invitee = await createUser(caseName, 'invitee');
      const organization = await createOrganization(owner.id, caseName);
      await createOrganizationMember({
        caseName,
        key: 'owner',
        organizationId: organization.id,
        userId: owner.id,
        role: 'owner',
      });
      const secret = randomBytes(32).toString('base64url');
      const invitationDigest = createHash('sha256').update(secret).digest('hex');
      const invitation = await createInvitation({
        caseName,
        organizationId: organization.id,
        invitedByUserId: owner.id,
        secret,
      });
      const accept = (db: DB) =>
        acceptInvitation({ db, actorExternalId: invitee.externalId, token: secret });
      const revoke = (db: DB) =>
        revokeInvitation({
          db,
          actorExternalId: owner.externalId,
          organizationExternalId: organization.externalId,
          invitationExternalId: invitation.externalId,
        });

      const race = await runOrganizationLockRace({
        caseName,
        firstBoundary: compileSqlBoundary(
          firstKind === 'accept'
            ? __organizationInvitationServiceInternals
                .buildLockedInvitationByHashQuery(compileDb, organization.id, invitationDigest)
                .toSQL()
            : __organizationInvitationServiceInternals
                .buildLockedInvitationByExternalIdQuery(
                  compileDb,
                  organization.id,
                  invitation.externalId,
                )
                .toSQL(),
        ),
        first: firstKind === 'accept' ? accept : revoke,
        second: firstKind === 'accept' ? revoke : accept,
      });
      expect(race.first.ok).toBe(true);
      expectDomainError(race.second, 'INVITATION_NOT_AVAILABLE');

      const invitationRows = await databaseRows<
        mysql.RowDataPacket & { acceptedAt: Date | null; revokedAt: Date | null }
      >(
        'SELECT accepted_at AS acceptedAt, revoked_at AS revokedAt FROM organization_invitations WHERE id = ?',
        [invitation.id],
      );
      assertInvitationTerminalRow(invitationRows, firstKind === 'accept' ? 'accepted' : 'revoked');
      const membershipRows = await databaseRows<
        mysql.RowDataPacket & { status: string; role: string }
      >('SELECT status, role FROM organization_members WHERE organization_id = ? AND user_id = ?', [
        organization.id,
        invitee.id,
      ]);
      expect(membershipRows).toEqual(
        firstKind === 'accept' ? [{ status: 'active', role: 'member' }] : [],
      );
      expect(deadlockCount([race.first, race.second])).toBe(0);
      evidence.push({
        case: caseName,
        lockWaitMs: race.lockWaitMs,
        firstDurationMs: race.first.durationMs,
        secondDurationMs: race.second.durationMs,
        deadlocks: 0,
      });
    },
  );

  it('rejects acceptance after a waiting organization switch is disabled', async () => {
    const caseName = 'organization-disable-accept';
    const owner = await createUser(caseName, 'owner');
    const invitee = await createUser(caseName, 'invitee');
    const organization = await createOrganization(owner.id, caseName);
    await createOrganizationMember({
      caseName,
      key: 'owner',
      organizationId: organization.id,
      userId: owner.id,
      role: 'owner',
    });
    const secret = randomBytes(32).toString('base64url');
    const invitation = await createInvitation({
      caseName,
      organizationId: organization.id,
      invitedByUserId: owner.id,
      secret,
    });
    const blocker = await openEndpoint();
    const accepter = await openEndpoint();
    let blockerTransactionOpen = false;
    let lockWaitMs = 0;
    let outcome: OperationOutcome;
    const blockerStartedAt = performance.now();
    try {
      await blocker.connection.beginTransaction();
      blockerTransactionOpen = true;
      const [disabled] = await blocker.connection.execute<mysql.ResultSetHeader>(
        'UPDATE organizations SET team_projects_enabled = FALSE WHERE id = ?',
        [organization.id],
      );
      expect(disabled.affectedRows).toBe(1);
      const acceptance = capture(
        acceptInvitation({ db: accepter.db, actorExternalId: invitee.externalId, token: secret }),
      );
      lockWaitMs = await waitForLockWait(accepter.threadId, blocker.threadId);
      await runWithActiveTimeout(blocker.connection.commit(), {
        label: 'organization-disable blocker commit',
        timeoutMs: CLEANUP_TIMEOUT_MS,
        settleTimeoutMs: CLEANUP_TIMEOUT_MS,
        onTimeout: () => blocker.connection.destroy(),
      });
      blockerTransactionOpen = false;
      outcome = await runWithActiveTimeout(acceptance, {
        label: caseName,
        timeoutMs: OPERATION_TIMEOUT_MS,
        settleTimeoutMs: CLEANUP_TIMEOUT_MS,
        onTimeout: () => accepter.connection.destroy(),
      });
    } finally {
      if (blockerTransactionOpen) {
        await runBoundedCleanup(
          [
            {
              label: 'rollback organization-disable blocker',
              run: () => blocker.connection.rollback(),
              onTimeout: () => blocker.connection.destroy(),
              onFailure: () => blocker.connection.destroy(),
            },
          ],
          CLEANUP_TIMEOUT_MS,
        );
      }
    }
    const blockerDurationMs = performance.now() - blockerStartedAt;

    expectDomainError(outcome, 'INVITATION_NOT_AVAILABLE');
    const invitationRows = await databaseRows<
      mysql.RowDataPacket & { acceptedAt: Date | null; revokedAt: Date | null }
    >(
      'SELECT accepted_at AS acceptedAt, revoked_at AS revokedAt FROM organization_invitations WHERE id = ?',
      [invitation.id],
    );
    assertInvitationPendingRow(invitationRows);
    const [membershipRow] = await databaseRows<mysql.RowDataPacket & { rowCount: number }>(
      'SELECT COUNT(*) AS rowCount FROM organization_members WHERE organization_id = ? AND user_id = ?',
      [organization.id, invitee.id],
    );
    expect(Number(membershipRow?.rowCount)).toBe(0);
    const organizationRows = await databaseRows<
      mysql.RowDataPacket & { teamProjectsEnabled: number }
    >('SELECT team_projects_enabled AS teamProjectsEnabled FROM organizations WHERE id = ?', [
      organization.id,
    ]);
    assertDisabledOrganizationRow(organizationRows);
    expect(blocker.recorder.transactionActions()).toEqual(['begin', 'commit']);
    expect(accepter.recorder.transactionActions()).toEqual(['begin', 'rollback']);
    expect(deadlockCount([outcome])).toBe(0);
    evidence.push({
      case: 'organization-disable-accept',
      lockWaitMs,
      firstDurationMs: blockerDurationMs,
      secondDurationMs: outcome.durationMs,
      deadlocks: 0,
    });
  });
});

describe.sequential('team workspace MySQL organization races', () => {
  it.each([
    ['report-first-demotion', true, 'demote'] as const,
    ['demotion-first-report', false, 'demote'] as const,
    ['report-first-deactivation', true, 'deactivate'] as const,
    ['deactivation-first-report', false, 'deactivate'] as const,
  ])(
    'serializes reporting-line assignment with manager mutation for %s',
    async (caseName, reportingFirst, mutationKind) => {
      const fixture = await createReportingFixture(caseName);
      const reporting = (db: DB) =>
        updateReportingLine({
          db,
          actorExternalId: fixture.owner.externalId,
          organizationExternalId: fixture.organization.externalId,
          targetMemberExternalId: fixture.subordinateMembership.externalId,
          managerMemberExternalId: fixture.managerMembership.externalId,
        });
      const managerMutation = (db: DB) =>
        mutationKind === 'demote'
          ? updateMemberRole({
              db,
              actorExternalId: fixture.owner.externalId,
              organizationExternalId: fixture.organization.externalId,
              targetMemberExternalId: fixture.managerMembership.externalId,
              nextRole: 'member',
            })
          : deactivateMember({
              db,
              actorExternalId: fixture.owner.externalId,
              organizationExternalId: fixture.organization.externalId,
              targetMemberExternalId: fixture.managerMembership.externalId,
            });

      const race = await runOrganizationLockRace({
        caseName,
        firstBoundary: organizationMemberLockBoundary(
          fixture.organization.id,
          reportingFirst
            ? [fixture.subordinateMembership.externalId, fixture.managerMembership.externalId]
            : [fixture.managerMembership.externalId],
        ),
        first: reportingFirst ? reporting : managerMutation,
        second: reportingFirst ? managerMutation : reporting,
      });
      const reportingOutcome = reportingFirst ? race.first : race.second;
      const mutationOutcome = reportingFirst ? race.second : race.first;

      expect(mutationOutcome.ok).toBe(true);
      if (reportingFirst) {
        expect(reportingOutcome.ok).toBe(true);
      } else {
        expectDomainError(reportingOutcome, 'PERMISSION_DENIED');
      }
      const [managerRow] = await databaseRows<
        mysql.RowDataPacket & { role: string; status: string }
      >('SELECT role, status FROM organization_members WHERE id = ?', [
        fixture.managerMembership.id,
      ]);
      const [subordinateRow] = await databaseRows<
        mysql.RowDataPacket & { managerUserId: number | null }
      >('SELECT manager_user_id AS managerUserId FROM organization_members WHERE id = ?', [
        fixture.subordinateMembership.id,
      ]);
      const [projectMembershipRow] = await databaseRows<mysql.RowDataPacket & { status: string }>(
        'SELECT status FROM project_members WHERE id = ?',
        [fixture.managerProjectMembership.id],
      );
      expect(subordinateRow?.managerUserId).toBeNull();
      if (mutationKind === 'demote') {
        expect(managerRow).toMatchObject({ role: 'member', status: 'active' });
        expect(projectMembershipRow?.status).toBe('active');
      } else {
        expect(managerRow).toMatchObject({ role: 'manager', status: 'inactive' });
        expect(projectMembershipRow?.status).toBe('inactive');
      }
      expect(deadlockCount([race.first, race.second])).toBe(0);
      evidence.push({
        case: caseName,
        lockWaitMs: race.lockWaitMs,
        firstDurationMs: race.first.durationMs,
        secondDurationMs: race.second.durationMs,
        deadlocks: 0,
      });
    },
  );

  it.each([
    ['owner-demotion-first', 'demote'] as const,
    ['owner-deactivation-first', 'deactivate'] as const,
  ])('serializes competing owner mutations for %s', async (caseName, firstKind) => {
    const fixture = await createTwoOwnerFixture(caseName);
    const demoteB = (db: DB) =>
      updateMemberRole({
        db,
        actorExternalId: fixture.ownerA.externalId,
        organizationExternalId: fixture.organization.externalId,
        targetMemberExternalId: fixture.membershipB.externalId,
        nextRole: 'member',
      });
    const deactivateA = (db: DB) =>
      deactivateMember({
        db,
        actorExternalId: fixture.ownerB.externalId,
        organizationExternalId: fixture.organization.externalId,
        targetMemberExternalId: fixture.membershipA.externalId,
      });
    const race = await runOrganizationLockRace({
      caseName,
      firstBoundary: organizationMemberLockBoundary(fixture.organization.id, [
        firstKind === 'demote' ? fixture.membershipB.externalId : fixture.membershipA.externalId,
      ]),
      first: firstKind === 'demote' ? demoteB : deactivateA,
      second: firstKind === 'demote' ? deactivateA : demoteB,
    });

    expect(race.first.ok).toBe(true);
    expect(race.second.ok).toBe(false);
    if (!race.second.ok) {
      expect(['PERMISSION_DENIED', 'ORGANIZATION_NOT_FOUND']).toContain(
        errorField(race.second.error, 'code'),
      );
    }
    const owners = await activeOwnerCount(fixture.organization.id);
    expect(owners).toBe(1);
    expect(deadlockCount([race.first, race.second])).toBe(0);
    evidence.push({
      case: caseName,
      lockWaitMs: race.lockWaitMs,
      firstDurationMs: race.first.durationMs,
      secondDurationMs: race.second.durationMs,
      deadlocks: 0,
      finalActiveOwners: owners,
    });
  });

  it('rolls back a guarded zero-row owner update before the serialized mutation proceeds', async () => {
    const caseName = 'owner-zero-row-rollback';
    const fixture = await createTwoOwnerFixture(caseName);
    const updateBoundary = compileSqlBoundary(
      compileDb
        .update(organizationMembers)
        .set({ role: 'member' })
        .where(
          and(
            eq(organizationMembers.id, fixture.membershipB.id),
            eq(organizationMembers.status, 'active'),
          ),
        )
        .toSQL(),
      { dynamicDateParameterIndexes: [1] },
    );
    const override = createAffectedRowsOverride({
      matches: (invocation) => matchesSqlBoundary(updateBoundary, invocation),
      affectedRows: 0,
    });
    const race = await runOrganizationLockRace({
      caseName,
      firstBoundary: organizationMemberLockBoundary(fixture.organization.id, [
        fixture.membershipB.externalId,
      ]),
      firstResultOverrides: [override],
      first: (db) =>
        updateMemberRole({
          db,
          actorExternalId: fixture.ownerA.externalId,
          organizationExternalId: fixture.organization.externalId,
          targetMemberExternalId: fixture.membershipB.externalId,
          nextRole: 'member',
        }),
      second: (db) =>
        deactivateMember({
          db,
          actorExternalId: fixture.ownerB.externalId,
          organizationExternalId: fixture.organization.externalId,
          targetMemberExternalId: fixture.membershipA.externalId,
        }),
    });

    expectDomainError(race.first, 'MEMBER_NOT_FOUND');
    expect(race.second.ok).toBe(true);
    const [ownerBRow] = await databaseRows<mysql.RowDataPacket & { role: string; status: string }>(
      'SELECT role, status FROM organization_members WHERE id = ?',
      [fixture.membershipB.id],
    );
    expect(ownerBRow).toMatchObject({ role: 'owner', status: 'active' });
    expect(race.firstRecorder.transactionActions()).toEqual(['begin', 'rollback']);
    expect(race.secondRecorder.transactionActions()).toEqual(['begin', 'commit']);
    const owners = await activeOwnerCount(fixture.organization.id);
    expect(owners).toBe(1);
    expect(deadlockCount([race.first, race.second])).toBe(0);
    evidence.push({
      case: caseName,
      lockWaitMs: race.lockWaitMs,
      firstDurationMs: race.first.durationMs,
      secondDurationMs: race.second.durationMs,
      deadlocks: 0,
      finalActiveOwners: owners,
    });
  });

  it.each([
    ['local-target-foreign-manager', false] as const,
    ['foreign-target-local-manager', true] as const,
  ])(
    'rejects inverse foreign member inputs without waiting on the foreign organization for %s',
    async (caseName, foreignIsTarget) => {
      const actor = await createUser(caseName, 'actor');
      const localTarget = await createUser(caseName, 'local-target');
      const localManager = await createUser(caseName, 'local-manager');
      const requestedOrganization = await createOrganization(actor.id, caseName, 'requested');
      await createOrganizationMember({
        caseName,
        key: 'actor',
        organizationId: requestedOrganization.id,
        userId: actor.id,
        role: 'owner',
      });
      const localTargetMembership = await createOrganizationMember({
        caseName,
        key: 'local-target',
        organizationId: requestedOrganization.id,
        userId: localTarget.id,
        role: 'member',
      });
      const localManagerMembership = await createOrganizationMember({
        caseName,
        key: 'local-manager',
        organizationId: requestedOrganization.id,
        userId: localManager.id,
        role: 'manager',
      });
      const foreignOwner = await createUser(caseName, 'foreign-owner');
      const foreignManager = await createUser(caseName, 'foreign-manager');
      const foreignOrganization = await createOrganization(foreignOwner.id, caseName, 'foreign');
      await createOrganizationMember({
        caseName,
        key: 'foreign-owner',
        organizationId: foreignOrganization.id,
        userId: foreignOwner.id,
        role: 'owner',
      });
      const foreignMembership = await createOrganizationMember({
        caseName,
        key: 'foreign-manager',
        organizationId: foreignOrganization.id,
        userId: foreignManager.id,
        role: 'manager',
      });
      const readIsolationState = async () => ({
        organizations: await databaseRows<
          mysql.RowDataPacket & {
            id: number;
            externalId: string;
            ownerUserId: number;
            status: string;
            teamProjectsEnabled: number;
          }
        >(
          `SELECT id, external_id AS externalId, owner_user_id AS ownerUserId,
                  status, team_projects_enabled AS teamProjectsEnabled
           FROM organizations WHERE id IN (?, ?) ORDER BY id`,
          [requestedOrganization.id, foreignOrganization.id],
        ),
        members: await databaseRows<
          mysql.RowDataPacket & {
            id: number;
            externalId: string;
            organizationId: number;
            userId: number;
            managerUserId: number | null;
            role: string;
            status: string;
          }
        >(
          `SELECT id, external_id AS externalId, organization_id AS organizationId,
                  user_id AS userId, manager_user_id AS managerUserId, role, status
           FROM organization_members
           WHERE organization_id IN (?, ?)
           ORDER BY organization_id, id`,
          [requestedOrganization.id, foreignOrganization.id],
        ),
      });
      const beforeState = await readIsolationState();
      const blocker = await openEndpoint();
      const operationEndpoint = await openEndpoint();
      let blockerTransactionOpen = false;
      let outcome!: OperationOutcome;
      const blockerStartedAt = performance.now();
      try {
        await blocker.connection.beginTransaction();
        blockerTransactionOpen = true;
        await blocker.connection.execute('SELECT id FROM organizations WHERE id = ? FOR UPDATE', [
          foreignOrganization.id,
        ]);
        outcome = await runWithActiveTimeout(
          capture(
            updateReportingLine({
              db: operationEndpoint.db,
              actorExternalId: actor.externalId,
              organizationExternalId: requestedOrganization.externalId,
              targetMemberExternalId: foreignIsTarget
                ? foreignMembership.externalId
                : localTargetMembership.externalId,
              managerMemberExternalId: foreignIsTarget
                ? localManagerMembership.externalId
                : foreignMembership.externalId,
            }),
          ),
          {
            label: caseName,
            timeoutMs: 3_000,
            settleTimeoutMs: CLEANUP_TIMEOUT_MS,
            onTimeout: () => operationEndpoint.connection.destroy(),
          },
        );
      } finally {
        if (blockerTransactionOpen) {
          await runBoundedCleanup(
            [
              {
                label: `${caseName} foreign blocker rollback`,
                run: () => blocker.connection.rollback(),
                onTimeout: () => blocker.connection.destroy(),
                onFailure: () => blocker.connection.destroy(),
              },
            ],
            CLEANUP_TIMEOUT_MS,
          );
          blockerTransactionOpen = false;
        }
      }
      const blockerDurationMs = performance.now() - blockerStartedAt;

      expectDomainError(outcome, 'MEMBER_NOT_FOUND');
      assertForeignReportingLineIsolationEvidence({
        recorder: operationEndpoint.recorder,
        requestedOrganizationId: requestedOrganization.id,
        requestedOrganizationExternalId: requestedOrganization.externalId,
        foreignOrganizationId: foreignOrganization.id,
        foreignOrganizationExternalId: foreignOrganization.externalId,
        actorUserId: actor.id,
        localMemberExternalId: foreignIsTarget
          ? localManagerMembership.externalId
          : localTargetMembership.externalId,
        foreignMemberExternalId: foreignMembership.externalId,
      });

      const [inactiveResult] = await admin.execute<mysql.ResultSetHeader>(
        'UPDATE organization_members SET status = ? WHERE id = ?',
        ['inactive', localManagerMembership.id],
      );
      expect(inactiveResult.affectedRows).toBe(1);
      const inactiveManagerOutcome = await capture(
        updateReportingLine({
          db: operationEndpoint.db,
          actorExternalId: actor.externalId,
          organizationExternalId: requestedOrganization.externalId,
          targetMemberExternalId: localTargetMembership.externalId,
          managerMemberExternalId: localManagerMembership.externalId,
        }),
      );
      expectDomainError(inactiveManagerOutcome, 'PERMISSION_DENIED');
      const [wrongRoleResult] = await admin.execute<mysql.ResultSetHeader>(
        'UPDATE organization_members SET status = ?, role = ? WHERE id = ?',
        ['active', 'member', localManagerMembership.id],
      );
      expect(wrongRoleResult.affectedRows).toBe(1);
      const wrongRoleManagerOutcome = await capture(
        updateReportingLine({
          db: operationEndpoint.db,
          actorExternalId: actor.externalId,
          organizationExternalId: requestedOrganization.externalId,
          targetMemberExternalId: localTargetMembership.externalId,
          managerMemberExternalId: localManagerMembership.externalId,
        }),
      );
      expectDomainError(wrongRoleManagerOutcome, 'PERMISSION_DENIED');
      const [restoreResult] = await admin.execute<mysql.ResultSetHeader>(
        'UPDATE organization_members SET role = ? WHERE id = ?',
        ['manager', localManagerMembership.id],
      );
      expect(restoreResult.affectedRows).toBe(1);
      expect(await readIsolationState()).toEqual(beforeState);
      expect(blocker.recorder.transactionActions()).toEqual(['begin', 'rollback']);
      expect(deadlockCount([outcome])).toBe(0);
      evidence.push({
        case: caseName,
        lockWaitMs: null,
        firstDurationMs: blockerDurationMs,
        secondDurationMs: outcome.durationMs,
        deadlocks: 0,
      });
    },
  );
});

describe.sequential('team workspace MySQL project snapshot and lock-order races', () => {
  it('keeps an organization project list on one pre-create snapshot and fresh reads see the commit', async () => {
    const caseName = 'project-list-versus-create';
    const owner = await createUser(caseName, 'owner');
    const organization = await createOrganization(owner.id, caseName);
    await createOrganizationMember({
      caseName,
      key: 'owner',
      organizationId: organization.id,
      userId: owner.id,
      role: 'owner',
    });
    const readPause = pauseAfterBoundary(
      'project-list-auth-snapshot',
      compileSqlBoundary(
        __teamProjectServiceInternals
          .buildActiveTeamOrganizationMembershipQuery(
            compileDb,
            owner.externalId,
            organization.externalId,
          )
          .toSQL(),
      ),
    );
    const reader = await openEndpoint([readPause]);
    const writer = await openEndpoint();
    const readPromise = capture(
      listTeamProjects({
        db: reader.db,
        actorExternalId: owner.externalId,
        organizationExternalId: organization.externalId,
      }),
    );
    let writeOutcome!: OperationOutcome;
    let readSettled = false;
    try {
      await readPause.waitUntilReached(BARRIER_TIMEOUT_MS);
      writeOutcome = await runWithActiveTimeout(
        capture(
          createTeamProject({
            db: writer.db,
            actorExternalId: owner.externalId,
            organizationExternalId: organization.externalId,
            name: 'Snapshot-created project',
            description: null,
          }),
        ),
        {
          label: caseName,
          timeoutMs: OPERATION_TIMEOUT_MS,
          settleTimeoutMs: CLEANUP_TIMEOUT_MS,
          onTimeout: () => writer.connection.destroy(),
        },
      );
      expect(writeOutcome.ok).toBe(true);
      readPause.release();
      const readOutcome = await runWithActiveTimeout(readPromise, {
        label: 'project-list-snapshot-read',
        timeoutMs: OPERATION_TIMEOUT_MS,
        settleTimeoutMs: CLEANUP_TIMEOUT_MS,
        onTimeout: () => reader.connection.destroy(),
      });
      readSettled = true;
      expect(readOutcome.ok).toBe(true);
      if (readOutcome.ok) expect(readOutcome.value).toEqual([]);
      const freshRows = await listTeamProjects({
        db: writer.db,
        actorExternalId: owner.externalId,
        organizationExternalId: organization.externalId,
      });
      expect(freshRows).toHaveLength(1);
      expect(freshRows[0]).toMatchObject({
        name: 'Snapshot-created project',
        scope: 'organization',
        organizationId: organization.externalId,
      });
      expect(deadlockCount([readOutcome, writeOutcome])).toBe(0);
      evidence.push({
        case: 'project-list-versus-create',
        lockWaitMs: null,
        firstDurationMs: readOutcome.durationMs,
        secondDurationMs: writeOutcome.durationMs,
        deadlocks: 0,
      });
    } finally {
      readPause.release();
      if (!readSettled) {
        await runWithActiveTimeout(readPromise, {
          label: 'project-list read failure cleanup',
          timeoutMs: CLEANUP_TIMEOUT_MS,
          settleTimeoutMs: CLEANUP_TIMEOUT_MS,
          onTimeout: () => reader.connection.destroy(),
        });
      }
    }
  });

  it.each([
    ['project-get-versus-deactivation', 'get'] as const,
    ['project-roster-versus-deactivation', 'roster'] as const,
  ])(
    'keeps project authorization and payload on one snapshot for %s',
    async (caseName, readKind) => {
      const fixture = await createProjectReadFixture(caseName);
      const readPause = pauseAfterBoundary(
        `${caseName}-access-snapshot`,
        compileSqlBoundary(
          __projectAccessInternals
            .buildProjectAccessSnapshotQuery(compileDb, {
              actorExternalId: fixture.reader.externalId,
              projectExternalId: fixture.project.externalId,
            })
            .toSQL(),
        ),
      );
      const reader = await openEndpoint([readPause]);
      const writer = await openEndpoint();
      const read = async (db: DB): Promise<unknown> =>
        readKind === 'get'
          ? getTeamProjectWithAccess(db, {
              actorExternalId: fixture.reader.externalId,
              projectExternalId: fixture.project.externalId,
            })
          : listProjectMembersWithAccess(db, {
              actorExternalId: fixture.reader.externalId,
              projectExternalId: fixture.project.externalId,
            });
      const readPromise = capture(read(reader.db));
      let readSettled = false;
      try {
        await readPause.waitUntilReached(BARRIER_TIMEOUT_MS);
        const mutationOutcome = await runWithActiveTimeout(
          capture(
            deactivateMember({
              db: writer.db,
              actorExternalId: fixture.owner.externalId,
              organizationExternalId: fixture.organization.externalId,
              targetMemberExternalId: fixture.readerOrganizationMembership.externalId,
            }),
          ),
          {
            label: caseName,
            timeoutMs: OPERATION_TIMEOUT_MS,
            settleTimeoutMs: CLEANUP_TIMEOUT_MS,
            onTimeout: () => writer.connection.destroy(),
          },
        );
        expect(mutationOutcome.ok).toBe(true);
        readPause.release();
        const readOutcome = await runWithActiveTimeout(readPromise, {
          label: caseName,
          timeoutMs: OPERATION_TIMEOUT_MS,
          settleTimeoutMs: CLEANUP_TIMEOUT_MS,
          onTimeout: () => reader.connection.destroy(),
        });
        readSettled = true;
        expect(readOutcome.ok).toBe(true);
        if (readOutcome.ok && readKind === 'get') {
          expect(readOutcome.value).toMatchObject({
            externalId: fixture.project.externalId,
            scope: 'organization',
          });
        }
        if (readOutcome.ok && readKind === 'roster') {
          expect(readOutcome.value).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ userId: fixture.reader.externalId }),
            ]),
          );
        }
        const freshOutcome = await capture(read(writer.db));
        expectDomainError(freshOutcome, 'NOT_FOUND');
        const [organizationMembership] = await databaseRows<
          mysql.RowDataPacket & { status: string }
        >('SELECT status FROM organization_members WHERE id = ?', [
          fixture.readerOrganizationMembership.id,
        ]);
        const [projectMembership] = await databaseRows<mysql.RowDataPacket & { status: string }>(
          'SELECT status FROM project_members WHERE id = ?',
          [fixture.readerProjectMembership.id],
        );
        expect(organizationMembership?.status).toBe('inactive');
        expect(projectMembership?.status).toBe('inactive');
        expect(deadlockCount([readOutcome, mutationOutcome, freshOutcome])).toBe(0);
        evidence.push({
          case: caseName,
          lockWaitMs: null,
          firstDurationMs: readOutcome.durationMs,
          secondDurationMs: mutationOutcome.durationMs,
          deadlocks: 0,
        });
      } finally {
        readPause.release();
        if (!readSettled) {
          await runWithActiveTimeout(readPromise, {
            label: `${caseName} read failure cleanup`,
            timeoutMs: CLEANUP_TIMEOUT_MS,
            settleTimeoutMs: CLEANUP_TIMEOUT_MS,
            onTimeout: () => reader.connection.destroy(),
          });
        }
      }
    },
  );

  it.each([
    ['deactivation-first-project-removal', 'deactivate'] as const,
    ['project-removal-first-deactivation', 'remove'] as const,
  ])(
    'uses one canonical lock order and preserves an active lead for %s',
    async (caseName, firstKind) => {
      const fixture = await createProjectWriteRaceFixture(caseName);
      const deactivateLeadA = (db: DB) =>
        deactivateMember({
          db,
          actorExternalId: fixture.actor.externalId,
          organizationExternalId: fixture.organization.externalId,
          targetMemberExternalId: fixture.leadAOrganizationMembership.externalId,
        });
      const removeLeadB = (db: DB) =>
        removeProjectMemberWithAccess(
          db,
          {
            actorExternalId: fixture.actor.externalId,
            projectExternalId: fixture.project.externalId,
          },
          fixture.leadBProjectMembership.externalId,
        );
      const race = await runOrganizationLockRace({
        caseName,
        firstBoundary:
          firstKind === 'deactivate'
            ? organizationMemberLockBoundary(fixture.organization.id, [
                fixture.leadAOrganizationMembership.externalId,
              ])
            : compileSqlBoundary(
                __projectAccessInternals
                  .buildLockedOrganizationQuery(
                    compileDb,
                    fixture.organization.id,
                    fixture.organization.externalId,
                  )
                  .toSQL(),
              ),
        first: firstKind === 'deactivate' ? deactivateLeadA : removeLeadB,
        second: firstKind === 'deactivate' ? removeLeadB : deactivateLeadA,
      });

      expect(race.first.ok).toBe(true);
      expect(race.second.ok).toBe(false);
      if (!race.second.ok) {
        expect(errorField(race.second.error, 'code')).toBe(
          firstKind === 'deactivate' ? 'CONFLICT' : 'SOLE_PROJECT_LEAD',
        );
      }
      const leads = await activeLeadCount(fixture.project.id);
      expect(leads).toBe(1);
      const memberships = await databaseRows<
        mysql.RowDataPacket & { userId: number; organizationStatus: string; projectStatus: string }
      >(
        `SELECT om.user_id AS userId,
                om.status AS organizationStatus,
                pm.status AS projectStatus
         FROM organization_members AS om
         INNER JOIN project_members AS pm
           ON pm.user_id = om.user_id AND pm.project_id = ?
         WHERE om.organization_id = ? AND om.user_id IN (?, ?)
         ORDER BY om.user_id`,
        [fixture.project.id, fixture.organization.id, fixture.leadA.id, fixture.leadB.id],
      );
      expect(memberships).toHaveLength(2);
      expect(
        memberships.every(
          (membership) =>
            membership.organizationStatus === 'active' || membership.projectStatus === 'inactive',
        ),
      ).toBe(true);
      expect(deadlockCount([race.first, race.second])).toBe(0);
      evidence.push({
        case: caseName,
        lockWaitMs: race.lockWaitMs,
        firstDurationMs: race.first.durationMs,
        secondDurationMs: race.second.durationMs,
        deadlocks: 0,
        finalActiveLeads: leads,
      });
    },
  );
});
