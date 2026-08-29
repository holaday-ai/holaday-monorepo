import { describe, expect, it } from 'vitest';
import {
  clearInviteLinkState,
  memberActionVisibility,
  normalizeInviteLinkState,
  normalizeOrganizationMemberRows,
  normalizeOrganizationRows,
  normalizeSelectedWorkspace,
  organizationActionVisibility,
} from './organization-page-state';

describe('organization page state helpers', () => {
  it('normalizes organization names, exact roles, manager names, and member counts', () => {
    const raw = {
      organizationId: ' org_design ',
      name: { unsafe: true },
      role: 'admin',
      managerDisplayName: ' Ada ',
      activeMemberCount: 3.9,
    };

    const normalized = normalizeOrganizationRows([
      raw,
      {
        organizationId: 'org_research',
        name: ' Research ',
        role: 'member',
        managerDisplayName: { unsafe: true },
        activeMemberCount: Number.POSITIVE_INFINITY,
      },
      { organizationId: 'org_bad_role', name: 'Bad', role: { admin: true } },
      Object.create({ organizationId: 'org_inherited', name: 'Inherited', role: 'owner' }),
    ]);

    expect(normalized).toEqual([
      {
        organizationId: 'org_design',
        name: '未命名团队',
        role: 'admin',
        managerDisplayName: 'Ada',
        activeMemberCount: 3,
      },
      {
        organizationId: 'org_research',
        name: 'Research',
        role: 'member',
        managerDisplayName: null,
        activeMemberCount: 0,
      },
    ]);
    expect(normalized[0]).not.toBe(raw);
  });

  it('selects only an organization present in the normalized workspace list', () => {
    const organizations = normalizeOrganizationRows([
      { organizationId: 'org_design', name: 'Design', role: 'manager', activeMemberCount: 2 },
    ]);

    expect(normalizeSelectedWorkspace(' org_design ', organizations)).toEqual({
      scope: 'organization',
      organizationId: 'org_design',
      organization: organizations[0],
    });
    expect(normalizeSelectedWorkspace('org_other', organizations)).toEqual({
      scope: 'personal',
      organizationId: null,
      organization: null,
    });
    expect(normalizeSelectedWorkspace({ organizationId: 'org_design' }, organizations)).toEqual({
      scope: 'personal',
      organizationId: null,
      organization: null,
    });
  });

  it('binds normalized active members to the requested organization and rejects tenant hints', () => {
    const raw = {
      memberId: ' omem_ada ',
      userId: ' usr_ada ',
      displayName: { unsafe: true },
      avatarUrl: ' https://cdn.example.test/ada.png ',
      role: 'admin',
      managerUserId: ' usr_owner ',
      managerDisplayName: ' Owner ',
      status: 'active',
    };

    const normalized = normalizeOrganizationMemberRows(
      [
        raw,
        {
          ...raw,
          memberId: 'omem_cross_tenant',
          organizationId: 'org_other',
        },
        { ...raw, memberId: 'omem_bad_role', role: 'administrator' },
        Object.create(raw),
      ],
      'org_design',
    );

    expect(normalized).toEqual([
      {
        organizationId: 'org_design',
        memberId: 'omem_ada',
        userId: 'usr_ada',
        displayName: '未命名成员',
        avatarUrl: 'https://cdn.example.test/ada.png',
        role: 'admin',
        managerUserId: 'usr_owner',
        managerDisplayName: 'Owner',
        status: 'active',
      },
    ]);
    expect(normalized[0]).not.toBe(raw);
  });

  it('keeps invite plaintext only in a valid organization-bound ready state and clears it', () => {
    const ready = normalizeInviteLinkState(
      {
        invitationId: ' oinv_123 ',
        inviteUrl: ' /organizations/invitations/accept?token=plaintext-token ',
        expiresAt: '2026-09-06T00:00:00.000Z',
      },
      'org_design',
    );

    expect(ready).toEqual({
      status: 'ready',
      organizationId: 'org_design',
      invitationId: 'oinv_123',
      inviteUrl: '/organizations/invitations/accept?token=plaintext-token',
      expiresAt: '2026-09-06T00:00:00.000Z',
    });
    expect(clearInviteLinkState()).toEqual({ status: 'idle' });
    expect(clearInviteLinkState(ready)).toEqual({ status: 'idle' });
    expect(
      normalizeInviteLinkState(
        {
          organizationId: 'org_other',
          invitationId: 'oinv_cross',
          inviteUrl: '/organizations/invitations/accept?token=other',
          expiresAt: '2026-09-06T00:00:00.000Z',
        },
        'org_design',
      ),
    ).toEqual({ status: 'idle' });
    expect(
      normalizeInviteLinkState(
        Object.create({
          invitationId: 'oinv_inherited',
          inviteUrl: '/organizations/invitations/accept?token=inherited',
          expiresAt: '2026-09-06T00:00:00.000Z',
        }),
        'org_design',
      ),
    ).toEqual({ status: 'idle' });
  });

  it.each([
    ['owner', true, ['admin', 'manager', 'member']],
    ['admin', true, ['admin', 'manager', 'member']],
    ['manager', true, ['manager', 'member']],
    ['member', false, []],
  ] as const)(
    'derives exact organization actions for a %s',
    (role, canCreateProject, inviteRoles) => {
      expect(organizationActionVisibility(role)).toEqual({ canCreateProject, inviteRoles });
    },
  );

  it('derives member actions from the backend owner/admin/manager permission boundaries', () => {
    const members = normalizeOrganizationMemberRows(
      [
        {
          memberId: 'omem_owner',
          userId: 'usr_owner',
          displayName: 'Owner',
          role: 'owner',
          status: 'active',
        },
        {
          memberId: 'omem_admin',
          userId: 'usr_admin',
          displayName: 'Admin',
          role: 'admin',
          status: 'active',
        },
        {
          memberId: 'omem_member',
          userId: 'usr_member',
          displayName: 'Member',
          role: 'member',
          status: 'active',
        },
      ],
      'org_design',
    );
    const targetOwner = members[0];
    const targetMember = members[2];

    expect(
      memberActionVisibility({
        organization: {
          organizationId: 'org_design',
          name: 'Design',
          role: 'admin',
          managerDisplayName: null,
          activeMemberCount: 3,
        },
        target: targetOwner,
        members,
      }),
    ).toEqual({
      canSetReportingLine: true,
      canChangeRole: false,
      canDeactivate: false,
      roleOptions: [],
      managerMemberIds: ['omem_admin'],
    });
    expect(
      memberActionVisibility({
        organization: {
          organizationId: 'org_design',
          name: 'Design',
          role: 'manager',
          managerDisplayName: null,
          activeMemberCount: 3,
        },
        target: targetMember,
        members,
      }),
    ).toEqual({
      canSetReportingLine: true,
      canChangeRole: false,
      canDeactivate: false,
      roleOptions: [],
      managerMemberIds: ['omem_owner', 'omem_admin'],
    });
    expect(
      memberActionVisibility({
        organization: {
          organizationId: 'org_design',
          name: 'Design',
          role: 'owner',
          managerDisplayName: null,
          activeMemberCount: 3,
        },
        target: targetOwner,
        members,
      }),
    ).toMatchObject({ canChangeRole: false, canDeactivate: false, roleOptions: [] });
    expect(
      memberActionVisibility({
        organization: {
          organizationId: 'org_design',
          name: 'Design',
          role: 'owner',
          managerDisplayName: null,
          activeMemberCount: 3,
        },
        target: targetMember,
        members,
      }),
    ).toMatchObject({
      canChangeRole: true,
      canDeactivate: true,
      roleOptions: ['owner', 'admin', 'manager'],
    });

    const membersWithAnotherOwner = normalizeOrganizationMemberRows(
      [
        ...members,
        {
          memberId: 'omem_owner_2',
          userId: 'usr_owner_2',
          displayName: 'Owner 2',
          role: 'owner',
          status: 'active',
        },
      ],
      'org_design',
    );
    expect(
      memberActionVisibility({
        organization: {
          organizationId: 'org_design',
          name: 'Design',
          role: 'owner',
          managerDisplayName: null,
          activeMemberCount: 4,
        },
        target: membersWithAnotherOwner[0],
        members: membersWithAnotherOwner,
      }),
    ).toMatchObject({
      canChangeRole: true,
      canDeactivate: true,
      roleOptions: ['admin', 'manager', 'member'],
    });
  });

  it('fails member actions closed for member callers and cross-tenant targets', () => {
    const [target] = normalizeOrganizationMemberRows(
      [
        {
          memberId: 'omem_member',
          userId: 'usr_member',
          displayName: 'Member',
          role: 'member',
          status: 'active',
        },
      ],
      'org_other',
    );

    expect(
      memberActionVisibility({
        organization: {
          organizationId: 'org_design',
          name: 'Design',
          role: 'owner',
          managerDisplayName: null,
          activeMemberCount: 1,
        },
        target,
        members: [target],
      }),
    ).toEqual({
      canSetReportingLine: false,
      canChangeRole: false,
      canDeactivate: false,
      roleOptions: [],
      managerMemberIds: [],
    });
  });
});
