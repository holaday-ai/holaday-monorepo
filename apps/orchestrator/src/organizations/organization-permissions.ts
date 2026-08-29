/** Role values shared by validation, services, and routers. */
export const ORGANIZATION_ROLES = ['owner', 'admin', 'manager', 'member'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** Roles that may appear as a current reporting manager. */
export const REPORTING_MANAGER_ROLES = [
  'owner',
  'admin',
  'manager',
] as const satisfies readonly OrganizationRole[];

export function isReportingManagerRole(
  role: OrganizationRole,
): role is (typeof REPORTING_MANAGER_ROLES)[number] {
  return (REPORTING_MANAGER_ROLES as readonly OrganizationRole[]).includes(role);
}

/** Project roles are scoped to one project and never bypass organization membership. */
export const PROJECT_ROLES = ['lead', 'member', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export type PermissionReason =
  | 'actor_organization_membership_inactive'
  | 'actor_outside_organization'
  | 'target_organization_membership_inactive'
  | 'target_outside_organization'
  | 'organization_role_not_permitted'
  | 'owner_invitation_forbidden'
  | 'manager_cannot_be_self'
  | 'manager_outside_organization'
  | 'manager_organization_membership_inactive'
  | 'manager_role_not_permitted'
  | 'owner_protected'
  | 'last_owner_must_remain'
  | 'actor_project_membership_inactive'
  | 'project_membership_actor_mismatch'
  | 'actor_project_membership_wrong_project'
  | 'target_project_membership_inactive'
  | 'target_project_membership_wrong_project'
  | 'project_outside_organization'
  | 'project_role_not_permitted';

export type PermissionDecision = { allowed: true } | { allowed: false; reason: PermissionReason };

export interface OrganizationMembership {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  /** Any state other than exactly `active` is denied. */
  status: string;
}

export interface ProjectMembership {
  projectId: string;
  userId: string;
  role: ProjectRole;
  /** Any state other than exactly `active` is denied. */
  status: string;
}

export interface ProjectAccessContext {
  organizationId: string;
  projectOrganizationId: string;
  targetProjectId: string;
  actorOrganizationMember: OrganizationMembership;
  actorProjectMember: ProjectMembership;
}

export interface ProjectMemberRemovalContext extends ProjectAccessContext {
  targetProjectMember: ProjectMembership;
}

interface ReportingLineInput {
  actor: OrganizationMembership;
  member: OrganizationMembership;
  manager: OrganizationMembership;
}

interface OrganizationMemberChangeInput {
  actor: OrganizationMembership;
  target: OrganizationMembership;
  ownerCount: number;
}

export interface ChangeOrganizationMemberRoleInput extends OrganizationMemberChangeInput {
  nextRole: OrganizationRole;
}

const allow = (): PermissionDecision => ({ allowed: true });
const deny = (reason: PermissionReason): PermissionDecision => ({ allowed: false, reason });

function isActive(membership: { status: string }): boolean {
  return membership.status === 'active';
}

function hasOrganizationRole(
  actor: OrganizationMembership,
  roles: readonly OrganizationRole[],
): PermissionDecision {
  if (!isActive(actor)) return deny('actor_organization_membership_inactive');
  return roles.includes(actor.role) ? allow() : deny('organization_role_not_permitted');
}

function validateOrganizationTarget(
  actor: OrganizationMembership,
  target: OrganizationMembership,
): PermissionDecision {
  if (!isActive(actor)) return deny('actor_organization_membership_inactive');
  if (actor.organizationId !== target.organizationId) return deny('target_outside_organization');
  if (!isActive(target)) return deny('target_organization_membership_inactive');
  return allow();
}

/** Owner, admin, and manager may create a project in their active organization. */
export function canCreateTeamProject(actor: OrganizationMembership): PermissionDecision {
  return hasOrganizationRole(actor, ['owner', 'admin', 'manager']);
}

/**
 * Invitation policy deliberately has no owner path. Only an owner or admin can invite
 * administrators; managers may invite managers and members.
 */
export function canInviteOrganizationMember(
  actor: OrganizationMembership,
  invitedRole: OrganizationRole,
): PermissionDecision {
  if (!isActive(actor)) return deny('actor_organization_membership_inactive');
  if (invitedRole === 'owner') return deny('owner_invitation_forbidden');
  if (invitedRole === 'admin') {
    return actor.role === 'owner' || actor.role === 'admin'
      ? allow()
      : deny('organization_role_not_permitted');
  }
  return actor.role === 'owner' || actor.role === 'admin' || actor.role === 'manager'
    ? allow()
    : deny('organization_role_not_permitted');
}

/** A reporting manager must be an active owner, admin, or manager in the same organization. */
export function canSetReportingLine(input: ReportingLineInput): PermissionDecision {
  const { actor, member, manager } = input;
  const targetDecision = validateOrganizationTarget(actor, member);
  if (!targetDecision.allowed) return targetDecision;
  if (!isReportingManagerRole(actor.role)) {
    return deny('organization_role_not_permitted');
  }
  if (member.userId === manager.userId) return deny('manager_cannot_be_self');
  if (manager.organizationId !== member.organizationId) return deny('manager_outside_organization');
  if (!isActive(manager)) return deny('manager_organization_membership_inactive');
  return isReportingManagerRole(manager.role) ? allow() : deny('manager_role_not_permitted');
}

/**
 * Changes to owner membership are owner-only, and a change away from owner
 * requires another owner to remain. Admins can manage non-owner roles only.
 */
export function canChangeOrganizationMemberRole(
  input: ChangeOrganizationMemberRoleInput,
): PermissionDecision {
  const { actor, target, nextRole, ownerCount } = input;
  const targetDecision = validateOrganizationTarget(actor, target);
  if (!targetDecision.allowed) return targetDecision;

  const changesOwner = target.role === 'owner' || nextRole === 'owner';
  if (changesOwner && actor.role !== 'owner') return deny('owner_protected');
  if (target.role === 'owner' && nextRole !== 'owner' && ownerCount <= 1) {
    return deny('last_owner_must_remain');
  }
  return actor.role === 'owner' || actor.role === 'admin'
    ? allow()
    : deny('organization_role_not_permitted');
}

/** Deactivation follows the same owner protection as role changes. */
export function canDeactivateOrganizationMember(
  input: OrganizationMemberChangeInput,
): PermissionDecision {
  const { actor, target, ownerCount } = input;
  const targetDecision = validateOrganizationTarget(actor, target);
  if (!targetDecision.allowed) return targetDecision;

  if (target.role === 'owner' && actor.role !== 'owner') return deny('owner_protected');
  if (target.role === 'owner' && ownerCount <= 1) return deny('last_owner_must_remain');
  return actor.role === 'owner' || actor.role === 'admin'
    ? allow()
    : deny('organization_role_not_permitted');
}

function validateProjectAccess(context: ProjectAccessContext): PermissionDecision {
  const { organizationId, projectOrganizationId, actorOrganizationMember, actorProjectMember } =
    context;
  if (!isActive(actorOrganizationMember)) return deny('actor_organization_membership_inactive');
  if (actorOrganizationMember.organizationId !== organizationId)
    return deny('actor_outside_organization');
  if (projectOrganizationId !== organizationId) return deny('project_outside_organization');
  if (!isActive(actorProjectMember)) return deny('actor_project_membership_inactive');
  if (actorProjectMember.userId !== actorOrganizationMember.userId) {
    return deny('project_membership_actor_mismatch');
  }
  if (actorProjectMember.projectId !== context.targetProjectId) {
    return deny('actor_project_membership_wrong_project');
  }
  return allow();
}

function canManageProject(context: ProjectAccessContext): PermissionDecision {
  const accessDecision = validateProjectAccess(context);
  if (!accessDecision.allowed) return accessDecision;
  const { role: organizationRole } = context.actorOrganizationMember;
  const { role: projectRole } = context.actorProjectMember;
  return organizationRole === 'owner' || organizationRole === 'admin' || projectRole === 'lead'
    ? allow()
    : deny('project_role_not_permitted');
}

/** Project leads may rename only after both membership boundaries pass. */
export function canRenameTeamProject(context: ProjectAccessContext): PermissionDecision {
  return canManageProject(context);
}

/** Project leads may manage membership only within the authorized target project. */
export function canRemoveProjectMember(context: ProjectMemberRemovalContext): PermissionDecision {
  const accessDecision = canManageProject(context);
  if (!accessDecision.allowed) return accessDecision;
  if (!isActive(context.targetProjectMember)) return deny('target_project_membership_inactive');
  return context.targetProjectMember.projectId === context.targetProjectId
    ? allow()
    : deny('target_project_membership_wrong_project');
}

/** Project deletion remains an organization owner/admin decision, never a lead decision. */
export function canDeleteTeamProject(context: ProjectAccessContext): PermissionDecision {
  const accessDecision = validateProjectAccess(context);
  if (!accessDecision.allowed) return accessDecision;
  const { role } = context.actorOrganizationMember;
  return role === 'owner' || role === 'admin' ? allow() : deny('project_role_not_permitted');
}
