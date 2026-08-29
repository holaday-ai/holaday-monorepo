import { describe, expect, it } from 'vitest';
import {
  type OrganizationMembership,
  type OrganizationRole,
  type ProjectAccessContext,
  type ProjectRole,
  canChangeOrganizationMemberRole,
  canCreateTeamProject,
  canDeactivateOrganizationMember,
  canDeleteTeamProject,
  canInviteOrganizationMember,
  canRemoveProjectMember,
  canRenameTeamProject,
  canSetReportingLine,
} from './organization-permissions.js';

const organizationId = 'org_alpha';
const otherOrganizationId = 'org_other';

function organizationMember(
  role: OrganizationRole,
  overrides: Partial<OrganizationMembership> = {},
): OrganizationMembership {
  return {
    organizationId,
    userId: `usr_${role}`,
    role,
    status: 'active',
    ...overrides,
  };
}

function projectContext(
  role: ProjectRole,
  overrides: Partial<ProjectAccessContext> = {},
): ProjectAccessContext {
  const actor = organizationMember('member');
  return {
    organizationId,
    projectOrganizationId: organizationId,
    actorOrganizationMember: actor,
    actorProjectMember: {
      projectId: 'prj_alpha',
      userId: actor.userId,
      role,
      status: 'active',
    },
    ...overrides,
  };
}

describe('organization permission matrix', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['manager', true],
    ['member', false],
  ] as const)('allows %s to create a team project: %s', (role, allowed) => {
    expect(canCreateTeamProject(organizationMember(role))).toEqual(
      allowed ? { allowed: true } : { allowed: false, reason: 'organization_role_not_permitted' },
    );
  });

  it.each([
    ['owner', 'admin', true],
    ['owner', 'manager', true],
    ['owner', 'member', true],
    ['admin', 'admin', true],
    ['admin', 'manager', true],
    ['admin', 'member', true],
    ['manager', 'admin', false],
    ['manager', 'manager', true],
    ['manager', 'member', true],
    ['member', 'admin', false],
    ['member', 'manager', false],
    ['member', 'member', false],
  ] as const)('allows %s to invite %s: %s', (actorRole, invitedRole, allowed) => {
    expect(canInviteOrganizationMember(organizationMember(actorRole), invitedRole)).toEqual(
      allowed ? { allowed: true } : { allowed: false, reason: 'organization_role_not_permitted' },
    );
  });

  it('categorically rejects owner invitations', () => {
    expect(canInviteOrganizationMember(organizationMember('owner'), 'owner')).toEqual({
      allowed: false,
      reason: 'owner_invitation_forbidden',
    });
  });

  it.each([
    ['owner', true],
    ['admin', true],
    ['manager', true],
    ['member', false],
  ] as const)('allows %s to set an active reporting line: %s', (role, allowed) => {
    expect(
      canSetReportingLine({
        actor: organizationMember(role),
        member: organizationMember('member', { userId: 'usr_report' }),
        manager: organizationMember('manager', { userId: 'usr_manager' }),
      }),
    ).toEqual(
      allowed ? { allowed: true } : { allowed: false, reason: 'organization_role_not_permitted' },
    );
  });

  it.each([
    ['lead', true, true, false],
    ['member', false, false, false],
    ['viewer', false, false, false],
  ] as const)(
    'project %s can rename: %s, remove a project member: %s, delete: %s',
    (role, canRename, canRemove, canDelete) => {
      const context = projectContext(role);
      expect(canRenameTeamProject(context)).toEqual(
        canRename ? { allowed: true } : { allowed: false, reason: 'project_role_not_permitted' },
      );
      expect(canRemoveProjectMember(context)).toEqual(
        canRemove ? { allowed: true } : { allowed: false, reason: 'project_role_not_permitted' },
      );
      expect(canDeleteTeamProject(context)).toEqual(
        canDelete ? { allowed: true } : { allowed: false, reason: 'project_role_not_permitted' },
      );
    },
  );

  it.each(['owner', 'admin'] as const)(
    'allows active organization %s to delete a team project',
    (role) => {
      const actor = organizationMember(role);
      expect(
        canDeleteTeamProject(
          projectContext('member', {
            actorOrganizationMember: actor,
            actorProjectMember: {
              projectId: 'prj_alpha',
              userId: actor.userId,
              role: 'member',
              status: 'active',
            },
          }),
        ),
      ).toEqual({ allowed: true });
    },
  );
});

