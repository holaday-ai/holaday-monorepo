import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  ProjectAccessError,
  __projectAccessInternals,
  addProjectMemberWithAccess,
  deleteProjectWithAccess,
  removeProjectMemberWithAccess,
  renameProjectWithAccess,
  requireReadableProject,
} from './project-access.js';

type Executor = 'root' | 'tx';
type Query = { table: string; lock: 'update' | null; executor: Executor };
type Write = {
  kind: 'insert' | 'update' | 'delete';
  table: string;
  values?: Record<string, unknown>;
  executor: Executor;
};

/** A transaction fake that makes locked reads, writes, and rollback observable. */
function makeDb(selectResults: unknown[][], affectedRows: number[] = []) {
  const queries: Query[] = [];
  const writes: Write[] = [];
  const events: string[] = [];
  const tableName = (table: unknown) => {
    if (!table || typeof table !== 'object') return '';
    const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
    return typeof name === 'string' ? name : '';
  };
  const take = () => selectResults.shift() ?? [];
  const writeResult = () => [{ affectedRows: affectedRows.shift() ?? 1 }];
  type SelectBuilder = {
    from: (table: unknown) => SelectBuilder;
    innerJoin: () => SelectBuilder;
    leftJoin: () => SelectBuilder;
    where: () => SelectBuilder;
    for: (strength: 'update') => SelectBuilder;
    limit: () => Promise<unknown[]>;
  };
  const makeSelect = (executor: Executor) => (): SelectBuilder => {
    let table = '';
    let lock: 'update' | null = null;
    let completed: Promise<unknown[]> | undefined;
    const finish = () => {
      if (!completed) {
        queries.push({ table, lock, executor });
        events.push(`${executor}:select:${table}:${lock ?? 'none'}`);
        completed = Promise.resolve(take());
      }
      return completed;
    };
    const builder: SelectBuilder = {
      from(nextTable) {
        table = tableName(nextTable);
        return builder;
      },
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: () => builder,
      for(strength) {
        lock = strength;
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
  const makeUpdate = (executor: Executor) => (table: unknown) => {
    return {
      set(values: Record<string, unknown>) {
        return {
          async where() {
            writes.push({
              kind: 'update',
              table: tableName(table),
              values,
              executor,
            });
            events.push(`${executor}:update:${tableName(table)}`);
            if (executor === 'root') {
              throw new Error('test fake rejected root update during a project mutation');
            }
            return writeResult();
          },
        };
      },
    };
  };
  const makeDelete = (executor: Executor) => (table: unknown) => {
    return {
      async where() {
        writes.push({
          kind: 'delete',
          table: tableName(table),
          executor,
        });
        events.push(`${executor}:delete:${tableName(table)}`);
        if (executor === 'root') {
          throw new Error('test fake rejected root delete during a project mutation');
        }
        return writeResult();
      },
    };
  };
  const makeInsert = (executor: Executor) => (table: unknown) => {
    return {
      async values(values: Record<string, unknown>) {
        writes.push({ kind: 'insert', table: tableName(table), values, executor });
        events.push(`${executor}:insert:${tableName(table)}`);
        if (executor === 'root') {
          throw new Error('test fake rejected root insert during a project mutation');
        }
        return writeResult();
      },
    };
  };
  const tx = {
    select: makeSelect('tx'),
    insert: makeInsert('tx'),
    update: makeUpdate('tx'),
    delete: makeDelete('tx'),
  };
  const db = {
    select: makeSelect('root'),
    insert: makeInsert('root'),
    update: makeUpdate('root'),
    delete: makeDelete('root'),
    async transaction<Result>(callback: (tx: unknown) => Promise<Result>): Promise<Result> {
      events.push('root:transaction:begin');
      try {
        const result = await callback(tx);
        events.push('root:transaction:commit');
        return result;
      } catch (error) {
        events.push('root:transaction:rollback');
        throw error;
      }
    },
  };
  return { db: db as unknown as DB, tx, queries, writes, events };
}

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
  projectMemberRole: 'lead',
  projectMemberStatus: 'active',
};
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
const targetMember = {
  id: 300,
  externalId: 'pmem_target',
  projectId: 200,
  userId: 2,
  role: 'member',
  status: 'active',
};
const targetOrganizationMember = {
  id: 301,
  externalId: 'omem_target',
  organizationId: 20,
  userId: 2,
  status: 'active',
  userExternalId: 'usr_target',
  displayName: 'Mina',
  avatarUrl: null,
};
const input = { actorExternalId: 'usr_member', projectExternalId: 'prj_design' };

function normalizedSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, ' ').trim();
}

