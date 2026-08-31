// Team-task lifecycle is a Phase 2 rollout nested beneath the Phase 1 team
// project gate. Keep parsing and decisions pure so every consumer shares the
// same fail-closed behavior without reading environment variables itself.

import { isExternalId } from '@holaday/shared-types';
import { env as appEnv } from '../config/env.js';
import { isTeamProjectsEnabledFor } from '../organizations/team-project-access.js';

export type ParsedTeamTaskLifecycleAllowlist = {
  allowlist: ReadonlySet<string>;
  /** True only for the exact empty env value, which intentionally means all. */
  allowAll: boolean;
};

/** Parse CSV without widening access when a non-empty value is malformed. */
export function parseTeamTaskLifecycleAllowlist(raw: string): ParsedTeamTaskLifecycleAllowlist {
  if (raw === '') return { allowlist: new Set(), allowAll: true };

  const entries = raw.split(',').map((value) => value.trim());
  if (entries.some((entry) => entry === '' || !isExternalId(entry, 'user'))) {
    return { allowlist: new Set(), allowAll: false };
  }

  return { allowlist: new Set(entries), allowAll: false };
}

/**
 * User-level portion of the nested Phase 2 rollout. This is safe for auth.me:
 * it never claims organization access because no organization has been chosen.
 */
export function computeTeamTaskLifecycleUserEnabled(
  teamProjectsEnabled: boolean,
  teamTaskLifecycleEnabled: boolean,
  allowlist: ReadonlySet<string>,
  userExternalId: string,
  allowAll: boolean,
): boolean {
  if (!teamProjectsEnabled || !teamTaskLifecycleEnabled) return false;
  return allowAll || allowlist.has(userExternalId);
}

/**
 * Full Phase 2 gate for organization-scoped services. Team-task routes must
 * supply the persisted organization flag; personal projects never pass it.
 */
export function computeTeamTaskLifecycleEnabled(
  teamProjectsEnabled: boolean,
  teamTaskLifecycleEnabled: boolean,
  organizationTeamProjectsEnabled: boolean,
  allowlist: ReadonlySet<string>,
  userExternalId: string,
  allowAll: boolean,
): boolean {
  return (
    organizationTeamProjectsEnabled === true &&
    computeTeamTaskLifecycleUserEnabled(
      teamProjectsEnabled,
      teamTaskLifecycleEnabled,
      allowlist,
      userExternalId,
      allowAll,
    )
  );
}

const parsedTeamTaskLifecycleAllowlist = parseTeamTaskLifecycleAllowlist(
  appEnv.TEAM_TASK_LIFECYCLE_ALLOWLIST ?? '',
);
export const TEAM_TASK_LIFECYCLE_ALLOWLIST = parsedTeamTaskLifecycleAllowlist.allowlist;

/** Nested user/global eligibility for auth.me and other context-free callers. */
export function isTeamTaskLifecycleEnabledForUser(userExternalId: string): boolean {
  return computeTeamTaskLifecycleUserEnabled(
    isTeamProjectsEnabledFor(userExternalId),
    appEnv.TEAM_TASK_LIFECYCLE_ENABLED,
    TEAM_TASK_LIFECYCLE_ALLOWLIST,
    userExternalId,
    parsedTeamTaskLifecycleAllowlist.allowAll,
  );
}

/** Full nested eligibility for organization-scoped lifecycle services. */
export function isTeamTaskLifecycleEnabledFor(
  userExternalId: string,
  organizationTeamProjectsEnabled: boolean,
): boolean {
  return (
    organizationTeamProjectsEnabled === true && isTeamTaskLifecycleEnabledForUser(userExternalId)
  );
}
