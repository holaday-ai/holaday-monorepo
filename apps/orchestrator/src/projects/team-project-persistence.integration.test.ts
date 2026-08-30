import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { readInsertId } from '../db/mysql-result.js';
import * as schema from '../db/schema/index.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { projectMembers } from '../db/schema/project-members.js';
import { projects } from '../db/schema/projects.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import { deleteProjectWithAccess } from './project-access.js';
import {
  assertConnectionTargetsValidatedSchema,
  parseTeamProjectsIntegrationTarget,
  preflightTeamProjectsIntegrationDatabase,
} from './team-project-integration-safety.js';
import {
  createTeamProjectInsertIdCapture,
  matchesCreatorLeadInsertInvocation,
} from './team-project-persistence-harness.js';
import { buildIntegrationFixtureExternalId } from './team-project-race-fixtures.js';
import {
  createAffectedRowsOverride,
  createMysqlBoundaryRecorder,
  instrumentMysqlConnection,
  runBoundedCleanup,
  runWithActiveTimeout,
} from './team-project-race-harness.js';
import { createTeamProject } from './team-project-service.js';

const CLEANUP_TIMEOUT_MS = 5_000;
const OPERATION_TIMEOUT_MS = 15_000;
const MYSQL_LOCK_WAIT_TIMEOUT_SECONDS = 10;

type MysqlConnection = Awaited<ReturnType<typeof mysql.createConnection>>;

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

