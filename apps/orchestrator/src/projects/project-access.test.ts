import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  ProjectAccessError,
  __projectAccessInternals,
  requireMutableProject,
  requireReadableProject,
} from './project-access.js';

type Query = {
  from: string;
  joins: Array<{ kind: 'inner' | 'left'; table: string }>;
  predicates: unknown[];
};

/**
 * A deliberately narrow Drizzle-shaped fake. It records every predicate so
 * tenant, active-status, project, and actor bindings cannot disappear behind
 * a no-op query builder.
 */
function makeDb(selectResults: unknown[][]) {
  const queries: Query[] = [];
  const tableName = (table: unknown) => {
    if (!table || typeof table !== 'object') return '';
    const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
    return typeof name === 'string' ? name : '';
  };
  const take = () => selectResults.shift() ?? [];
  type SelectBuilder = {
    from: (table: unknown) => SelectBuilder;
    innerJoin: (table: unknown) => SelectBuilder;
    leftJoin: (table: unknown) => SelectBuilder;
    where: (predicate: unknown) => SelectBuilder;
    limit: () => Promise<unknown[]>;
  };
  const select = (): SelectBuilder => {
    const query: Query = { from: '', joins: [], predicates: [] };
    let result: Promise<unknown[]> | undefined;
    let recorded = false;
    const finish = () => {
      result ??= Promise.resolve(take());
      if (!recorded) {
        recorded = true;
        queries.push({ ...query, joins: [...query.joins], predicates: [...query.predicates] });
      }
      return result;
    };
    const builder: SelectBuilder = {
      from(table) {
        query.from = tableName(table);
        return builder;
      },
      innerJoin(table) {
        query.joins.push({ kind: 'inner', table: tableName(table) });
        return builder;
      },
      leftJoin(table) {
        query.joins.push({ kind: 'left', table: tableName(table) });
        return builder;
      },
      where(predicate) {
        query.predicates.push(predicate);
        return builder;
      },
      limit: finish,
    };
    Object.defineProperty(builder, 'then', {
      value: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        finish().then(resolve, reject),
    });
    return builder;
  };
  return { db: { select } as unknown as DB, queries };
}

const actor = { id: 1 };
const anotherActor = { id: 2 };
const personalProject = {
  id: 100,
  ownerUserId: 1,
  organizationInternalId: null,
  organizationExternalId: null,
  organizationName: null,
  organizationStatus: null,
  teamProjectsEnabled: null,
};
const teamProject = {
  id: 200,
  ownerUserId: 1,
  organizationInternalId: 20,
  organizationExternalId: 'org_design',
  organizationName: 'Design team',
  organizationStatus: 'active',
  teamProjectsEnabled: true,
};
const ownerMembership = {
  organizationId: 20,
  userId: 1,
  role: 'owner',
  status: 'active',
};
const memberMembership = { ...ownerMembership, role: 'member' };
const leadMembership = {
  projectId: 200,
  userId: 1,
  role: 'lead',
  status: 'active',
};
const viewerMembership = { ...leadMembership, role: 'viewer' };

function normalizedSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, ' ').trim();
}

