import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  OrganizationServiceError,
  __organizationServiceInternals,
  createOrganization,
  deactivateMember,
  listOrganizationMembers,
  listOrganizationsForUser,
  updateMemberRole,
  updateReportingLine,
} from './organization-service.js';

type Executor = 'root' | 'tx';
type Insert = {
  table: string;
  values: Record<string, unknown>;
  inTransaction: boolean;
  executor: Executor;
};
type Update = {
  table: string;
  values: Record<string, unknown>;
  inTransaction: boolean;
  executor: Executor;
};
type Query = {
  from: string;
  joins: Array<{ kind: 'inner' | 'left'; table: string }>;
  predicates: unknown[];
  lockStrength: 'update' | null;
  ordered: boolean;
  inTransaction: boolean;
  executor: Executor;
};
type Event = {
  kind: 'select' | 'update';
  table: string;
  lockStrength: 'update' | null;
  inTransaction: boolean;
  executor: Executor;
};

type FakeMembershipState = {
  organizationMembershipStatus: 'active' | 'inactive';
  projectMembershipStatuses: Array<'active' | 'inactive'>;
};
type FakeDbOptions = {
  failTransactionAfterCallback?: boolean;
};

/**
 * The service boundary needs only selects plus transaction-scoped writes. This deliberately
 * small Drizzle-shaped fake returns programmed select results and records real service effects.
 */
