import { drizzle } from 'drizzle-orm/mysql2';
import type { Connection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import * as schema from '../db/schema/index.js';
import { __organizationInvitationServiceInternals } from '../organizations/organization-invitation-service.js';
import { assertInvitationReplayMemberWrite } from './team-project-invitation-race-harness.js';
import {
  createMysqlBoundaryRecorder,
  createMysqlRaceEndpoint,
  instrumentMysqlConnection,
  sqlInvocation,
} from './team-project-race-harness.js';

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

  it.each(['create', 'reactivate'] as const)(
    'counts a production %s that reaches mysql2 and rejects as a loser write attempt',
    async (kind) => {
      const existingMembershipId = 73;
      const compiled =
        kind === 'create'
          ? __organizationInvitationServiceInternals
              .buildCreateInvitationMembershipQuery(compileDb, {
                externalId: 'omem_ABCDEFGHJKLMNPQRSTUV2',
                organizationId: replayInput.organizationId,
                userId: replayInput.actorUserId,
                role: replayInput.role,
                managerUserId: replayInput.managerUserId,
                joinedAt: replayInput.acceptedAt,
              })
              .toSQL()
          : __organizationInvitationServiceInternals
              .buildReactivateInvitationMembershipQuery(compileDb, existingMembershipId, {
                role: replayInput.role,
                managerUserId: replayInput.managerUserId,
                joinedAt: replayInput.acceptedAt,
              })
              .toSQL();
      const loser = createMysqlBoundaryRecorder();
      const connection = instrumentMysqlConnection(
        {
          execute: async (_sql?: unknown, _parameters?: readonly unknown[]) => {
            throw new Error(`${kind} delegate rejected after receiving SQL`);
          },
        },
        [],
        [],
        loser,
      );

      await expect(connection.execute(compiled.sql, compiled.params)).rejects.toThrow(
        `${kind} delegate rejected after receiving SQL`,
      );
      const expectedInvocation = sqlInvocation('execute', compiled.sql, compiled.params);
      expect(loser.sqlInvocations()).toEqual([
        expect.objectContaining({
          normalizedSql: expectedInvocation.normalizedSql,
          parameters: expectedInvocation.parameters,
          outcome: 'rejected',
        }),
      ]);
      expect(() => {
        if (kind === 'create') {
          assertInvitationReplayMemberWrite({
            winner: createMysqlBoundaryRecorder(),
            loser,
            expectedKind: 'create',
            ...replayInput,
          });
          return;
        }
        assertInvitationReplayMemberWrite({
          winner: createMysqlBoundaryRecorder(),
          loser,
          expectedKind: 'reactivate',
          existingMembershipId,
          ...replayInput,
        });
      }).toThrow('invitation replay loser recorded 1 member write; expected 0');
    },
  );

  it.each(['create', 'reactivate'] as const)(
    'records one pending then rejected production %s through the Drizzle mysql2 query path without error details',
    async (kind) => {
      const existingMembershipId = 73;
      const sentinel = `task14-round4-${kind}-secret-token-9f4d66f8`;
      let notifyQueryReceived = () => {};
      const queryReceived = new Promise<void>((resolve) => {
        notifyQueryReceived = resolve;
      });
      let rejectQuery = (_error: Error): void => {};
      const queryResult = new Promise<never>((_resolve, reject) => {
        rejectQuery = reject;
      });
      let queryCalls = 0;
      const endpoint = createMysqlRaceEndpoint({
        connection: {
          query: (_sql?: unknown, _parameters?: readonly unknown[]) => {
            queryCalls += 1;
            notifyQueryReceived();
            return queryResult;
          },
        },
        checkpoints: [],
      });
      const db = drizzle(endpoint.connection as unknown as Connection, {
        schema,
        mode: 'default',
        casing: 'snake_case',
      });
      const write =
        kind === 'create'
          ? __organizationInvitationServiceInternals.buildCreateInvitationMembershipQuery(db, {
              externalId: 'omem_ABCDEFGHJKLMNPQRSTUV2',
              organizationId: replayInput.organizationId,
              userId: replayInput.actorUserId,
              role: replayInput.role,
              managerUserId: replayInput.managerUserId,
              joinedAt: replayInput.acceptedAt,
            })
          : __organizationInvitationServiceInternals.buildReactivateInvitationMembershipQuery(
              db,
              existingMembershipId,
              {
                role: replayInput.role,
                managerUserId: replayInput.managerUserId,
                joinedAt: replayInput.acceptedAt,
              },
            );
      const operation = write.execute();
      const exposedOutcome = operation.then(
        () => ({ status: 'fulfilled' as const }),
        () => ({ status: 'rejected' as const }),
      );

      await queryReceived;
      expect(queryCalls).toBe(1);
      expect(endpoint.recorder.sqlInvocations()).toHaveLength(1);
      const [pendingEvent] = endpoint.recorder.sqlInvocations();
      expect(pendingEvent).toMatchObject({ method: 'query', outcome: 'pending' });

      rejectQuery(new Error(sentinel));
      const outcome = await exposedOutcome;
      expect(outcome).toEqual({ status: 'rejected' });
      expect(endpoint.recorder.sqlInvocations()).toHaveLength(1);
      const [rejectedEvent] = endpoint.recorder.sqlInvocations();
      expect(rejectedEvent).toBe(pendingEvent);
      expect(rejectedEvent).toMatchObject({ method: 'query', outcome: 'rejected' });
      expect(
        Reflect.ownKeys(rejectedEvent ?? {})
          .map(String)
          .sort(),
      ).toEqual(['kind', 'method', 'normalizedSql', 'outcome', 'parameters']);

      const exposedEvidence = JSON.stringify({ events: endpoint.recorder.events, outcome });
      expect(exposedEvidence).not.toContain(sentinel);
      expect(exposedEvidence).not.toMatch(/"(?:error|message|stack)"\s*:/);
      expect(() => {
        if (kind === 'create') {
          assertInvitationReplayMemberWrite({
            winner: createMysqlBoundaryRecorder(),
            loser: endpoint.recorder,
            expectedKind: 'create',
            ...replayInput,
          });
          return;
        }
        assertInvitationReplayMemberWrite({
          winner: createMysqlBoundaryRecorder(),
          loser: endpoint.recorder,
          expectedKind: 'reactivate',
          existingMembershipId,
          ...replayInput,
        });
      }).toThrow('invitation replay loser recorded 1 member write; expected 0');
    },
  );
});
