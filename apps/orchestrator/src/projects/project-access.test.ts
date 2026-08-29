import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  type DeleteProjectSession,
  ProjectAccessError,
  type RenameProjectSession,
  __projectAccessInternals,
  requireReadableProject,
  withDeleteProjectSession,
  withProjectMemberManagementSession,
  withRenameProjectSession,
} from './project-access.js';

type Query = {
  from: string;
  joins: Array<{ kind: 'inner' | 'left'; table: string }>;
  predicates: unknown[];
  lock: 'update' | null;
  inTransaction: boolean;
};

/** Records exact query shape and prevents accidental snapshot splitting. */
function makeDb(selectResults: unknown[][]) {
  const queries: Query[] = [];
  let transactionCalls = 0;
  let transactionDepth = 0;
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
    for: (strength: 'update') => SelectBuilder;
    limit: () => Promise<unknown[]>;
  };
  const select = (): SelectBuilder => {
    const query: Query = { from: '', joins: [], predicates: [], lock: null, inTransaction: false };
    let result: Promise<unknown[]> | undefined;
    let recorded = false;
    const finish = () => {
      result ??= Promise.resolve(take());
      if (!recorded) {
        recorded = true;
        queries.push({
          ...query,
          joins: [...query.joins],
          predicates: [...query.predicates],
          inTransaction: transactionDepth > 0,
        });
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
      for(strength) {
        query.lock = strength;
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
  const db = {
    select,
    async transaction<Result>(callback: (tx: unknown) => Promise<Result>): Promise<Result> {
      transactionCalls += 1;
      transactionDepth += 1;
      try {
        return await callback(db);
      } finally {
        transactionDepth -= 1;
      }
    },
  };
  return {
    db: db as unknown as DB,
    queries,
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

const personalSnapshot = {
  projectId: 100,
  projectExternalId: 'prj_personal',
  projectOwnerUserId: 1,
  actorUserId: 1,
  actorExternalId: 'usr_owner',
  organizationInternalId: null,
  organizationRowId: null,
  organizationExternalId: null,
  organizationName: null,
  organizationStatus: null,
  teamProjectsEnabled: null,
  organizationMemberOrganizationId: null,
  organizationMemberUserId: null,
  organizationMemberRole: null,
  organizationMemberStatus: null,
  projectMemberProjectId: null,
  projectMemberUserId: null,
  projectMemberRole: null,
  projectMemberStatus: null,
};
const teamSnapshot = {
  projectId: 200,
  projectExternalId: 'prj_design',
  projectOwnerUserId: 1,
  actorUserId: 1,
  actorExternalId: 'usr_member',
  organizationInternalId: 20,
  organizationRowId: 20,
  organizationExternalId: 'org_design',
  organizationName: 'Design team',
  organizationStatus: 'active',
  teamProjectsEnabled: true,
  organizationMemberOrganizationId: 20,
  organizationMemberUserId: 1,
  organizationMemberRole: 'member',
  organizationMemberStatus: 'active',
  projectMemberProjectId: 200,
  projectMemberUserId: 1,
  projectMemberRole: 'viewer',
  projectMemberStatus: 'active',
};

function normalizedSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, ' ').trim();
}

describe('project access', () => {
  it('exposes only action-specific sessions at the type boundary', () => {
    expectTypeOf<RenameProjectSession>().not.toMatchTypeOf<DeleteProjectSession>();
    expectTypeOf(withRenameProjectSession)
      .parameter(2)
      .toEqualTypeOf<(session: RenameProjectSession) => Promise<unknown>>();
  });

  it('returns personal owner access from one actor-bound snapshot query', async () => {
    const fake = makeDb([[personalSnapshot]]);

    await expect(
      requireReadableProject(fake.db, {
        actorExternalId: 'usr_owner',
        projectExternalId: 'prj_personal',
      }),
    ).resolves.toMatchObject({ projectId: 100, scope: 'personal' });
    expect(fake.queries).toEqual([
      expect.objectContaining({ from: 'projects', lock: null, inTransaction: false }),
    ]);
  });

  it.each([
    ['a different actor external ID', { ...teamSnapshot, actorExternalId: 'usr_other' }],
    ['a different project external ID', { ...teamSnapshot, projectExternalId: 'prj_other' }],
    ['a different personal owner', { ...personalSnapshot, actorUserId: 2 }],
    ['a personal project with team rows', { ...personalSnapshot, projectMemberProjectId: 100 }],
    ['a missing project', undefined],
    ['a disabled organization', { ...teamSnapshot, teamProjectsEnabled: false }],
    ['an inactive organization', { ...teamSnapshot, organizationStatus: 'inactive' }],
    ['a mismatched organization row', { ...teamSnapshot, organizationRowId: 21 }],
    [
      'an organization membership for another tenant',
      { ...teamSnapshot, organizationMemberOrganizationId: 21 },
    ],
    [
      'an organization membership for another actor',
      { ...teamSnapshot, organizationMemberUserId: 2 },
    ],
    [
      'an inactive organization membership',
      { ...teamSnapshot, organizationMemberStatus: 'inactive' },
    ],
    ['a project membership for another project', { ...teamSnapshot, projectMemberProjectId: 201 }],
    ['a project membership for another actor', { ...teamSnapshot, projectMemberUserId: 2 }],
    ['an inactive project membership', { ...teamSnapshot, projectMemberStatus: 'inactive' }],
    ['an invalid organization role', { ...teamSnapshot, organizationMemberRole: 'unknown' }],
    ['an invalid project role', { ...teamSnapshot, projectMemberRole: 'unknown' }],
  ] as const)('hides %s with NOT_FOUND', async (_label, row) => {
    const fake = makeDb([row ? [row] : []]);

    await expect(
      requireReadableProject(fake.db, {
        actorExternalId: 'usr_member',
        projectExternalId: 'prj_design',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns authoritative team access from the single snapshot', async () => {
    const fake = makeDb([[teamSnapshot]]);

    await expect(
      requireReadableProject(fake.db, {
        actorExternalId: 'usr_member',
        projectExternalId: 'prj_design',
      }),
    ).resolves.toMatchObject({
      projectId: 200,
      scope: 'organization',
      organizationInternalId: 20,
      organizationExternalId: 'org_design',
      organizationRole: 'member',
      projectRole: 'viewer',
    });
    expect(fake.queries).toHaveLength(1);
  });

  it('runs rename through a frozen live session and expires it after commit', async () => {
    const fake = makeDb([[{ ...teamSnapshot, projectMemberRole: 'lead' }]]);
    let captured: RenameProjectSession | undefined;
    const result = await withRenameProjectSession(
      fake.db,
      { actorExternalId: 'usr_member', projectExternalId: 'prj_design' },
      async (session) => {
        captured = session;
        expect(Object.isFrozen(session)).toBe(true);
        return session.rename((access) => ({
          action: session.action,
          projectId: access.projectId,
        }));
      },
    );

    expect(result).toEqual({ action: 'rename', projectId: 200 });
    expect(fake.transactionCalls).toBe(1);
    expect(fake.queries).toEqual([
      expect.objectContaining({ from: 'projects', lock: 'update', inTransaction: true }),
    ]);
    await expect(captured?.rename(async () => 'late')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does not resolve a mutable session before its matching action executes', async () => {
    const fake = makeDb([[{ ...teamSnapshot, projectMemberRole: 'lead' }]]);

    await expect(
      withRenameProjectSession(
        fake.db,
        { actorExternalId: 'usr_member', projectExternalId: 'prj_design' },
        async () => 'did not execute rename',
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('prevents rename-to-delete tampering and delete consumption', async () => {
    const fake = makeDb([[{ ...teamSnapshot, projectMemberRole: 'lead' }]]);

    await withRenameProjectSession(
      fake.db,
      { actorExternalId: 'usr_member', projectExternalId: 'prj_design' },
      async (session) => {
        expect(() => Object.assign(session, { action: 'delete' })).toThrow();
        expect('delete' in session).toBe(false);
        expect((session as unknown as { delete?: unknown }).delete).toBeUndefined();
        return session.rename(async () => undefined);
      },
    );
  });

  it('does not let a session executor return usable capability state', async () => {
    const fake = makeDb([[{ ...teamSnapshot, projectMemberRole: 'lead' }]]);
    const escaped = await withRenameProjectSession(
      fake.db,
      { actorExternalId: 'usr_member', projectExternalId: 'prj_design' },
      async (session) => {
        await session.rename(async () => undefined);
        return session;
      },
    );

    await expect(escaped.rename(async () => undefined)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('keeps member-management and delete role matrices action-specific', async () => {
    const memberFake = makeDb([[{ ...teamSnapshot, projectMemberRole: 'lead' }]]);
    await expect(
      withProjectMemberManagementSession(
        memberFake.db,
        { actorExternalId: 'usr_member', projectExternalId: 'prj_design' },
        async (session) => session.manageMembers(async (access) => access.projectId),
      ),
    ).resolves.toBe(200);

    const deniedDelete = makeDb([[{ ...teamSnapshot, projectMemberRole: 'lead' }]]);
    await expect(
      withDeleteProjectSession(
        deniedDelete.db,
        { actorExternalId: 'usr_member', projectExternalId: 'prj_design' },
        async (session) => session.delete(async () => undefined),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('compiles exact LEFT JOIN, personal, team, actor, and lock predicates', () => {
    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const input = { actorExternalId: 'usr_member', projectExternalId: 'prj_design' };
    const unlocked = __projectAccessInternals
      .buildProjectAccessSnapshotQuery(mockDb, input, false)
      .toSQL();
    const locked = __projectAccessInternals
      .buildProjectAccessSnapshotQuery(mockDb, input, true)
      .toSQL();
    const sql = normalizedSql(locked.sql);

    expect(sql).toContain('inner join `users` on `users`.`external_id` = ?');
    expect(sql).toContain('left join `organizations` on');
    expect(sql).toContain('left join `organization_members` on');
    expect(sql).toContain('left join `project_members` on');
    expect(sql).toContain('`organizations`.`id` = `projects`.`organization_id`');
    expect(sql).toContain('`organizations`.`status` = ?');
    expect(sql).toContain('`organizations`.`team_projects_enabled` = ?');
    expect(sql).toContain('`organization_members`.`organization_id` = `organizations`.`id`');
    expect(sql).toContain('`organization_members`.`user_id` = `users`.`id`');
    expect(sql).toContain('`organization_members`.`status` = ?');
    expect(sql).toContain('`project_members`.`project_id` = `projects`.`id`');
    expect(sql).toContain('`project_members`.`user_id` = `users`.`id`');
    expect(sql).toContain('`project_members`.`status` = ?');
    expect(sql).toContain('`projects`.`external_id` = ?');
    expect(sql).toContain('`projects`.`organization_id` is null');
    expect(sql).toContain('`projects`.`user_id` = `users`.`id`');
    expect(sql).toContain('`projects`.`organization_id` is not null');
    expect(sql).toContain('for update');
    expect(unlocked.sql).not.toContain('for update');
    expect(locked.params).toEqual([
      'usr_member',
      'active',
      true,
      'active',
      'active',
      'prj_design',
      1,
    ]);
  });

  it('uses domain-only errors', () => {
    expect(new ProjectAccessError('NOT_FOUND')).toBeInstanceOf(Error);
  });
});
