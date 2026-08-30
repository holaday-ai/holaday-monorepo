import { describe, expect, it } from 'vitest';
import {
  computeTeamTaskLifecycleEnabled,
  computeTeamTaskLifecycleUserEnabled,
  parseTeamTaskLifecycleAllowlist,
} from './team-task-access.js';

describe('team task lifecycle access gate', () => {
  it.each([
    ['the phase two global flag is disabled', false, true, true, 'usr_canary', false],
    ['the phase one user gate is disabled', true, false, true, 'usr_canary', false],
    [
      'the user is missing from a non-empty phase two allowlist',
      true,
      true,
      true,
      'usr_other',
      false,
    ],
    ['the user is in a non-empty phase two allowlist', true, true, true, 'usr_canary', true],
  ] as const)(
    'returns %s for the user-level nested gate',
    (_label, phaseTwoEnabled, phaseOneEnabled, allowlistContainsUser, userExternalId, expected) => {
      const allowlist = allowlistContainsUser ? new Set(['usr_canary']) : new Set(['usr_other']);

      expect(
        computeTeamTaskLifecycleUserEnabled(
          phaseOneEnabled,
          phaseTwoEnabled,
          allowlist,
          userExternalId,
          false,
        ),
      ).toBe(expected);
    },
  );

  it('allows every phase-one eligible user for an exactly empty phase two allowlist', () => {
    const parsed = parseTeamTaskLifecycleAllowlist('');

    expect(parsed).toEqual({ allowlist: new Set(), allowAll: true });
    expect(
      computeTeamTaskLifecycleUserEnabled(
        true,
        true,
        parsed.allowlist,
        'usr_anyone',
        parsed.allowAll,
      ),
    ).toBe(true);
  });

  it.each([' ', ' usr_canary, ', 'usr_canary,,usr_other'] as const)(
    'fails closed for malformed non-empty phase two allowlist %j',
    (raw) => {
      const parsed = parseTeamTaskLifecycleAllowlist(raw);

      expect(parsed).toEqual({ allowlist: new Set(), allowAll: false });
      expect(
        computeTeamTaskLifecycleUserEnabled(
          true,
          true,
          parsed.allowlist,
          'usr_canary',
          parsed.allowAll,
        ),
      ).toBe(false);
    },
  );

  it('requires the organization team-project flag after the user-level nested gate passes', () => {
    expect(
      computeTeamTaskLifecycleEnabled(
        true,
        true,
        true,
        new Set(['usr_canary']),
        'usr_canary',
        false,
      ),
    ).toBe(true);
    expect(
      computeTeamTaskLifecycleEnabled(
        true,
        true,
        false,
        new Set(['usr_canary']),
        'usr_canary',
        false,
      ),
    ).toBe(false);
  });
});
