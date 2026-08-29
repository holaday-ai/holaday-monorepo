import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  enabledForUser,
  createOrganizationMock,
  listOrganizationsMock,
  listMembersMock,
  updateReportingLineMock,
  updateMemberRoleMock,
  deactivateMemberMock,
  createInvitationMock,
  acceptInvitationMock,
  revokeInvitationMock,
  resolveInvitationOrganizationMock,
} = vi.hoisted(() => ({
  enabledForUser: vi.fn<(userId: string) => boolean>(),
  createOrganizationMock: vi.fn(),
  listOrganizationsMock: vi.fn(),
  listMembersMock: vi.fn(),
  updateReportingLineMock: vi.fn(),
  updateMemberRoleMock: vi.fn(),
  deactivateMemberMock: vi.fn(),
  createInvitationMock: vi.fn(),
  acceptInvitationMock: vi.fn(),
  revokeInvitationMock: vi.fn(),
  resolveInvitationOrganizationMock: vi.fn(),
}));

vi.mock('../../organizations/team-project-access.js', () => ({
  isTeamProjectsEnabledFor: enabledForUser,
}));

vi.mock('../../organizations/organization-service.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../organizations/organization-service.js')>();
  return {
    ...actual,
    createOrganization: createOrganizationMock,
    listOrganizationsForUser: listOrganizationsMock,
    listOrganizationMembers: listMembersMock,
    updateReportingLine: updateReportingLineMock,
    updateMemberRole: updateMemberRoleMock,
    deactivateMember: deactivateMemberMock,
  };
});

vi.mock('../../organizations/organization-invitation-service.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../organizations/organization-invitation-service.js')>();
  return {
    ...actual,
    createInvitation: createInvitationMock,
    acceptInvitation: acceptInvitationMock,
    revokeInvitation: revokeInvitationMock,
    resolveInvitationOrganization: resolveInvitationOrganizationMock,
  };
});

import { appRouter } from '../router.js';
import { organizationsRouter } from './organizations.js';

class OrganizationGateDb {
  constructor(private readonly enabledOrganizationIds = new Set(['org_design'])) {}

  select() {
    return {
      from: () => ({
        where: (predicate: unknown) => ({
          limit: async () => {
            const id = stringsIn(predicate).find((value) => value.startsWith('org_'));
            return id && this.enabledOrganizationIds.has(id) ? [{ externalId: id }] : [];
          },
        }),
      }),
    };
  }
}

