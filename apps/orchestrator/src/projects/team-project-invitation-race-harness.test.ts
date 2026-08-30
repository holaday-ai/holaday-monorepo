import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import * as schema from '../db/schema/index.js';
import { __organizationInvitationServiceInternals } from '../organizations/organization-invitation-service.js';
import { assertInvitationReplayMemberWrite } from './team-project-invitation-race-harness.js';
import { createMysqlBoundaryRecorder, sqlInvocation } from './team-project-race-harness.js';

const compileDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
const acceptedAt = new Date('2026-08-30T12:00:00.000Z');
const replayInput = {
  organizationId: 41,
  actorUserId: 17,
  role: 'member' as const,
  managerUserId: null,
  acceptedAt,
};

function recordProductionCreate() {
  const recorder = createMysqlBoundaryRecorder();
  const compiled = __organizationInvitationServiceInternals
    .buildCreateInvitationMembershipQuery(compileDb, {
      externalId: 'omem_ABCDEFGHJKLMNPQRSTUV2',
      organizationId: replayInput.organizationId,
      userId: replayInput.actorUserId,
      role: replayInput.role,
      managerUserId: replayInput.managerUserId,
      joinedAt: replayInput.acceptedAt,
    })
    .toSQL();
  recorder.recordSql(sqlInvocation('execute', compiled.sql, compiled.params));
  return recorder;
}

describe('invitation replay member-write evidence', () => {
  it('accepts exactly one production-derived create on the winner and none on the loser', () => {
    const winner = recordProductionCreate();
    const loser = createMysqlBoundaryRecorder();

    expect(() =>
      assertInvitationReplayMemberWrite({ winner, loser, expectedKind: 'create', ...replayInput }),
    ).not.toThrow();
  });

  it('fails when a mutation injects an extra loser-side member write', () => {
    const winner = recordProductionCreate();
    const loser = recordProductionCreate();

    expect(() =>
      assertInvitationReplayMemberWrite({ winner, loser, expectedKind: 'create', ...replayInput }),
    ).toThrow('invitation replay loser recorded 1 member write; expected 0');
  });
});
