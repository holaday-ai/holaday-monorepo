import { describe, expect, it } from 'vitest';
import { storedBrowserSessionPolicy } from './browser-session-recovery.js';
import { sessionPolicyOf } from './types.js';

describe('D17-P1-01 session policy helpers', () => {
  it('allocation: only an explicit vault_allowed may load a session (fail closed)', () => {
    expect(sessionPolicyOf({ sessionPolicy: 'vault_allowed' })).toBe('vault_allowed');
    expect(sessionPolicyOf({ sessionPolicy: 'anonymous' })).toBe('anonymous');
    expect(sessionPolicyOf({})).toBe('anonymous');
    expect(sessionPolicyOf(undefined)).toBe('anonymous');
    expect(sessionPolicyOf({ sessionPolicy: 'anything' as never })).toBe('anonymous');
  });
  it('stored task policy: anonymous stays anonymous; only pre-policy rows keep vault access', () => {
    expect(storedBrowserSessionPolicy({ browserSessionPolicy: 'anonymous' })).toBe('anonymous');
    expect(storedBrowserSessionPolicy({ browserSessionPolicy: 'vault_allowed' })).toBe(
      'vault_allowed',
    );
    expect(storedBrowserSessionPolicy({ browserSessionPolicy: 'unknown' })).toBe('anonymous');
    expect(storedBrowserSessionPolicy({ browserSource: 'local-chrome' })).toBe('vault_allowed');
    expect(storedBrowserSessionPolicy(null)).toBe('vault_allowed');
  });
});