describe.sequential('team project MySQL persistence', () => {
  let connection: MysqlConnection;
  let db: DB;
  let actorUserId = 0;
  let organizationId = 0;
  let actorExternalId = '';
  let organizationExternalId = '';
  let uniqueName = '';
  let fixtureSerial = 0;

  async function cleanupFixtureRows(): Promise<void> {
    await assertConnectionTargetsValidatedSchema(connection, integrationTarget);
    await connection.query('DELETE FROM tasks');
    await connection.query('DELETE FROM project_members');
    await connection.query('DELETE FROM projects');
    await connection.query('DELETE FROM organization_invitations');
    await connection.query('DELETE FROM organization_members');
    await connection.query('DELETE FROM organizations');
    await connection.query('DELETE FROM users');
  }

  beforeAll(async () => {
    connection = await mysql.createConnection({ ...integrationTarget.connectionConfig });
    await assertConnectionTargetsValidatedSchema(connection, integrationTarget);
    await connection.query(
      `SET SESSION innodb_lock_wait_timeout = ${MYSQL_LOCK_WAIT_TIMEOUT_SECONDS}`,
    );
    const observerProbe = await mysql.createConnection({ ...integrationTarget.connectionConfig });
    try {
      await preflightTeamProjectsIntegrationDatabase(connection, integrationTarget, {
        observerProbeConnection: observerProbe,
      });
    } finally {
      await runBoundedCleanup(
        [
          {
            label: 'close persistence observer preflight probe',
            run: () => observerProbe.end(),
            onTimeout: () => observerProbe.destroy(),
            onFailure: () => observerProbe.destroy(),
          },
        ],
        CLEANUP_TIMEOUT_MS,
      );
    }
    db = drizzle(connection, {
      schema,
      mode: 'default',
      casing: 'snake_case',
    }) as unknown as DB;
  });

  beforeEach(async () => {
    fixtureSerial += 1;
    const fixtureCase = `persistence-${fixtureSerial}`;
    actorExternalId = buildIntegrationFixtureExternalId(fixtureCase, 'users', 'actor');
    organizationExternalId = buildIntegrationFixtureExternalId(
      fixtureCase,
      'organizations',
      'primary',
    );
    uniqueName = `team-project-${fixtureSerial}`;

    actorUserId = readInsertId(
      await db.insert(users).values({
        externalId: actorExternalId,
        email: `${actorExternalId}@team-project.integration.test`,
        passwordHash: 'integration-test-only',
      }),
    );
    organizationId = readInsertId(
      await db.insert(organizations).values({
        externalId: organizationExternalId,
        name: `Integration ${fixtureSerial}`,
        ownerUserId: actorUserId,
        status: 'active',
        teamProjectsEnabled: true,
      }),
    );
    await db.insert(organizationMembers).values({
      externalId: buildIntegrationFixtureExternalId(fixtureCase, 'organization_members', 'owner'),
      organizationId,
      userId: actorUserId,
      role: 'owner',
      status: 'active',
    });
  });

  afterEach(async () => {
    try {
      await runBoundedCleanup(
        [
          {
            label: 'clean persistence integration fixture rows',
            run: cleanupFixtureRows,
            onTimeout: () => connection.destroy(),
            onFailure: () => connection.destroy(),
          },
        ],
        CLEANUP_TIMEOUT_MS,
      );
    } finally {
      actorUserId = 0;
      organizationId = 0;
    }
  });

  afterAll(async () => {
    if (!connection) return;
    await runBoundedCleanup(
      [
        {
          label: 'close persistence admin connection',
          run: () => connection.end(),
          onTimeout: () => connection.destroy(),
          onFailure: () => connection.destroy(),
        },
      ],
      CLEANUP_TIMEOUT_MS,
    );
  });

  it('executes the creator-lead insert and rolls back both rows after its result reports zero affected rows', async () => {
    const failingConnection = await mysql.createConnection({
      ...integrationTarget.connectionConfig,
    });
    try {
      await assertConnectionTargetsValidatedSchema(failingConnection, integrationTarget);
      await failingConnection.query(
        `SET SESSION innodb_lock_wait_timeout = ${MYSQL_LOCK_WAIT_TIMEOUT_SECONDS}`,
      );
      const recorder = createMysqlBoundaryRecorder();
      const projectIdCapture = createTeamProjectInsertIdCapture({
        actorUserId,
        organizationId,
        name: uniqueName,
        description: null,
      });
      const zeroCreatorLeadResult = createAffectedRowsOverride({
        matches: (invocation) => {
          const projectId = projectIdCapture.projectId();
          return (
            projectId !== undefined &&
            matchesCreatorLeadInsertInvocation(invocation, { actorUserId, projectId })
          );
        },
        affectedRows: 0,
      });
      const instrumented = instrumentMysqlConnection(
        failingConnection,
        [],
        [projectIdCapture, zeroCreatorLeadResult],
        recorder,
      );
      const failingDb = drizzle(instrumented, {
        schema,
        mode: 'default',
        casing: 'snake_case',
      }) as unknown as DB;

      await expect(
        runWithActiveTimeout(
          createTeamProject({
            db: failingDb,
            actorExternalId,
            organizationExternalId,
            name: uniqueName,
            description: null,
          }),
          {
            label: 'creator-lead zero-row rollback',
            timeoutMs: OPERATION_TIMEOUT_MS,
            settleTimeoutMs: CLEANUP_TIMEOUT_MS,
            onTimeout: () => failingConnection.destroy(),
          },
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const attemptedProjectId = projectIdCapture.requireProjectId();
      const creatorLeadInserts = recorder.sqlInvocations().filter((invocation) =>
        matchesCreatorLeadInsertInvocation(invocation, {
          actorUserId,
          projectId: attemptedProjectId,
        }),
      );
      expect(creatorLeadInserts).toHaveLength(1);
      expect(recorder.transactionActions()).toEqual(['begin', 'rollback']);
      const persistedProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, attemptedProjectId));
      const persistedMemberships = await db
        .select({ id: projectMembers.id })
        .from(projectMembers)
        .where(eq(projectMembers.projectId, attemptedProjectId));
      expect(persistedProjects).toEqual([]);
      expect(persistedMemberships).toEqual([]);
    } finally {
      await runBoundedCleanup(
        [
          {
            label: 'close creator-lead failing connection',
            run: () => failingConnection.end(),
            onTimeout: () => failingConnection.destroy(),
            onFailure: () => failingConnection.destroy(),
          },
        ],
        CLEANUP_TIMEOUT_MS,
      );
    }
  });

  it('deletes only the project while preserving its task with a null project id', async () => {
    const fixtureCase = `persistence-delete-${fixtureSerial}`;
    const projectExternalId = buildIntegrationFixtureExternalId(fixtureCase, 'projects', 'primary');
    const projectId = readInsertId(
      await db.insert(projects).values({
        externalId: projectExternalId,
        userId: actorUserId,
        organizationId,
        name: uniqueName,
      }),
    );
    await db.insert(projectMembers).values({
      externalId: buildIntegrationFixtureExternalId(fixtureCase, 'project_members', 'owner-lead'),
      projectId,
      userId: actorUserId,
      role: 'lead',
      status: 'active',
    });
    const taskExternalId = `tsk_${createHash('sha256')
      .update(fixtureCase)
      .digest('hex')
      .slice(0, 21)}`;
    await db.insert(tasks).values({
      externalId: taskExternalId,
      userId: actorUserId,
      projectId,
      intent: 'prove project deletion preserves this task',
    });

    await expect(
      runWithActiveTimeout(deleteProjectWithAccess(db, { actorExternalId, projectExternalId }), {
        label: 'project delete task-FK persistence',
        timeoutMs: OPERATION_TIMEOUT_MS,
        settleTimeoutMs: CLEANUP_TIMEOUT_MS,
        onTimeout: () => connection.destroy(),
      }),
    ).resolves.toMatchObject({ projectId, scope: 'organization' });

    const persistedProject = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.externalId, projectExternalId));
    const [persistedTask] = await db
      .select({ externalId: tasks.externalId, projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.externalId, taskExternalId))
      .limit(1);
    expect(persistedProject).toEqual([]);
    expect(persistedTask).toEqual({ externalId: taskExternalId, projectId: null });
  });
});
