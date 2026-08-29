// Team project workspace gradual-rollout access gate.
//
// Keep the pure decision separate from environment parsing so the access rule
// can be tested without process-wide configuration. Consumers should call the
// runtime helper rather than parsing the flag or allowlist themselves.

import { env as appEnv } from '../config/env.js';

/**
 * Allowlist of user externalIds for the team project workspace rollout.
 * Empty = all users when the global flag is enabled.
 */
export const TEAM_PROJECTS_ALLOWLIST: ReadonlySet<string> = new Set(
  (appEnv.TEAM_PROJECTS_ALLOWLIST ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

/**
 * Pure gate logic: enabled iff the global flag is on and either the allowlist
 * is empty or the user is included in it.
 */
export function computeTeamProjectsEnabled(
  enabled: boolean,
  allowlist: ReadonlySet<string>,
  userExternalId: string,
): boolean {
  if (!enabled) return false;
  return allowlist.size === 0 || allowlist.has(userExternalId);
}

/** Whether team project workspaces are enabled and reachable for this user. */
export function isTeamProjectsEnabledFor(userExternalId: string): boolean {
  return computeTeamProjectsEnabled(
    appEnv.TEAM_PROJECTS_ENABLED,
    TEAM_PROJECTS_ALLOWLIST,
    userExternalId,
  );
}
