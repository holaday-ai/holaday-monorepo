/**
 * Video gradual-rollout gate. The pure `computeVideoEnabled` is the single
 * source for both the tasks.ts fork (backend reject) and auth.me's
 * `videoEnabled` (frontend entry/route hide), so the UI can never show the
 * video page to a user the backend would reject. Locks all four states.
 */
import { describe, expect, it } from 'vitest';
import { computeVideoEnabled } from './video-access.js';

describe('computeVideoEnabled — video gradual-rollout gate', () => {
  const boss = 'usr_boss';
  const allow = new Set([boss]);
  const empty = new Set<string>();

  it('flag OFF → false (even if on the allowlist) — video invisible', () => {
    expect(computeVideoEnabled(false, allow, boss)).toBe(false);
    expect(computeVideoEnabled(false, empty, boss)).toBe(false);
  });

  it('flag ON + in allowlist → true (the BOSS-only 灰度 case)', () => {
    expect(computeVideoEnabled(true, allow, boss)).toBe(true);
  });

  it('flag ON + NOT in allowlist → false (名单外用户彻底不可见)', () => {
    expect(computeVideoEnabled(true, allow, 'usr_other')).toBe(false);
  });

  it('flag ON + empty allowlist → true for anyone (widen = all)', () => {
    expect(computeVideoEnabled(true, empty, boss)).toBe(true);
    expect(computeVideoEnabled(true, empty, 'usr_anyone')).toBe(true);
  });
});
