import type { OrganizationRole, ProjectRole } from '../organizations/organization-permissions.js';

export const TEAM_TASK_ACTIONS = [
  'create',
  'publish',
  'assign',
  'claim',
  'edit_contract',
  'submit',
  'review',
  'appeal',
  'arbitrate',
  'bind_evidence',
  'record_ai_contribution',
  'confirm_ai_contribution',
  'read_evidence_package',
  'close',
  'archive',
] as const;
export type TeamTaskAction = (typeof TEAM_TASK_ACTIONS)[number];

export type TeamTaskPermissionReason =
  | 'actor_organization_membership_inactive'
  | 'actor_project_membership_inactive'
  | 'viewer_cannot_mutate'
  | 'management_role_required'
  | 'designated_approver_required'
  | 'responsible_member_required'
  | 'assigned_member_required'
  | 'creator_responsible_self_approval_forbidden'
  | 'responsible_cannot_review_own_work'
  | 'responsible_cannot_arbitrate_own_work'
  | 'latest_reviewer_cannot_arbitrate_own_rejection'
  | 'arbitrator_not_designated_or_manager';

export type TeamTaskPermissionDecision =
  | { allowed: true }
  | { allowed: false; reason: TeamTaskPermissionReason };

/**
 * Facts loaded by the calling service. This policy is deliberately pure: it
 * does not inspect the environment or query memberships, projects, or tasks.
 */
export interface TeamTaskPermissionContext {
  actorOrganizationRole: OrganizationRole;
  actorOrganizationMembershipActive: boolean;
  /** Null when the active organization member is not a project member. */
  actorProjectRole: ProjectRole | null;
  /** Null when no project membership exists; only arbitration may omit it. */
  actorProjectMembershipActive: boolean | null;
  actorIsCreator: boolean;
  actorIsResponsible: boolean;
  /** Accepted collaborator assignment on the locked work item. */
  actorIsCollaborator?: boolean;
  actorIsLatestReviewer: boolean;
  actorIsDesignatedApprover: boolean;
  actorIsDesignatedIndependentArbitrator: boolean;
}

const managementActions = new Set<TeamTaskAction>([
  'create',
  'publish',
  'assign',
  'edit_contract',
  'close',
  'archive',
]);

const allow = (): TeamTaskPermissionDecision => ({ allowed: true });
const deny = (reason: TeamTaskPermissionReason): TeamTaskPermissionDecision => ({
  allowed: false,
  reason,
});

function passesMemberships(
  action: TeamTaskAction,
  context: TeamTaskPermissionContext,
): TeamTaskPermissionDecision {
  if (!context.actorOrganizationMembershipActive) {
    return deny('actor_organization_membership_inactive');
  }
  // An arbitrator is an organization-scoped, predesignated independent role.
  // It may be assigned to somebody outside the project, but never to a viewer
  // who is explicitly a project member.
  if (action === 'arbitrate') {
    return context.actorProjectRole === 'viewer' ? deny('viewer_cannot_mutate') : allow();
  }
  if (context.actorProjectMembershipActive !== true || context.actorProjectRole === null) {
    return deny('actor_project_membership_inactive');
  }
  if (action === 'read_evidence_package') return allow();
  if (context.actorProjectRole === 'viewer') return deny('viewer_cannot_mutate');
  return allow();
}

function hasManagementAuthority(context: TeamTaskPermissionContext): boolean {
  return hasOrganizationManagementAuthority(context) || context.actorProjectRole === 'lead';
}

function hasOrganizationManagementAuthority(context: TeamTaskPermissionContext): boolean {
  return (
    context.actorOrganizationRole === 'owner' ||
    context.actorOrganizationRole === 'admin' ||
    context.actorOrganizationRole === 'manager'
  );
}

/** Single source of truth for all Phase 2 task lifecycle mutation policies. */
export function decideTeamTaskPermission(
  action: TeamTaskAction,
  context: TeamTaskPermissionContext,
): TeamTaskPermissionDecision {
  const membershipDecision = passesMemberships(action, context);
  if (!membershipDecision.allowed) return membershipDecision;

  if (managementActions.has(action)) {
    return hasManagementAuthority(context) ? allow() : deny('management_role_required');
  }

  if (action === 'claim') return allow();

  if (
    action === 'bind_evidence' ||
    action === 'record_ai_contribution' ||
    action === 'confirm_ai_contribution'
  ) {
    return context.actorIsResponsible || context.actorIsCollaborator === true
      ? allow()
      : deny('assigned_member_required');
  }

  if (action === 'read_evidence_package') return allow();

  if (action === 'submit' || action === 'appeal') {
    return context.actorIsResponsible ? allow() : deny('responsible_member_required');
  }

  if (action === 'review') {
    if (context.actorIsCreator && context.actorIsResponsible) {
      return deny('creator_responsible_self_approval_forbidden');
    }
    if (context.actorIsResponsible) return deny('responsible_cannot_review_own_work');
    return context.actorIsDesignatedApprover ? allow() : deny('designated_approver_required');
  }

  if (action === 'arbitrate') {
    if (context.actorIsResponsible) return deny('responsible_cannot_arbitrate_own_work');
    if (context.actorIsLatestReviewer) {
      return deny('latest_reviewer_cannot_arbitrate_own_rejection');
    }
    return hasOrganizationManagementAuthority(context) ||
      context.actorIsDesignatedIndependentArbitrator
      ? allow()
      : deny('arbitrator_not_designated_or_manager');
  }

  return deny('management_role_required');
}
