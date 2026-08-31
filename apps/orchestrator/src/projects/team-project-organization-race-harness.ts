import { isDeepStrictEqual } from 'node:util';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { __organizationServiceInternals } from '../organizations/organization-service.js';
import {
  type MysqlBoundaryEvent,
  type MysqlBoundaryRecorder,
  type SanitizedSqlParameter,
  sqlInvocation,
} from './team-project-race-harness.js';

const compileDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
type SqlEvent = Extract<MysqlBoundaryEvent, { kind: 'sql' }>;

type ForeignReportingLineEvidenceInput = {
  recorder: MysqlBoundaryRecorder;
  requestedOrganizationId: number;
  requestedOrganizationExternalId: string;
  foreignOrganizationId: number;
  foreignOrganizationExternalId: string;
  actorUserId: number;
  localMemberExternalId: string;
  foreignMemberExternalId: string;
};

function hasColumnPredicate(sql: string, table: string, column: string): boolean {
  return sql.includes(`\`${table}\`.\`${column}\` = ?`) || sql.includes(`${table}.${column} = ?`);
}

function mentionsTable(event: SqlEvent, table: string): boolean {
  return event.normalizedSql.includes(table);
}

function requireQuery(
  condition: boolean,
  event: SqlEvent | undefined,
  expectedParameters: readonly SanitizedSqlParameter[],
  label: string,
): void {
  if (!condition || !event || !isDeepStrictEqual(event.parameters, expectedParameters)) {
    throw new Error(`unexpected ${label} query or bound parameters`);
  }
}

export function assertForeignReportingLineIsolationEvidence(
  input: ForeignReportingLineEvidenceInput,
): void {
  const events = input.recorder
    .sqlInvocations()
    .filter(
      (event) =>
        mentionsTable(event, 'organizations') || mentionsTable(event, 'organization_members'),
    );
  const expectedMemberLockQuery = __organizationServiceInternals
    .buildLockOrganizationMembersQuery(
      compileDb,
      input.requestedOrganizationId,
      [input.foreignMemberExternalId, input.localMemberExternalId].sort((left, right) =>
        left.localeCompare(right),
      ),
    )
    .toSQL();
  const expectedMemberLock = sqlInvocation(
    'execute',
    expectedMemberLockQuery.sql,
    expectedMemberLockQuery.params,
  );
  const expectedQueries = [
    __organizationServiceInternals
      .buildActiveActorMembershipQuery(
        compileDb,
        input.actorUserId,
        input.requestedOrganizationExternalId,
      )
      .toSQL(),
    __organizationServiceInternals
      .buildLockedActiveOrganizationQuery(compileDb, input.requestedOrganizationExternalId)
      .toSQL(),
    __organizationServiceInternals
      .buildLockedActiveActorMembershipQuery(compileDb, input.actorUserId, {
        id: input.requestedOrganizationId,
        externalId: input.requestedOrganizationExternalId,
      })
      .toSQL(),
    expectedMemberLockQuery,
  ].map((query) => sqlInvocation('execute', query.sql, query.params));

  for (const event of events) {
    if (
      event.parameters.some(
        (parameter) =>
          parameter.kind === 'number' && parameter.value === input.foreignOrganizationId,
      )
    ) {
      throw new Error('foreign numeric organization id appeared in reporting-line SQL parameters');
    }
    if (
      event.parameters.some(
        (parameter) =>
          parameter.kind === 'fixture-id' &&
          parameter.value === input.foreignOrganizationExternalId,
      )
    ) {
      throw new Error('foreign external organization id appeared in reporting-line SQL parameters');
    }

    const isExactMemberLock =
      event.normalizedSql === expectedMemberLock.normalizedSql &&
      isDeepStrictEqual(event.parameters, expectedMemberLock.parameters);
    if (
      !isExactMemberLock &&
      event.parameters.some(
        (parameter) =>
          parameter.kind === 'fixture-id' && parameter.value === input.foreignMemberExternalId,
      )
    ) {
      throw new Error(
        'foreign member external id appeared outside the exact scoped member-lock query',
      );
    }

    if (mentionsTable(event, 'organization_members')) {
      const externallyScoped =
        mentionsTable(event, 'organizations') &&
        hasColumnPredicate(event.normalizedSql, 'organizations', 'external_id') &&
        event.parameters.some(
          (parameter) =>
            parameter.kind === 'fixture-id' &&
            parameter.value === input.requestedOrganizationExternalId,
        );
      const numericallyScoped =
        hasColumnPredicate(event.normalizedSql, 'organization_members', 'organization_id') &&
        event.parameters.some(
          (parameter) =>
            parameter.kind === 'number' && parameter.value === input.requestedOrganizationId,
        );
      if (!externallyScoped && !numericallyScoped) {
        throw new Error('unscoped organization-member query appeared in reporting-line evidence');
      }
    }
  }

  if (events.length !== 4) {
    throw new Error(
      `reporting-line evidence recorded ${events.length} organization queries; expected 4`,
    );
  }
  const [preflight, organizationLock, actorLock, memberLock] = events;
  const [expectedPreflight, expectedOrganizationLock, expectedActorLock] = expectedQueries;
  requireQuery(
    preflight?.normalizedSql === expectedPreflight?.normalizedSql,
    preflight,
    expectedPreflight?.parameters ?? [],
    'active actor preflight',
  );
  requireQuery(
    organizationLock?.normalizedSql === expectedOrganizationLock?.normalizedSql,
    organizationLock,
    expectedOrganizationLock?.parameters ?? [],
    'organization lock',
  );
  requireQuery(
    actorLock?.normalizedSql === expectedActorLock?.normalizedSql,
    actorLock,
    expectedActorLock?.parameters ?? [],
    'actor membership lock',
  );
  requireQuery(
    Boolean(
      memberLock &&
        memberLock.normalizedSql === expectedMemberLock.normalizedSql &&
        isDeepStrictEqual(memberLock.parameters, expectedMemberLock.parameters),
    ),
    memberLock,
    expectedMemberLock.parameters,
    'scoped member lock',
  );
}
