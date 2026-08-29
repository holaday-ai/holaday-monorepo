import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  ProjectAccessError,
  __projectAccessInternals,
  deleteProjectWithAccess,
  removeProjectMemberWithAccess,
  renameProjectWithAccess,
  requireReadableProject,
} from './project-access.js';

type Query = { table: string; lock: 'update' | null; inTransaction: boolean };
type Write = {
  kind: 'update' | 'delete';
  table: string;
  values?: Record<string, unknown>;
  inTransaction: boolean;
};

/** A transaction fake that makes locked reads, writes, and rollback observable. */
function makeDb(selectResults: unknown[][], affectedRows: number[] = []) {
  const queries: Query[] = [];
  const writes: Write[] = [];
  const events: string[] = [];
  let transactionDepth = 0;
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
  const select = (): SelectBuilder => {
    let table = '';
    let lock: 'update' | null = null;
    let completed: Promise<unknown[]> | undefined;
    const finish = () => {
      completed ??= Promise.resolve(take());
      if (!queries.some((query) => query.table === table && query.lock === lock)) {
        queries.push({ table, lock, inTransaction: transactionDepth > 0 });
        events.push(`select:${table}:${lock ?? 'none'}`);
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
  const db = {
    select,
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            async where() {
              writes.push({
                kind: 'update',
                table: tableName(table),
                values,
                inTransaction: transactionDepth > 0,
              });
              events.push(`update:${tableName(table)}`);
              return writeResult();
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        async where() {
          writes.push({
            kind: 'delete',
            table: tableName(table),
            inTransaction: transactionDepth > 0,
          });
          events.push(`delete:${tableName(table)}`);
          return writeResult();
        },
      };
    },
    async transaction<Result>(callback: (tx: unknown) => Promise<Result>): Promise<Result> {
      transactionDepth += 1;
      events.push('begin');
      try {
        const result = await callback(db);
        events.push('commit');
        return result;
      } catch (error) {
        events.push('rollback');
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    },
  };
  return { db: db as unknown as DB, queries, writes, events };
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

  it('renames exactly the authorized project in the locked authorization transaction', async () => {
    const fake = makeDb([[teamSnapshot]], [1]);

    await expect(renameProjectWithAccess(fake.db, input, { name: 'Renamed' })).resolves.toEqual(
      expect.objectContaining({ projectId: 200, name: 'Renamed', scope: 'organization' }),
    );
    expect(fake.queries).toEqual([
      expect.objectContaining({ table: 'projects', lock: 'update', inTransaction: true }),
    ]);
    expect(fake.writes).toEqual([
      expect.objectContaining({
        kind: 'update',
        table: 'projects',
        values: { name: 'Renamed' },
        inTransaction: true,
      }),
    ]);
    expect(fake.events).toEqual(['begin', 'select:projects:update', 'update:projects', 'commit']);
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
    expect(deniedDelete.writes).toEqual([]);
    expect(deniedDelete.events).toEqual(['begin', 'select:projects:update', 'rollback']);
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
      expect.objectContaining({ kind: 'update', table: 'project_members', inTransaction: true }),
    ]);
    expect(fake.events.at(-1)).toBe('rollback');
  });

  it('fails and rolls back a zero-row guarded delete', async () => {
    const fake = makeDb([[{ ...teamSnapshot, organizationMemberRole: 'owner' }]], [0]);

    await expect(deleteProjectWithAccess(fake.db, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(fake.writes).toEqual([
      expect.objectContaining({ kind: 'delete', table: 'projects', inTransaction: true }),
    ]);
    expect(fake.events.at(-1)).toBe('rollback');
  });

  it('keeps readable access read-only and validates tampered snapshot identities', async () => {
    const fake = makeDb([[{ ...teamSnapshot, actorExternalId: 'usr_other' }]]);

    await expect(requireReadableProject(fake.db, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(fake.writes).toEqual([]);
  });

  it('compiles locked access and target-member predicates with exact parameters', () => {
    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const access = __projectAccessInternals
      .buildProjectAccessSnapshotQuery(mockDb, input, true)
      .toSQL();
    const target = __projectAccessInternals
      .buildLockedTargetMemberQuery(mockDb, 200, 'pmem_target')
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
  });

  it('uses domain-only errors', () => {
    expect(new ProjectAccessError('FORBIDDEN')).toBeInstanceOf(Error);
  });
});
