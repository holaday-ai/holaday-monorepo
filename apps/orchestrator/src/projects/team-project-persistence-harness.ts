import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { projectMembers } from '../db/schema/project-members.js';
import { type MysqlSqlInvocation, normalizeSql } from './team-project-race-harness.js';

const compileDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
const creatorLeadInsertSql = normalizeSql(
  compileDb
    .insert(projectMembers)
    .values({
      externalId: 'pmem_ABCDEFGHJKLMNPQRSTUV2',
      projectId: 1,
      userId: 1,
      role: 'lead',
      status: 'active',
    })
    .toSQL().sql,
);

export function matchesCreatorLeadInsertInvocation(
  invocation: Pick<MysqlSqlInvocation, 'normalizedSql' | 'parameters'>,
  input: { actorUserId: number },
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
    Number.isSafeInteger(projectId.value) &&
    projectId.value > 0 &&
    userId?.kind === 'number' &&
    userId.value === input.actorUserId &&
    role?.kind === 'sql-literal' &&
    role.value === 'lead' &&
    status?.kind === 'sql-literal' &&
    status.value === 'active'
  );
}
