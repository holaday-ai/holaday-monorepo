// Team project workspace gradual-rollout access gate.
//
// Keep the pure decision separate from environment parsing so the access rule
// can be tested without process-wide configuration. Consumers should call the
// runtime helper rather than parsing the flag or allowlist themselves.

import { env as appEnv } from '../config/env.js';

export type ParsedTeamProjectsAllowlist = {
  allowlist: ReadonlySet<string>;
  /** True only for the exact empty env value, which intentionally means all. */
  allowAll: boolean;
};

/** Parse the CSV without widening access when a non-empty value is malformed. */
export function parseTeamProjectsAllowlist(raw: string): ParsedTeamProjectsAllowlist {
  if (raw === '') return { allowlist: new Set(), allowAll: true };

  const entries = raw.split(',').map((value) => value.trim());
  if (entries.some((entry) => entry === '')) {
    return { allowlist: new Set(), allowAll: false };
  }

  return { allowlist: new Set(entries), allowAll: false };
}

/**
 * Allowlist of user externalIds for the team project workspace rollout.
 * Empty = all users when the global flag is enabled.
 */
const parsedTeamProjectsAllowlist = parseTeamProjectsAllowlist(appEnv.TEAM_PROJECTS_ALLOWLIST ?? '');
export const TEAM_PROJECTS_ALLOWLIST = parsedTeamProjectsAllowlist.allowlist;

/**
 * Pure gate logic: enabled iff the global flag is on and either the allowlist
 * is empty or the user is included in it.
 */
export function computeTeamProjectsEnabled(
  enabled: boolean,
  allowlist: ReadonlySet<string>,
  userExternalId: string,
  allowAll = allowlist.size === 0,
): boolean {
  if (!enabled) return false;
  return allowAll || allowlist.has(userExternalId);
}

/** Whether team project workspaces are enabled and reachable for this user. */
export function isTeamProjectsEnabledFor(userExternalId: string): boolean {
  return computeTeamProjectsEnabled(
    appEnv.TEAM_PROJECTS_ENABLED,
    TEAM_PROJECTS_ALLOWLIST,
    userExternalId,
    parsedTeamProjectsAllowlist.allowAll,
  );
}