function makeDb(
  selectResults: unknown[][],
  updateAffectedRows: number[] = [],
  initialState: FakeMembershipState = {
    organizationMembershipStatus: 'active',
    projectMembershipStatuses: ['active'],
  },
  options: FakeDbOptions = {},
) {
  const inserts: Insert[] = [];
  const updates: Update[] = [];
  const deletes: string[] = [];
  const queries: Query[] = [];
  const events: Event[] = [];
  let transactionCalls = 0;
  let transactionRollbacks = 0;
  let transactionDepth = 0;
  let nextInsertId = 100;
  const state: FakeMembershipState = {
    organizationMembershipStatus: initialState.organizationMembershipStatus,
    projectMembershipStatuses: [...initialState.projectMembershipStatuses],
  };

  const tableName = (table: unknown) => {
    if (!table || typeof table !== 'object') return '';
    const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
    return typeof name === 'string' ? name : '';
  };

  const takeSelectResult = () => selectResults.shift() ?? [];
  type SelectBuilder = {
    from: (table: unknown) => SelectBuilder;
    innerJoin: (table: unknown) => SelectBuilder;
    leftJoin: (table: unknown) => SelectBuilder;
    where: (predicate: unknown) => SelectBuilder;
    groupBy: () => SelectBuilder;
    orderBy: () => SelectBuilder;
    for: (strength: 'update') => SelectBuilder;
    limit: () => Promise<unknown[]>;
  };
  const rejectRootDuringTransaction = (executor: Executor, operation: string) => {
    if (executor === 'root' && transactionDepth > 0) {
      throw new Error(`organization service fake rejected root ${operation} inside transaction`);
    }
  };
  const selectBuilder = (executor: Executor): SelectBuilder => {
    rejectRootDuringTransaction(executor, 'select');
    const query: Query = {
      from: '',
      joins: [],
      predicates: [],
      lockStrength: null,
      ordered: false,
      inTransaction: executor === 'tx',
      executor,
    };
    let result: Promise<unknown[]> | undefined;
    let recorded = false;
    const finish = () => {
      result ??= Promise.resolve(takeSelectResult());
      if (!recorded) {
        recorded = true;
        queries.push({
          ...query,
          joins: [...query.joins],
          predicates: [...query.predicates],
          inTransaction: executor === 'tx',
          executor,
        });
        events.push({
          kind: 'select',
          table: query.from,
          lockStrength: query.lockStrength,
          inTransaction: executor === 'tx',
          executor,
        });
      }
      return result;
    };
    const builder: SelectBuilder = {
      from: (table: unknown) => {
        query.from = tableName(table);
        return builder;
      },
      innerJoin: (table: unknown) => {
        query.joins.push({ kind: 'inner', table: tableName(table) });
        return builder;
      },
      leftJoin: (table: unknown) => {
        query.joins.push({ kind: 'left', table: tableName(table) });
        return builder;
      },
      where: (predicate: unknown) => {
        query.predicates.push(predicate);
        return builder;
      },
      groupBy: () => builder,
      orderBy: () => {
        query.ordered = true;
        return builder;
      },
      for: (strength: 'update') => {
        query.lockStrength = strength;
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

  const makeInsert = (executor: Executor) => (table: unknown) => {
    rejectRootDuringTransaction(executor, 'insert');
    return {
      async values(values: Record<string, unknown>) {
        inserts.push({
          table: tableName(table),
          values,
          inTransaction: executor === 'tx',
          executor,
        });
        return [{ insertId: nextInsertId++ }];
      },
    };
  };
  const makeUpdate = (executor: Executor) => (table: unknown) => {
    rejectRootDuringTransaction(executor, 'update');
    return {
      set(values: Record<string, unknown>) {
        return {
          async where() {
            const selectedTable = tableName(table);
            const affectedRows = updateAffectedRows.shift() ?? 1;
            updates.push({
              table: selectedTable,
              values,
              inTransaction: executor === 'tx',
              executor,
            });
            events.push({
              kind: 'update',
              table: selectedTable,
              lockStrength: null,
              inTransaction: executor === 'tx',
              executor,
            });
            if (affectedRows > 0 && values.status === 'inactive') {
              if (selectedTable === 'organization_members') {
                state.organizationMembershipStatus = 'inactive';
              }
              if (selectedTable === 'project_members') {
                state.projectMembershipStatuses = state.projectMembershipStatuses.map(
                  () => 'inactive',
                );
              }
            }
            return [{ affectedRows }];
          },
        };
      },
    };
  };
  const makeDelete = (executor: Executor) => (table: unknown) => {
    rejectRootDuringTransaction(executor, 'delete');
    return {
      async where() {
        deletes.push(tableName(table));
        return [{ affectedRows: 1 }];
      },
    };
  };
  const tx = {
    select: () => selectBuilder('tx'),
    insert: makeInsert('tx'),
    update: makeUpdate('tx'),
    delete: makeDelete('tx'),
  };
  const db = {
    select: () => selectBuilder('root'),
    insert: makeInsert('root'),
    update: makeUpdate('root'),
    delete: makeDelete('root'),
    async transaction<T>(callback: (transactionExecutor: typeof tx) => Promise<T>): Promise<T> {
      transactionCalls += 1;
      transactionDepth += 1;
      const stateSnapshot: FakeMembershipState = {
        organizationMembershipStatus: state.organizationMembershipStatus,
        projectMembershipStatuses: [...state.projectMembershipStatuses],
      };
      try {
        const result = await callback(tx);
        if (options.failTransactionAfterCallback) {
          throw new Error('organization service fake injected post-callback transaction failure');
        }
        return result;
      } catch (error) {
        transactionRollbacks += 1;
        state.organizationMembershipStatus = stateSnapshot.organizationMembershipStatus;
        state.projectMembershipStatuses = [...stateSnapshot.projectMembershipStatuses];
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    },
  };

  return {
    db: db as unknown as DB,
    inserts,
    updates,
    deletes,
    queries,
    events,
    tx,
    get state(): FakeMembershipState {
      return {
        organizationMembershipStatus: state.organizationMembershipStatus,
        projectMembershipStatuses: [...state.projectMembershipStatuses],
      };
    },
    get transactionCalls() {
      return transactionCalls;
    },
    get transactionRollbacks() {
      return transactionRollbacks;
    },
  };
}

const actor = { id: 1 };
const actorMembership = {
  id: 10,
  externalId: 'omem_actor',
  organizationId: 20,
  organizationExternalId: 'org_design',
  userId: 1,
  role: 'owner',
  status: 'active',
};
const member = {
  id: 11,
  externalId: 'omem_member',
  organizationId: 20,
  organizationExternalId: 'org_design',
  userId: 2,
  role: 'member',
  status: 'active',
};
const manager = {
  ...member,
  id: 12,
  externalId: 'omem_manager',
  userId: 3,
  role: 'manager',
};

function normalizedSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, ' ').trim();
}

function expectValidatedManagerJoin(sql: string): void {
  const normalized = normalizedSql(sql);
  const managerMembershipJoin =
    'left join `organization_members` `organization_manager_memberships` on ';
  const managerUserJoin = 'left join `users` `organization_manager_users` on ';
  const membershipJoinIndex = normalized.indexOf(managerMembershipJoin);
  const managerUserJoinIndex = normalized.indexOf(managerUserJoin);

  expect(membershipJoinIndex).toBeGreaterThanOrEqual(0);
  expect(managerUserJoinIndex).toBeGreaterThan(membershipJoinIndex);
  const managerMembershipOn = normalized.slice(membershipJoinIndex, managerUserJoinIndex);
  expect(managerMembershipOn).toContain(
    '`organization_manager_memberships`.`organization_id` = `organization_members`.`organization_id`',
  );
  expect(managerMembershipOn).toContain(
    '`organization_manager_memberships`.`user_id` = `organization_members`.`manager_user_id`',
  );
  expect(managerMembershipOn).toContain('`organization_manager_memberships`.`status` = ?');
  expect(managerMembershipOn).toContain('`organization_manager_memberships`.`role` in (?, ?, ?)');
  const managerUserOnStart = managerUserJoinIndex + managerUserJoin.length;
  const remainingSql = normalized.slice(managerUserOnStart);
  const managerUserOnEnd = [
    ' left join ',
    ' inner join ',
    ' right join ',
    ' full join ',
    ' cross join ',
    ' join ',
    ' where ',
    ' group by ',
    ' order by ',
    ' having ',
    ' limit ',
    ' for update',
  ]
    .map((clause) => remainingSql.indexOf(clause))
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), remainingSql.length);
  const managerUserOn = remainingSql.slice(0, managerUserOnEnd);
  expect(managerUserOn).toContain(
    '`organization_manager_users`.`id` = `organization_manager_memberships`.`user_id`',
  );
  expect(managerUserOn).not.toContain('`organization_members`.`manager_user_id`');
}

