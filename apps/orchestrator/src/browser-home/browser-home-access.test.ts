/**
 * BROWSER-HOME-1 gradual-rollout gate: one helper for the browserHome router (refusal) and
 * auth.me's `browserHomeEnabled` (entry / route), so the two can never disagree.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { env as appEnv } from '../config/env.js';
import {
  computeBrowserHomeEnabled,
  isBrowserHomeEnabledFor,
  parseBrowserHomeAllowlist,
} from './browser-home-access.js';

const original = {
  enabled: appEnv.BROWSER_HOME_ENABLED,
  allowlist: appEnv.BROWSER_HOME_ALLOWLIST,
};
afterEach(() => {
  appEnv.BROWSER_HOME_ENABLED = original.enabled;
  appEnv.BROWSER_HOME_ALLOWLIST = original.allowlist;
});

describe('computeBrowserHomeEnabled', () => {
  const allow = new Set(['usr_boss']);
  const empty = new Set<string>();

  it('flag off → false, even on the allowlist', () => {
    expect(computeBrowserHomeEnabled(false, allow, 'usr_boss')).toBe(false);
    expect(computeBrowserHomeEnabled(false, empty, 'usr_boss')).toBe(false);
  });

  it('flag on + allowlist → only listed users', () => {
    expect(computeBrowserHomeEnabled(true, allow, 'usr_boss')).toBe(true);
    expect(computeBrowserHomeEnabled(true, allow, 'usr_other')).toBe(false);
  });

  it('flag on + empty allowlist → everyone', () => {
    expect(computeBrowserHomeEnabled(true, empty, 'usr_anyone')).toBe(true);
  });
});

describe('isBrowserHomeEnabledFor (live env)', () => {
  it('is off by default', () => {
    expect(original.enabled).toBe(false);
    expect(isBrowserHomeEnabledFor('usr_any')).toBe(false);
  });

  it('reads the CSV allowlist (trimmed, blanks ignored)', () => {
    expect([...parseBrowserHomeAllowlist(' usr_a , ,usr_b ')]).toEqual(['usr_a', 'usr_b']);
    appEnv.BROWSER_HOME_ENABLED = true;
    appEnv.BROWSER_HOME_ALLOWLIST = 'usr_a, usr_b';
    expect(isBrowserHomeEnabledFor('usr_b')).toBe(true);
    expect(isBrowserHomeEnabledFor('usr_c')).toBe(false);
    appEnv.BROWSER_HOME_ALLOWLIST = '';
    expect(isBrowserHomeEnabledFor('usr_c')).toBe(true);
  });
});
