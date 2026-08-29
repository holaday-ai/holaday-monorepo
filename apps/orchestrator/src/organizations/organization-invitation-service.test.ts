import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  InvitationServiceError,
  __organizationInvitationServiceInternals,
  acceptInvitation,
  createInvitation,
  revokeInvitation,
} from './organization-invitation-service.js';

type Write = { table: string; values: Record<string, unknown>; inTransaction: boolean };
type Query = { table: string; lock: 'update' | null; inTransaction: boolean; ordered: boolean };

/** A deliberately narrow Drizzle-shaped fake that makes lock and affected-row behavior visible. */
function makeDb(
  selectResults: unknown[][],
  updateAffectedRows: number[] = [],
  options: { onQuery?: (query: Query) => void } = {},
) {
  const inserts: Write[] = [];
  const updates: Write[] = [];
  const queries: Query[] = [];
  const events: string[] = [];
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
    innerJoin: () => SelectBuilder;
    where: () => SelectBuilder;
    orderBy: () => SelectBuilder;
    for: (strength: 'update') => SelectBuilder;
    limit: () => Promise<unknown[]>;
  };
  const select = (): SelectBuilder => {
    const query: Query = { table: '', lock: null, inTransaction: false, ordered: false };
    let completed: Promise<unknown[]> | undefined;
    const finish = () => {
      completed ??= Promise.resolve(take());
      if (!queries.includes(query)) {
        query.inTransaction = transactionDepth > 0;
        queries.push(query);
        events.push(
          `select:${query.table}:${query.lock ?? 'none'}:${query.inTransaction ? 'tx' : 'outside'}`,
        );
        options.onQuery?.(query);
      }
      return completed;
    };
    const builder: SelectBuilder = {
      from(table) {
        query.table = tableName(table);
        return builder;
      },
      innerJoin: () => builder,
      where: () => builder,
      orderBy() {
        query.ordered = true;
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
    select: () => select(),
    insert(table: unknown) {
      return {
        async values(values: Record<string, unknown>) {
          inserts.push({ table: tableName(table), values, inTransaction: transactionDepth > 0 });
          events.push(`insert:${tableName(table)}:${transactionDepth > 0 ? 'tx' : 'outside'}`);
          return [{ insertId: 100 }];
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
              events.push(`update:${tableName(table)}:${transactionDepth > 0 ? 'tx' : 'outside'}`);
              return [{ affectedRows: updateAffectedRows.shift() ?? 1 }];
            },
          };
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
    queries,
    events,
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

const now = new Date('2026-08-30T12:00:00.000Z');
const fixedRandom = (size: number) => Buffer.alloc(size, 7);
const token = Buffer.alloc(32, 7).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');
const actor = { id: 1 };
const ownerMembership = {
  id: 10,
  externalId: 'omem_owner',
  organizationId: 20,
  organizationExternalId: 'org_design',
  userId: 1,
  role: 'owner',
  status: 'active',
};
const managerMembership = {
  ...ownerMembership,
  id: 11,
  externalId: 'omem_manager',
  userId: 2,
  role: 'manager',
};
const openInvitation = {
  id: 30,
  externalId: 'oinv_design',
  organizationId: 20,
  tokenHash,
  role: 'member',
  managerUserId: 2,
  expiresAt: new Date('2026-09-06T12:00:00.000Z'),
  acceptedAt: null,
  revokedAt: null,
};

describe('organization invitation service', () => {
  it('stores only a SHA-256 hash of a 32-byte URL-safe token and returns plaintext once', async () => {
    const fake = makeDb([
      [actor],
      [ownerMembership],
      [{ id: 20, externalId: 'org_design' }],
      [ownerMembership],
    ]);

    const result = await createInvitation({
      db: fake.db,
      actorExternalId: 'usr_owner',
      organizationExternalId: 'org_design',
      role: 'member',
      now: () => now,
      randomBytes: fixedRandom,
    });

    expect(result).toEqual({
      invitationId: expect.stringMatching(/^oinv_/),
      token,
      expiresAt: new Date('2026-09-06T12:00:00.000Z'),
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fake.inserts).toEqual([
      expect.objectContaining({
        table: 'organization_invitations',
        inTransaction: true,
        values: expect.objectContaining({
          tokenHash,
          role: 'member',
          managerUserId: null,
          invitedByUserId: 1,
          expiresAt: new Date('2026-09-06T12:00:00.000Z'),
        }),
      }),
    ]);
    expect(JSON.stringify(fake.inserts)).not.toContain(token);
  });

  it('rejects malformed injected randomness before it can persist an invitation', async () => {
    const fake = makeDb([[actor], [ownerMembership]]);

    await expect(
      createInvitation({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        role: 'member',
        randomBytes: () => Buffer.alloc(31, 7),
      }),
    ).rejects.toMatchObject({ code: 'INVITATION_GENERATION_FAILED' });
    expect(fake.transactionCalls).toBe(0);
    expect(fake.inserts).toEqual([]);
  });

  it('uses a manager from the same locked organization when creating an invitation', async () => {
    const fake = makeDb([
      [actor],
      [ownerMembership],
      [{ id: 20, externalId: 'org_design' }],
      [ownerMembership],
      [managerMembership],
    ]);

    await createInvitation({
      db: fake.db,
      actorExternalId: 'usr_owner',
      organizationExternalId: 'org_design',
      role: 'member',
      managerMemberExternalId: 'omem_manager',
      now: () => now,
      randomBytes: fixedRandom,
    });

    expect(fake.inserts[0]?.values.managerUserId).toBe(2);
    expect(fake.events).toEqual([
      'select:users:none:outside',
      'select:organization_members:none:outside',
      'select:organizations:update:tx',
      'select:organization_members:update:tx',
      'select:organization_members:update:tx',
      'insert:organization_invitations:tx',
    ]);
  });

  it.each([
    ['owner', ownerMembership, 'owner_invitation_forbidden'],
    ['admin', { ...ownerMembership, role: 'manager' }, 'organization_role_not_permitted'],
    ['member', { ...ownerMembership, role: 'member' }, 'organization_role_not_permitted'],
  ] as const)('rejects an unauthorized %s invitation', async (role, membership, reason) => {
    const fake = makeDb([
      [actor],
      [membership],
      [{ id: 20, externalId: 'org_design' }],
      [membership],
    ]);

    await expect(
      createInvitation({
        db: fake.db,
        actorExternalId: 'usr_actor',
        organizationExternalId: 'org_design',
        role,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', reason });
    expect(fake.inserts).toEqual([]);
  });

  it.each([
    ['acceptance', { ...openInvitation, expiresAt: now }, 'accept'],
    ['revocation', { ...openInvitation, expiresAt: now }, 'revoke'],
  ] as const)(
    'rejects %s exactly at expiresAt without mutating the invitation',
    async (_label, invitation, operation) => {
      const fake =
        operation === 'accept'
          ? makeDb([
              [actor],
              [{ organizationId: 20 }],
              [{ id: 20, externalId: 'org_design' }],
              [invitation],
            ])
          : makeDb([
              [actor],
              [ownerMembership],
              [{ id: 20, externalId: 'org_design' }],
              [ownerMembership],
              [invitation],
            ]);

      const call =
        operation === 'accept'
          ? acceptInvitation({ db: fake.db, actorExternalId: 'usr_new', token, now: () => now })
          : revokeInvitation({
              db: fake.db,
              actorExternalId: 'usr_owner',
              organizationExternalId: 'org_design',
              invitationExternalId: 'oinv_design',
              now: () => now,
            });

      await expect(call).rejects.toMatchObject({ code: 'INVITATION_NOT_AVAILABLE' });
      expect(fake.inserts).toEqual([]);
      expect(fake.updates).toEqual([]);
    },
  );

  it.each(['accept', 'revoke'] as const)(
    'samples a fresh clock after the invitation lock when a %s lock wait crosses expiry',
    async (operation) => {
      const expiresAt = new Date('2026-08-30T12:00:01.000Z');
      let currentTime = new Date('2026-08-30T12:00:00.000Z');
      const invitation = { ...openInvitation, expiresAt };
      const fake =
        operation === 'accept'
          ? makeDb(
              [
                [actor],
                [{ organizationId: 20 }],
                [{ id: 20, externalId: 'org_design' }],
                [invitation],
                [],
                [managerMembership],
              ],
              [],
              {
                onQuery(query) {
                  if (query.table === 'organization_invitations' && query.lock === 'update') {
                    currentTime = expiresAt;
                  }
                },
              },
            )
          : makeDb(
              [
                [actor],
                [ownerMembership],
                [{ id: 20, externalId: 'org_design' }],
                [ownerMembership],
                [invitation],
              ],
              [],
              {
                onQuery(query) {
                  if (query.table === 'organization_invitations' && query.lock === 'update') {
                    currentTime = expiresAt;
                  }
                },
              },
            );

      const call =
        operation === 'accept'
          ? acceptInvitation({
              db: fake.db,
              actorExternalId: 'usr_new',
              token,
              now: () => currentTime,
            })
          : revokeInvitation({
              db: fake.db,
              actorExternalId: 'usr_owner',
              organizationExternalId: 'org_design',
              invitationExternalId: 'oinv_design',
              now: () => currentTime,
            });

      await expect(call).rejects.toMatchObject({ code: 'INVITATION_NOT_AVAILABLE' });
      expect(fake.inserts).toEqual([]);
      expect(fake.updates).toEqual([]);
    },
  );

  it('allows a manager to invite managers and members but not administrators', async () => {
    for (const role of ['manager', 'member'] as const) {
      const membership = { ...ownerMembership, role: 'manager' as const };
      const fake = makeDb([
        [actor],
        [membership],
        [{ id: 20, externalId: 'org_design' }],
        [membership],
      ]);
      await expect(
        createInvitation({
          db: fake.db,
          actorExternalId: 'usr_manager',
          organizationExternalId: 'org_design',
          role,
        }),
      ).resolves.toMatchObject({ token: expect.any(String) });
    }
  });

  it.each([
    ['expired', { ...openInvitation, expiresAt: new Date('2026-08-30T11:59:59.999Z') }],
    ['revoked', { ...openInvitation, revokedAt: now }],
    ['already accepted', { ...openInvitation, acceptedAt: now }],
  ])('rejects a %s invitation without exposing token state', async (_label, invitation) => {
    const fake = makeDb([
      [actor],
      [{ organizationId: 20 }],
      [{ id: 20, externalId: 'org_design' }],
      [invitation],
    ]);

    await expect(
      acceptInvitation({ db: fake.db, actorExternalId: 'usr_new', token, now: () => now }),
    ).rejects.toMatchObject({ code: 'INVITATION_NOT_AVAILABLE' });
    expect(fake.inserts).toEqual([]);
    expect(fake.updates).toEqual([]);
  });

  it('accepts once by creating a membership from invitation role and manager, then guards the invitation update', async () => {
    const fake = makeDb([
      [actor],
      [{ organizationId: 20 }],
      [{ id: 20, externalId: 'org_design' }],
      [openInvitation],
      [],
      [managerMembership],
    ]);

    await expect(
      acceptInvitation({ db: fake.db, actorExternalId: 'usr_new', token, now: () => now }),
    ).resolves.toMatchObject({ membershipId: expect.stringMatching(/^omem_/), status: 'joined' });

    expect(fake.transactionCalls).toBe(1);
    expect(fake.inserts).toEqual([
      expect.objectContaining({
        table: 'organization_members',
        inTransaction: true,
        values: expect.objectContaining({
          organizationId: 20,
          userId: 1,
          role: 'member',
          managerUserId: 2,
          status: 'active',
        }),
      }),
    ]);
    expect(fake.updates).toEqual([
      expect.objectContaining({
        table: 'organization_invitations',
        inTransaction: true,
        values: { acceptedAt: now },
      }),
    ]);
    expect(fake.events).toEqual([
      'select:users:none:outside',
      'select:organization_invitations:none:outside',
      'select:organizations:update:tx',
      'select:organization_invitations:update:tx',
      'select:organization_members:update:tx',
      'select:organization_members:update:tx',
      'update:organization_invitations:tx',
      'insert:organization_members:tx',
    ]);
  });

  it('reactivates one inactive membership using the invitation row rather than accept input', async () => {
    const inactive = { id: 40, externalId: 'omem_existing', status: 'inactive' };
    const fake = makeDb([
      [actor],
      [{ organizationId: 20 }],
      [{ id: 20, externalId: 'org_design' }],
      [openInvitation],
      [inactive],
      [managerMembership],
    ]);

    await expect(
      acceptInvitation({
        db: fake.db,
        actorExternalId: 'usr_new',
        token,
        now: () => now,
        // @ts-expect-error acceptance cannot choose an invitation role
        role: 'admin',
      }),
    ).resolves.toMatchObject({ membershipId: 'omem_existing', status: 'reactivated' });

    expect(fake.updates).toEqual([
      expect.objectContaining({ table: 'organization_invitations', values: { acceptedAt: now } }),
      expect.objectContaining({
        table: 'organization_members',
        values: { status: 'active', role: 'member', managerUserId: 2, joinedAt: now },
      }),
    ]);
  });

  it('consumes the invitation for an existing active member without creating a duplicate', async () => {
    const active = { id: 40, externalId: 'omem_existing', status: 'active' };
    const fake = makeDb([
      [actor],
      [{ organizationId: 20 }],
      [{ id: 20, externalId: 'org_design' }],
      [openInvitation],
      [active],
      [managerMembership],
    ]);

    await expect(
      acceptInvitation({ db: fake.db, actorExternalId: 'usr_new', token, now: () => now }),
    ).resolves.toEqual({ membershipId: 'omem_existing', status: 'already_member' });
    expect(fake.inserts).toEqual([]);
    expect(fake.updates).toEqual([
      expect.objectContaining({ table: 'organization_invitations', values: { acceptedAt: now } }),
    ]);
  });

  it('does not create a reporting line to a manager who is no longer active in the organization', async () => {
    const fake = makeDb([
      [actor],
      [{ organizationId: 20 }],
      [{ id: 20, externalId: 'org_design' }],
      [openInvitation],
      [],
      [],
    ]);

    await expect(
      acceptInvitation({ db: fake.db, actorExternalId: 'usr_new', token, now: () => now }),
    ).rejects.toMatchObject({ code: 'INVITATION_NOT_AVAILABLE' });
    expect(fake.inserts).toEqual([]);
    expect(fake.updates).toEqual([]);
  });

  it.each([
    ['owner', 'owner'],
    ['unknown', 'contractor'],
  ] as const)(
    'does not consume a persisted %s role invitation for a new membership',
    async (_label, role) => {
      const fake = makeDb([
        [actor],
        [{ organizationId: 20 }],
        [{ id: 20, externalId: 'org_design' }],
        [{ ...openInvitation, role }],
        [],
        [managerMembership],
      ]);

      await expect(
        acceptInvitation({ db: fake.db, actorExternalId: 'usr_new', token, now: () => now }),
      ).rejects.toMatchObject({ code: 'INVITATION_NOT_AVAILABLE' });
      expect(fake.inserts).toEqual([]);
      expect(fake.updates).toEqual([]);
    },
  );

  it.each([
    ['owner', 'owner'],
    ['unknown', 'contractor'],
  ] as const)(
    'does not consume a persisted %s role invitation or reactivate a membership',
    async (_label, role) => {
      const inactive = { id: 40, externalId: 'omem_existing', status: 'inactive' };
      const fake = makeDb([
        [actor],
        [{ organizationId: 20 }],
        [{ id: 20, externalId: 'org_design' }],
        [{ ...openInvitation, role }],
        [inactive],
        [managerMembership],
      ]);

      await expect(
        acceptInvitation({ db: fake.db, actorExternalId: 'usr_new', token, now: () => now }),
      ).rejects.toMatchObject({ code: 'INVITATION_NOT_AVAILABLE' });
      expect(fake.inserts).toEqual([]);
      expect(fake.updates).toEqual([]);
      expect(inactive.status).toBe('inactive');
    },
  );

  it('rejects a concurrent replay when the guarded acceptance update affects no rows', async () => {
    const fake = makeDb(
      [
        [actor],
        [{ organizationId: 20 }],
        [{ id: 20, externalId: 'org_design' }],
        [openInvitation],
        [],
        [managerMembership],
      ],
      [0],
    );

    await expect(
      acceptInvitation({ db: fake.db, actorExternalId: 'usr_new', token, now: () => now }),
    ).rejects.toMatchObject({ code: 'INVITATION_NOT_AVAILABLE' });
    expect(fake.inserts).toEqual([]);
    expect(fake.updates).toHaveLength(1);
  });

  it('revokes only a still-open invitation after organization, actor, and invitation locks', async () => {
    const fake = makeDb([
      [actor],
      [ownerMembership],
      [{ id: 20, externalId: 'org_design' }],
      [ownerMembership],
      [openInvitation],
    ]);

    await expect(
      revokeInvitation({
        db: fake.db,
        actorExternalId: 'usr_owner',
        organizationExternalId: 'org_design',
        invitationExternalId: 'oinv_design',
        now: () => now,
      }),
    ).resolves.toEqual({ ok: true });

    expect(fake.updates).toEqual([
      expect.objectContaining({
        table: 'organization_invitations',
        inTransaction: true,
        values: { revokedAt: now },
      }),
    ]);
    expect(fake.events).toEqual([
      'select:users:none:outside',
      'select:organization_members:none:outside',
      'select:organizations:update:tx',
      'select:organization_members:update:tx',
      'select:organization_invitations:update:tx',
      'update:organization_invitations:tx',
    ]);
  });

  it('cannot revoke an accepted invitation or revive a revoked invitation', async () => {
    for (const invitation of [
      { ...openInvitation, acceptedAt: now },
      { ...openInvitation, revokedAt: now },
    ]) {
      const fake = makeDb([
        [actor],
        [ownerMembership],
        [{ id: 20, externalId: 'org_design' }],
        [ownerMembership],
        [invitation],
      ]);
      await expect(
        revokeInvitation({
          db: fake.db,
          actorExternalId: 'usr_owner',
          organizationExternalId: 'org_design',
          invitationExternalId: 'oinv_design',
          now: () => now,
        }),
      ).rejects.toMatchObject({ code: 'INVITATION_NOT_AVAILABLE' });
      expect(fake.updates).toEqual([]);
    }
  });

  it('compiles the token lookup and guarded consume queries with their tenant predicates', () => {
    const db = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const tokenLookup = __organizationInvitationServiceInternals
      .buildTokenLookupQuery(db, tokenHash)
      .toSQL();
    const consume = __organizationInvitationServiceInternals
      .buildConsumeInvitationQuery(db, 30, now)
      .toSQL();
    const actorMembership = __organizationInvitationServiceInternals
      .buildActiveActorMembershipQuery(db, 1, 'org_design')
      .toSQL();
    const lockedActor = __organizationInvitationServiceInternals
      .buildLockedActiveActorMembershipQuery(db, 20, 1)
      .toSQL();
    const manager = __organizationInvitationServiceInternals
      .buildLockedActiveManagerMembershipQuery(db, 20, 'omem_manager')
      .toSQL();
    const lockedToken = __organizationInvitationServiceInternals
      .buildLockedInvitationByHashQuery(db, 20, tokenHash)
      .toSQL();
    const revoke = __organizationInvitationServiceInternals
      .buildLockedInvitationByExternalIdQuery(db, 20, 'oinv_design')
      .toSQL();
    expect(tokenLookup.sql).toContain('`organization_invitations`.`token_hash` = ?');
    expect(consume.sql).toContain('`organization_invitations`.`id` = ?');
    expect(consume.sql).toContain('`organization_invitations`.`accepted_at` is null');
    expect(consume.sql).toContain('`organization_invitations`.`revoked_at` is null');
    expect(consume.sql).toContain('`organization_invitations`.`expires_at` > ?');
    expect(actorMembership.sql).toContain('inner join `organizations`');
    expect(actorMembership.sql).toContain('`organizations`.`external_id` = ?');
    expect(actorMembership.sql).toContain('`organizations`.`status` = ?');
    expect(actorMembership.sql).toContain('`organization_members`.`user_id` = ?');
    expect(actorMembership.sql).toContain('`organization_members`.`status` = ?');
    expect(lockedActor.sql).toContain('`organization_members`.`organization_id` = ?');
    expect(lockedActor.sql).toContain('`organization_members`.`user_id` = ?');
    expect(lockedActor.sql).toContain('`organization_members`.`status` = ?');
    expect(manager.sql).toContain('`organization_members`.`organization_id` = ?');
    expect(manager.sql).toContain('`organization_members`.`external_id` = ?');
    expect(manager.sql).toContain('`organization_members`.`status` = ?');
    expect(lockedToken.sql).toContain('`organization_invitations`.`organization_id` = ?');
    expect(lockedToken.sql).toContain('`organization_invitations`.`token_hash` = ?');
    expect(revoke.sql).toContain('`organization_invitations`.`organization_id` = ?');
    expect(revoke.sql).toContain('`organization_invitations`.`external_id` = ?');
  });

  it('keeps failures domain-only', () => {
    expect(new InvitationServiceError('INVITATION_NOT_AVAILABLE')).toMatchObject({
      name: 'InvitationServiceError',
      code: 'INVITATION_NOT_AVAILABLE',
    });
  });
});