const validManagerJoinSql = `
  select * from \`organization_members\`
  left join \`organization_members\` \`organization_manager_memberships\` on
    \`organization_manager_memberships\`.\`organization_id\` = \`organization_members\`.\`organization_id\`
    and \`organization_manager_memberships\`.\`user_id\` = \`organization_members\`.\`manager_user_id\`
    and \`organization_manager_memberships\`.\`status\` = ?
    and \`organization_manager_memberships\`.\`role\` in (?, ?, ?)
  left join \`users\` \`organization_manager_users\` on
    \`organization_manager_users\`.\`id\` = \`organization_manager_memberships\`.\`user_id\`
  where \`organization_members\`.\`status\` = ?
`;

function eventSequence(fake: ReturnType<typeof makeDb>): string[] {
  return fake.events.map(
    (event) =>
      `${event.kind}:${event.table}:${event.lockStrength ?? 'none'}:${event.inTransaction ? 'tx' : 'outside'}`,
  );
}

function lockedMemberShapes(fake: ReturnType<typeof makeDb>) {
  return fake.queries
    .filter(
      (query) =>
        query.from === 'organization_members' &&
        query.inTransaction &&
        query.lockStrength === 'update',
    )
    .map((query) => ({ lockStrength: query.lockStrength, ordered: query.ordered }));
}

