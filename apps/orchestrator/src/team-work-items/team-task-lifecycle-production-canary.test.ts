import { newExternalId } from '@holaday/shared-types';
import { describe, expect, it, vi } from 'vitest';
import {
  LIFECYCLE_CANARY_SCENARIOS,
  type LifecycleCanaryManifest,
  lifecycleCanaryBoundaryDigestForScopes,
} from './team-task-lifecycle-canary-runner.js';
import {
  __teamTaskLifecycleProductionCanaryInternals,
  createTeamTaskLifecycleProductionCanary,
} from './team-task-lifecycle-production-canary.js';

function manifest(): LifecycleCanaryManifest {
  const users = {
    creatorApprover: newExternalId('user'),
    claimantA: newExternalId('user'),
    claimantB: newExternalId('user'),
    arbitrator: newExternalId('user'),
  };
  const scope = () => ({
    organizationId: newExternalId('organization'),
    projectId: newExternalId('project'),
    actors: Object.fromEntries(
      Object.entries(users).map(([role, userId]) => [
        role,
        {
          userId,
          organizationMemberId: newExternalId('organizationMember'),
          projectMemberId: newExternalId('projectMember'),
        },
      ]),
    ) as LifecycleCanaryManifest['scopes'][number]['actors'],
  });
  const scopes: LifecycleCanaryManifest['scopes'] = [scope(), scope()];
  const boundaryDigest = lifecycleCanaryBoundaryDigestForScopes(scopes);
  const attestation = (operatorSlot: 'primary' | 'secondary', confirmedAt: string) => ({
    schemaVersion: 1 as const,
    source: 'holaday-team-task-lifecycle-operator-attestation-v1' as const,
    operatorSlot,
    operatorPrincipal: `ops:${operatorSlot}-human`,
    boundaryDigest,
    confirmedAt,
    confirmedSyntheticBoundary: true as const,
    signature: Buffer.alloc(64, operatorSlot === 'primary' ? 1 : 2).toString('base64'),
  });
  return {
    schemaVersion: 1,
    source: 'holaday-team-task-lifecycle-canary-manifest-v1',
    confirmation: {
      source: 'holaday-team-task-lifecycle-dual-operator-confirmation-v1',
      boundaryDigest,
      primaryAttestation: attestation('primary', '2026-08-31T05:00:00.000Z'),
      secondaryAttestation: attestation('secondary', '2026-08-31T05:05:00.000Z'),
      distinctHumanOperatorsConfirmed: true,
    },
    scopes,
  };
}

