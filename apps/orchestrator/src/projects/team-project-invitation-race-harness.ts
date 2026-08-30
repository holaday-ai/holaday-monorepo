import { isDeepStrictEqual } from 'node:util';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { __organizationInvitationServiceInternals } from '../organizations/organization-invitation-service.js';
import type { OrganizationRole } from '../organizations/organization-permissions.js';
import {
  type MysqlBoundaryEvent,
  type MysqlBoundaryRecorder,
  sqlInvocation,
} from './team-project-race-harness.js';

const compileDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
const COMPILE_ONLY_MEMBERSHIP_EXTERNAL_ID = 'omem_ABCDEFGHJKLMNPQRSTUV2';

type ReplayMemberWriteInput = {
  winner: MysqlBoundaryRecorder;
  loser: MysqlBoundaryRecorder;
  organizationId: number;
  actorUserId: number;
  role: Exclude<OrganizationRole, 'owner'>;
  managerUserId: number | null;
  acceptedAt: Date;
} & ({ expectedKind: 'create' } | { expectedKind: 'reactivate'; existingMembershipId: number });

type SqlEvent = Extract<MysqlBoundaryEvent, { kind: 'sql' }>;

export function assertInvitationReplayMemberWrite(input: ReplayMemberWriteInput): void {
  const createQuery = __organizationInvitationServiceInternals
    .buildCreateInvitationMembershipQuery(compileDb, {
      externalId: COMPILE_ONLY_MEMBERSHIP_EXTERNAL_ID,
      organizationId: input.organizationId,
      userId: input.actorUserId,
      role: input.role,
      managerUserId: input.managerUserId,
      joinedAt: input.acceptedAt,
    })
    .toSQL();
  const reactivateQuery = __organizationInvitationServiceInternals
    .buildReactivateInvitationMembershipQuery(
      compileDb,
      input.expectedKind === 'reactivate' ? input.existingMembershipId : 1,
      {
        role: input.role,
        managerUserId: input.managerUserId,
        joinedAt: input.acceptedAt,
      },
    )
    .toSQL();
  const expectedCreate = sqlInvocation('execute', createQuery.sql, createQuery.params);
  const expectedReactivate = sqlInvocation('execute', reactivateQuery.sql, reactivateQuery.params);
  const classify = (event: SqlEvent): 'create' | 'reactivate' | undefined => {
    if (event.normalizedSql === expectedCreate.normalizedSql) return 'create';
    if (event.normalizedSql === expectedReactivate.normalizedSql) return 'reactivate';
    return undefined;
  };
  const writes = (recorder: MysqlBoundaryRecorder) =>
    recorder
      .sqlInvocations()
      .map((event) => ({ event, kind: classify(event) }))
      .filter(
        (write): write is { event: SqlEvent; kind: 'create' | 'reactivate' } =>
          write.kind !== undefined,
      );

  const winnerWrites = writes(input.winner);
  const loserWrites = writes(input.loser);
  if (loserWrites.length !== 0) {
    throw new Error(
      `invitation replay loser recorded ${loserWrites.length} member write; expected 0`,
    );
  }
  if (winnerWrites.length !== 1) {
    throw new Error(
      `invitation replay winner recorded ${winnerWrites.length} member writes; expected 1`,
    );
  }
  const [winnerWrite] = winnerWrites;
  if (!winnerWrite || winnerWrite.kind !== input.expectedKind) {
    throw new Error(`invitation replay winner did not record the expected ${input.expectedKind}`);
  }
  const expected = input.expectedKind === 'create' ? expectedCreate : expectedReactivate;
  if (!isDeepStrictEqual(winnerWrite.event.parameters, expected.parameters)) {
    throw new Error(`invitation replay winner ${input.expectedKind} parameters did not match`);
  }
}