describe('project access', () => {
  it('returns a personal owner access context without querying team membership', async () => {
    const fake = makeDb([[actor], [personalProject]]);

    await expect(
      requireReadableProject({
        db: fake.db,
        actorExternalId: 'usr_owner',
        projectExternalId: 'prj_personal',
      }),
    ).resolves.toEqual({
      projectId: 100,
      scope: 'personal',
      organizationInternalId: null,
      organizationExternalId: null,
      organizationName: null,
      organizationRole: null,
      projectRole: null,
    });
    expect(fake.queries).toHaveLength(2);
  });

  it('hides a personal project from every non-owner', async () => {
    const fake = makeDb([[anotherActor], [personalProject]]);

    await expect(
      requireReadableProject({
        db: fake.db,
        actorExternalId: 'usr_other',
        projectExternalId: 'prj_personal',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('requires active organization and project memberships before reading a team project', async () => {
    const fake = makeDb([[actor], [teamProject], [memberMembership], [viewerMembership]]);

    await expect(
      requireReadableProject({
        db: fake.db,
        actorExternalId: 'usr_member',
        projectExternalId: 'prj_design',
      }),
    ).resolves.toEqual({
      projectId: 200,
      scope: 'organization',
      organizationInternalId: 20,
      organizationExternalId: 'org_design',
      organizationName: 'Design team',
      organizationRole: 'member',
      projectRole: 'viewer',
    });
    expect(fake.queries).toHaveLength(4);
    expect(fake.queries.map((query) => query.predicates)).toEqual(
      expect.arrayContaining([expect.any(Array)]),
    );
  });

  it.each([
    ['unknown project', [[actor], []]],
    [
      'disabled or inactive organization',
      [[actor], [{ ...teamProject, organizationExternalId: null }]],
    ],
    ['inactive organization member', [[actor], [teamProject], []]],
    ['inactive project member', [[actor], [teamProject], [memberMembership], []]],
    [
      'unknown organization membership role',
      [[actor], [teamProject], [{ ...memberMembership, role: 'suspended' }], [viewerMembership]],
    ],
    [
      'unknown project membership role',
      [[actor], [teamProject], [memberMembership], [{ ...viewerMembership, role: 'suspended' }]],
    ],
    [
      'project member bound to another actor',
      [[actor], [teamProject], [memberMembership], [{ ...viewerMembership, userId: 2 }]],
    ],
  ] as const)('hides a team project for %s', async (_label, results) => {
    const fake = makeDb(results.map((rows) => [...rows]));

    await expect(
      requireReadableProject({
        db: fake.db,
        actorExternalId: 'usr_member',
        projectExternalId: 'prj_design',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('hides a project when a cross-organization project identifier is substituted', async () => {
    const fake = makeDb([[actor], [teamProject], []]);

    await expect(
      requireReadableProject({
        db: fake.db,
        actorExternalId: 'usr_member',
        projectExternalId: 'prj_other_organization',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    ['rename', 'lead', 'owner', true],
    ['remove_member', 'lead', 'member', true],
    ['delete', 'lead', 'member', false],
    ['rename', 'viewer', 'owner', true],
    ['delete', 'viewer', 'member', false],
    ['rename', 'viewer', 'member', false],
  ] as const)(
    'enforces the %s action matrix for project %s and organization %s',
    async (action, projectRole, organizationRole, allowed) => {
      const fake = makeDb([
        [actor],
        [teamProject],
        [{ ...ownerMembership, role: organizationRole }],
        [{ ...leadMembership, role: projectRole }],
      ]);
      const request = requireMutableProject({
        db: fake.db,
        actorExternalId: 'usr_member',
        projectExternalId: 'prj_design',
        action,
      });

      if (allowed) {
        await expect(request).resolves.toMatchObject({
          projectId: 200,
          projectRole,
          organizationRole,
        });
      } else {
        await expect(request).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
    },
  );

  it('does not turn membership-bound failures into forbidden mutation responses', async () => {
    const fake = makeDb([[actor], [teamProject], [], [leadMembership]]);

    await expect(
      requireMutableProject({
        db: fake.db,
        actorExternalId: 'usr_member',
        projectExternalId: 'prj_design',
        action: 'rename',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('builds project and membership queries with tenant, status, project, and actor predicates', () => {
    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const projectSql = normalizedSql(
      __projectAccessInternals.buildProjectLookupQuery(mockDb, 'prj_design').toSQL().sql,
    );
    const organizationMemberSql = normalizedSql(
      __projectAccessInternals.buildOrganizationMembershipQuery(mockDb, 20, 1).toSQL().sql,
    );
    const projectMemberSql = normalizedSql(
      __projectAccessInternals.buildProjectMembershipQuery(mockDb, 200, 1).toSQL().sql,
    );

    expect(projectSql).toContain('left join `organizations` on');
    expect(projectSql).toContain('`organizations`.`status` = ?');
    expect(projectSql).toContain('`organizations`.`team_projects_enabled` = ?');
    expect(projectSql).toContain('`projects`.`external_id` = ?');
    expect(organizationMemberSql).toContain('`organization_members`.`organization_id` = ?');
    expect(organizationMemberSql).toContain('`organization_members`.`user_id` = ?');
    expect(organizationMemberSql).toContain('`organization_members`.`status` = ?');
    expect(projectMemberSql).toContain('`project_members`.`project_id` = ?');
    expect(projectMemberSql).toContain('`project_members`.`user_id` = ?');
    expect(projectMemberSql).toContain('`project_members`.`status` = ?');
  });

  it('uses domain-only access errors', () => {
    expect(new ProjectAccessError('NOT_FOUND')).toBeInstanceOf(Error);
    expect(new ProjectAccessError('FORBIDDEN')).toMatchObject({ code: 'FORBIDDEN' });
  });
});
