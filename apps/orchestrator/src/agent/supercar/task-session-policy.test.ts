import { describe, expect, it } from 'vitest';
import { deriveTaskSessionPolicy } from './user-browser-routing.js';

describe('deriveTaskSessionPolicy (FIX-INTENT-ROUTE-BROWSER)', () => {
  it.each([
    [
      'public task, cloud route',
      false,
      false,
      { lane: 'cloud', reason: 'public_site' },
      'anonymous',
    ],
    [
      'public task, legacy route',
      false,
      false,
      { lane: 'legacy', reason: 'flag_off' },
      'anonymous',
    ],
    [
      'identity task, explicit public cloud',
      true,
      true,
      { lane: 'cloud', reason: 'explicit_public_cloud' },
      'anonymous',
    ],
    [
      'identity task, route promises no login',
      true,
      false,
      { lane: 'cloud', reason: 'x', sessionPolicy: 'anonymous' as const },
      'anonymous',
    ],
    [
      'identity task, vault route',
      true,
      false,
      { lane: 'cloud', reason: 'vault_session' },
      'vault_allowed',
    ],
  ] as const)('%s → %s', (_name, identityRequired, publicCloudRequested, route, expected) => {
    expect(deriveTaskSessionPolicy({ identityRequired, publicCloudRequested, route })).toBe(
      expected,
    );
  });
});
