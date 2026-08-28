import { describe, expect, it } from 'vitest';
import { canAccessVideoEditing, videoEditingCapability } from './feature-access.js';

describe('video editing feature access', () => {
  it('keeps access off unless the feature flag is explicitly enabled', () => {
    expect(canAccessVideoEditing({ enabled: false, allowlist: '' }, 'usr_one')).toBe(false);
  });

  it('fails closed when the commercial license or canary allowlist is missing', () => {
    expect(
      canAccessVideoEditing(
        { enabled: true, allowlist: 'usr_one', licenseConfigured: false },
        'usr_one',
      ),
    ).toBe(false);
    expect(
      canAccessVideoEditing({ enabled: true, allowlist: '  ', licenseConfigured: true }, 'usr_one'),
    ).toBe(false);
    expect(
      canAccessVideoEditing(
        {
          enabled: true,
          allowlist: 'usr_one',
          licenseConfigured: true,
          hostnameScopeConfigured: false,
        },
        'usr_one',
      ),
    ).toBe(false);
  });

  it('uses trimmed exact external-id matching for a non-empty canary allowlist', () => {
    const config = {
      enabled: true,
      allowlist: 'usr_one, usr_two',
      licenseConfigured: true,
      hostnameScopeConfigured: true,
    };
    expect(canAccessVideoEditing(config, 'usr_one')).toBe(true);
    expect(canAccessVideoEditing(config, 'usr_two')).toBe(true);
    expect(canAccessVideoEditing(config, 'usr')).toBe(false);
    expect(canAccessVideoEditing(config, 'USR_ONE')).toBe(false);
  });

  it('reports only the caller capability without revealing gate internals', () => {
    expect(
      videoEditingCapability(
        {
          enabled: true,
          allowlist: 'usr_canary',
          licenseConfigured: true,
          hostnameScopeConfigured: true,
        },
        'usr_other',
      ),
    ).toEqual({ enabled: false });
  });
});
