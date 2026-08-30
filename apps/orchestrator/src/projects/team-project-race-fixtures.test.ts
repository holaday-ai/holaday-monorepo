import { describe, expect, it } from 'vitest';
import {
  TASK14_RACE_FIXTURE_PLANS,
  buildIntegrationFixtureExternalId,
  enumerateTask14FixtureExternalIds,
  task14FixtureExternalId,
} from './team-project-race-fixtures.js';
import { sqlInvocation } from './team-project-race-harness.js';

const expectedCases = [
  'invitation-replay',
  'accept-first',
  'revoke-first',
  'organization-disable-accept',
  'organization-disable-create-invitation',
  'organization-disable-revoke-invitation',
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
  it('enumerates every declared fixture id for all 20 race cases without a per-table collision', () => {
    expect(TASK14_RACE_FIXTURE_PLANS.map((plan) => plan.caseName)).toEqual(expectedCases);

    const entries = enumerateTask14FixtureExternalIds();
    expect(entries).toHaveLength(150);
    expect(
      Object.fromEntries(
        [...new Set(entries.map((entry) => entry.table))].map((table) => [
          table,
          entries.filter((entry) => entry.table === table).length,
        ]),
      ),
    ).toEqual({
      users: 51,
      organizations: 22,
      organization_members: 45,
      organization_invitations: 6,
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
      expect(entry.externalId).toMatch(
        /^(?:usr|org|omem|oinv|prj|pmem)_[a-z0-9]+(?:_[a-z0-9]+)*_[0-9a-f]{12}$/,
      );
    }
  });

  it('keeps all 150 manifest ids as exact production-sanitized fixture evidence', () => {
    const entries = enumerateTask14FixtureExternalIds();

    for (const entry of entries) {
      expect(
        sqlInvocation('execute', 'SELECT ?', [entry.externalId]).parameters,
        `${entry.caseName}/${entry.table}/${entry.key}`,
      ).toEqual([{ kind: 'fixture-id', value: entry.externalId }]);
    }
  });

  it('keeps requested and foreign organization evidence distinguishable in the long inverse case', () => {
    const organizations = enumerateTask14FixtureExternalIds().filter(
      (entry) =>
        entry.caseName === 'foreign-target-local-manager' && entry.table === 'organizations',
    );
    const requested = organizations.find((entry) => entry.key === 'requested');
    const foreign = organizations.find((entry) => entry.key === 'foreign');
    if (!requested || !foreign) throw new Error('missing inverse foreign organization fixtures');

    expect(requested.externalId).not.toBe(foreign.externalId);
    expect(
      sqlInvocation('execute', 'SELECT ? AS requested_id, ? AS foreign_id', [
        requested.externalId,
        foreign.externalId,
      ]).parameters,
    ).toEqual([
      { kind: 'fixture-id', value: requested.externalId },
      { kind: 'fixture-id', value: foreign.externalId },
    ]);
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
