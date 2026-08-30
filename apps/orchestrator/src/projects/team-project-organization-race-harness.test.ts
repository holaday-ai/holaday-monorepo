import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import * as schema from '../db/schema/index.js';
import { __organizationServiceInternals } from '../organizations/organization-service.js';
import { assertForeignReportingLineIsolationEvidence } from './team-project-organization-race-harness.js';
import { createMysqlBoundaryRecorder, sqlInvocation } from './team-project-race-harness.js';

const compileDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
const input = {
  requestedOrganizationId: 41,
  requestedOrganizationExternalId: 'org_requested_111111111111',
  foreignOrganizationId: 99,
  foreignOrganizationExternalId: 'org_foreign_222222222222',
  actorUserId: 7,
  localMemberExternalId: 'omem_local_333333333333',
  foreignMemberExternalId: 'omem_foreign_444444444444',
};

function validRecorder(options: { preflightSuffix?: string } = {}) {
  const recorder = createMysqlBoundaryRecorder();
  const preflight = __organizationServiceInternals
    .buildActiveActorMembershipQuery(
      compileDb,
      input.actorUserId,
      input.requestedOrganizationExternalId,
    )
    .toSQL();
  recorder.recordSql(
    sqlInvocation('execute', `${preflight.sql}${options.preflightSuffix ?? ''}`, preflight.params),
  );
  const organizationLock = __organizationServiceInternals
    .buildLockedActiveOrganizationQuery(compileDb, input.requestedOrganizationExternalId)
    .toSQL();
  recorder.recordSql(sqlInvocation('execute', organizationLock.sql, organizationLock.params));
  const actorLock = __organizationServiceInternals
    .buildLockedActiveActorMembershipQuery(compileDb, input.actorUserId, {
      id: input.requestedOrganizationId,
      externalId: input.requestedOrganizationExternalId,
    })
    .toSQL();
  recorder.recordSql(sqlInvocation('execute', actorLock.sql, actorLock.params));
  const memberLock = __organizationServiceInternals
    .buildLockOrganizationMembersQuery(compileDb, input.requestedOrganizationId, [
      input.foreignMemberExternalId,
      input.localMemberExternalId,
    ])
    .toSQL();
  recorder.recordSql(sqlInvocation('execute', memberLock.sql, memberLock.params));
  return recorder;
}

describe('foreign reporting-line isolation evidence', () => {
  it('accepts the exact four-query tenant sequence and one scoped foreign-member negative lookup', () => {
    expect(() =>
      assertForeignReportingLineIsolationEvidence({ recorder: validRecorder(), ...input }),
    ).not.toThrow();
  });

  it('fails when a mutation adds a query bound to the foreign numeric organization id', () => {
    const recorder = validRecorder();
    recorder.recordSql(
      sqlInvocation(
        'execute',
        'SELECT id FROM organization_members WHERE organization_id = ? FOR UPDATE',
        [input.foreignOrganizationId],
      ),
    );

    expect(() => assertForeignReportingLineIsolationEvidence({ recorder, ...input })).toThrow(
      'foreign numeric organization id appeared in reporting-line SQL parameters',
    );
  });

  it('fails when a mutation changes one otherwise plausible query boundary', () => {
    const recorder = validRecorder({ preflightSuffix: ' AND 1 = 1' });

    expect(() => assertForeignReportingLineIsolationEvidence({ recorder, ...input })).toThrow(
      'unexpected active actor preflight query or bound parameters',
    );
  });

  it('fails when a mutation adds an unscoped organization-member query', () => {
    const recorder = validRecorder();
    recorder.recordSql(
      sqlInvocation(
        'execute',
        'SELECT id FROM organization_members WHERE external_id = ? FOR UPDATE',
        [input.localMemberExternalId],
      ),
    );

    expect(() => assertForeignReportingLineIsolationEvidence({ recorder, ...input })).toThrow(
      'unscoped organization-member query appeared in reporting-line evidence',
    );
  });

  it('fails when the foreign member external id appears outside the one scoped member lock', () => {
    const recorder = validRecorder();
    recorder.recordSql(
      sqlInvocation(
        'execute',
        `SELECT id FROM organization_members
         WHERE organization_id = ? AND external_id = ? FOR UPDATE`,
        [input.requestedOrganizationId, input.foreignMemberExternalId],
      ),
    );

    expect(() => assertForeignReportingLineIsolationEvidence({ recorder, ...input })).toThrow(
      'foreign member external id appeared outside the exact scoped member-lock query',
    );
  });
});
