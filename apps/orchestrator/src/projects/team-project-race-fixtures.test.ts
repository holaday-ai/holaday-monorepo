import { describe, expect, it } from 'vitest';
import {
  TASK14_RACE_FIXTURE_PLANS,
  buildIntegrationFixtureExternalId,
  enumerateTask14FixtureExternalIds,
  task14FixtureExternalId,
} from './team-project-race-fixtures.js';

const expectedCases = [
  'invitation-replay',
  'accept-first',
  'revoke-first',
  'organization-disable-accept',
  'report-first-demotion',
  'demotion-first-report',
  'report-first-deactivation',
  'deactivation-first-report',
  'owner-demotion-first',
  'owner-deactivation-first',
  'owner-zero-row-rollback',
  'local-target-foreign-manager',
  'foreign-target-local-manager',
  'project-list-versus-create',
  'project-get-versus-deactivation',
  'project-roster-versus-deactivation',
  'deactivation-first-project-removal',
  'project-removal-first-deactivation',
] as const;

describe('Task14 deterministic integration fixture ids', () => {
  it('enumerates every declared fixture id for all 18 race cases without a per-table collision', () => {
    expect(TASK14_RACE_FIXTURE_PLANS.map((plan) => plan.caseName)).toEqual(expectedCases);

    const entries = enumerateTask14FixtureExternalIds();
    expect(entries).toHaveLength(140);
    expect(
      Object.fromEntries(
        [...new Set(entries.map((entry) => entry.table))].map((table) => [
          table,
          entries.filter((entry) => entry.table === table).length,
        ]),
      ),
    ).toEqual({
      users: 47,
      organizations: 20,
      organization_members: 43,
      organization_invitations: 4,
      projects: 8,
      project_members: 18,
    });

    for (const table of new Set(entries.map((entry) => entry.table))) {
      const ids = entries.filter((entry) => entry.table === table).map((entry) => entry.externalId);
      expect(new Set(ids).size, table).toBe(ids.length);
    }
    for (const entry of entries) {
      expect(
        entry.externalId.length,
        `${entry.caseName}/${entry.table}/${entry.key}`,
      ).toBeGreaterThan(0);
      expect(
        entry.externalId.length,
        `${entry.caseName}/${entry.table}/${entry.key}`,
      ).toBeLessThanOrEqual(32);
      expect(entry.externalId).toMatch(/_[0-9a-f]{12}$/);
    }
  });

  it('reserves the deterministic hash suffix when long readable prefixes share their first 32 characters', () => {
    const first = buildIntegrationFixtureExternalId(
      'local-target-foreign-manager',
      'users',
      'actor-with-a-very-long-shared-prefix-a',
    );
    const second = buildIntegrationFixtureExternalId(
      'local-target-foreign-manager',
      'users',
      'actor-with-a-very-long-shared-prefix-b',
    );

    expect(first).not.toBe(second);
    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first.slice(-13)).not.toBe(second.slice(-13));
  });

  it('rejects an undeclared fixture key so integration call sites cannot escape enumeration', () => {
    expect(() => task14FixtureExternalId('invitation-replay', 'users', 'undeclared')).toThrow(
      'undeclared Task14 fixture id',
    );
  });
});
