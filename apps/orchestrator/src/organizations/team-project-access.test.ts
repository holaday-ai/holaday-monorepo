import { describe, expect, it } from 'vitest';
import { computeTeamProjectsEnabled } from './team-project-access.js';

describe('team projects access gate', () => {
  it('stays off when the global flag is disabled', () => {
    expect(computeTeamProjectsEnabled(false, new Set(['usr_a']), 'usr_a')).toBe(false);
  });

  it('allows an allowlisted user when the global flag is enabled', () => {
    expect(computeTeamProjectsEnabled(true, new Set(['usr_a']), 'usr_a')).toBe(true);
  });

  it('rejects a non-allowlisted user when the global flag is enabled', () => {
    expect(computeTeamProjectsEnabled(true, new Set(['usr_a']), 'usr_b')).toBe(false);
  });

  it('allows all users when enabled with an empty allowlist', () => {
    expect(computeTeamProjectsEnabled(true, new Set(), 'usr_b')).toBe(true);
  });
});
