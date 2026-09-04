import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  ModelDataRegionAssignmentError,
  __modelDataRegionAssignmentInternals,
  assignOrganizationModelDataRegion,
  assignPersonalModelDataRegion,
} from './model-data-region-assignment.js';

type Region = 'cn' | 'intl';

function tableName(table: unknown): string {
  if (!table || typeof table !== 'object') return '';
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : '';
}

function makeAssignmentDb(input?: {
  userExists?: boolean;
  userStatus?: string;
  userRegion?: Region | null;
  organizationExists?: boolean;
  organizationStatus?: string;
  organizationRegion?: Region | null;
  membershipStatus?: string;
  role?: string;
}) {
  const state = {
    userExists: input?.userExists ?? true,
    userStatus: input?.userStatus ?? 'active',
    userRegion: input?.userRegion ?? null,
    organizationExists: input?.organizationExists ?? true,
    organizationStatus: input?.organizationStatus ?? 'active',
    organizationRegion: input?.organizationRegion ?? null,
    membershipStatus: input?.membershipStatus ?? 'active',
    role: input?.role ?? 'owner',
  };
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  let transactionCalls = 0;

  const tx = {
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            async where() {
              const name = tableName(table);
              let affectedRows = 0;
              if (
                name === 'users' &&
                state.userExists &&
                state.userStatus === 'active' &&
                state.userRegion === null
              ) {
                state.userRegion = values.modelDataRegion as Region;
                affectedRows = 1;
              }
              if (
                name === 'organizations' &&
                state.organizationExists &&
                state.organizationStatus === 'active' &&
                state.organizationRegion === null
              ) {
                state.organizationRegion = values.modelDataRegion as Region;
                affectedRows = 1;
              }
              updates.push({ table: name, values });
              return [{ affectedRows }];
            },
          };
        },
      };
    },
    select() {
      let from = '';
      const builder = {
        from(table: unknown) {
          from = tableName(table);
          return builder;
        },
        innerJoin() {
          return builder;
        },
        where() {
          return builder;
        },
        for() {
          return builder;
        },
        async limit() {
          if (from === 'users') {
            return state.userExists && state.userStatus === 'active'
              ? [{ modelDataRegion: state.userRegion }]
              : [];
          }
          if (from === 'organization_members') {
            return state.userExists &&
              state.userStatus === 'active' &&
              state.organizationExists &&
              state.organizationStatus === 'active' &&
              state.membershipStatus === 'active'
              ? [
                  {
                    organizationId: 20,
                    role: state.role,
                    modelDataRegion: state.organizationRegion,
                  },
                ]
              : [];
          }
          if (from === 'organizations') {
            return state.organizationExists && state.organizationStatus === 'active'
              ? [{ modelDataRegion: state.organizationRegion }]
              : [];
          }
          return [];
        },
      };
      return builder;
    },
  };
  const db = {
    async transaction<T>(operation: (executor: typeof tx) => Promise<T>): Promise<T> {
      transactionCalls += 1;
      return await operation(tx);
    },
  };

  return {
    db: db as unknown as DB,
    state,
    updates,
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

describe('model data region assignment', () => {
  it('sets a null personal region exactly once and treats the same value as idempotent', async () => {
    const fake = makeAssignmentDb();

    await expect(
      assignPersonalModelDataRegion({
        db: fake.db,
        actorExternalId: 'usr_a',
        region: 'cn',
      }),
    ).resolves.toEqual({ region: 'cn', changed: true });
    await expect(
      assignPersonalModelDataRegion({
        db: fake.db,
        actorExternalId: 'usr_a',
        region: 'cn',
      }),
    ).resolves.toEqual({ region: 'cn', changed: false });
    expect(fake.state.userRegion).toBe('cn');
    expect(fake.transactionCalls).toBe(2);
  });

  it('rejects a different personal value without changing the row', async () => {
    const fake = makeAssignmentDb({ userRegion: 'cn' });

    await expect(
      assignPersonalModelDataRegion({
        db: fake.db,
        actorExternalId: 'usr_a',
        region: 'intl',
      }),
    ).rejects.toMatchObject({ code: 'REGION_ALREADY_ASSIGNED' });
    expect(fake.state.userRegion).toBe('cn');
  });

  it.each([
    ['missing', { userExists: false }],
    ['inactive', { userStatus: 'closure_pending' }],
  ])('rejects a %s personal actor', async (_label, options) => {
    const fake = makeAssignmentDb(options);

    await expect(
      assignPersonalModelDataRegion({
        db: fake.db,
        actorExternalId: 'usr_a',
        region: 'intl',
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ACTOR' });
  });

  it.each(['owner', 'admin'])(
    'allows an active %s to assign an organization once',
    async (role) => {
      const fake = makeAssignmentDb({ role });

      await expect(
        assignOrganizationModelDataRegion({
          db: fake.db,
          actorExternalId: 'usr_a',
          organizationExternalId: 'org_a',
          region: 'intl',
        }),
      ).resolves.toEqual({ region: 'intl', changed: true });
      await expect(
        assignOrganizationModelDataRegion({
          db: fake.db,
          actorExternalId: 'usr_a',
          organizationExternalId: 'org_a',
          region: 'intl',
        }),
      ).resolves.toEqual({ region: 'intl', changed: false });
    },
  );

  it.each(['manager', 'member'])(
    'does not let an active %s assign the organization region',
    async (role) => {
      const fake = makeAssignmentDb({ role });

      await expect(
        assignOrganizationModelDataRegion({
          db: fake.db,
          actorExternalId: 'usr_a',
          organizationExternalId: 'org_a',
          region: 'cn',
        }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      expect(fake.updates).toEqual([]);
    },
  );

  it('rejects a different organization value without changing the row', async () => {
    const fake = makeAssignmentDb({ role: 'owner', organizationRegion: 'intl' });

    await expect(
      assignOrganizationModelDataRegion({
        db: fake.db,
        actorExternalId: 'usr_a',
        organizationExternalId: 'org_a',
        region: 'cn',
      }),
    ).rejects.toBeInstanceOf(ModelDataRegionAssignmentError);
    expect(fake.state.organizationRegion).toBe('intl');
  });

  it('constrains both compare-and-set updates by identity, active status and IS NULL', () => {
    const db = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const personal = __modelDataRegionAssignmentInternals
      .buildPersonalRegionUpdate(db, 'usr_a', 'cn')
      .toSQL();
    const organization = __modelDataRegionAssignmentInternals
      .buildOrganizationRegionUpdate(db, 20, 'intl')
      .toSQL();

    expect(personal.sql).toContain('`users`.`external_id` = ?');
    expect(personal.sql).toContain('`users`.`status` = ?');
    expect(personal.sql).toContain('`users`.`model_data_region` is null');
    expect(personal.params[0]).toBe('cn');
    expect(personal.params.slice(-2)).toEqual(['usr_a', 'active']);
    expect(organization.sql).toContain('`organizations`.`id` = ?');
    expect(organization.sql).toContain('`organizations`.`status` = ?');
    expect(organization.sql).toContain('`organizations`.`model_data_region` is null');
    expect(organization.params[0]).toBe('intl');
    expect(organization.params.slice(-2)).toEqual([20, 'active']);
  });

  it('locks the active organization membership and tenant row before authorization', () => {
    const db = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const query = __modelDataRegionAssignmentInternals
      .buildActiveOrganizationMembershipQuery(db, 'usr_a', 'org_a')
      .toSQL();

    expect(query.sql.toLowerCase()).toContain('for update');
    expect(query.sql).toContain('`users`.`external_id` = ?');
    expect(query.sql).toContain('`organizations`.`external_id` = ?');
    expect(query.sql).toContain('`organization_members`.`status` = ?');
    expect(query.params).toEqual(['usr_a', 'active', 'org_a', 'active', 'active', 1]);
  });
});
