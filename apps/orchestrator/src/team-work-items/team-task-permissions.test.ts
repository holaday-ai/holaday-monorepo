import { describe, expect, it } from 'vitest';
import {
  type TeamTaskAction,
  type TeamTaskPermissionContext,
  decideTeamTaskPermission,
} from './team-task-permissions.js';

const managementActions = [
  'create',
  'publish',
  'assign',
  'edit_contract',
  'close',
  'archive',
] as const satisfies readonly TeamTaskAction[];

function context(overrides: Partial<TeamTaskPermissionContext> = {}): TeamTaskPermissionContext {
  return {
    actorOrganizationRole: 'member',
    actorOrganizationMembershipActive: true,
    actorProjectRole: 'member',
    actorProjectMembershipActive: true,
    actorIsCreator: false,
    actorIsResponsible: false,
    actorIsLatestReviewer: false,
    actorIsDesignatedApprover: false,
    actorIsDesignatedIndependentArbitrator: false,
    ...overrides,
  };
}

describe('team task lifecycle permission matrix', () => {
  it.each([
    ['owner', 'member', true],
    ['admin', 'member', true],
    ['manager', 'member', true],
    ['member', 'lead', true],
    ['member', 'member', false],
    ['member', 'viewer', false],
  ] as const)(
    'allows management actions for organization %s / project %s: %s',
    (organizationRole, projectRole, allowed) => {
      const input = context({
        actorOrganizationRole: organizationRole,
        actorProjectRole: projectRole,
      });

      for (const action of managementActions) {
        expect(decideTeamTaskPermission(action, input)).toEqual(
          allowed
            ? { allowed: true }
            : {
                allowed: false,
                reason:
                  projectRole === 'viewer' ? 'viewer_cannot_mutate' : 'management_role_required',
              },
        );
      }
    },
  );

  it.each([
    ['member', 'member', true],
    ['member', 'lead', true],
    ['member', 'viewer', false],
  ] as const)(
    'allows %s/%s to claim an available task: %s',
    (organizationRole, projectRole, allowed) => {
      expect(
        decideTeamTaskPermission(
          'claim',
          context({ actorOrganizationRole: organizationRole, actorProjectRole: projectRole }),
        ),
      ).toEqual(allowed ? { allowed: true } : { allowed: false, reason: 'viewer_cannot_mutate' });
    },
  );

  it.each([
    ['submit', { actorIsResponsible: true }, { allowed: true }],
    ['submit', {}, { allowed: false, reason: 'responsible_member_required' }],
    ['appeal', { actorIsResponsible: true }, { allowed: true }],
    ['appeal', {}, { allowed: false, reason: 'responsible_member_required' }],
  ] as const)('applies the responsible-member rule to %s', (action, overrides, expected) => {
    expect(decideTeamTaskPermission(action, context(overrides))).toEqual(expected);
  });

  it.each([
    ['review', { actorIsDesignatedApprover: true }, { allowed: true }],
    [
      'review',
      { actorOrganizationRole: 'manager' },
      { allowed: false, reason: 'designated_approver_required' },
    ],
    [
      'review',
      { actorProjectRole: 'lead' },
      { allowed: false, reason: 'designated_approver_required' },
    ],
    [
      'review',
      {
        actorOrganizationRole: 'manager',
        actorIsDesignatedApprover: true,
        actorIsResponsible: true,
      },
      { allowed: false, reason: 'responsible_cannot_review_own_work' },
    ],
    [
      'review',
      {
        actorOrganizationRole: 'manager',
        actorIsDesignatedApprover: true,
        actorIsCreator: true,
        actorIsResponsible: true,
      },
      { allowed: false, reason: 'creator_responsible_self_approval_forbidden' },
    ],
  ] as const)(
    'applies review authority and conflict rules for %s',
    (action, overrides, expected) => {
      expect(decideTeamTaskPermission(action, context(overrides))).toEqual(expected);
    },
  );

  it.each([
    ['a manager', { actorOrganizationRole: 'manager' }, { allowed: true }],
    [
      'an undesignated project lead',
      { actorProjectRole: 'lead' },
      { allowed: false, reason: 'arbitrator_not_designated_or_manager' },
    ],
    [
      'the designated independent arbitrator',
      { actorIsDesignatedIndependentArbitrator: true },
      { allowed: true },
    ],
    ['an ordinary member', {}, { allowed: false, reason: 'arbitrator_not_designated_or_manager' }],
    [
      'the responsible member',
      { actorOrganizationRole: 'manager', actorIsResponsible: true },
      { allowed: false, reason: 'responsible_cannot_arbitrate_own_work' },
    ],
    [
      'the latest reviewer',
      { actorOrganizationRole: 'manager', actorIsLatestReviewer: true },
      { allowed: false, reason: 'latest_reviewer_cannot_arbitrate_own_rejection' },
    ],
  ] as const)(
    'allows arbitration for %s only when conflict-free',
    (_label, overrides, expected) => {
      expect(decideTeamTaskPermission('arbitrate', context(overrides))).toEqual(expected);
    },
  );

  it.each([
    [
      'inactive organization membership',
      { actorOrganizationMembershipActive: false },
      'actor_organization_membership_inactive',
    ],
    [
      'inactive project membership',
      { actorProjectMembershipActive: false },
      'actor_project_membership_inactive',
    ],
    ['a project viewer', { actorProjectRole: 'viewer' }, 'viewer_cannot_mutate'],
  ] as const)('denies every non-arbitration mutation for %s', (_label, overrides, reason) => {
    const actions: readonly TeamTaskAction[] = [
      'create',
      'publish',
      'assign',
      'claim',
      'edit_contract',
      'submit',
      'review',
      'appeal',
      'close',
      'archive',
    ];

    for (const action of actions) {
      expect(decideTeamTaskPermission(action, context(overrides))).toEqual({
        allowed: false,
        reason,
      });
    }
  });

  it.each([
    [
      'a manager outside the project',
      {
        actorOrganizationRole: 'manager',
        actorProjectRole: null,
        actorProjectMembershipActive: null,
      },
    ],
    [
      'the designated independent arbitrator outside the project',
      {
        actorProjectRole: null,
        actorProjectMembershipActive: null,
        actorIsDesignatedIndependentArbitrator: true,
      },
    ],
  ] as const)(
    'allows %s to arbitrate despite an inactive project membership',
    (_label, overrides) => {
      expect(decideTeamTaskPermission('arbitrate', context(overrides))).toEqual({ allowed: true });
    },
  );

  it('still denies a project viewer from arbitrating even if independently designated', () => {
    expect(
      decideTeamTaskPermission(
        'arbitrate',
        context({
          actorProjectRole: 'viewer',
          actorIsDesignatedIndependentArbitrator: true,
        }),
      ),
    ).toEqual({ allowed: false, reason: 'viewer_cannot_mutate' });
  });
});
