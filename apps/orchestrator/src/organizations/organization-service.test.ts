import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import {
  OrganizationServiceError,
  createOrganization,
  deactivateMember,
  listOrganizationMembers,
  listOrganizationsForUser,
  updateMemberRole,
  updateReportingLine,
} from './organization-service.js';

type Insert = { table: string; values: Record<string, unknown>; inTransaction: boolean };
type Update = { table: string; values: Record<string, unknown>; inTransaction: boolean };

/**
 * The service boundary needs only selects plus transaction-scoped writes. This deliberately
 * small Drizzle-shaped fake returns programmed select results and records real service effects.
 */
function makeDb(selectResults: unknown[][]) {
  const inserts: Insert[] = [];
  const updates: Update[] = [];
  const deletes: string[] = [];
  let transactionCalls = 0;
  let transactionDepth = 0;
  let nextInsertId = 100;

  const tableName = (table: unknown) => {
    if (!table || typeof table !== 'object') return '';
    const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
    return typeof name === 'string' ? name : '';
  };

  const takeSelectResult = () => selectResults.shift() ?? [];
  type SelectBuilder = {
    from: () => SelectBuilder;
    innerJoin: () => SelectBuilder;
    leftJoin: () => SelectBuilder;
    where: () => SelectBuilder;
    groupBy: () => SelectBuilder;
    orderBy: () => SelectBuilder;
    for: () => SelectBuilder;
    limit: () => Promise<unknown[]>;
  };
  const selectBuilder = (): SelectBuilder => {
    const finish = () => Promise.resolve(takeSelectResult());
    const builder: SelectBuilder = {
      from: () => selectBuilder(),
      innerJoin: () => selectBuilder(),
      leftJoin: () => selectBuilder(),
      where: () => selectBuilder(),
      groupBy: () => selectBuilder(),
      orderBy: () => selectBuilder(),
      for: () => selectBuilder(),
      limit: finish,
    };
    Object.defineProperty(builder, 'then', {
      value: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        finish().then(resolve, reject),
    });
    return builder;
  };

  const db = {
    select: () => selectBuilder(),
    insert(table: unknown) {
      return {
        async values(values: Record<string, unknown>) {
          inserts.push({ table: tableName(table), values, inTransaction: transactionDepth > 0 });
          return [{ insertId: nextInsertId++ }];
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            async where() {
              updates.push({
                table: tableName(table),
                values,
                inTransaction: transactionDepth > 0,
              });
              return [{ affectedRows: 1 }];
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        async where() {
          deletes.push(tableName(table));
          return [{ affectedRows: 1 }];
        },
      };
    },
    async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
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
    inserts,
    updates,
    deletes,
    get transactionCalls() {
      return transactionCalls;
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

describe('organization service', () => {
  it('creates the canary organization and its owner membership in one transaction', async () => {
    const fake = makeDb([[actor]]);

    const result = await createOrganization({
      db: fake.db,
      actorExternalId: 'usr_owner',
      name: 'Design team',
    });

    expect(result).toMatchObject({ name: 'Design team', role: 'owner', teamProjectsEnabled: true });
    expect(fake.transactionCalls).toBe(1);
    expect(fake.inserts).toEqual([
      expect.objectContaining({
        table: 'organizations',
        inTransaction: true,
        values: expect.objectContaining({
          name: 'Design team',
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
    [
      'another organization',
      {
        ...member,
        externalId: 'omem_manager',
        organizationId: 99,
        organizationExternalId: 'org_other',
        userId: 3,
        role: 'manager',
      },
      'manager_outside_organization',
    ],
    ['the target user', member, 'manager_cannot_be_self'],
  ] as const)(
    'rejects a %s reporting manager through the shared permission decision',
    async (_label, manager, reason) => {
      const fake = makeDb([[actor], [actorMembership], [member], [manager]]);

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

  it('deactivates organization and team-project memberships in one transaction without deleting audit rows', async () => {
    const fake = makeDb([[actor], [actorMembership], [member], [{ id: 10 }, { id: 12 }]]);

    await expect(
      deactivateMember({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        targetMemberExternalId: 'omem_member',
      }),
    ).resolves.toEqual({ ok: true });

    expect(fake.transactionCalls).toBe(1);
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
  });

  it('does not deactivate the last owner', async () => {
    const owner = { ...actorMembership, externalId: 'omem_owner' };
    const fake = makeDb([[actor], [actorMembership], [owner], [{ id: 10 }]]);

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
    const fake = makeDb([[actor], [actorMembership], [owner], [{ id: 10 }]]);

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
