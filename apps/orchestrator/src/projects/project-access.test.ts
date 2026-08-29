import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  ProjectAccessError,
  type ProjectAccessTransaction,
  type ProjectMutationGrant,
  __projectAccessInternals,
  requireDeleteProjectGrant,
  requireMemberManagementProjectGrant,
  requireMutableProject,
  requireReadableProject,
  requireRenameProjectGrant,
  withMutableProjectAccess,
  withProjectAccessTransaction,
} from './project-access.js';

type Query = {
  from: string;
  joins: Array<{ kind: 'inner' | 'left'; table: string }>;
  predicates: unknown[];
  lock: 'update' | null;
  inTransaction: boolean;
};

/** A fake that preserves joins, predicates, locks, and transaction scope. */
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
  organizationInternalId: null,
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
  organizationInternalId: 20,
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

async function mutableGrant(
  row: typeof teamSnapshot,
  action: 'rename' | 'manage_members' | 'delete',
) {
  const fake = makeDb([[row]]);
  const result = await withProjectAccessTransaction(fake.db, async (tx) => {
    const grant = await requireMutableProject(tx, {
      actorExternalId: 'usr_member',
      projectExternalId: 'prj_design',
      action,
    });
    return { grant, tx };
  });
  return { ...result, fake };
}

describe('project access', () => {
  it('requires a branded transaction and exact action grants at the type boundary', () => {
    expectTypeOf<DB>().not.toMatchTypeOf<ProjectAccessTransaction>();
    expectTypeOf<ProjectMutationGrant<'rename'>>().not.toMatchTypeOf<
      ProjectMutationGrant<'delete'>
    >();
    expectTypeOf(requireMutableProject).parameter(0).toEqualTypeOf<ProjectAccessTransaction>();
    expectTypeOf(requireRenameProjectGrant)
      .parameter(0)
      .toEqualTypeOf<ProjectMutationGrant<'rename'>>();
    expectTypeOf(requireMemberManagementProjectGrant)
      .parameter(0)
      .toEqualTypeOf<ProjectMutationGrant<'manage_members'>>();
    expectTypeOf(requireDeleteProjectGrant)
      .parameter(0)
      .toEqualTypeOf<ProjectMutationGrant<'delete'>>();
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
    ['a different personal owner', { ...personalSnapshot, actorUserId: 2 }],
    ['a missing project', undefined],
    ['a disabled organization', { ...teamSnapshot, teamProjectsEnabled: false }],
    ['an inactive organization', { ...teamSnapshot, organizationStatus: 'inactive' }],
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
    ).resolves.toEqual({
      projectId: 200,
      scope: 'organization',
      organizationInternalId: 20,
      organizationExternalId: 'org_design',
      organizationName: 'Design team',
      organizationRole: 'member',
      projectRole: 'viewer',
    });
    expect(fake.queries).toHaveLength(1);
  });

  it.each([
    ['rename', 'lead', 'member', true],
    ['manage_members', 'lead', 'member', true],
    ['delete', 'lead', 'member', false],
    ['rename', 'viewer', 'owner', true],
    ['delete', 'viewer', 'owner', true],
    ['rename', 'viewer', 'member', false],
  ] as const)(
    'enforces the %s action matrix for %s project and %s organization roles',
    async (action, projectRole, organizationRole, allowed) => {
      const row = {
        ...teamSnapshot,
        projectMemberRole: projectRole,
        organizationMemberRole: organizationRole,
      };
      const request = mutableGrant(row, action);
      if (allowed) {
        await expect(request).resolves.toMatchObject({ grant: { action } });
      } else {
        await expect(request).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
    },
  );

  it('locks the matching snapshot inside the transaction that returns its grant', async () => {
    const result = await mutableGrant({ ...teamSnapshot, projectMemberRole: 'lead' }, 'rename');

    expect(result.grant).toMatchObject({ action: 'rename', projectId: 200 });
    expect(result.fake.transactionCalls).toBe(1);
    expect(result.fake.queries).toEqual([
      expect.objectContaining({ from: 'projects', lock: 'update', inTransaction: true }),
    ]);
  });

  it('supplies the same branded transaction and exact grant to a mutable callback', async () => {
    const fake = makeDb([[{ ...teamSnapshot, projectMemberRole: 'lead' }]]);
    const result = await withMutableProjectAccess(
      fake.db,
      {
        actorExternalId: 'usr_member',
        projectExternalId: 'prj_design',
        action: 'rename',
      },
      async (tx, grant) => ({
        action: requireRenameProjectGrant(grant).action,
        tx,
      }),
    );

    expect(result.action).toBe('rename');
    expect(result.tx).toBe(fake.db);
    expect(fake.transactionCalls).toBe(1);
    expect(fake.queries[0]).toMatchObject({ lock: 'update', inTransaction: true });
  });

  it('rejects an action discriminator tampered after authorization', async () => {
    const { grant } = await mutableGrant({ ...teamSnapshot, projectMemberRole: 'lead' }, 'rename');
    const tampered = { ...grant, action: 'delete' } as unknown as ProjectMutationGrant<'rename'>;

    try {
      requireRenameProjectGrant(tampered);
      throw new Error('expected tampered grant to be rejected');
    } catch (error) {
      expect(error).toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('compiles the complete tenant-bound joined snapshot and lock predicates', () => {
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

  it('uses domain-only access errors', () => {
    expect(new ProjectAccessError('NOT_FOUND')).toBeInstanceOf(Error);
    expect(new ProjectAccessError('FORBIDDEN')).toMatchObject({ code: 'FORBIDDEN' });
  });
});
