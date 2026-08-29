import { describe, expect, it } from 'vitest';
import {
  type OrganizationMembership,
  type OrganizationRole,
  type ProjectAccessContext,
  type ProjectMemberRemovalContext,
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
    targetProjectId: 'prj_alpha',
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

function projectContextForRoles(
  organizationRole: OrganizationRole,
  projectRole: ProjectRole,
): ProjectAccessContext {
  const actor = organizationMember(organizationRole);
  return projectContext(projectRole, {
    actorOrganizationMember: actor,
    actorProjectMember: {
      projectId: 'prj_alpha',
      userId: actor.userId,
      role: projectRole,
      status: 'active',
    },
  });
}

function removalContext(
  projectRole: ProjectRole,
  overrides: Partial<ProjectMemberRemovalContext> = {},
): ProjectMemberRemovalContext {
  const context = projectContext(projectRole);
  return {
    ...context,
    targetProjectMember: {
      projectId: context.targetProjectId,
      userId: 'usr_target',
      role: 'member',
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
      expect(canRemoveProjectMember(removalContext(role))).toEqual(
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

  it.each([
    ['owner', 'lead', true, true, true],
    ['owner', 'member', true, true, true],
    ['owner', 'viewer', true, true, true],
    ['admin', 'lead', true, true, true],
    ['admin', 'member', true, true, true],
    ['admin', 'viewer', true, true, true],
    ['manager', 'lead', true, true, false],
    ['manager', 'member', false, false, false],
    ['manager', 'viewer', false, false, false],
    ['member', 'lead', true, true, false],
    ['member', 'member', false, false, false],
    ['member', 'viewer', false, false, false],
  ] as const)(
    '%s organization role with %s project role permits rename/remove/delete: %s/%s/%s',
    (organizationRole, projectRole, renameAllowed, removeAllowed, deleteAllowed) => {
      const context = projectContextForRoles(organizationRole, projectRole);
      const expected = (allowed: boolean) =>
        allowed ? { allowed: true } : { allowed: false, reason: 'project_role_not_permitted' };

      expect(canRenameTeamProject(context)).toEqual(expected(renameAllowed));
      expect(
        canRemoveProjectMember({
          ...context,
          targetProjectMember: {
            projectId: context.targetProjectId,
            userId: 'usr_target',
            role: 'member',
            status: 'active',
          },
        }),
      ).toEqual(expected(removeAllowed));
      expect(canDeleteTeamProject(context)).toEqual(expected(deleteAllowed));
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
          removalContext('lead', { projectOrganizationId: otherOrganizationId }),
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

  it.each([
    [
      'an inactive proposed manager',
      () =>
        canSetReportingLine({
          actor: organizationMember('owner'),
          member: organizationMember('member', { userId: 'usr_report' }),
          manager: organizationMember('manager', { userId: 'usr_manager', status: 'inactive' }),
        }),
      'manager_organization_membership_inactive',
    ],
    [
      'a member inviting an owner',
      () => canInviteOrganizationMember(organizationMember('member'), 'owner'),
      'owner_invitation_forbidden',
    ],
    [
      'an actor whose organization membership is outside the requested organization',
      () =>
        canRenameTeamProject(
          projectContext('lead', {
            actorOrganizationMember: organizationMember('member', {
              organizationId: otherOrganizationId,
            }),
          }),
        ),
      'actor_outside_organization',
    ],
    [
      'a project membership belonging to another actor',
      () =>
        canDeleteTeamProject(
          projectContext('member', {
            actorProjectMember: {
              projectId: 'prj_alpha',
              userId: 'usr_other',
              role: 'member',
              status: 'active',
            },
          }),
        ),
      'project_membership_actor_mismatch',
    ],
  ] as const)('denies %s', (_label, check, reason) => {
    expect(check()).toEqual({ allowed: false, reason });
  });

  it.each([
    [
      'rename when the actor project membership is for another project',
      () =>
        canRenameTeamProject(
          projectContext('lead', {
            targetProjectId: 'prj_beta',
          }),
        ),
      'actor_project_membership_wrong_project',
    ],
    [
      'delete when the actor project membership is for another project',
      () =>
        canDeleteTeamProject(
          projectContext('lead', {
            targetProjectId: 'prj_beta',
          }),
        ),
      'actor_project_membership_wrong_project',
    ],
    [
      'removal when the actor project membership is for another project',
      () =>
        canRemoveProjectMember(
          removalContext('lead', {
            targetProjectId: 'prj_beta',
          }),
        ),
      'actor_project_membership_wrong_project',
    ],
    [
      'removal when the target membership is for another project',
      () =>
        canRemoveProjectMember(
          removalContext('lead', {
            targetProjectMember: {
              projectId: 'prj_beta',
              userId: 'usr_target',
              role: 'member',
              status: 'active',
            },
          }),
        ),
      'target_project_membership_wrong_project',
    ],
  ] as const)('denies %s', (_label, check, reason) => {
    expect(check()).toEqual({ allowed: false, reason });
  });

  it.each([
    [
      'rename when the organization membership is inactive',
      () =>
        canRenameTeamProject(
          projectContext('lead', {
            actorOrganizationMember: organizationMember('member', { status: 'inactive' }),
          }),
        ),
      'actor_organization_membership_inactive',
    ],
    [
      'remove when the project membership is inactive',
      () =>
        canRemoveProjectMember(
          removalContext('lead', {
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
      'remove when the target project membership is inactive',
      () =>
        canRemoveProjectMember(
          removalContext('lead', {
            targetProjectMember: {
              projectId: 'prj_alpha',
              userId: 'usr_target',
              role: 'member',
              status: 'inactive',
            },
          }),
        ),
      'target_project_membership_inactive',
    ],
    [
      'delete when the project membership is inactive',
      () =>
        canDeleteTeamProject(
          projectContext('member', {
            actorProjectMember: {
              projectId: 'prj_alpha',
              userId: 'usr_member',
              role: 'member',
              status: 'inactive',
            },
          }),
        ),
      'actor_project_membership_inactive',
    ],
  ] as const)('requires active membership to %s', (_label, check, reason) => {
    expect(check()).toEqual({ allowed: false, reason });
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
