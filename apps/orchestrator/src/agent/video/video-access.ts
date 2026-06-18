// Phase 1 #4 — video-creation gradual-rollout access gate.
//
// SINGLE SOURCE OF TRUTH for "can this user reach video creation", shared
// by the tasks.ts video fork (backend reject) AND auth.me's `videoEnabled`
// (frontend entry/route gate). Keeping them on one helper guarantees the UI
// never shows the「视频任务」entry / /video page to a user the backend would
// reject — the two gates can't drift.

import { env as appEnv } from '../../config/env.js';

/**
 * Allowlist of user externalIds for the video-creation gradual rollout
 * (VIDEO_CREATION_ALLOWLIST, CSV in env). Empty = all users (widen). Non-
 * empty = only the listed users.
 */
export const VIDEO_CREATION_ALLOWLIST: ReadonlySet<string> = new Set(
  (appEnv.VIDEO_CREATION_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * Pure gate logic (no env read, unit-testable): enabled iff the flag is on
 * AND (the allowlist is empty = all, OR the user is on it).
 */
export function computeVideoEnabled(
  enabled: boolean,
  allowlist: ReadonlySet<string>,
  userExternalId: string,
): boolean {
  if (!enabled) return false;
  return allowlist.size === 0 || allowlist.has(userExternalId);
}

/**
 * Whether video creation is enabled AND reachable for this user. Mirrors
 * the backend fork gate in tasks.ts exactly; auth.me exposes it as
 * `videoEnabled` so the SPA hides the entry / guards /video.
 */
export function isVideoEnabledFor(userExternalId: string): boolean {
  return computeVideoEnabled(
    appEnv.VIDEO_CREATION_ENABLED,
    VIDEO_CREATION_ALLOWLIST,
    userExternalId,
  );
}
