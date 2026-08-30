import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import { removeProjectMemberWithAccess } from '../projects/project-access.js';
import {
  PROJECT_TASK_FOREIGN_KEY_QUERY,
  type ProjectTaskForeignKeyRow,
  assertExactProjectTaskForeignKey,
} from '../projects/team-project-integration-safety.js';
import {
  type SqlCheckpoint,
  type SqlResultOverride,
  createAffectedRowsOverride,
  createSqlCheckpoint,
  instrumentMysqlConnection,
  isOrganizationLockSql,
  isOrganizationMembershipSnapshotSql,
  isProjectAccessSnapshotSql,
} from '../projects/team-project-race-harness.js';
import {
  createTeamProject,
  getTeamProjectWithAccess,
  listProjectMembersWithAccess,
  listTeamProjects,
} from '../projects/team-project-service.js';
import { acceptInvitation, revokeInvitation } from './organization-invitation-service.js';
import { deactivateMember, updateMemberRole, updateReportingLine } from './organization-service.js';

const DESTRUCTIVE_OPT_IN = 'DESTROY_FRESH_HOLADAY_TEAM_PROJECTS_IT_DATABASE';
const BARRIER_TIMEOUT_MS = 10_000;
const LOCK_WAIT_TIMEOUT_MS = 10_000;
const OPERATION_TIMEOUT_MS = 15_000;

type MysqlConnection = Awaited<ReturnType<typeof mysql.createConnection>>;

type Endpoint = {
  connection: MysqlConnection;
  db: DB;
  threadId: number;
};

type OperationOutcome<T = unknown> =
  | { ok: true; value: T; durationMs: number }
  | { ok: false; error: unknown; durationMs: number };