describe('team task lifecycle production canary adapter', () => {
  it('requires exactly four distinct actors shared across exactly two organizations', async () => {
    const boundary = vi.fn(async () => true);
    const adapter = __teamTaskLifecycleProductionCanaryInternals.createAdapter({
      validatePersistedBoundary: boundary,
      smoke: async () => ({ personalProjects: true, teamProjects: true, filePath: true }),
      scenarios: Object.fromEntries(
        LIFECYCLE_CANARY_SCENARIOS.map((name) => [name, async () => true]),
      ) as never,
    });
    const valid = manifest();

    await expect(adapter.validateBoundary(valid)).resolves.toBe(true);
    expect(boundary).toHaveBeenCalledTimes(1);

    const invalid = manifest();
    invalid.scopes[0].actors.claimantB = invalid.scopes[0].actors.claimantA;
    await expect(adapter.validateBoundary(invalid)).resolves.toBe(false);
    expect(boundary).toHaveBeenCalledTimes(1);
  });

  it('validates non-login identities and every persisted user/member/project mapping', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            activeUsers: 4,
            nonLoginUsers: 4,
            activeOrganizations: 2,
            boundedProjects: 2,
            outsideOrganizationMemberships: 0,
            outsideProjectMemberships: 0,
          },
        ],
      ])
      .mockResolvedValueOnce([[{ exactMappings: 8 }]]);
    const adapter = createTeamTaskLifecycleProductionCanary({
      db: {} as never,
      pool: { execute },
    });

    await expect(adapter.validateBoundary(manifest())).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(String(execute.mock.calls[0]?.[0])).toContain("u.password_hash = ''");
    expect(String(execute.mock.calls[1]?.[0])).toContain('pm.external_id = ?');
  });

  it('maps every fixed receipt scenario and returns booleans only', async () => {
    const called: string[] = [];
    const scenarios = Object.fromEntries(
      LIFECYCLE_CANARY_SCENARIOS.map((name) => [
        name,
        async () => {
          called.push(name);
          return true;
        },
      ]),
    ) as never;
    const adapter = __teamTaskLifecycleProductionCanaryInternals.createAdapter({
      validatePersistedBoundary: async () => true,
      smoke: async () => ({ personalProjects: true, teamProjects: true, filePath: true }),
      scenarios,
    });
    const input = manifest();

    for (const name of LIFECYCLE_CANARY_SCENARIOS) {
      await expect(adapter.executeScenario(name, input)).resolves.toBe(true);
    }

    expect(called).toEqual(LIFECYCLE_CANARY_SCENARIOS);
    expect(JSON.stringify(called)).not.toContain(input.scopes[0].actors.creatorApprover.userId);
  });

  it('turns business assertion failures into false and rethrows infrastructure failures', async () => {
    const businessFailure = Object.assign(new Error('redacted'), { code: 'CONFLICT' });
    const infrastructureFailure = new Error('database unavailable');
    const adapter = __teamTaskLifecycleProductionCanaryInternals.createAdapter({
      validatePersistedBoundary: async () => true,
      smoke: async () => ({ personalProjects: true, teamProjects: true, filePath: true }),
      scenarios: {
        ...Object.fromEntries(LIFECYCLE_CANARY_SCENARIOS.map((name) => [name, async () => true])),
        directLifecycle: async () => {
          throw businessFailure;
        },
        firstComeRace: async () => {
          throw infrastructureFailure;
        },
      } as never,
    });

    await expect(adapter.executeScenario('directLifecycle', manifest())).resolves.toBe(false);
    await expect(adapter.executeScenario('firstComeRace', manifest())).rejects.toBe(
      infrastructureFailure,
    );
  });

  it('always restores an inactive synthetic project member even when the mutation fails', async () => {
    const events: string[] = [];
    let rejectMutation: ((error: unknown) => void) | undefined;
    const result = await __teamTaskLifecycleProductionCanaryInternals.runInactiveCommitRace({
      makeInactiveAndHold: async () => {
        events.push('inactive');
      },
      beginMutation: async () => {
        events.push('mutation');
        return new Promise((_resolve, reject) => {
          rejectMutation = reject;
        });
      },
      waitForBlockedMutation: async () => {
        events.push('wait');
      },
      commitInactive: async () => {
        events.push('commit');
        rejectMutation?.(Object.assign(new Error('hidden'), { code: 'NOT_FOUND' }));
      },
      rollbackInactive: async () => {
        events.push('rollback');
      },
      restoreActive: async () => {
        events.push('restore');
      },
    });

    expect(result).toBe(true);
    expect(events.at(-1)).toBe('restore');
  });

  it('does not mistake an immediate rejection for a blocked membership mutation', async () => {
    const result = await __teamTaskLifecycleProductionCanaryInternals.runInactiveCommitRace({
      makeInactiveAndHold: async () => undefined,
      beginMutation: async () => {
        throw Object.assign(new Error('hidden'), { code: 'NOT_FOUND' });
      },
      waitForBlockedMutation: async () => {
        await Promise.resolve();
      },
      commitInactive: async () => undefined,
      rollbackInactive: async () => undefined,
      restoreActive: async () => undefined,
    });

    expect(result).toBe(false);
  });

  it('requires a database lock-timeout window for the exact inactive membership probe', async () => {
    const events: string[] = [];
    const clock = [1_000, 2_000];
    const result = await __teamTaskLifecycleProductionCanaryInternals.runInactiveLockTimeoutProbe({
      makeInactiveAndHold: async () => {
        events.push('inactive');
      },
      beginMutation: async () => {
        events.push('mutation');
        throw Object.assign(new Error('hidden'), { code: 'CONFLICT' });
      },
      rollbackInactive: async () => {
        events.push('rollback');
      },
      now: () => clock.shift() ?? 2_000,
    });

    expect(result).toBe(true);
    expect(events).toEqual(['inactive', 'mutation', 'rollback']);
  });

  it('requires rejected inactive mutations to leave work items and idempotency events unchanged', () => {
    const before = { workItems: 0, events: 0, planningEvents: 0 };
    expect(
      __teamTaskLifecycleProductionCanaryInternals.rejectedCreationCountsUnchanged(before, {
        ...before,
      }),
    ).toBe(true);
    expect(
      __teamTaskLifecycleProductionCanaryInternals.rejectedCreationCountsUnchanged(before, {
        ...before,
        events: 1,
      }),
    ).toBe(false);
  });

  it('rolls back an uncommitted inactive transaction before restoring membership', async () => {
    const events: string[] = [];
    await expect(
      __teamTaskLifecycleProductionCanaryInternals.runInactiveCommitRace({
        makeInactiveAndHold: async () => {
          events.push('inactive');
        },
        beginMutation: async () => {
          events.push('mutation');
          return true;
        },
        waitForBlockedMutation: async () => {
          events.push('wait');
        },
        commitInactive: async () => {
          events.push('commit');
          throw new Error('commit failed');
        },
        rollbackInactive: async () => {
          events.push('rollback');
        },
        restoreActive: async () => {
          events.push('restore');
        },
      }),
    ).rejects.toThrow('commit failed');
    expect(events.slice(-2)).toEqual(['rollback', 'restore']);
  });

  it('selects only completed synthetic support tasks with recorded worker execution', async () => {
    const input = manifest();
    const execute = vi.fn(async (_sql: string, _values?: unknown[]) => [
      [{ taskId: 'tsk_completed_worker_task' }],
    ]);

    await expect(
      __teamTaskLifecycleProductionCanaryInternals.findSyntheticSupportTask({ execute }, input),
    ).resolves.toBe('tsk_completed_worker_task');

    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).toContain("t.status = 'completed'");
    expect(sql).not.toContain('partial_success');
    expect(sql).toContain('INNER JOIN llm_calls');
  });

  it('requires the exact expected business rejection code', async () => {
    const rejection = (code: string) =>
      Promise.reject(Object.assign(new Error('hidden'), { code }));

    await expect(
      __teamTaskLifecycleProductionCanaryInternals.expectedBusinessCode(
        rejection('CONFLICT'),
        'CONFLICT',
      ),
    ).resolves.toBe(true);
    await expect(
      __teamTaskLifecycleProductionCanaryInternals.expectedBusinessCode(
        rejection('NOT_FOUND'),
        'CONFLICT',
      ),
    ).resolves.toBe(false);
  });

  it('compares replayed receipts semantically when MySQL JSON changes object key order', () => {
    expect(
      __teamTaskLifecycleProductionCanaryInternals.sameReceipt(
        { command: 'appeal', version: 8, nested: { state: 'revision_requested', accepted: null } },
        { nested: { accepted: null, state: 'revision_requested' }, version: 8, command: 'appeal' },
      ),
    ).toBe(true);
  });

  it('does not write an AI contribution without an explicitly confirmed synthetic fixture', async () => {
    const record = vi.fn(async () => true);
    await expect(
      __teamTaskLifecycleProductionCanaryInternals.runAiBoundaryScenario(manifest(), record),
    ).resolves.toBe(true);
    expect(record).toHaveBeenCalledOnce();
    record.mockClear();
    await expect(
      __teamTaskLifecycleProductionCanaryInternals.runAiBoundaryScenario(
        { ...manifest(), confirmation: null } as never,
        record,
      ),
    ).resolves.toBe(false);
    expect(record).not.toHaveBeenCalled();
  });

  it('exposes the fixed public factory without doing work during construction', () => {
    const adapter = createTeamTaskLifecycleProductionCanary({
      db: {} as never,
      pool: {} as never,
    });
    expect(Object.keys(adapter).sort()).toEqual(['executeScenario', 'smoke', 'validateBoundary']);
  });
});
