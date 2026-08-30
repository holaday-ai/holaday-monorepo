import { describe, expect, it } from 'vitest';
import {
  computeTeamTaskLifecycleEnabled,
  computeTeamTaskLifecycleUserEnabled,
  parseTeamTaskLifecycleAllowlist,
} from './team-task-access.js';

const canaryUserId = 'usr_EeYpvsvLtyDzN4VLQi7BT';
const secondUserId = 'usr_AbCdEfGhJkLmNpQrStUv2';

describe('team task lifecycle access gate', () => {
  it.each([
    ['the phase two global flag is disabled', false, true, true, canaryUserId, false],
    ['the phase one user gate is disabled', true, false, true, canaryUserId, false],
    [
      'the user is missing from a non-empty phase two allowlist',
      true,
      true,
      true,
      secondUserId,
      false,
    ],
    ['the user is in a non-empty phase two allowlist', true, true, true, canaryUserId, true],
  ] as const)(
    'returns %s for the user-level nested gate',
    (_label, phaseTwoEnabled, phaseOneEnabled, allowlistContainsUser, userExternalId, expected) => {
      const allowlist = allowlistContainsUser ? new Set([canaryUserId]) : new Set([secondUserId]);

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
        canaryUserId,
        parsed.allowAll,
      ),
    ).toBe(true);
  });

  it.each([
    [canaryUserId, [canaryUserId]],
    [`${canaryUserId},${secondUserId}`, [canaryUserId, secondUserId]],
  ] as const)('accepts canonical user IDs in a configured allowlist', (raw, expectedIds) => {
    const parsed = parseTeamTaskLifecycleAllowlist(raw);

    expect(parsed).toEqual({ allowlist: new Set(expectedIds), allowAll: false });
    for (const userExternalId of expectedIds) {
      expect(
        computeTeamTaskLifecycleUserEnabled(
          true,
          true,
          parsed.allowlist,
          userExternalId,
          parsed.allowAll,
        ),
      ).toBe(true);
    }
  });

  it.each([
    ' ',
    ` ${canaryUserId}, `,
    `${canaryUserId},,${secondUserId}`,
    `${canaryUserId},not-a-user-id`,
    'tsk_EeYpvsvLtyDzN4VLQi7BT',
    'usr_short',
  ] as const)('fails closed for malformed non-empty phase two allowlist %j', (raw) => {
    const parsed = parseTeamTaskLifecycleAllowlist(raw);

    expect(parsed).toEqual({ allowlist: new Set(), allowAll: false });
    expect(
      computeTeamTaskLifecycleUserEnabled(
        true,
        true,
        parsed.allowlist,
        canaryUserId,
        parsed.allowAll,
      ),
    ).toBe(false);
  });

  it('does not infer allow-all from a malformed empty set', () => {
    expect(computeTeamTaskLifecycleUserEnabled(true, true, new Set(), canaryUserId, false)).toBe(
      false,
    );
  });

  it('requires the organization team-project flag after the user-level nested gate passes', () => {
    expect(
      computeTeamTaskLifecycleEnabled(
        true,
        true,
        true,
        new Set([canaryUserId]),
        canaryUserId,
        false,
      ),
    ).toBe(true);
    expect(
      computeTeamTaskLifecycleEnabled(
        true,
        true,
        false,
        new Set([canaryUserId]),
        canaryUserId,
        false,
      ),
    ).toBe(false);
  });
});