describe('organization permission denials', () => {
  it.each([
    [
      'an inactive organization actor',
      () => canCreateTeamProject(organizationMember('owner', { status: 'inactive' })),
      'actor_organization_membership_inactive',
    ],
    [
      'an inactive reporting-line member',
      () =>
        canSetReportingLine({
          actor: organizationMember('owner'),
          member: organizationMember('member', { status: 'inactive' }),
          manager: organizationMember('manager', { userId: 'usr_manager' }),
        }),
      'target_organization_membership_inactive',
    ],
    [
      'self as a reporting-line manager',
      () => {
        const member = organizationMember('member', { userId: 'usr_same' });
        return canSetReportingLine({ actor: organizationMember('owner'), member, manager: member });
      },
      'manager_cannot_be_self',
    ],
    [
      'a reporting-line manager from another organization',
      () =>
        canSetReportingLine({
          actor: organizationMember('owner'),
          member: organizationMember('member', { userId: 'usr_report' }),
          manager: organizationMember('manager', {
            organizationId: otherOrganizationId,
            userId: 'usr_manager',
          }),
        }),
      'manager_outside_organization',
    ],
    [
      'an inactive project actor',
      () =>
        canRenameTeamProject(
          projectContext('lead', {
            actorOrganizationMember: organizationMember('member', { status: 'inactive' }),
          }),
        ),
      'actor_organization_membership_inactive',
    ],
    [
      'an inactive project membership',
      () =>
        canRenameTeamProject(
          projectContext('lead', {
            actorProjectMember: {
              projectId: 'prj_alpha',
              userId: 'usr_member',
              role: 'lead',
              status: 'inactive',
            },
          }),
        ),
      'actor_project_membership_inactive',
    ],
    [
      'a project from another organization',
      () =>
        canRemoveProjectMember(
          projectContext('lead', { projectOrganizationId: otherOrganizationId }),
        ),
      'project_outside_organization',
    ],
  ] as const)('denies %s', (_label, check, reason) => {
    expect(check()).toEqual({ allowed: false, reason });
  });

  it('rejects a manager target whose active role cannot manage reporting lines', () => {
    expect(
      canSetReportingLine({
        actor: organizationMember('owner'),
        member: organizationMember('member', { userId: 'usr_report' }),
        manager: organizationMember('member', { userId: 'usr_manager' }),
      }),
    ).toEqual({ allowed: false, reason: 'manager_role_not_permitted' });
  });

  it('protects an owner from a non-owner role change and deactivation', () => {
    const target = organizationMember('owner', { userId: 'usr_owner' });
    const actor = organizationMember('admin');
    expect(
      canChangeOrganizationMemberRole({ actor, target, nextRole: 'member', ownerCount: 2 }),
    ).toEqual({
      allowed: false,
      reason: 'owner_protected',
    });
    expect(canDeactivateOrganizationMember({ actor, target, ownerCount: 2 })).toEqual({
      allowed: false,
      reason: 'owner_protected',
    });
  });

  it('protects the last owner from demotion or deactivation', () => {
    const owner = organizationMember('owner');
    expect(
      canChangeOrganizationMemberRole({
        actor: owner,
        target: owner,
        nextRole: 'admin',
        ownerCount: 1,
      }),
    ).toEqual({ allowed: false, reason: 'last_owner_must_remain' });
    expect(canDeactivateOrganizationMember({ actor: owner, target: owner, ownerCount: 1 })).toEqual(
      {
        allowed: false,
        reason: 'last_owner_must_remain',
      },
    );
  });
});