type RaceEvidence = {
  case: string;
  lockWaitMs: number;
  firstDurationMs: number;
  secondDurationMs: number;
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

function requireIntegrationEnvironment(): string {
  const rawUrl = process.env.TEAM_PROJECTS_INTEGRATION_DATABASE_URL;
  if (!rawUrl) {
    throw new Error('TEAM_PROJECTS_INTEGRATION_DATABASE_URL is required for this integration file');
  }
  if (process.env.TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY !== DESTRUCTIVE_OPT_IN) {
    throw new Error(
      `TEAM_PROJECTS_INTEGRATION_CONFIRM_DESTROY must exactly equal ${DESTRUCTIVE_OPT_IN}`,
    );
  }
  const parsed = new URL(rawUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (
    parsed.protocol !== 'mysql:' ||
    !databaseName.startsWith('holaday_team_projects_it_') ||
    /(?:prod|production|stage|staging|shared)/i.test(databaseName)
  ) {
    throw new Error(
      'integration database must use the holaday_team_projects_it_ prefix and cannot contain production, staging, or shared tokens',
    );
  }
  return rawUrl;
}

const databaseUrl = requireIntegrationEnvironment();
const evidence: RaceEvidence[] = [];
const openConnections = new Set<MysqlConnection>();
const openCheckpoints = new Set<SqlCheckpoint>();
let admin: MysqlConnection;
let fixtureSerial = 0;
let isolationLevel = '';

function nextSuffix(): string {
  fixtureSerial += 1;
  return `${Date.now().toString(36).slice(-6)}${fixtureSerial.toString(36)}`;
}

function externalId(prefix: string, suffix: string): string {
  return `${prefix}_it_${suffix}`.slice(0, 32);
}

async function insertRow(sql: string, values: readonly unknown[]): Promise<number> {
  const [result] = await admin.execute<mysql.ResultSetHeader>(sql, [...values]);
  if (result.affectedRows !== 1 || result.insertId <= 0) {
    throw new Error('integration fixture insert did not affect exactly one row');
  }
  return result.insertId;
}

async function createUser(tag: string): Promise<UserFixture> {
  const suffix = nextSuffix();
  const external = externalId(`usr_${tag}`, suffix);
  const id = await insertRow(
    'INSERT INTO users (external_id, email, password_hash) VALUES (?, ?, ?)',
    [external, `${tag}.${suffix}@team-workspace.integration.test`, 'integration-test-only'],
  );
  return { id, externalId: external };
}

async function createOrganization(
  ownerUserId: number,
  tag: string,
  teamProjectsEnabled = true,
): Promise<OrganizationFixture> {
  const suffix = nextSuffix();
  const external = externalId(`org_${tag}`, suffix);
  const id = await insertRow(
    'INSERT INTO organizations (external_id, name, owner_user_id, status, team_projects_enabled) VALUES (?, ?, ?, ?, ?)',
    [external, `Integration ${tag} ${suffix}`, ownerUserId, 'active', teamProjectsEnabled],
  );
  return { id, externalId: external };
}

async function createOrganizationMember(input: {
  organizationId: number;
  userId: number;
  role: 'owner' | 'admin' | 'manager' | 'member';
  status?: 'active' | 'inactive';
  managerUserId?: number | null;
  tag: string;
}): Promise<OrganizationMemberFixture> {
  const suffix = nextSuffix();
  const external = externalId(`omem_${input.tag}`, suffix);
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
  ownerUserId: number;
  organizationId: number;
  tag: string;
}): Promise<ProjectFixture> {
  const suffix = nextSuffix();
  const external = externalId(`prj_${input.tag}`, suffix);
  const id = await insertRow(
    'INSERT INTO projects (external_id, user_id, organization_id, name) VALUES (?, ?, ?, ?)',
    [external, input.ownerUserId, input.organizationId, `Integration project ${suffix}`],
  );
  return { id, externalId: external };
}

async function createProjectMember(input: {
  projectId: number;
  userId: number;
  role: 'lead' | 'member' | 'viewer';
  status?: 'active' | 'inactive';
  tag: string;
}): Promise<ProjectMemberFixture> {
  const suffix = nextSuffix();
  const external = externalId(`pmem_${input.tag}`, suffix);
  const id = await insertRow(
    'INSERT INTO project_members (external_id, project_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)',
    [external, input.projectId, input.userId, input.role, input.status ?? 'active'],
  );
  return { id, externalId: external };
}

async function createInvitation(input: {
  organizationId: number;
  invitedByUserId: number;
  role?: 'admin' | 'manager' | 'member';
  managerUserId?: number | null;
  secret: string;
  tag: string;
}): Promise<{ id: number; externalId: string }> {
  const suffix = nextSuffix();
  const external = externalId(`oinv_${input.tag}`, suffix);
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

function pauseAfterOrganizationLock(label: string): SqlCheckpoint {
  const checkpoint = createSqlCheckpoint({
    label,
    phase: 'after',
    matches: isOrganizationLockSql,
  });
  openCheckpoints.add(checkpoint);
  return checkpoint;
}

function signalBeforeOrganizationLock(label: string): SqlCheckpoint {
  const checkpoint = createSqlCheckpoint({
    label,
    phase: 'before',
    matches: isOrganizationLockSql,
  });
  checkpoint.release();
  openCheckpoints.add(checkpoint);
  return checkpoint;
}

function pauseAfterProjectAccessSnapshot(label: string): SqlCheckpoint {
  const checkpoint = createSqlCheckpoint({
    label,
    phase: 'after',
    matches: isProjectAccessSnapshotSql,
  });
  openCheckpoints.add(checkpoint);
  return checkpoint;
}

function pauseAfterOrganizationMembershipSnapshot(label: string): SqlCheckpoint {
  const checkpoint = createSqlCheckpoint({
    label,
    phase: 'after',
    matches: isOrganizationMembershipSnapshotSql,
  });
  openCheckpoints.add(checkpoint);
  return checkpoint;
}

async function openEndpoint(
  checkpoints: readonly SqlCheckpoint[] = [],
  resultOverrides: readonly SqlResultOverride[] = [],
): Promise<Endpoint> {
  const connection = await mysql.createConnection({
    uri: databaseUrl,
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  openConnections.add(connection);
  const [[thread]] = await connection.query<Array<mysql.RowDataPacket & { threadId: number }>>(
    'SELECT CONNECTION_ID() AS threadId',
  );
  if (!thread) throw new Error('integration connection id unavailable');
  const instrumented = instrumentMysqlConnection(connection, checkpoints, resultOverrides);
  const db = drizzle(instrumented, {
    schema,
    mode: 'default',
    casing: 'snake_case',
  }) as unknown as DB;
  return { connection, db, threadId: Number(thread.threadId) };
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`timed out: ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
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
    const [rows] = await admin.execute<mysql.RowDataPacket[]>(
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
    );
    if (rows.length > 0) return performance.now() - startedAt;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('expected MySQL row-lock wait was not observed before the bounded deadline');
}

async function runOrganizationLockRace(input: {
  caseName: string;
  first: (db: DB) => Promise<unknown>;
  second: (db: DB) => Promise<unknown>;
  firstResultOverrides?: readonly SqlResultOverride[];
  secondResultOverrides?: readonly SqlResultOverride[];
}): Promise<{
  first: OperationOutcome;
  second: OperationOutcome;
  lockWaitMs: number;
}> {
  const firstPause = pauseAfterOrganizationLock(`${input.caseName}-first-held`);
  const secondStarted = signalBeforeOrganizationLock(`${input.caseName}-second-started`);
  const firstEndpoint = await openEndpoint([firstPause], input.firstResultOverrides);
  const secondEndpoint = await openEndpoint([secondStarted], input.secondResultOverrides);
  const firstPromise = capture(input.first(firstEndpoint.db));
  let secondPromise: Promise<OperationOutcome> | undefined;
  try {
    await firstPause.waitUntilReached(BARRIER_TIMEOUT_MS);
    secondPromise = capture(input.second(secondEndpoint.db));
    await secondStarted.waitUntilReached(BARRIER_TIMEOUT_MS);
    const lockWaitMs = await waitForLockWait(secondEndpoint.threadId, firstEndpoint.threadId);
    firstPause.release();
    const [first, second] = await withTimeout(
      Promise.all([firstPromise, secondPromise]),
      input.caseName,
      OPERATION_TIMEOUT_MS,
    );
    const transactionStates = await Promise.all(
      [firstEndpoint, secondEndpoint].map(async (endpoint) => {
        const [[row]] = await endpoint.connection.query<
          Array<mysql.RowDataPacket & { inTransaction: number }>
        >('SELECT @@session.in_transaction AS inTransaction');
        return Number(row?.inTransaction ?? -1);
      }),
    );
    if (transactionStates.some((state) => state !== 0)) {
      throw new Error('race operation left a mysql2 session inside a transaction');
    }
    return { first, second, lockWaitMs };
  } finally {
    firstPause.release();
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

async function createReportingFixture(tag: string) {
  const owner = await createUser(`${tag}_owner`);
  const manager = await createUser(`${tag}_manager`);
  const subordinate = await createUser(`${tag}_subordinate`);
  const organization = await createOrganization(owner.id, tag);
  await createOrganizationMember({
    organizationId: organization.id,
    userId: owner.id,
    role: 'owner',
    tag: `${tag}_owner`,
  });
  const managerMembership = await createOrganizationMember({
    organizationId: organization.id,
    userId: manager.id,
    role: 'manager',
    tag: `${tag}_manager`,
  });
  const subordinateMembership = await createOrganizationMember({
    organizationId: organization.id,
    userId: subordinate.id,
    role: 'member',
    managerUserId: null,
    tag: `${tag}_subordinate`,
  });
  const project = await createProject({
    ownerUserId: owner.id,
    organizationId: organization.id,
    tag,
  });
  await createProjectMember({
    projectId: project.id,
    userId: owner.id,
    role: 'lead',
    tag: `${tag}_owner`,
  });
  const managerProjectMembership = await createProjectMember({
    projectId: project.id,
    userId: manager.id,
    role: 'member',
    tag: `${tag}_manager`,
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

async function createTwoOwnerFixture(tag: string) {
  const ownerA = await createUser(`${tag}_a`);
  const ownerB = await createUser(`${tag}_b`);
  const organization = await createOrganization(ownerA.id, tag);
  const membershipA = await createOrganizationMember({
    organizationId: organization.id,
    userId: ownerA.id,
    role: 'owner',
    tag: `${tag}_a`,
  });
  const membershipB = await createOrganizationMember({
    organizationId: organization.id,
    userId: ownerB.id,
    role: 'owner',
    tag: `${tag}_b`,
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

async function createProjectReadFixture(tag: string) {
  const owner = await createUser(`${tag}_owner`);
  const reader = await createUser(`${tag}_reader`);
  const organization = await createOrganization(owner.id, tag);
  await createOrganizationMember({
    organizationId: organization.id,
    userId: owner.id,
    role: 'owner',
    tag: `${tag}_owner`,
  });
  const readerOrganizationMembership = await createOrganizationMember({
    organizationId: organization.id,
    userId: reader.id,
    role: 'member',
    tag: `${tag}_reader`,
  });
  const project = await createProject({
    ownerUserId: owner.id,
    organizationId: organization.id,
    tag,
  });
  await createProjectMember({
    projectId: project.id,
    userId: owner.id,
    role: 'lead',
    tag: `${tag}_owner`,
  });
  const readerProjectMembership = await createProjectMember({
    projectId: project.id,
    userId: reader.id,
    role: 'viewer',
    tag: `${tag}_reader`,
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

async function createProjectWriteRaceFixture(tag: string) {
  const actor = await createUser(`${tag}_actor`);
  const leadA = await createUser(`${tag}_lead_a`);
  const leadB = await createUser(`${tag}_lead_b`);
  const organization = await createOrganization(actor.id, tag);
  await createOrganizationMember({
    organizationId: organization.id,
    userId: actor.id,
    role: 'owner',
    tag: `${tag}_actor`,
  });
  const leadAOrganizationMembership = await createOrganizationMember({
    organizationId: organization.id,
    userId: leadA.id,
    role: 'member',
    tag: `${tag}_lead_a`,
  });
  await createOrganizationMember({
    organizationId: organization.id,
    userId: leadB.id,
    role: 'member',
    tag: `${tag}_lead_b`,
  });
  const project = await createProject({
    ownerUserId: actor.id,
    organizationId: organization.id,
    tag,
  });
  await createProjectMember({
    projectId: project.id,
    userId: actor.id,
    role: 'member',
    tag: `${tag}_actor`,
  });
  const leadAProjectMembership = await createProjectMember({
    projectId: project.id,
    userId: leadA.id,
    role: 'lead',
    tag: `${tag}_lead_a`,
  });
  const leadBProjectMembership = await createProjectMember({
    projectId: project.id,
    userId: leadB.id,
    role: 'lead',
    tag: `${tag}_lead_b`,
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
  admin = await mysql.createConnection({ uri: databaseUrl, timezone: 'Z' });
  await assertDatabaseEmpty();
  const [foreignKeys] = await admin.query<Array<mysql.RowDataPacket & ProjectTaskForeignKeyRow>>(
    PROJECT_TASK_FOREIGN_KEY_QUERY,
  );
  assertExactProjectTaskForeignKey(foreignKeys);
  const [[isolation]] = await admin.query<Array<mysql.RowDataPacket & { isolationLevel: string }>>(
    'SELECT @@transaction_isolation AS isolationLevel',
  );
  isolationLevel = isolation?.isolationLevel ?? '';
  if (isolationLevel !== 'REPEATABLE-READ') {
    throw new Error('race integration database must use the deployed REPEATABLE-READ isolation');
  }
});

beforeEach(async () => {
  await assertDatabaseEmpty();
});

afterEach(async () => {
  for (const checkpoint of openCheckpoints) checkpoint.release();
  openCheckpoints.clear();
  await Promise.allSettled([...openConnections].map((connection) => connection.end()));
  openConnections.clear();
  await cleanupDatabase();
});

afterAll(async () => {
  const aggregate = {
    cases: evidence.length,
    deadlocks: evidence.reduce((sum, item) => sum + item.deadlocks, 0),
    isolationLevel,
    lockWaitMs: evidence.map((item) => Math.round(item.lockWaitMs)),
    operationDurationMs: evidence.map((item) => ({
      case: item.case,
      first: Math.round(item.firstDurationMs),
      second: Math.round(item.secondDurationMs),
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
  expect(JSON.stringify(aggregate)).not.toMatch(/token|hash/i);
  console.info(`TASK14_RACE_EVIDENCE ${JSON.stringify(aggregate)}`);
  await admin?.end();
});

describe.sequential('team workspace MySQL invitation races', () => {
  it('serializes replay so one acceptance commits and the losing transaction rolls back', async () => {
    const owner = await createUser('replay_owner');
    const invitee = await createUser('replay_invitee');
    const organization = await createOrganization(owner.id, 'replay');
    await createOrganizationMember({
      organizationId: organization.id,
      userId: owner.id,
      role: 'owner',
      tag: 'replay_owner',
    });
    const secret = randomBytes(32).toString('base64url');
    const invitation = await createInvitation({
      organizationId: organization.id,
      invitedByUserId: owner.id,
      secret,
      tag: 'replay',
    });
    let consumeQueryCount = 0;
    let membershipMutationQueryCount = 0;
    const consumeRecorder: SqlResultOverride = {
      transform(sql, result) {
        if (sql.startsWith('update `organization_invitations`') && sql.includes('`accepted_at`')) {
          consumeQueryCount += 1;
        }
        if (
          sql.startsWith('insert into `organization_members`') ||
          (sql.startsWith('update `organization_members`') && sql.includes('`status` = ?'))
        ) {
          membershipMutationQueryCount += 1;
        }
        return result;
      },
    };

    const race = await runOrganizationLockRace({
      caseName: 'invitation-replay',
      firstResultOverrides: [consumeRecorder],
      secondResultOverrides: [consumeRecorder],
      first: (db) => acceptInvitation({ db, actorExternalId: invitee.externalId, token: secret }),
      second: (db) => acceptInvitation({ db, actorExternalId: invitee.externalId, token: secret }),
    });

    expect(race.first.ok).toBe(true);
    if (race.first.ok) expect(race.first.value).toMatchObject({ status: 'joined' });
    expectDomainError(race.second, 'INVITATION_NOT_AVAILABLE');
    const [invitationRow] = await databaseRows<
      mysql.RowDataPacket & { acceptedAt: Date | null; revokedAt: Date | null }
    >(
      'SELECT accepted_at AS acceptedAt, revoked_at AS revokedAt FROM organization_invitations WHERE id = ?',
      [invitation.id],
    );
    expect(invitationRow?.acceptedAt).toBeInstanceOf(Date);
    expect(invitationRow?.revokedAt).toBeNull();
    expect(consumeQueryCount).toBe(1);
    expect(membershipMutationQueryCount).toBe(1);
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
      const owner = await createUser(`${caseName}_owner`);
      const invitee = await createUser(`${caseName}_invitee`);
      const organization = await createOrganization(owner.id, caseName);
      await createOrganizationMember({
        organizationId: organization.id,
        userId: owner.id,
        role: 'owner',
        tag: `${caseName}_owner`,
      });
      const secret = randomBytes(32).toString('base64url');
      const invitation = await createInvitation({
        organizationId: organization.id,
        invitedByUserId: owner.id,
        secret,
        tag: caseName,
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
        first: firstKind === 'accept' ? accept : revoke,
        second: firstKind === 'accept' ? revoke : accept,
      });
      expect(race.first.ok).toBe(true);
      expectDomainError(race.second, 'INVITATION_NOT_AVAILABLE');

      const [invitationRow] = await databaseRows<
        mysql.RowDataPacket & { acceptedAt: Date | null; revokedAt: Date | null }
      >(
        'SELECT accepted_at AS acceptedAt, revoked_at AS revokedAt FROM organization_invitations WHERE id = ?',
        [invitation.id],
      );
      const accepted = invitationRow?.acceptedAt instanceof Date;
      const revoked = invitationRow?.revokedAt instanceof Date;
      expect(Number(accepted) + Number(revoked)).toBe(1);
      const membershipRows = await databaseRows<mysql.RowDataPacket & { rowCount: number }>(
        'SELECT COUNT(*) AS rowCount FROM organization_members WHERE organization_id = ? AND user_id = ?',
        [organization.id, invitee.id],
      );
      expect(Number(membershipRows[0]?.rowCount)).toBe(firstKind === 'accept' ? 1 : 0);
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
    const owner = await createUser('disable_owner');
    const invitee = await createUser('disable_invitee');
    const organization = await createOrganization(owner.id, 'disable');
    await createOrganizationMember({
      organizationId: organization.id,
      userId: owner.id,
      role: 'owner',
      tag: 'disable_owner',
    });
    const secret = randomBytes(32).toString('base64url');
    const invitation = await createInvitation({
      organizationId: organization.id,
      invitedByUserId: owner.id,
      secret,
      tag: 'disable',
    });
    const blocker = await openEndpoint();
    const acceptStarted = signalBeforeOrganizationLock('disable-accept-started');
    const accepter = await openEndpoint([acceptStarted]);

    await blocker.connection.beginTransaction();
    await blocker.connection.execute(
      'UPDATE organizations SET team_projects_enabled = FALSE WHERE id = ?',
      [organization.id],
    );
    const acceptance = capture(
      acceptInvitation({ db: accepter.db, actorExternalId: invitee.externalId, token: secret }),
    );
    await acceptStarted.waitUntilReached(BARRIER_TIMEOUT_MS);
    const lockWaitMs = await waitForLockWait(accepter.threadId, blocker.threadId);
    await blocker.connection.commit();
    const outcome = await withTimeout(
      acceptance,
      'organization-disable-accept',
      OPERATION_TIMEOUT_MS,
    );

    expectDomainError(outcome, 'INVITATION_NOT_AVAILABLE');
    const [invitationRow] = await databaseRows<
      mysql.RowDataPacket & { acceptedAt: Date | null; revokedAt: Date | null }
    >(
      'SELECT accepted_at AS acceptedAt, revoked_at AS revokedAt FROM organization_invitations WHERE id = ?',
      [invitation.id],
    );
    expect(invitationRow).toMatchObject({ acceptedAt: null, revokedAt: null });
    const [membershipRow] = await databaseRows<mysql.RowDataPacket & { rowCount: number }>(
      'SELECT COUNT(*) AS rowCount FROM organization_members WHERE organization_id = ? AND user_id = ?',
      [organization.id, invitee.id],
    );
    expect(Number(membershipRow?.rowCount)).toBe(0);
    expect(deadlockCount([outcome])).toBe(0);
    evidence.push({
      case: 'organization-disable-accept',
      lockWaitMs,
      firstDurationMs: 0,
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
    const override = createAffectedRowsOverride({
      matches: (sql) =>
        sql.startsWith('update `organization_members`') && sql.includes('set `role` = ?'),
      affectedRows: 0,
    });
    const race = await runOrganizationLockRace({
      caseName,
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
      const actor = await createUser(`${caseName}_actor`);
      const localTarget = await createUser(`${caseName}_target`);
      const localManager = await createUser(`${caseName}_manager`);
      const requestedOrganization = await createOrganization(actor.id, `${caseName}_requested`);
      await createOrganizationMember({
        organizationId: requestedOrganization.id,
        userId: actor.id,
        role: 'owner',
        tag: `${caseName}_actor`,
      });
      const localTargetMembership = await createOrganizationMember({
        organizationId: requestedOrganization.id,
        userId: localTarget.id,
        role: 'member',
        tag: `${caseName}_target`,
      });
      const localManagerMembership = await createOrganizationMember({
        organizationId: requestedOrganization.id,
        userId: localManager.id,
        role: 'manager',
        tag: `${caseName}_manager`,
      });
      const foreignOwner = await createUser(`${caseName}_foreign_owner`);
      const foreignManager = await createUser(`${caseName}_foreign_manager`);
      const foreignOrganization = await createOrganization(foreignOwner.id, `${caseName}_foreign`);
      await createOrganizationMember({
        organizationId: foreignOrganization.id,
        userId: foreignOwner.id,
        role: 'owner',
        tag: `${caseName}_foreign_owner`,
      });
      const foreignMembership = await createOrganizationMember({
        organizationId: foreignOrganization.id,
        userId: foreignManager.id,
        role: 'manager',
        tag: `${caseName}_foreign_manager`,
      });
      const blocker = await openEndpoint();
      let organizationQueryCount = 0;
      const queryRecorder: SqlResultOverride = {
        transform(sql, result) {
          if (sql.includes('from `organizations`') || sql.includes('join `organizations`')) {
            organizationQueryCount += 1;
          }
          return result;
        },
      };
      const operationEndpoint = await openEndpoint([], [queryRecorder]);
      await blocker.connection.beginTransaction();
      await blocker.connection.execute('SELECT id FROM organizations WHERE id = ? FOR UPDATE', [
        foreignOrganization.id,
      ]);
      let outcome: OperationOutcome;
      try {
        outcome = await withTimeout(
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
          caseName,
          3_000,
        );
      } finally {
        await blocker.connection.commit();
      }

      expectDomainError(outcome, 'MEMBER_NOT_FOUND');
      expect(organizationQueryCount).toBe(2);
      const unchangedMembers = await databaseRows<
        mysql.RowDataPacket & {
          id: number;
          managerUserId: number | null;
          role: string;
          status: string;
        }
      >(
        `SELECT id, manager_user_id AS managerUserId, role, status
         FROM organization_members
         WHERE id IN (?, ?, ?)
         ORDER BY id`,
        [localTargetMembership.id, localManagerMembership.id, foreignMembership.id],
      );
      expect(unchangedMembers).toHaveLength(3);
      expect(unchangedMembers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: localTargetMembership.id,
            managerUserId: null,
            role: 'member',
            status: 'active',
          }),
          expect.objectContaining({
            id: localManagerMembership.id,
            managerUserId: null,
            role: 'manager',
            status: 'active',
          }),
          expect.objectContaining({
            id: foreignMembership.id,
            managerUserId: null,
            role: 'manager',
            status: 'active',
          }),
        ]),
      );
      expect(deadlockCount([outcome])).toBe(0);
      evidence.push({
        case: caseName,
        lockWaitMs: 0,
        firstDurationMs: 0,
        secondDurationMs: outcome.durationMs,
        deadlocks: 0,
      });
    },
  );
});

describe.sequential('team workspace MySQL project snapshot and lock-order races', () => {
  it('keeps an organization project list on one pre-create snapshot and fresh reads see the commit', async () => {
    const owner = await createUser('list_owner');
    const organization = await createOrganization(owner.id, 'list_create');
    await createOrganizationMember({
      organizationId: organization.id,
      userId: owner.id,
      role: 'owner',
      tag: 'list_owner',
    });
    const readPause = pauseAfterOrganizationMembershipSnapshot('project-list-auth-snapshot');
    const reader = await openEndpoint([readPause]);
    const writer = await openEndpoint();
    const readPromise = capture(
      listTeamProjects({
        db: reader.db,
        actorExternalId: owner.externalId,
        organizationExternalId: organization.externalId,
      }),
    );
    let writeOutcome: OperationOutcome | undefined;
    try {
      await readPause.waitUntilReached(BARRIER_TIMEOUT_MS);
      writeOutcome = await withTimeout(
        capture(
          createTeamProject({
            db: writer.db,
            actorExternalId: owner.externalId,
            organizationExternalId: organization.externalId,
            name: 'Snapshot-created project',
            description: null,
          }),
        ),
        'project-list-versus-create',
        OPERATION_TIMEOUT_MS,
      );
      expect(writeOutcome.ok).toBe(true);
      readPause.release();
      const readOutcome = await withTimeout(
        readPromise,
        'project-list-snapshot-read',
        OPERATION_TIMEOUT_MS,
      );
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
        lockWaitMs: 0,
        firstDurationMs: readOutcome.durationMs,
        secondDurationMs: writeOutcome.durationMs,
        deadlocks: 0,
      });
    } finally {
      readPause.release();
    }
  });

  it.each([
    ['project-get-versus-deactivation', 'get'] as const,
    ['project-roster-versus-deactivation', 'roster'] as const,
  ])(
    'keeps project authorization and payload on one snapshot for %s',
    async (caseName, readKind) => {
      const fixture = await createProjectReadFixture(caseName);
      const readPause = pauseAfterProjectAccessSnapshot(`${caseName}-access-snapshot`);
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
      try {
        await readPause.waitUntilReached(BARRIER_TIMEOUT_MS);
        const mutationOutcome = await withTimeout(
          capture(
            deactivateMember({
              db: writer.db,
              actorExternalId: fixture.owner.externalId,
              organizationExternalId: fixture.organization.externalId,
              targetMemberExternalId: fixture.readerOrganizationMembership.externalId,
            }),
          ),
          caseName,
          OPERATION_TIMEOUT_MS,
        );
        expect(mutationOutcome.ok).toBe(true);
        readPause.release();
        const readOutcome = await withTimeout(readPromise, caseName, OPERATION_TIMEOUT_MS);
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
          lockWaitMs: 0,
          firstDurationMs: readOutcome.durationMs,
          secondDurationMs: mutationOutcome.durationMs,
          deadlocks: 0,
        });
      } finally {
        readPause.release();
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
