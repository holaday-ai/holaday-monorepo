import { isDeepStrictEqual } from 'node:util';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import {
  type MysqlSqlInvocation,
  type SqlResultOverride,
  normalizeSql,
  sqlInvocation,
} from './team-project-race-harness.js';
import { __teamProjectServiceInternals } from './team-project-service.js';

const compileDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
const creatorLeadInsertSql = normalizeSql(
  __teamProjectServiceInternals
    .buildTeamProjectCreatorMembershipInsert(compileDb, {
      externalId: 'pmem_ABCDEFGHJKLMNPQRSTUV2',
      projectId: 1,
      userId: 1,
    })
    .toSQL().sql,
);

export function createTeamProjectInsertIdCapture(input: {
  actorUserId: number;
  organizationId: number;
  name: string;
  description: string | null;
}): SqlResultOverride & { projectId(): number | undefined; requireProjectId(): number } {
  const compiled = __teamProjectServiceInternals
    .buildTeamProjectInsert(compileDb, {
      externalId: 'prj_ABCDEFGHJKLMNPQRSTUV2',
      userId: input.actorUserId,
      organizationId: input.organizationId,
      name: input.name,
      description: input.description,
    })
    .toSQL();
  const expected = sqlInvocation('execute', compiled.sql, compiled.params);
  let projectId: number | undefined;
  return {
    transform(invocation, result) {
      if (
        invocation.normalizedSql !== expected.normalizedSql ||
        !isDeepStrictEqual(invocation.parameters, expected.parameters)
      ) {
        return result;
      }
      if (projectId !== undefined)
        throw new Error('project insert boundary executed more than once');
      const header = Array.isArray(result) ? result[0] : undefined;
      const insertId =
        header && typeof header === 'object' && 'insertId' in header ? header.insertId : undefined;
      if (typeof insertId !== 'number' || !Number.isSafeInteger(insertId) || insertId <= 0) {
        throw new Error('project insert did not return one authoritative positive insert id');
      }
      projectId = insertId;
      return result;
    },
    projectId() {
      return projectId;
    },
    requireProjectId() {
      if (projectId === undefined) throw new Error('project insert boundary was not observed');
      return projectId;
    },
  };
}

export function matchesCreatorLeadInsertInvocation(
  invocation: Pick<MysqlSqlInvocation, 'normalizedSql' | 'parameters'>,
  input: { actorUserId: number; projectId: number },
): boolean {
  if (invocation.normalizedSql !== creatorLeadInsertSql || invocation.parameters.length !== 5) {
    return false;
  }
  const [externalId, projectId, userId, role, status] = invocation.parameters;
  return (
    externalId?.kind === 'generated-external-id' &&
    externalId.prefix === 'pmem' &&
    externalId.length === 26 &&
    projectId?.kind === 'number' &&
    projectId.value === input.projectId &&
    userId?.kind === 'number' &&
    userId.value === input.actorUserId &&
    role?.kind === 'sql-literal' &&
    role.value === 'lead' &&
    status?.kind === 'sql-literal' &&
    status.value === 'active'
  );
}
