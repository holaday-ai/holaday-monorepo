import { describe, expect, it } from 'vitest';
import { canAccessVideoEditing, videoEditingCapability } from './feature-access.js';

describe('video editing feature access', () => {
  it('keeps access off unless the feature flag is explicitly enabled', () => {
    expect(canAccessVideoEditing({ enabled: false, allowlist: '' }, 'usr_one')).toBe(false);
  });

  it('allows every authenticated user when enabled with an empty allowlist', () => {
    expect(canAccessVideoEditing({ enabled: true, allowlist: '  ' }, 'usr_one')).toBe(true);
  });

  it('uses trimmed exact external-id matching for a non-empty canary allowlist', () => {
    const config = { enabled: true, allowlist: 'usr_one, usr_two' };
    expect(canAccessVideoEditing(config, 'usr_one')).toBe(true);
    expect(canAccessVideoEditing(config, 'usr_two')).toBe(true);
    expect(canAccessVideoEditing(config, 'usr')).toBe(false);
    expect(canAccessVideoEditing(config, 'USR_ONE')).toBe(false);
  });

  it('reports only the caller capability without revealing gate internals', () => {
    expect(
      videoEditingCapability(
        { enabled: true, allowlist: 'usr_canary', licenseConfigured: true },
        'usr_other',
      ),
    ).toEqual({ enabled: false });
  });
});
