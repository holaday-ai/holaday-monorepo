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
import { createTeamProject } from './team-project-service.js';

const databaseUrl = process.env.TEAM_PROJECTS_INTEGRATION_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;

function requireIsolatedTestDatabase(rawUrl: string): void {
  const parsed = new URL(rawUrl);
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (parsed.protocol !== 'mysql:' || !/(?:test|integration)/i.test(databaseName)) {
    throw new Error(
      'TEAM_PROJECTS_INTEGRATION_DATABASE_URL must be a mysql URL whose database name contains test or integration',
    );
  }
}

integrationDescribe('team project MySQL persistence', () => {
  let pool: ReturnType<typeof mysql.createPool>;
  let db: DB;
  let actorUserId = 0;
  let organizationId = 0;
  let actorExternalId = '';
  let organizationExternalId = '';
  let uniqueName = '';

  beforeAll(async () => {
    requireIsolatedTestDatabase(databaseUrl as string);
    pool = mysql.createPool({
      uri: databaseUrl as string,
      connectionLimit: 2,
      timezone: 'Z',
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
    });
    db = drizzle(pool, { schema, mode: 'default', casing: 'snake_case' });
  });

  beforeEach(async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    actorExternalId = `usr_it_${suffix}`;
    organizationExternalId = `org_it_${suffix}`;
    uniqueName = `team-project-it-${suffix}`;

    actorUserId = readInsertId(
      await db.insert(users).values({
        externalId: actorExternalId,
        email: `${suffix}@team-project.integration.test`,
        passwordHash: 'integration-test-only',
      }),
    );
    organizationId = readInsertId(
      await db.insert(organizations).values({
        externalId: organizationExternalId,
        name: `Integration ${suffix}`,
        ownerUserId: actorUserId,
        status: 'active',
        teamProjectsEnabled: true,
      }),
    );
    await db.insert(organizationMembers).values({
      externalId: `omem_it_${suffix}`,
      organizationId,
      userId: actorUserId,
      role: 'owner',
      status: 'active',
    });
  });

  afterEach(async () => {
    if (!actorUserId) return;
    await db.delete(tasks).where(eq(tasks.userId, actorUserId));
    await db.delete(projects).where(eq(projects.userId, actorUserId));
    await db.delete(organizationMembers).where(eq(organizationMembers.userId, actorUserId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
    await db.delete(users).where(eq(users.id, actorUserId));
    actorUserId = 0;
    organizationId = 0;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('rolls back the project row when creator-lead insertion reports zero affected rows', async () => {
    const failingDb = {
      transaction: <Result>(callback: (tx: unknown) => Promise<Result>) =>
        db.transaction(async (tx) => {
          const txProxy = new Proxy(tx as object, {
            get(target, property) {
              if (property === 'insert') {
                return (table: unknown) => {
                  if (table === projectMembers) {
                    return { values: async () => [{ affectedRows: 0, insertId: 0 }] };
                  }
                  const insert = Reflect.get(target, property, target) as (
                    value: unknown,
                  ) => unknown;
                  return insert.call(target, table);
                };
              }
              const value = Reflect.get(target, property, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          return callback(txProxy);
        }),
    } as unknown as DB;

    await expect(
      createTeamProject({
        db: failingDb,
        actorExternalId,
        organizationExternalId,
        name: uniqueName,
        description: null,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const persisted = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, actorUserId));
    expect(persisted).toEqual([]);
  });

  it('deletes only the project while preserving its task with a null project id', async () => {
    const suffix = actorExternalId.replace('usr_', '');
    const projectExternalId = `prj_${suffix}`;
    const projectId = readInsertId(
      await db.insert(projects).values({
        externalId: projectExternalId,
        userId: actorUserId,
        organizationId,
        name: uniqueName,
      }),
    );
    await db.insert(projectMembers).values({
      externalId: `pmem_${suffix}`,
      projectId,
      userId: actorUserId,
      role: 'lead',
      status: 'active',
    });
    const taskExternalId = `tsk_${suffix}`;
    await db.insert(tasks).values({
      externalId: taskExternalId,
      userId: actorUserId,
      projectId,
      intent: 'prove project deletion preserves this task',
    });

    await expect(
      deleteProjectWithAccess(db, { actorExternalId, projectExternalId }),
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