describe('project access mutations', () => {
  it('exposes concrete mutation APIs without public callback sessions', () => {
    expectTypeOf(renameProjectWithAccess).parameters.toEqualTypeOf<
      [DB, typeof input, { name: string }]
    >();
    expectTypeOf(deleteProjectWithAccess).parameters.toEqualTypeOf<[DB, typeof input]>();
  });

  it('uses a distinct transaction executor and rejects root writes in the test harness', async () => {
    const fake = makeDb([]);

    expect(fake.tx).not.toBe(fake.db);
    await expect(
      fake.db
        .update(schema.projects)
        .set({ name: 'Wrong executor' })
        .where(undefined as never),
    ).rejects.toThrow('test fake rejected root update during a project mutation');
    expect(fake.writes).toEqual([
      {
        kind: 'update',
        table: 'projects',
        values: { name: 'Wrong executor' },
        executor: 'root',
      },
    ]);
  });

  it('renames exactly the authorized project in the locked authorization transaction', async () => {
    const fake = makeDb([[teamSnapshot]], [1]);

    await expect(renameProjectWithAccess(fake.db, input, { name: 'Renamed' })).resolves.toEqual(
      expect.objectContaining({ projectId: 200, name: 'Renamed', scope: 'organization' }),
    );
    expect(fake.queries).toEqual([{ table: 'projects', lock: 'update', executor: 'tx' }]);
    expect(fake.writes).toEqual([
      {
        kind: 'update',
        table: 'projects',
        values: { name: 'Renamed' },
        executor: 'tx',
      },
    ]);
    expect(fake.events).toEqual([
      'root:transaction:begin',
      'tx:select:projects:update',
      'tx:update:projects',
      'root:transaction:commit',
    ]);
  });

  it('preserves personal owner-only read and rename compatibility', async () => {
    const ownerRead = makeDb([[personalSnapshot]]);
    const ownerRename = makeDb([[personalSnapshot]], [1]);
    const nonOwner = makeDb([[{ ...personalSnapshot, actorUserId: 2 }]]);
    const personalInput = { actorExternalId: 'usr_owner', projectExternalId: 'prj_personal' };

    await expect(requireReadableProject(ownerRead.db, personalInput)).resolves.toMatchObject({
      projectId: 100,
      scope: 'personal',
    });
    await expect(
      renameProjectWithAccess(ownerRename.db, personalInput, { name: 'Personal' }),
    ).resolves.toMatchObject({
      projectId: 100,
      name: 'Personal',
    });
    await expect(requireReadableProject(nonOwner.db, personalInput)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(ownerRead.queries).toEqual([{ table: 'projects', lock: null, executor: 'root' }]);
    expect(ownerRename.queries).toEqual([{ table: 'projects', lock: 'update', executor: 'tx' }]);
  });

  it('does not provide a delete callback or delete write on the rename path', async () => {
    const fake = makeDb([[teamSnapshot]], [1]);
    const result = await renameProjectWithAccess(fake.db, input, { name: 'Renamed' });

    expect(result).not.toHaveProperty('action');
    expect(result).not.toHaveProperty('delete');
    expect(fake.writes.map((write) => write.kind)).toEqual(['update']);
  });

  it('allows a project lead to rename and remove members but denies delete before a write', async () => {
    const rename = makeDb([[teamSnapshot]], [1]);
    const remove = makeDb([[teamSnapshot], [targetMember]], [1]);
    const deniedDelete = makeDb([[teamSnapshot]]);

    await expect(
      renameProjectWithAccess(rename.db, input, { name: 'Renamed' }),
    ).resolves.toBeDefined();
    await expect(
      removeProjectMemberWithAccess(remove.db, input, 'pmem_target'),
    ).resolves.toMatchObject({
      projectMemberId: 'pmem_target',
      status: 'inactive',
    });
    await expect(deleteProjectWithAccess(deniedDelete.db, input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(remove.queries).toEqual([
      { table: 'projects', lock: 'update', executor: 'tx' },
      { table: 'project_members', lock: 'update', executor: 'tx' },
    ]);
    expect(remove.writes).toEqual([
      expect.objectContaining({
        kind: 'update',
        table: 'project_members',
        executor: 'tx',
      }),
    ]);
    expect(remove.events).toEqual([
      'root:transaction:begin',
      'tx:select:projects:update',
      'tx:select:project_members:update',
      'tx:update:project_members',
      'root:transaction:commit',
    ]);
    expect(deniedDelete.writes).toEqual([]);
    expect(deniedDelete.events).toEqual([
      'root:transaction:begin',
      'tx:select:projects:update',
      'root:transaction:rollback',
    ]);
  });

  it('adds an active same-organization target through the locked access transaction', async () => {
    const fake = makeDb([[teamSnapshot], [targetOrganizationMember], []], [1]);

    await expect(
      addProjectMemberWithAccess(fake.db, input, 'omem_target', 'viewer'),
    ).resolves.toMatchObject({
      projectMemberId: expect.stringMatching(/^pmem_/),
      userId: 'usr_target',
      displayName: 'Mina',
      avatarUrl: null,
      role: 'viewer',
    });
    expect(fake.queries).toEqual([
      { table: 'projects', lock: 'update', executor: 'tx' },
      { table: 'organization_members', lock: 'update', executor: 'tx' },
      { table: 'project_members', lock: 'update', executor: 'tx' },
    ]);
    expect(fake.writes).toEqual([
      expect.objectContaining({
        kind: 'insert',
        table: 'project_members',
        executor: 'tx',
        values: expect.objectContaining({ projectId: 200, userId: 2, role: 'viewer' }),
      }),
    ]);
  });

  it('hides an inactive or cross-organization add target before a membership write', async () => {
    const fake = makeDb([
      [teamSnapshot],
      [{ ...targetOrganizationMember, organizationId: 21, status: 'inactive' }],
    ]);

    await expect(
      addProjectMemberWithAccess(fake.db, input, 'omem_target', 'member'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fake.writes).toEqual([]);
  });

  it('rejects a duplicate active project membership without inserting', async () => {
    const fake = makeDb([[teamSnapshot], [targetOrganizationMember], [targetMember]]);

    await expect(
      addProjectMemberWithAccess(fake.db, input, 'omem_target', 'member'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(fake.writes).toEqual([]);
  });

  it('hides a tampered existing membership bound to another project or user', async () => {
    const fake = makeDb([
      [teamSnapshot],
      [targetOrganizationMember],
      [{ ...targetMember, projectId: 201, userId: 3 }],
    ]);

    await expect(
      addProjectMemberWithAccess(fake.db, input, 'omem_target', 'member'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fake.writes).toEqual([]);
  });

  it.each([
    ['a cross-project target', { ...targetMember, projectId: 201 }],
    ['an inactive target', { ...targetMember, status: 'inactive' }],
  ] as const)('hides %s before a remove write', async (_label, target) => {
    const fake = makeDb([[teamSnapshot], [target]]);

    await expect(
      removeProjectMemberWithAccess(fake.db, input, 'pmem_target'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fake.writes).toEqual([]);
  });

  it('fails and rolls back a zero-row guarded member removal', async () => {
    const fake = makeDb([[teamSnapshot], [targetMember]], [0]);

    await expect(
      removeProjectMemberWithAccess(fake.db, input, 'pmem_target'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fake.writes).toEqual([
      expect.objectContaining({ kind: 'update', table: 'project_members', executor: 'tx' }),
    ]);
    expect(fake.events).toEqual([
      'root:transaction:begin',
      'tx:select:projects:update',
      'tx:select:project_members:update',
      'tx:update:project_members',
      'root:transaction:rollback',
    ]);
  });

  it('fails stably and rolls back a zero-row guarded rename without success', async () => {
    const fake = makeDb([[teamSnapshot]], [0]);

    await expect(
      renameProjectWithAccess(fake.db, input, { name: 'Not persisted' }),
    ).rejects.toMatchObject({
      name: 'ProjectAccessError',
      code: 'NOT_FOUND',
      message: 'project not found',
    });
    expect(fake.queries).toEqual([{ table: 'projects', lock: 'update', executor: 'tx' }]);
    expect(fake.writes).toEqual([
      {
        kind: 'update',
        table: 'projects',
        values: { name: 'Not persisted' },
        executor: 'tx',
      },
    ]);
    expect(fake.events).toEqual([
      'root:transaction:begin',
      'tx:select:projects:update',
      'tx:update:projects',
      'root:transaction:rollback',
    ]);
    expect(fake.events).not.toContain('root:transaction:commit');
  });

  it('fails and rolls back a zero-row guarded delete', async () => {
    const fake = makeDb([[{ ...teamSnapshot, organizationMemberRole: 'owner' }]], [0]);

    await expect(deleteProjectWithAccess(fake.db, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(fake.writes).toEqual([
      expect.objectContaining({ kind: 'delete', table: 'projects', executor: 'tx' }),
    ]);
    expect(fake.queries).toEqual([{ table: 'projects', lock: 'update', executor: 'tx' }]);
    expect(fake.events).toEqual([
      'root:transaction:begin',
      'tx:select:projects:update',
      'tx:delete:projects',
      'root:transaction:rollback',
    ]);
  });

  it('keeps readable access read-only and validates tampered snapshot identities', async () => {
    const fake = makeDb([[{ ...teamSnapshot, actorExternalId: 'usr_other' }]]);

    await expect(requireReadableProject(fake.db, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(fake.writes).toEqual([]);
    expect(fake.queries).toEqual([{ table: 'projects', lock: null, executor: 'root' }]);
  });

  it('compiles locked access and target-member predicates with exact parameters', () => {
    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const access = __projectAccessInternals
      .buildProjectAccessSnapshotQuery(mockDb, input, true)
      .toSQL();
    const target = __projectAccessInternals
      .buildLockedTargetMemberQuery(mockDb, 200, 'pmem_target')
      .toSQL();
    const organizationTarget = __projectAccessInternals
      .buildLockedTargetOrganizationMemberQuery(mockDb, 20, 'omem_target')
      .toSQL();
    const existingProjectMember = __projectAccessInternals
      .buildLockedProjectMemberByUserQuery(mockDb, 200, 2)
      .toSQL();
    const accessSql = normalizedSql(access.sql);
    const targetSql = normalizedSql(target.sql);

    expect(accessSql).toContain('left join `organizations` on');
    expect(accessSql).toContain('`projects`.`organization_id` is null');
    expect(accessSql).toContain('`projects`.`user_id` = `users`.`id`');
    expect(accessSql).toContain('`project_members`.`project_id` = `projects`.`id`');
    expect(accessSql).toContain('for update');
    expect(access.params).toEqual([
      'usr_member',
      'active',
      true,
      'active',
      'active',
      'prj_design',
      1,
    ]);
    expect(targetSql).toContain('`project_members`.`project_id` = ?');
    expect(targetSql).toContain('`project_members`.`external_id` = ?');
    expect(targetSql).toContain('for update');
    expect(target.params).toEqual([200, 'pmem_target', 1]);
    expect(normalizedSql(organizationTarget.sql)).toContain(
      '`organization_members`.`organization_id` = ?',
    );
    expect(normalizedSql(organizationTarget.sql)).toContain(
      '`organization_members`.`external_id` = ?',
    );
    expect(normalizedSql(organizationTarget.sql)).toContain('`organization_members`.`status` = ?');
    expect(normalizedSql(organizationTarget.sql)).toContain('for update');
    expect(organizationTarget.params).toEqual([20, 'omem_target', 'active', 1]);
    expect(normalizedSql(existingProjectMember.sql)).toContain(
      '`project_members`.`project_id` = ?',
    );
    expect(normalizedSql(existingProjectMember.sql)).toContain('`project_members`.`user_id` = ?');
    expect(normalizedSql(existingProjectMember.sql)).toContain('for update');
    expect(existingProjectMember.params).toEqual([200, 2, 1]);
  });

  it('uses domain-only errors', () => {
    expect(new ProjectAccessError('FORBIDDEN')).toBeInstanceOf(Error);
  });
});