describe('organization service', () => {
  it('uses distinct root and transaction executors and rejects root access inside callbacks', async () => {
    const fake = makeDb([]);

    expect(fake.tx).not.toBe(fake.db);
    await fake.db.transaction(async (tx) => {
      expect(tx).toBe(fake.tx);
      expect(() => fake.db.select()).toThrow(
        'organization service fake rejected root select inside transaction',
      );
      expect(() => fake.db.update(schema.organizationMembers)).toThrow(
        'organization service fake rejected root update inside transaction',
      );
    });
    expect(fake.queries).toEqual([]);
    expect(fake.updates).toEqual([]);
  });

  it('creates the canary organization and its owner membership in one transaction', async () => {
    const fake = makeDb([[actor]]);

    const result = await createOrganization({
      db: fake.db,
      actorExternalId: 'usr_owner',
      name: 'Design team',
    });

    expect(result).toMatchObject({ name: 'Design team', role: 'owner', teamProjectsEnabled: true });
    expect(result.organizationId).toMatch(/^org_/);
    expect(fake.transactionCalls).toBe(1);
    expect(fake.inserts).toEqual([
      expect.objectContaining({
        table: 'organizations',
        inTransaction: true,
        values: expect.objectContaining({
          name: 'Design team',
          externalId: expect.stringMatching(/^org_/),
          ownerUserId: 1,
          status: 'active',
          teamProjectsEnabled: true,
        }),
      }),
      expect.objectContaining({
        table: 'organization_members',
        inTransaction: true,
        values: expect.objectContaining({
          organizationId: 100,
          externalId: expect.stringMatching(/^omem_/),
          userId: 1,
          role: 'owner',
          status: 'active',
        }),
      }),
    ]);
  });

  it('lists only active organizations with caller role, manager name, and active-member count', async () => {
    const fake = makeDb([
      [actor],
      [
        {
          organizationId: 20,
          organizationExternalId: 'org_design',
          organizationName: 'Design team',
          teamProjectsEnabled: true,
          role: 'manager',
          managerDisplayName: 'Ada',
        },
      ],
      [{ organizationId: 20, activeMemberCount: 3 }],
    ]);

    await expect(
      listOrganizationsForUser({ db: fake.db, actorExternalId: 'usr_manager' }),
    ).resolves.toEqual([
      {
        organizationId: 'org_design',
        name: 'Design team',
        callerRole: 'manager',
        managerDisplayName: 'Ada',
        activeMemberCount: 3,
        teamProjectsEnabled: true,
      },
    ]);
  });

  it('lists active organization members without auth or contact fields', async () => {
    const fake = makeDb([
      [actor],
      [actorMembership],
      [
        {
          memberExternalId: 'omem_member',
          userExternalId: 'usr_member',
          displayName: 'Mina',
          avatarUrl: 'https://cdn.example/mina.png',
          role: 'member',
          managerUserExternalId: 'usr_manager',
          managerDisplayName: 'Ada',
        },
      ],
    ]);

    await expect(
      listOrganizationMembers({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
      }),
    ).resolves.toEqual([
      {
        memberId: 'omem_member',
        userId: 'usr_member',
        displayName: 'Mina',
        avatarUrl: 'https://cdn.example/mina.png',
        role: 'member',
        managerUserId: 'usr_manager',
        managerDisplayName: 'Ada',
        status: 'active',
      },
    ]);
  });

  it('binds manager display names through an active authorized same-organization membership', () => {
    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const query = __organizationServiceInternals.buildActiveMemberListQuery(mockDb, 20).toSQL();

    expectValidatedManagerJoin(query.sql);
    expect(query.sql).toContain('`organization_members`.`organization_id`');
    expect(query.params).toEqual(
      expect.arrayContaining([20, 'active', 'owner', 'admin', 'manager']),
    );
  });

  it('applies the same active authorized manager binding to organization-list manager names', () => {
    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const query = __organizationServiceInternals.buildOrganizationListQuery(mockDb, 1).toSQL();

    expectValidatedManagerJoin(query.sql);
    expect(query.params).toEqual(
      expect.arrayContaining([1, 'active', 'owner', 'admin', 'manager']),
    );
  });

  it('rejects a manager-user join mutated to also bind directly to the base membership', () => {
    const unsafeSql = validManagerJoinSql.replace(
      '`organization_manager_users`.`id` = `organization_manager_memberships`.`user_id`',
      '`organization_manager_users`.`id` = `organization_manager_memberships`.`user_id` and `organization_manager_users`.`id` = `organization_members`.`manager_user_id`',
    );

    expect(() => expectValidatedManagerJoin(unsafeSql)).toThrow();
  });

  it('builds a same-organization, deterministic membership lock query', () => {
    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const query = __organizationServiceInternals
      .buildLockOrganizationMembersQuery(mockDb, 20, ['omem_manager', 'omem_member'])
      .toSQL();
    const sql = normalizedSql(query.sql);

    expect(sql).toContain(
      'where (`organization_members`.`organization_id` = ? and `organization_members`.`external_id` in (?, ?))',
    );
    expect(sql).toContain('order by `organization_members`.`external_id` asc for update');
    expect(sql).not.toContain('join `organizations`');
    expect(query.params).toEqual([20, 'omem_manager', 'omem_member']);
  });

  it('compiles reporting-line preflight and transaction locks with exact tenant parameters', () => {
    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const preflight = __organizationServiceInternals
      .buildActiveActorMembershipQuery(mockDb, 7, 'org_design')
      .toSQL();
    const organizationLock = __organizationServiceInternals
      .buildLockedActiveOrganizationQuery(mockDb, 'org_design')
      .toSQL();
    const actorLock = __organizationServiceInternals
      .buildLockedActiveActorMembershipQuery(mockDb, 7, {
        id: 20,
        externalId: 'org_design',
      })
      .toSQL();

    expect(normalizedSql(preflight.sql)).toContain('`organizations`.`external_id` = ?');
    expect(normalizedSql(preflight.sql)).not.toContain('for update');
    expect(preflight.params).toEqual(['org_design', 'active', 7, 'active', 1]);
    expect(normalizedSql(organizationLock.sql)).toContain(
      '`organizations`.`team_projects_enabled` = ?',
    );
    expect(normalizedSql(organizationLock.sql)).toContain('for update');
    expect(organizationLock.params).toEqual(['org_design', 'active', true]);
    expect(normalizedSql(actorLock.sql)).toContain('`organization_members`.`organization_id` = ?');
    expect(normalizedSql(actorLock.sql)).toContain('for update');
    expect(actorLock.params).toEqual([20, 7, 'active']);
  });

  it('compiles affected-project and active-membership locks in deterministic id order', () => {
    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const candidates = __organizationServiceInternals
      .buildTargetActiveProjectIdsQuery(mockDb, 20, 2)
      .toSQL();
    const projectLocks = __organizationServiceInternals
      .buildLockedProjectsQuery(mockDb, 20, [200, 201])
      .toSQL();
    const membershipLocks = __organizationServiceInternals
      .buildLockedActiveProjectMembershipsQuery(mockDb, [200, 201])
      .toSQL();

    expect(normalizedSql(candidates.sql)).toContain('`projects`.`organization_id` = ?');
    expect(normalizedSql(candidates.sql)).toContain('`project_members`.`user_id` = ?');
    expect(normalizedSql(candidates.sql)).toContain('`project_members`.`status` = ?');
    expect(candidates.params).toEqual([2, 'active', 20]);
    expect(normalizedSql(projectLocks.sql)).toContain('order by `projects`.`id` asc for update');
    expect(projectLocks.params).toEqual([20, 200, 201]);
    expect(normalizedSql(membershipLocks.sql)).toContain(
      'order by `project_members`.`project_id` asc, `project_members`.`id` asc for update',
    );
    expect(membershipLocks.params).toEqual([200, 201, 'active']);
  });

  it.each([
    [
      'inactive',
      { ...member, externalId: 'omem_manager', userId: 3, role: 'manager', status: 'inactive' },
      'manager_organization_membership_inactive',
    ],
    [
      'member role',
      { ...member, externalId: 'omem_manager', userId: 3, role: 'member' },
      'manager_role_not_permitted',
    ],
    ['the target user', member, 'manager_cannot_be_self'],
  ] as const)(
    'rejects a %s reporting manager through the shared permission decision',
    async (_label, manager, reason) => {
      const fake = makeDb([
        [actor],
        [actorMembership],
        [{ id: 20, externalId: 'org_design' }],
        [actorMembership],
        [member, manager],
      ]);

      await expect(
        updateReportingLine({
          db: fake.db,
          actorExternalId: 'usr_owner',
          organizationExternalId: 'org_design',
          targetMemberExternalId: 'omem_member',
          managerMemberExternalId: manager.externalId,
        }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', reason });
      expect(fake.updates).toEqual([]);
    },
  );

  it('updates a reporting line only inside a transaction that issues a row lock', async () => {
    const fake = makeDb([
      [actor],
      [actorMembership],
      [{ id: 20, externalId: 'org_design' }],
      [actorMembership],
      [member, manager],
    ]);

    await expect(
      updateReportingLine({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
        managerMemberExternalId: 'omem_manager',
      }),
    ).resolves.toEqual({ ok: true });

    expect(fake.transactionCalls).toBe(1);
    const organizationLockIndex = fake.queries.findIndex(
      (query) =>
        query.from === 'organizations' && query.lockStrength === 'update' && query.inTransaction,
    );
    const lockedMemberIndex = fake.queries.findIndex(
      (query, index) =>
        index > organizationLockIndex &&
        query.from === 'organization_members' &&
        query.lockStrength === 'update' &&
        query.inTransaction,
    );
    expect(organizationLockIndex).toBeGreaterThanOrEqual(0);
    expect(lockedMemberIndex).toBeGreaterThan(organizationLockIndex);
    expect(fake.updates).toEqual([
      expect.objectContaining({
        table: 'organization_members',
        inTransaction: true,
        values: { managerUserId: 3 },
      }),
    ]);
    expect(eventSequence(fake)).toEqual([
      'select:users:none:outside',
      'select:organization_members:none:outside',
      'select:organizations:update:tx',
      'select:organization_members:update:tx',
      'select:organization_members:update:tx',
      'update:organization_members:none:tx',
    ]);
    expect(lockedMemberShapes(fake)).toEqual([
      { lockStrength: 'update', ordered: false },
      { lockStrength: 'update', ordered: true },
    ]);
  });

  it('rejects a reporting update when the active target disappears before the write', async () => {
    const fake = makeDb(
      [
        [actor],
        [actorMembership],
        [{ id: 20, externalId: 'org_design' }],
        [actorMembership],
        [member, manager],
      ],
      [0],
    );

    await expect(
      updateReportingLine({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
        managerMemberExternalId: 'omem_manager',
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
  });

  it('does not lock a foreign organization membership while assigning a reporting line', async () => {
    const fake = makeDb([
      [actor],
      [actorMembership],
      [{ id: 20, externalId: 'org_design' }],
      [actorMembership],
      [member],
    ]);

    await expect(
      updateReportingLine({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
        managerMemberExternalId: 'omem_manager',
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
    const lockedMemberQueries = fake.queries.filter(
      (query) =>
        query.from === 'organization_members' &&
        query.lockStrength === 'update' &&
        query.inTransaction,
    );
    expect(lockedMemberQueries).toHaveLength(2);
    expect(lockedMemberQueries.every((query) => query.joins.length === 0)).toBe(true);
    expect(lockedMemberQueries.some((query) => query.ordered)).toBe(true);
    expect(
      fake.queries.filter(
        (query) => query.from === 'organizations' && query.inTransaction && query.lockStrength,
      ),
    ).toHaveLength(1);
  });

  it('does not lock a foreign target membership while assigning a reporting line', async () => {
    const fake = makeDb([
      [actor],
      [actorMembership],
      [{ id: 20, externalId: 'org_design' }],
      [actorMembership],
      [manager],
    ]);

    await expect(
      updateReportingLine({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_foreign_target',
        managerMemberExternalId: 'omem_manager',
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });

    expect(
      fake.queries.filter(
        (query) => query.from === 'organizations' && query.inTransaction && query.lockStrength,
      ),
    ).toHaveLength(1);
    const lockedMemberQueries = fake.queries.filter(
      (query) =>
        query.from === 'organization_members' &&
        query.lockStrength === 'update' &&
        query.inTransaction,
    );
    expect(lockedMemberQueries).toHaveLength(2);
    expect(lockedMemberQueries.every((query) => query.joins.length === 0)).toBe(true);
  });

  it('rejects a role update when its active target row disappears before the write', async () => {
    const fake = makeDb(
      [
        [actor],
        [actorMembership],
        [{ id: 20, externalId: 'org_design' }],
        [actorMembership],
        [member],
        [{ id: 10 }],
      ],
      [0],
    );

    await expect(
      updateMemberRole({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
        nextRole: 'manager',
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
  });

  it('rejects a deactivation when its active target row disappears before the write', async () => {
    const fake = makeDb(
      [
        [actor],
        [actorMembership],
        [{ id: 20, externalId: 'org_design' }],
        [actorMembership],
        [member],
        [{ id: 10 }],
      ],
      [0],
    );

    await expect(
      deactivateMember({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
  });

  it('deactivates organization and team-project memberships in one transaction without deleting audit rows', async () => {
    const fake = makeDb([
      [actor],
      [actorMembership],
      [{ id: 20, externalId: 'org_design' }],
      [actorMembership],
      [member],
      [{ id: 10 }, { id: 12 }],
    ]);

    await expect(
      deactivateMember({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
      }),
    ).resolves.toEqual({ ok: true });

    expect(fake.transactionCalls).toBe(1);
    expect(fake.queries.map((query) => query.executor)).toEqual([
      'root',
      'root',
      'tx',
      'tx',
      'tx',
      'tx',
      'tx',
    ]);
    expect(fake.updates.every((update) => update.executor === 'tx')).toBe(true);
    expect(fake.updates).toEqual([
      expect.objectContaining({
        table: 'organization_members',
        inTransaction: true,
        values: { status: 'inactive' },
      }),
      expect.objectContaining({
        table: 'project_members',
        inTransaction: true,
        values: { status: 'inactive' },
      }),
    ]);
    expect(fake.deletes).toEqual([]);
    expect(eventSequence(fake)).toEqual([
      'select:users:none:outside',
      'select:organization_members:none:outside',
      'select:organizations:update:tx',
      'select:organization_members:update:tx',
      'select:organization_members:update:tx',
      'select:organization_members:update:tx',
      'select:projects:none:tx',
      'update:organization_members:none:tx',
      'update:project_members:none:tx',
    ]);
    expect(lockedMemberShapes(fake)).toEqual([
      { lockStrength: 'update', ordered: false },
      { lockStrength: 'update', ordered: true },
      { lockStrength: 'update', ordered: true },
    ]);
  });

  it('rejects organization deactivation when the target is a project sole lead', async () => {
    const fake = makeDb([
      [actor],
      [actorMembership],
      [{ id: 20, externalId: 'org_design' }],
      [actorMembership],
      [member],
      [{ id: 10 }],
      [{ projectId: 200 }],
      [{ id: 200, organizationId: 20 }],
      [{ id: 300, projectId: 200, userId: 2, role: 'lead', status: 'active' }],
    ]);

    await expect(
      deactivateMember({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
      }),
    ).rejects.toMatchObject({
      code: 'SOLE_PROJECT_LEAD',
      message: 'SOLE_PROJECT_LEAD',
    });
    expect(fake.updates).toEqual([]);
    expect(fake.transactionRollbacks).toBe(1);
    expect(
      fake.queries.map(
        (query) =>
          `${query.from}:${query.lockStrength ?? 'none'}:${query.ordered ? 'ordered' : 'plain'}`,
      ),
    ).toEqual([
      'users:none:plain',
      'organization_members:none:plain',
      'organizations:update:plain',
      'organization_members:update:plain',
      'organization_members:update:ordered',
      'organization_members:update:ordered',
      'projects:none:ordered',
      'projects:update:ordered',
      'project_members:update:ordered',
    ]);
  });

  it('allows deactivation when another active project lead remains', async () => {
    const fake = makeDb(
      [
        [actor],
        [actorMembership],
        [{ id: 20, externalId: 'org_design' }],
        [actorMembership],
        [member],
        [{ id: 10 }],
        [{ projectId: 200 }],
        [{ id: 200, organizationId: 20 }],
        [
          { id: 300, projectId: 200, userId: 2, role: 'lead', status: 'active' },
          { id: 301, projectId: 200, userId: 3, role: 'lead', status: 'active' },
        ],
      ],
      [1, 1],
    );

    await expect(
      deactivateMember({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
      }),
    ).resolves.toEqual({ ok: true });
    expect(fake.transactionRollbacks).toBe(0);
  });

  it('rejects the whole multi-project deactivation if any affected project would lose its lead', async () => {
    const fake = makeDb([
      [actor],
      [actorMembership],
      [{ id: 20, externalId: 'org_design' }],
      [actorMembership],
      [member],
      [{ id: 10 }],
      [{ projectId: 200 }, { projectId: 201 }],
      [
        { id: 200, organizationId: 20 },
        { id: 201, organizationId: 20 },
      ],
      [
        { id: 300, projectId: 200, userId: 2, role: 'member', status: 'active' },
        { id: 301, projectId: 200, userId: 3, role: 'lead', status: 'active' },
        { id: 302, projectId: 201, userId: 2, role: 'lead', status: 'active' },
      ],
    ]);

    await expect(
      deactivateMember({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
      }),
    ).rejects.toMatchObject({ code: 'SOLE_PROJECT_LEAD' });
    expect(fake.updates).toEqual([]);
  });

  it('rolls back both status updates when an affected project-membership update is zero-row', async () => {
    const fake = makeDb(
      [
        [actor],
        [actorMembership],
        [{ id: 20, externalId: 'org_design' }],
        [actorMembership],
        [member],
        [{ id: 10 }],
        [{ projectId: 200 }],
        [{ id: 200, organizationId: 20 }],
        [
          { id: 300, projectId: 200, userId: 2, role: 'member', status: 'active' },
          { id: 301, projectId: 200, userId: 3, role: 'lead', status: 'active' },
        ],
      ],
      [1, 0],
      {
        organizationMembershipStatus: 'active',
        projectMembershipStatuses: ['active'],
      },
    );

    await expect(
      deactivateMember({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
    expect(fake.transactionRollbacks).toBe(1);
    expect(fake.updates.map((update) => update.table)).toEqual([
      'organization_members',
      'project_members',
    ]);
    expect(fake.updates.every((update) => update.executor === 'tx')).toBe(true);
    expect(fake.state).toEqual({
      organizationMembershipStatus: 'active',
      projectMembershipStatuses: ['active'],
    });
  });

  it('restores both membership statuses when the transaction fails after both updates succeed', async () => {
    const fake = makeDb(
      [
        [actor],
        [actorMembership],
        [{ id: 20, externalId: 'org_design' }],
        [actorMembership],
        [member],
        [{ id: 10 }],
        [{ projectId: 200 }],
        [{ id: 200, organizationId: 20 }],
        [
          { id: 300, projectId: 200, userId: 2, role: 'member', status: 'active' },
          { id: 301, projectId: 200, userId: 3, role: 'lead', status: 'active' },
        ],
      ],
      [1, 1],
      {
        organizationMembershipStatus: 'active',
        projectMembershipStatuses: ['active'],
      },
      { failTransactionAfterCallback: true },
    );

    await expect(
      deactivateMember({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
      }),
    ).rejects.toThrow('organization service fake injected post-callback transaction failure');
    expect(fake.transactionRollbacks).toBe(1);
    expect(fake.updates.map((update) => update.table)).toEqual([
      'organization_members',
      'project_members',
    ]);
    expect(fake.updates.every((update) => update.executor === 'tx')).toBe(true);
    expect(fake.state).toEqual({
      organizationMembershipStatus: 'active',
      projectMembershipStatuses: ['active'],
    });
  });

  it('locks the organization, then members and owners, before a role mutation', async () => {
    const fake = makeDb([
      [actor],
      [actorMembership],
      [{ id: 20, externalId: 'org_design' }],
      [actorMembership],
      [member],
      [{ id: 10 }],
    ]);

    await expect(
      updateMemberRole({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
        nextRole: 'manager',
      }),
    ).resolves.toEqual({ ok: true });

    expect(eventSequence(fake)).toEqual([
      'select:users:none:outside',
      'select:organization_members:none:outside',
      'select:organizations:update:tx',
      'select:organization_members:update:tx',
      'select:organization_members:update:tx',
      'select:organization_members:update:tx',
      'update:organization_members:none:tx',
    ]);
    expect(lockedMemberShapes(fake)).toEqual([
      { lockStrength: 'update', ordered: false },
      { lockStrength: 'update', ordered: true },
      { lockStrength: 'update', ordered: true },
    ]);
  });

  it('does not deactivate the last owner', async () => {
    const owner = { ...actorMembership, externalId: 'omem_owner' };
    const fake = makeDb([
      [actor],
      [actorMembership],
      [{ id: 20, externalId: 'org_design' }],
      [actorMembership],
      [owner],
      [{ id: 10 }],
    ]);

    await expect(
      deactivateMember({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_owner',
      }),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      reason: 'last_owner_must_remain',
    });
    expect(fake.updates).toEqual([]);
  });

  it('does not demote the last owner', async () => {
    const owner = { ...actorMembership, externalId: 'omem_owner' };
    const fake = makeDb([
      [actor],
      [actorMembership],
      [{ id: 20, externalId: 'org_design' }],
      [actorMembership],
      [owner],
      [{ id: 10 }],
    ]);

    await expect(
      updateMemberRole({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_owner',
        nextRole: 'admin',
      }),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      reason: 'last_owner_must_remain',
    });
    expect(fake.updates).toEqual([]);
  });

  it('clears active subordinate reporting lines when deactivating their manager', async () => {
    const fake = makeDb([
      [actor],
      [actorMembership],
      [{ id: 20, externalId: 'org_design' }],
      [actorMembership],
      [manager],
      [{ id: 10 }],
    ]);

    await expect(
      deactivateMember({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_manager',
      }),
    ).resolves.toEqual({ ok: true });

    expect(fake.updates).toContainEqual(
      expect.objectContaining({
        table: 'organization_members',
        inTransaction: true,
        values: { managerUserId: null },
      }),
    );
  });

  it('clears active subordinate reporting lines when a manager becomes a member', async () => {
    const fake = makeDb([
      [actor],
      [actorMembership],
      [{ id: 20, externalId: 'org_design' }],
      [actorMembership],
      [manager],
      [{ id: 10 }],
    ]);

    await expect(
      updateMemberRole({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_manager',
        nextRole: 'member',
      }),
    ).resolves.toEqual({ ok: true });

    expect(fake.updates).toContainEqual(
      expect.objectContaining({
        table: 'organization_members',
        inTransaction: true,
        values: { managerUserId: null },
      }),
    );
  });

  it('keeps domain failures free of tRPC errors', () => {
    expect(
      new OrganizationServiceError('PERMISSION_DENIED', 'manager_role_not_permitted'),
    ).toMatchObject({
      name: 'OrganizationServiceError',
      code: 'PERMISSION_DENIED',
      reason: 'manager_role_not_permitted',
    });
  });
});
