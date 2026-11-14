// BROWSER-HOME-1 — gradual-rollout gate for the「云浏览器」entry.
//
// SINGLE SOURCE OF TRUTH for "can this user reach the cloud-browser home", shared by the
// browserHome router (backend refusal) AND auth.me's `browserHomeEnabled` (frontend entry/route
// gate), so the UI never shows the entry to a user the backend would refuse. Same shape as
// agent/video/video-access.ts.

import { env as appEnv } from '../config/env.js';

/**
 * Allowlist of user externalIds (BROWSER_HOME_ALLOWLIST, CSV in env). Empty = all users (widen).
 * Non-empty = only the listed users.
 */
export function parseBrowserHomeAllowlist(csv: string | undefined): ReadonlySet<string> {
  return new Set(
    (csv ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Pure gate logic (no env read, unit-testable): enabled iff the flag is on AND (the allowlist is
 * empty = all, OR the user is on it).
 */
export function computeBrowserHomeEnabled(
  enabled: boolean,
  allowlist: ReadonlySet<string>,
  userExternalId: string,
): boolean {
  if (!enabled) return false;
  return allowlist.size === 0 || allowlist.has(userExternalId);
}

/**
 * Whether the cloud-browser home is enabled AND reachable for this user. Reads the env on every
 * call (the CSV is tiny), so the router and auth.me always agree with the live config.
 */
export function isBrowserHomeEnabledFor(userExternalId: string): boolean {
  return computeBrowserHomeEnabled(
    appEnv.BROWSER_HOME_ENABLED,
    parseBrowserHomeAllowlist(appEnv.BROWSER_HOME_ALLOWLIST),
    userExternalId,
  );
}