function stringsIn(value: unknown): string[] {
  const strings: string[] = [];
  const seen = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (current === null || current === undefined) return;
    if (typeof current === 'string') {
      strings.push(current);
      return;
    }
    if (typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    Object.values(current as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return strings;
}

function makeCaller(db = new OrganizationGateDb()) {
  return organizationsRouter.createCaller({
    db,
    userId: 'usr_caller',
    logger: {},
  } as never);
}

function allDomainCalls() {
  return [
    createOrganizationMock,
    listOrganizationsMock,
    listMembersMock,
    updateReportingLineMock,
    updateMemberRoleMock,
    deactivateMemberMock,
    createInvitationMock,
    acceptInvitationMock,
    revokeInvitationMock,
    resolveInvitationOrganizationMock,
  ];
}

async function expectNotFound(action: Promise<unknown>) {
  await expect(action).rejects.toMatchObject({ code: 'NOT_FOUND' });
}

describe('organizationsRouter', () => {
  beforeEach(() => {
    enabledForUser.mockReset();
    enabledForUser.mockReturnValue(true);
    for (const mock of allDomainCalls()) mock.mockReset();
    createOrganizationMock.mockImplementation(async ({ name }: { name: string }) => ({
      organizationId: 'org_created',
      name,
      role: 'owner',
      teamProjectsEnabled: true,
      ownerEmail: 'owner@example.test',
    }));
    listOrganizationsMock.mockResolvedValue([]);
    listMembersMock.mockResolvedValue([]);
    updateReportingLineMock.mockResolvedValue({ ok: true });
    updateMemberRoleMock.mockResolvedValue({ ok: true });
    deactivateMemberMock.mockResolvedValue({ ok: true });
    createInvitationMock.mockResolvedValue({
      invitationId: 'oinv_123',
      token: 'plaintext-token',
      tokenHash: 'never-returned',
      expiresAt: new Date('2026-09-06T00:00:00.000Z'),
    });
    resolveInvitationOrganizationMock.mockResolvedValue({ organizationId: 'org_design' });
    acceptInvitationMock.mockResolvedValue({ membershipId: 'omem_new', status: 'joined' });
    revokeInvitationMock.mockResolvedValue({ ok: true });
  });

  it('registers the organization list procedure on the root router', async () => {
    const caller = appRouter.createCaller({ db: {}, userId: 'usr_caller', logger: {} } as never);
    await expect(caller.organizations.list()).resolves.toEqual([]);
  });

  it('hides every organization procedure before any domain lookup when the user rollout gate is off', async () => {
    enabledForUser.mockReturnValue(false);
    const caller = makeCaller();
    const actions = [
      caller.list(),
      caller.create({ name: 'Design' }),
      caller.members({ organizationId: 'org_design' }),
      caller.createInvitation({ organizationId: 'org_design', role: 'member' }),
      caller.acceptInvitation({ token: 'token' }),
      caller.revokeInvitation({ organizationId: 'org_design', invitationId: 'oinv_1' }),
      caller.updateReportingLine({
        organizationId: 'org_design',
        memberId: 'omem_member',
        managerMemberId: 'omem_manager',
      }),
      caller.updateMemberRole({
        organizationId: 'org_design',
        memberId: 'omem_member',
        role: 'admin',
      }),
      caller.deactivateMember({ organizationId: 'org_design', memberId: 'omem_member' }),
    ];

    await Promise.all(actions.map(expectNotFound));
    for (const mock of allDomainCalls()) expect(mock).not.toHaveBeenCalled();
  });

  it('does not call an organization-scoped service after an organization rollback', async () => {
    const caller = makeCaller(new OrganizationGateDb());

    await expectNotFound(caller.members({ organizationId: 'org_rolled_back' }));
    await expectNotFound(
      caller.createInvitation({ organizationId: 'org_rolled_back', role: 'member' }),
    );
    await expectNotFound(
      caller.revokeInvitation({ organizationId: 'org_rolled_back', invitationId: 'oinv_1' }),
    );
    await expectNotFound(
      caller.updateReportingLine({
        organizationId: 'org_rolled_back',
        memberId: 'omem_member',
        managerMemberId: 'omem_manager',
      }),
    );
    await expectNotFound(
      caller.updateMemberRole({
        organizationId: 'org_rolled_back',
        memberId: 'omem_member',
        role: 'admin',
      }),
    );
    await expectNotFound(
      caller.deactivateMember({ organizationId: 'org_rolled_back', memberId: 'omem_member' }),
    );

    expect(listMembersMock).not.toHaveBeenCalled();
    expect(createInvitationMock).not.toHaveBeenCalled();
    expect(revokeInvitationMock).not.toHaveBeenCalled();
    expect(updateReportingLineMock).not.toHaveBeenCalled();
    expect(updateMemberRoleMock).not.toHaveBeenCalled();
    expect(deactivateMemberMock).not.toHaveBeenCalled();
  });

  it('does not consume an invitation after its organization rollback', async () => {
    resolveInvitationOrganizationMock.mockResolvedValue({ organizationId: 'org_rolled_back' });
    const caller = makeCaller(new OrganizationGateDb());

    await expectNotFound(caller.acceptInvitation({ token: 'token' }));
    expect(resolveInvitationOrganizationMock).toHaveBeenCalledTimes(1);
    expect(acceptInvitationMock).not.toHaveBeenCalled();
  });

  it('normalizes a created name and rejects empty or oversized normalized values', async () => {
    const caller = makeCaller();

    await expect(caller.create({ name: '  Design team  ' })).resolves.toEqual({
      organizationId: 'org_created',
      name: 'Design team',
      role: 'owner',
    });
    await expect(caller.create({ name: '   ' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.create({ name: 'x'.repeat(101) })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(createOrganizationMock).toHaveBeenCalledTimes(1);
    expect(createOrganizationMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorExternalId: 'usr_caller', name: 'Design team' }),
    );
  });

  it('returns collaboration-only organization and member DTOs', async () => {
    listOrganizationsMock.mockResolvedValue([
      {
        organizationId: 'org_design',
        name: 'Design',
        callerRole: 'admin',
        managerDisplayName: 'Ada',
        activeMemberCount: 3,
        teamProjectsEnabled: true,
        ownerEmail: 'owner@example.test',
        internalOrganizationId: 9,
      },
      {
        organizationId: 'org_rolled_back',
        name: 'Rolled back',
        callerRole: 'owner',
        managerDisplayName: null,
        activeMemberCount: 1,
        teamProjectsEnabled: false,
      },
    ]);
    listMembersMock.mockResolvedValue([
      {
        memberId: 'omem_ada',
        userId: 'usr_ada',
        displayName: 'Ada',
        avatarUrl: 'https://cdn.example.test/ada.png',
        role: 'admin',
        managerUserId: 'usr_owner',
        managerDisplayName: 'Owner',
        status: 'active',
        email: 'ada@example.test',
        phone: '+1-555-0100',
        authRole: 'admin',
        passwordHash: 'hash',
        internalUserId: 7,
      },
    ]);
    const caller = makeCaller();

    await expect(caller.list()).resolves.toEqual([
      {
        organizationId: 'org_design',
        name: 'Design',
        role: 'admin',
        managerDisplayName: 'Ada',
        activeMemberCount: 3,
      },
    ]);
    await expect(caller.members({ organizationId: 'org_design' })).resolves.toEqual([
      {
        memberId: 'omem_ada',
        userId: 'usr_ada',
        displayName: 'Ada',
        avatarUrl: 'https://cdn.example.test/ada.png',
        role: 'admin',
        managerUserId: 'usr_owner',
        managerDisplayName: 'Owner',
        status: 'active',
      },
    ]);
  });

  it('creates an invitation with a one-time URL but no token or hash field', async () => {
    const caller = makeCaller();

    await expect(
      caller.createInvitation({ organizationId: 'org_design', role: 'member' }),
    ).resolves.toEqual({
      invitationId: 'oinv_123',
      inviteUrl: '/organizations/invitations/accept?token=plaintext-token',
      expiresAt: new Date('2026-09-06T00:00:00.000Z'),
    });
    await expect(
      caller.createInvitation({ organizationId: 'org_design', role: 'owner' as never }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('adapts invitation acceptance and every organization mutation to external ids only', async () => {
    const caller = makeCaller();

    await expect(caller.acceptInvitation({ token: 'token' })).resolves.toEqual({
      membershipId: 'omem_new',
      status: 'joined',
    });
    await expect(
      caller.revokeInvitation({ organizationId: 'org_design', invitationId: 'oinv_1' }),
    ).resolves.toEqual({ ok: true });
    await expect(
      caller.updateReportingLine({
        organizationId: 'org_design',
        memberId: 'omem_member',
        managerMemberId: 'omem_manager',
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      caller.updateMemberRole({
        organizationId: 'org_design',
        memberId: 'omem_member',
        role: 'admin',
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      caller.deactivateMember({ organizationId: 'org_design', memberId: 'omem_member' }),
    ).resolves.toEqual({ ok: true });
  });

  it('maps established permission denial to forbidden and hidden service errors to not found', async () => {
    const { OrganizationServiceError } = await import(
      '../../organizations/organization-service.js'
    );
    const { InvitationServiceError } = await import(
      '../../organizations/organization-invitation-service.js'
    );
    updateMemberRoleMock.mockRejectedValue(
      new OrganizationServiceError('PERMISSION_DENIED', 'owner_protected'),
    );
    resolveInvitationOrganizationMock.mockRejectedValue(
      new InvitationServiceError('INVITATION_NOT_AVAILABLE'),
    );
    const caller = makeCaller();

    await expect(
      caller.updateMemberRole({
        organizationId: 'org_design',
        memberId: 'omem_owner',
        role: 'member',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expectNotFound(caller.acceptInvitation({ token: 'unavailable-token' }));
  });

  it.each(['invalid', 'expired', 'replayed'])(
    'returns the same unavailable response when invitation acceptance is %s',
    async () => {
      const { InvitationServiceError } = await import(
        '../../organizations/organization-invitation-service.js'
      );
      acceptInvitationMock.mockRejectedValue(
        new InvitationServiceError('INVITATION_NOT_AVAILABLE'),
      );
      const caller = makeCaller();

      await expect(caller.acceptInvitation({ token: 'token' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'organization not found',
      });
    },
  );
});
