import { describe, expect, it } from 'vitest';
import {
  type EvidenceAiTransaction,
  type EvidenceBindingRow,
  type EvidencePackageBindingDto,
  type EvidencePreflightSnapshot,
  type EvidenceSourceRow,
  type TeamAiContributionRow,
  type TeamTaskEvidenceRepository,
  TeamTaskEvidenceService,
  type TeamTaskEvidenceServiceDependencies,
  TeamTaskEvidenceServiceError,
  type TeamTaskEvidenceTargetRow,
} from './team-task-evidence-service.js';
import type { TeamTaskEventRow, TeamTaskProjectAccessSnapshot } from './team-task-service.js';

const now = new Date('2026-08-31T00:00:00.000Z');
const externalId = (prefix: string, fill: string) => `${prefix}_${fill.repeat(21)}`;

const ids = {
  actor: externalId('usr', 'a'),
  other: externalId('usr', 'b'),
  project: externalId('prj', 'p'),
  workItem: externalId('twi', 'w'),
  artifact: externalId('art', 'r'),
  taskFile: externalId('file', 'f'),
  executionTask: externalId('tsk', 'x'),
  binding: externalId('teb', 'e'),
  contribution: externalId('tai', 'i'),
  event: externalId('twe', 'v'),
} as const;

function access(): TeamTaskProjectAccessSnapshot {
  return {
    actorUserId: 11,
    actorExternalId: ids.actor,
    actorOrganizationRole: 'member',
    actorOrganizationMembershipActive: true,
    actorProjectRole: 'member',
    actorProjectMembershipActive: true,
    organizationId: 21,
    organizationExternalId: externalId('org', 'o'),
    organizationActive: true,
    organizationTeamProjectsEnabled: true,
    projectId: 31,
    projectExternalId: ids.project,
    projectOrganizationId: 21,
  };
}

function workItem() {
  return {
    id: 41,
    externalId: ids.workItem,
    organizationId: 21,
    projectId: 31,
    status: 'in_progress' as const,
    version: 7,
    currentContractVersionId: 501,
  };
}

class FakeRepository implements TeamTaskEvidenceRepository, EvidenceAiTransaction {
  readonly access = access();
  readonly workItem = workItem();
  readonly events: TeamTaskEventRow[] = [];
  readonly bindings: EvidenceBindingRow[] = [];
  readonly contributions: TeamAiContributionRow[] = [];
  readonly targets = new Map<string, TeamTaskEvidenceTargetRow>([
    [
      externalId('tsb', 's'),
      {
        kind: 'submission',
        id: 71,
        externalId: externalId('tsb', 's'),
        organizationId: 21,
        projectId: 31,
        workItemId: 41,
      },
    ],
  ]);
  readonly sources = new Map<string, EvidenceSourceRow>([
    [
      ids.artifact,
      {
        kind: 'evidenceArtifact',
        id: 51,
        externalId: ids.artifact,
        ownerUserId: 11,
        taskId: 61,
        taskProjectId: 31,
        taskUserId: 11,
        expiresAt: new Date('2026-09-30T00:00:00.000Z'),
        ownerOrganizationMembershipActive: true,
        ownerProjectMembershipActive: true,
        ownerProjectRole: 'member',
      },
    ],
    [
      ids.taskFile,
      {
        kind: 'taskFile',
        id: 52,
        externalId: ids.taskFile,
        ownerUserId: 11,
        taskId: 61,
        taskProjectId: 31,
        taskUserId: 11,
        status: 'active',
        expiresAt: new Date('2026-09-30T00:00:00.000Z'),
        ownerOrganizationMembershipActive: true,
        ownerProjectMembershipActive: true,
        ownerProjectRole: 'member',
      },
    ],
  ]);
  executionTask = {
    id: 61,
    externalId: ids.executionTask,
    projectId: 31,
    userId: 11,
    status: 'completed',
    origin: 'user',
    updatedAt: new Date('2026-08-31T00:00:00.000Z'),
    opusUsed: true,
    ownerOrganizationMembershipActive: true,
    ownerProjectMembershipActive: true,
    ownerProjectRole: 'member',
    result: { summary: 'immutable execution result' },
    completedAt: new Date('2026-08-30T23:59:00.000Z'),
  };
  actorAcceptedAssignmentRole: 'responsible' | 'collaborator' | null = 'responsible';
  executionSnapshot = {
    taskFileCount: 1,
    evidenceArtifactCount: 1,
    llmCallCount: 2,
    inputTokens: 120,
    outputTokens: 80,
    cacheReadTokens: 10,
    cacheWriteTokens: 5,
    latencyMs: 900,
  };
  preflightSnapshot: EvidencePreflightSnapshot = {
    contract: {
      id: 501,
      organizationId: 21,
      projectId: 31,
      workItemId: 41,
      objective: '交付可核验结果',
      deliverables: ['报告'],
      criteria: [{ id: 'quality', description: '质量达标' }],
      requiredEvidenceTypes: [{ type: 'source_document' }],
      confirmedByUserId: 11,
      confirmedAt: new Date('2026-08-30T00:00:00.000Z'),
    },
    evidenceBindings: [{ evidenceType: 'source_document', sourceValid: true }],
  };
  nextBindingId = 100;
  nextContributionId = 200;
  failAppend = false;
  transactionFailure: unknown = null;
  unsafeBinding: unknown = null;

  async transaction<T>(work: (tx: EvidenceAiTransaction) => Promise<T>): Promise<T> {
    if (this.transactionFailure) throw this.transactionFailure;
    const snapshot = {
      events: structuredClone(this.events),
      bindings: structuredClone(this.bindings),
      contributions: structuredClone(this.contributions),
    };
    try {
      return await work(this);
    } catch (error) {
      this.events.splice(0, this.events.length, ...snapshot.events);
      this.bindings.splice(0, this.bindings.length, ...snapshot.bindings);
      this.contributions.splice(0, this.contributions.length, ...snapshot.contributions);
      throw error;
    }
  }

  async lockWorkItemAccess(actorExternalId: string, workItemExternalId: string) {
    if (actorExternalId !== ids.actor || workItemExternalId !== ids.workItem) return null;
    return {
      access: this.access,
      workItem: this.workItem,
      actorAcceptedAssignmentRole: this.actorAcceptedAssignmentRole,
    };
  }

  async lockOrganizationIdempotencyScope(organizationId: number) {
    return organizationId === 21;
  }

  async hasPlanningEventByIdempotencyKey() {
    return false;
  }

  async findEventByIdempotencyKey(organizationId: number, idempotencyKey: string) {
    return (
      this.events.find(
        (event) =>
          event.organizationId === organizationId && event.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async lockEvidenceSource(kind: EvidenceSourceRow['kind'], sourceExternalId: string) {
    const source = this.sources.get(sourceExternalId);
    return source?.kind === kind ? source : null;
  }

  async hasSourceOwnerSharedWithWorkItem(input: {
    workItemId: number;
    ownerUserId: number;
    sourceKind: EvidenceSourceRow['kind'];
    sourceId: number;
  }) {
    return this.bindings.some(
      (row) =>
        row.workItemId === input.workItemId &&
        row.boundByUserId === input.ownerUserId &&
        row.sourceKind === input.sourceKind &&
        (input.sourceKind === 'evidenceArtifact'
          ? row.evidenceArtifactId === input.sourceId
          : row.taskFileId === input.sourceId),
    );
  }

  async lockTarget(
    kind: TeamTaskEvidenceTargetRow['kind'],
    workItemId: number,
    externalId: string,
  ) {
    const row = this.targets.get(externalId);
    return row?.kind === kind && row.workItemId === workItemId ? row : null;
  }

  async findEquivalentBinding(input: Omit<EvidenceBindingRow, 'id' | 'externalId' | 'createdAt'>) {
    return (
      this.bindings.find(
        (row) =>
          row.organizationId === input.organizationId &&
          row.projectId === input.projectId &&
          row.workItemId === input.workItemId &&
          row.submissionId === input.submissionId &&
          row.reviewId === input.reviewId &&
          row.appealId === input.appealId &&
          row.aiContributionId === input.aiContributionId &&
          row.evidenceArtifactId === input.evidenceArtifactId &&
          row.taskFileId === input.taskFileId &&
          row.controlledExternalRef === input.controlledExternalRef,
      ) ?? null
    );
  }

  async insertEvidenceBinding(row: Omit<EvidenceBindingRow, 'id'>) {
    const id = this.nextBindingId++;
    this.bindings.push({ ...structuredClone(row), id });
    return id;
  }

  async lockExecutionTask(externalId: string) {
    return externalId === ids.executionTask ? this.executionTask : null;
  }

  async deriveAiExecutionSnapshot() {
    return structuredClone(this.executionSnapshot);
  }

  async findContributionByExecutionTask(executionTaskId: number) {
    return this.contributions.find((row) => row.executionTaskId === executionTaskId) ?? null;
  }

  async lockAiContribution(externalId: string) {
    return this.contributions.find((row) => row.externalId === externalId) ?? null;
  }

  async insertAiContribution(row: Omit<TeamAiContributionRow, 'id'>) {
    const id = this.nextContributionId++;
    this.contributions.push({ ...structuredClone(row), id });
    return id;
  }

  async updateAiContribution(
    id: number,
    expectedStatus: 'pending',
    update: Pick<
      TeamAiContributionRow,
      'humanConfirmationStatus' | 'humanChangesSummary' | 'confirmedAt'
    >,
  ) {
    const row = this.contributions.find(
      (contribution) =>
        contribution.id === id && contribution.humanConfirmationStatus === expectedStatus,
    );
    if (!row) return false;
    Object.assign(row, structuredClone(update));
    return true;
  }

  async listEvidencePackage() {
    return {
      bindings:
        this.unsafeBinding === null
          ? this.bindings.map((row) => ({
              id: row.externalId,
              source: {
                kind: row.sourceKind,
                ...(row.sourceKind === 'evidenceArtifact'
                  ? { sourceId: ids.artifact }
                  : row.sourceKind === 'taskFile'
                    ? { sourceId: ids.taskFile }
                    : {}),
              },
              target: { kind: 'workItem' as const },
              metadata: structuredClone(row.metadata),
              createdAt: row.createdAt.toISOString(),
            }))
          : [this.unsafeBinding as EvidencePackageBindingDto],
      contributions: this.contributions.map((row) => ({
        id: row.externalId,
        executionTaskId: row.executionTaskExternalId,
        requestedScope: row.requestedScope,
        inputSourceSummary: structuredClone(row.inputSourceSummary),
        resultVersion: row.resultVersion,
        usageSnapshot: structuredClone(row.usageSnapshot),
        humanConfirmationStatus: row.humanConfirmationStatus,
        humanChangesSummary: row.humanChangesSummary,
        unverifiedRisks: structuredClone(row.unverifiedRisks),
        createdAt: row.createdAt.toISOString(),
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
      })),
    };
  }

  async loadPreflightSnapshot() {
    return structuredClone(this.preflightSnapshot);
  }

  async appendEvent(event: TeamTaskEventRow) {
    if (this.failAppend) throw new Error('event write failed');
    this.events.push(structuredClone(event));
  }
}

function createHarness(
  repository = new FakeRepository(),
  overrides: Partial<TeamTaskEvidenceServiceDependencies> = {},
) {
  let bindingSequence = 0;
  let contributionSequence = 0;
  let eventSequence = 0;
  const dependencies: TeamTaskEvidenceServiceDependencies = {
    now: () => now.toISOString(),
    isLifecycleEnabled: () => true,
    newId: (kind) => {
      if (kind === 'teamEvidenceBinding') {
        bindingSequence += 1;
        return bindingSequence === 1 ? ids.binding : externalId('teb', String(bindingSequence));
      }
      if (kind === 'teamAiContribution') {
        contributionSequence += 1;
        return contributionSequence === 1
          ? ids.contribution
          : externalId('tai', String(contributionSequence));
      }
      eventSequence += 1;
      return eventSequence === 1 ? ids.event : externalId('twe', String(eventSequence));
    },
    ...overrides,
  };
  const rawService = new TeamTaskEvidenceService(repository, dependencies);
  const versioned = (input: unknown) =>
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? { expectedVersion: repository.workItem.version, ...input }
      : input;
  const service = {
    bindEvidence: (input: unknown) => rawService.bindEvidence(versioned(input)),
    recordAiContribution: (input: unknown) => rawService.recordAiContribution(versioned(input)),
    confirmAiContribution: (input: unknown) => rawService.confirmAiContribution(versioned(input)),
    getEvidencePackage: (input: unknown) => rawService.getEvidencePackage(input),
    preflight: (input: unknown) => rawService.preflight(input),
  };
  return { repository, rawService, service };
}

function expectCode(error: unknown, code: string) {
  expect(error).toBeInstanceOf(TeamTaskEvidenceServiceError);
  expect((error as TeamTaskEvidenceServiceError).code).toBe(code);
}

describe('TeamTaskEvidenceService core', () => {
  it('requires expectedVersion on every evidence mutation', async () => {
    const { rawService } = createHarness();
    await expect(
      rawService.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'missing-evidence-version',
        source: { kind: 'evidenceArtifact', evidenceArtifactId: ids.artifact },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'INVALID_INPUT');
      return true;
    });
  });

  it('rejects stale evidence mutations when the router supplies expectedVersion', async () => {
    const { service } = createHarness();

    await expect(
      service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        expectedVersion: 6,
        idempotencyKey: 'stale-evidence-version',
        source: { kind: 'evidenceArtifact', evidenceArtifactId: ids.artifact },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'CONFLICT');
      return true;
    });
  });

  it('requires exactly one evidence source kind', async () => {
    const { service } = createHarness();

    await expect(
      service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'evidence-source-none',
        source: {},
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'INVALID_INPUT');
      return true;
    });
    await expect(
      service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'evidence-source-many',
        source: {
          kind: 'evidenceArtifact',
          evidenceArtifactId: ids.artifact,
          taskFileId: ids.taskFile,
        },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'INVALID_INPUT');
      return true;
    });

    const receipt = await service.bindEvidence({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      idempotencyKey: 'evidence-source-one',
      source: { kind: 'evidenceArtifact', evidenceArtifactId: ids.artifact },
    });
    expect(receipt).toMatchObject({
      command: 'bind_evidence',
      evidenceBindingId: ids.binding,
      workItemId: ids.workItem,
      sourceKind: 'evidenceArtifact',
      state: 'in_progress',
      version: 7,
    });
  });

  it('binds one explicit target only when its full lineage matches the work item', async () => {
    const { repository, service } = createHarness();
    const submissionId = externalId('tsb', 's');

    const receipt = await service.bindEvidence({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      idempotencyKey: 'submission-evidence',
      source: { kind: 'evidenceArtifact', evidenceArtifactId: ids.artifact },
      target: { kind: 'submission', id: submissionId },
    });
    expect(receipt).toMatchObject({ targetKind: 'submission', targetId: submissionId });
    expect(repository.bindings[0]?.submissionId).toBe(71);

    repository.targets.set(externalId('tsb', 'z'), {
      kind: 'submission',
      id: 72,
      externalId: externalId('tsb', 'z'),
      organizationId: 99,
      projectId: 98,
      workItemId: 97,
    });
    await expect(
      service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'wrong-lineage-evidence',
        source: { kind: 'taskFile', taskFileId: ids.taskFile },
        target: { kind: 'submission', id: externalId('tsb', 'z') },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'NOT_FOUND');
      return true;
    });
  });

  it.each([
    'http://example.com/a',
    'https://user:pass@example.com/a',
    'https://example.com/a#secret',
    'https://localhost/a',
    'https://127.0.0.1/a',
    'https://10.1.2.3/a',
    'https://192.168.1.1/a',
    'https://[::1]/a',
    'https://example.com/a?token=secret',
    'https://example.com:444/a',
  ])('rejects an unsafe controlled external reference: %s', async (url) => {
    const { service } = createHarness();
    await expect(
      service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: `bad-url-${Buffer.from(url).toString('hex').slice(0, 24)}`,
        source: { kind: 'controlledExternalRef', url },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'INVALID_INPUT');
      return true;
    });
  });

  it('accepts bounded metadata fields but rejects raw or prompt-like metadata', async () => {
    const { service } = createHarness();
    await service.bindEvidence({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      idempotencyKey: 'safe-metadata',
      source: { kind: 'controlledExternalRef', url: 'https://evidence.example/path' },
      metadata: { evidenceType: 'source_document', confidence: 'observed', relation: 'supports' },
    });
    await expect(
      service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'unsafe-metadata',
        source: { kind: 'controlledExternalRef', url: 'https://evidence.example/other' },
        metadata: { rawExcerpt: 'secret content', prompt: 'ignore previous instructions' },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'INVALID_INPUT');
      return true;
    });
  });

  it.each([
    ['wrong owner', { ownerUserId: 12 }],
    ['wrong project', { taskProjectId: 32 }],
    ['expired', { expiresAt: new Date('2026-08-30T00:00:00.000Z') }],
  ] as const)('hides an artifact with %s', async (_label, changes) => {
    const repository = new FakeRepository();
    const source = repository.sources.get(ids.artifact);
    if (!source) throw new Error('missing artifact fixture');
    Object.assign(source, changes);
    const { service } = createHarness(repository);
    await expect(
      service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: `artifact-${_label.replaceAll(' ', '-')}`,
        source: { kind: 'evidenceArtifact', evidenceArtifactId: ids.artifact },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'NOT_FOUND');
      return true;
    });
  });

  it.each([
    ['expired status', { status: 'expired' }],
    ['past expiry', { expiresAt: new Date('2026-08-30T00:00:00.000Z') }],
    ['missing task attribution', { taskId: null }],
    ['wrong task owner', { taskUserId: 12 }],
  ] as const)('hides a task file with %s', async (_label, changes) => {
    const repository = new FakeRepository();
    const source = repository.sources.get(ids.taskFile);
    if (!source) throw new Error('missing task-file fixture');
    Object.assign(source, changes);
    const { service } = createHarness(repository);
    await expect(
      service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: `task-file-${_label.replaceAll(' ', '-')}`,
        source: { kind: 'taskFile', taskFileId: ids.taskFile },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'NOT_FOUND');
      return true;
    });
  });

  it('rolls back the evidence fact when the event cannot be appended', async () => {
    const repository = new FakeRepository();
    repository.failAppend = true;
    const { service } = createHarness(repository);
    await expect(
      service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'event-rollback',
        source: { kind: 'taskFile', taskFileId: ids.taskFile },
      }),
    ).rejects.toThrow('event write failed');
    expect(repository.bindings).toHaveLength(0);
  });

  it('denies disabled, viewer, and missing membership contexts before source reads', async () => {
    const disabled = createHarness(new FakeRepository(), { isLifecycleEnabled: () => false });
    await expect(
      disabled.service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'disabled',
        source: { kind: 'taskFile', taskFileId: ids.taskFile },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'NOT_FOUND');
      return true;
    });
    const viewerRepository = new FakeRepository();
    viewerRepository.access.actorProjectRole = 'viewer';
    const viewer = createHarness(viewerRepository);
    await expect(
      viewer.service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'viewer',
        source: { kind: 'taskFile', taskFileId: ids.taskFile },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'FORBIDDEN');
      return true;
    });
  });

  it('records AI contribution facts without completing or accepting the work item', async () => {
    const { repository, service } = createHarness();
    const before = structuredClone(repository.workItem);

    const receipt = await service.recordAiContribution({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      executionTaskId: ids.executionTask,
      requestedScope: '整理已完成任务的可核验结果',
      idempotencyKey: 'record-ai-isolated',
    });

    expect(receipt).toMatchObject({
      command: 'record_ai_contribution',
      aiContributionId: ids.contribution,
      humanConfirmationStatus: 'pending',
      state: 'in_progress',
      version: 7,
    });
    expect(repository.workItem).toEqual(before);
    expect(repository.contributions).toHaveLength(1);
    expect(repository.contributions[0]?.humanConfirmationStatus).toBe('pending');
  });

  it('replays the same actor-bound idempotency key and rejects changed input', async () => {
    const { repository, service } = createHarness();
    const input = {
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      idempotencyKey: 'same-bind-key',
      source: { kind: 'taskFile', taskFileId: ids.taskFile },
    } as const;

    const first = await service.bindEvidence(input);
    const replay = await service.bindEvidence(structuredClone(input));

    expect(replay).toEqual(first);
    expect(repository.bindings).toHaveLength(1);
    expect(repository.events).toHaveLength(1);
    await expect(
      service.bindEvidence({
        ...input,
        source: { kind: 'evidenceArtifact', evidenceArtifactId: ids.artifact },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'CONFLICT');
      return true;
    });
  });

  it('fails closed instead of replaying a corrupted event receipt', async () => {
    const { repository, service } = createHarness();
    const input = {
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      idempotencyKey: 'corrupt-receipt',
      source: { kind: 'taskFile', taskFileId: ids.taskFile },
    } as const;
    await service.bindEvidence(input);
    const event = repository.events[0];
    if (!event || typeof event.metadata !== 'object' || event.metadata === null) {
      throw new Error('missing event fixture');
    }
    const receipt = (event.metadata as { receipt?: Record<string, unknown> }).receipt;
    if (!receipt) throw new Error('missing receipt fixture');
    receipt.state = 'forged_state';

    await expect(service.bindEvidence(input)).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'CONFLICT');
      return true;
    });
  });

  it('allows only one equivalent binding across competing different keys', async () => {
    const { service } = createHarness();
    const base = {
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      source: { kind: 'taskFile', taskFileId: ids.taskFile },
    } as const;
    await service.bindEvidence({ ...base, idempotencyKey: 'different-key-a' });
    await expect(
      service.bindEvidence({ ...base, idempotencyKey: 'different-key-b' }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'CONFLICT');
      return true;
    });
  });

  it('maps database lock conflicts to the stable domain conflict code', async () => {
    const repository = new FakeRepository();
    repository.transactionFailure = { code: 'ER_LOCK_DEADLOCK' };
    const { service } = createHarness(repository);
    await expect(
      service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'lock-conflict',
        source: { kind: 'taskFile', taskFileId: ids.taskFile },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'CONFLICT');
      return true;
    });
  });

  it('rejects an execution task outside the actor/project lineage', async () => {
    const repository = new FakeRepository();
    repository.executionTask.userId = 99;
    const { service } = createHarness(repository);
    await expect(
      service.recordAiContribution({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        executionTaskId: ids.executionTask,
        requestedScope: '整理结果',
        idempotencyKey: 'wrong-execution-lineage',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'NOT_FOUND');
      return true;
    });
  });

  it('replays AI creation and permits only one contribution per execution task', async () => {
    const { repository, service } = createHarness();
    const input = {
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      executionTaskId: ids.executionTask,
      requestedScope: '整理结果',
      idempotencyKey: 'ai-replay',
    } as const;
    const first = await service.recordAiContribution(input);
    expect(await service.recordAiContribution(structuredClone(input))).toEqual(first);
    expect(repository.contributions).toHaveLength(1);
    await expect(
      service.recordAiContribution({ ...input, idempotencyKey: 'ai-different-key' }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'CONFLICT');
      return true;
    });
  });

  it('rolls back an AI contribution when the event append fails', async () => {
    const repository = new FakeRepository();
    repository.failAppend = true;
    const { service } = createHarness(repository);
    await expect(
      service.recordAiContribution({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        executionTaskId: ids.executionTask,
        requestedScope: '整理结果',
        idempotencyKey: 'ai-event-rollback',
      }),
    ).rejects.toThrow('event write failed');
    expect(repository.contributions).toHaveLength(0);
  });

  it.each([
    ['confirmed', null],
    ['modified', '人工修正了日期与来源标注'],
    ['rejected', null],
  ] as const)(
    'updates AI confirmation to %s without mutating the work item',
    async (status, summary) => {
      const { repository, service } = createHarness();
      await service.recordAiContribution({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        executionTaskId: ids.executionTask,
        requestedScope: '整理结果',
        idempotencyKey: `create-${status}`,
      });
      const before = structuredClone(repository.workItem);

      const receipt = await service.confirmAiContribution({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        aiContributionId: ids.contribution,
        status,
        humanChangesSummary: summary,
        idempotencyKey: `confirm-${status}`,
      });

      expect(receipt).toMatchObject({
        command: 'confirm_ai_contribution',
        humanConfirmationStatus: status,
        state: 'in_progress',
        version: 7,
      });
      expect(repository.workItem).toEqual(before);
      expect(repository.contributions[0]?.humanConfirmationStatus).toBe(status);
    },
  );

  it('replays AI confirmation and rolls it back when its event fails', async () => {
    const { service } = createHarness();
    await service.recordAiContribution({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      executionTaskId: ids.executionTask,
      requestedScope: '整理结果',
      idempotencyKey: 'ai-before-confirm',
    });
    const input = {
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      aiContributionId: ids.contribution,
      status: 'confirmed',
      humanChangesSummary: null,
      idempotencyKey: 'ai-confirm-replay',
    } as const;
    const first = await service.confirmAiContribution(input);
    expect(await service.confirmAiContribution(structuredClone(input))).toEqual(first);

    const rollbackRepository = new FakeRepository();
    const rollback = createHarness(rollbackRepository);
    await rollback.service.recordAiContribution({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      executionTaskId: ids.executionTask,
      requestedScope: '整理结果',
      idempotencyKey: 'ai-before-rollback',
    });
    rollbackRepository.failAppend = true;
    await expect(
      rollback.service.confirmAiContribution({ ...input, idempotencyKey: 'ai-confirm-rollback' }),
    ).rejects.toThrow('event write failed');
    expect(rollbackRepository.contributions[0]?.humanConfirmationStatus).toBe('pending');
    expect(rollbackRepository.contributions[0]?.confirmedAt).toBeNull();
  });

  it('hides an AI contribution owned by another contributor', async () => {
    const { repository, service } = createHarness();
    await service.recordAiContribution({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      executionTaskId: ids.executionTask,
      requestedScope: '整理结果',
      idempotencyKey: 'ai-other-owner-create',
    });
    const contribution = repository.contributions[0];
    if (!contribution) throw new Error('missing contribution fixture');
    contribution.contributedByUserId = 12;
    await expect(
      service.confirmAiContribution({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        aiContributionId: ids.contribution,
        status: 'confirmed',
        humanChangesSummary: null,
        idempotencyKey: 'ai-other-owner-confirm',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'NOT_FOUND');
      return true;
    });
  });

  it('returns a privacy-safe evidence package without storage or raw external reference fields', async () => {
    const { service } = createHarness();
    await service.bindEvidence({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      idempotencyKey: 'private-package-evidence',
      source: { kind: 'controlledExternalRef', url: 'https://secret.example/private/path' },
    });
    const result = await service.getEvidencePackage({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret.example');
    expect(serialized).not.toContain('storagePath');
    expect(serialized).not.toContain('r2Key');
    expect(serialized).not.toContain('rawExcerpt');
    expect(serialized).not.toContain('ownerUserId');
    expect(serialized).not.toContain('workItemId":41');
  });

  it('allows an active viewer to read the privacy-safe evidence package', async () => {
    const repository = new FakeRepository();
    repository.access.actorProjectRole = 'viewer';
    const { service } = createHarness(repository);
    await expect(
      service.getEvidencePackage({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
      }),
    ).resolves.toMatchObject({ workItemId: ids.workItem });
  });

  it('requires an accepted responsible or collaborator assignment for evidence mutations', async () => {
    const ordinaryRepository = new FakeRepository();
    ordinaryRepository.actorAcceptedAssignmentRole = null;
    const ordinary = createHarness(ordinaryRepository);
    await expect(
      ordinary.service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'ordinary-member-bind',
        source: { kind: 'taskFile', taskFileId: ids.taskFile },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'FORBIDDEN');
      return true;
    });

    const collaboratorRepository = new FakeRepository();
    collaboratorRepository.actorAcceptedAssignmentRole = 'collaborator';
    const collaborator = createHarness(collaboratorRepository);
    await expect(
      collaborator.service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'collaborator-bind',
        source: { kind: 'taskFile', taskFileId: ids.taskFile },
      }),
    ).resolves.toMatchObject({ command: 'bind_evidence' });
  });

  it('derives immutable AI execution facts and rejects client-forged facts', async () => {
    const { repository, service } = createHarness();
    await expect(
      service.recordAiContribution({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        executionTaskId: ids.executionTask,
        requestedScope: '整理结果',
        idempotencyKey: 'forged-ai-facts',
        usageSnapshot: { inputTokens: 999_999 },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'INVALID_INPUT');
      return true;
    });

    await service.recordAiContribution({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      executionTaskId: ids.executionTask,
      requestedScope: '整理结果',
      idempotencyKey: 'derived-ai-facts',
    });
    expect(repository.contributions[0]).toMatchObject({
      inputSourceSummary: {
        sourceKinds: ['task_file', 'evidence_artifact'],
        sourceCount: 2,
      },
      resultVersion: expect.stringMatching(/^rv_[a-f0-9]{32}$/u),
      usageSnapshot: {
        taskUnits: 1,
        opusUnits: 1,
        llmCallCount: 2,
        inputTokens: 120,
        outputTokens: 80,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        latencyMs: 900,
      },
      unverifiedRisks: [{ code: 'needs_fact_check', severity: 'medium' }],
    });
  });

  it.each([
    ['non-user origin', { origin: 'eval' }],
    ['inactive organization owner', { ownerOrganizationMembershipActive: false }],
    ['inactive project owner', { ownerProjectMembershipActive: false }],
    ['viewer owner', { ownerProjectRole: 'viewer' }],
    ['non-terminal execution', { status: 'executing' }],
  ] as const)('hides an AI execution task with %s', async (_label, changes) => {
    const repository = new FakeRepository();
    Object.assign(repository.executionTask, changes);
    const { service } = createHarness(repository);
    await expect(
      service.recordAiContribution({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        executionTaskId: ids.executionTask,
        requestedScope: '整理结果',
        idempotencyKey: `invalid-execution-${_label.replaceAll(' ', '-')}`,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'NOT_FOUND');
      return true;
    });
  });

  it('replays the first frozen AI contribution before reading a changed derived snapshot', async () => {
    const { repository, service } = createHarness();
    const input = {
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      executionTaskId: ids.executionTask,
      requestedScope: '整理结果',
      idempotencyKey: 'derived-snapshot-replay',
    } as const;
    const first = await service.recordAiContribution(input);
    repository.executionSnapshot.outputTokens += 1;
    repository.executionTask.updatedAt = new Date('2026-09-01T00:00:00.000Z');
    await expect(service.recordAiContribution(input)).resolves.toEqual(first);
    expect(repository.contributions).toHaveLength(1);
  });

  it('fails closed for orphan sources and requires owner publication before collaborator reuse', async () => {
    const orphanRepository = new FakeRepository();
    const orphan = orphanRepository.sources.get(ids.artifact);
    if (!orphan) throw new Error('missing orphan fixture');
    orphan.taskId = null;
    const orphanHarness = createHarness(orphanRepository);
    await expect(
      orphanHarness.service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'orphan-artifact',
        source: { kind: 'evidenceArtifact', evidenceArtifactId: ids.artifact },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'NOT_FOUND');
      return true;
    });

    const sharedRepository = new FakeRepository();
    const shared = sharedRepository.sources.get(ids.artifact);
    if (!shared) throw new Error('missing shared fixture');
    shared.ownerUserId = 12;
    shared.taskUserId = 12;
    const sharedHarness = createHarness(sharedRepository);
    await expect(
      sharedHarness.service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'unpublished-source',
        source: { kind: 'evidenceArtifact', evidenceArtifactId: ids.artifact },
        target: { kind: 'submission', id: externalId('tsb', 's') },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'NOT_FOUND');
      return true;
    });
    sharedRepository.bindings.push({
      id: 400,
      externalId: externalId('teb', 'o'),
      organizationId: 21,
      projectId: 31,
      workItemId: 41,
      submissionId: null,
      reviewId: null,
      appealId: null,
      aiContributionId: null,
      evidenceArtifactId: 51,
      taskFileId: null,
      sourceKind: 'evidenceArtifact',
      controlledExternalRef: null,
      metadata: { evidenceType: 'source_document' },
      boundByUserId: 12,
      createdAt: new Date('2026-08-30T00:00:00.000Z'),
    });
    await expect(
      sharedHarness.service.bindEvidence({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
        idempotencyKey: 'published-source',
        source: { kind: 'evidenceArtifact', evidenceArtifactId: ids.artifact },
        target: { kind: 'submission', id: externalId('tsb', 's') },
      }),
    ).resolves.toMatchObject({ command: 'bind_evidence', targetKind: 'submission' });
  });

  it('returns deterministic read-only preflight guidance without mutating the work item', async () => {
    const { repository, service } = createHarness();
    repository.preflightSnapshot.evidenceBindings = [];
    const before = structuredClone(repository.workItem);
    const result = await service.preflight({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
    });
    expect(result).toEqual({
      workItemId: ids.workItem,
      missingContractFields: [],
      missingEvidenceTypes: ['source_document'],
      schemaValidation: { valid: false, issueCodes: ['REQUIRED_EVIDENCE_MISSING'] },
      recommendationSummary: {
        code: 'ADD_REQUIRED_EVIDENCE',
        text: '补齐合同要求的证据类型后再提交人工复核。',
      },
    });
    expect(repository.workItem).toEqual(before);
    expect(repository.events).toHaveLength(0);
  });

  it.each([
    ['missing current pointer', { currentContractVersionId: null }, {}],
    ['wrong contract pointer', {}, { id: 999 }],
    ['wrong organization lineage', {}, { organizationId: 99 }],
    ['wrong project lineage', {}, { projectId: 99 }],
    ['wrong work-item lineage', {}, { workItemId: 99 }],
    ['unconfirmed current contract', {}, { confirmedAt: null }],
  ] as const)(
    'fails preflight closed for %s instead of selecting another confirmed contract',
    async (_label, workItemChanges, contractChanges) => {
      const repository = new FakeRepository();
      Object.assign(repository.workItem, workItemChanges);
      const contract = repository.preflightSnapshot.contract;
      if (!contract) throw new Error('missing contract fixture');
      Object.assign(contract, contractChanges);
      const { service } = createHarness(repository);
      const result = await service.preflight({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
      });
      expect(result.schemaValidation).toEqual({
        valid: false,
        issueCodes: ['CONFIRMED_CONTRACT_MISSING', 'CONTRACT_SCHEMA_INVALID'],
      });
      expect(result.recommendationSummary.code).toBe('COMPLETE_CONTRACT');
    },
  );

  it('does not let damaged or expired evidence satisfy a required evidence type', async () => {
    const repository = new FakeRepository();
    repository.preflightSnapshot.evidenceBindings = [
      { evidenceType: 'source_document', sourceValid: false },
    ];
    const { service } = createHarness(repository);
    await expect(
      service.preflight({ actorExternalId: ids.actor, workItemExternalId: ids.workItem }),
    ).resolves.toMatchObject({
      missingEvidenceTypes: ['source_document'],
      schemaValidation: { valid: false, issueCodes: ['REQUIRED_EVIDENCE_MISSING'] },
    });
  });

  it('accepts multiple valid bindings with the same normalized evidence type', async () => {
    const repository = new FakeRepository();
    repository.preflightSnapshot.evidenceBindings = [
      { evidenceType: 'source_document', sourceValid: true },
      { evidenceType: ' source_document ', sourceValid: true },
    ];
    const { service } = createHarness(repository);
    await expect(
      service.preflight({ actorExternalId: ids.actor, workItemExternalId: ids.workItem }),
    ).resolves.toMatchObject({
      missingEvidenceTypes: [],
      schemaValidation: { valid: true, issueCodes: [] },
    });
  });

  it.each([undefined, '', 'bad\u0000type'])(
    'rejects a valid-source binding with missing or invalid evidence metadata: %s',
    async (evidenceType) => {
      const repository = new FakeRepository();
      repository.preflightSnapshot.evidenceBindings = [{ evidenceType, sourceValid: true }];
      const { service } = createHarness(repository);
      await expect(
        service.preflight({ actorExternalId: ids.actor, workItemExternalId: ids.workItem }),
      ).resolves.toMatchObject({
        missingEvidenceTypes: ['source_document'],
        schemaValidation: {
          valid: false,
          issueCodes: ['EVIDENCE_METADATA_INVALID', 'REQUIRED_EVIDENCE_MISSING'],
        },
      });
    },
  );

  it('binds resultVersion to immutable execution result content, not generic task updatedAt', async () => {
    const firstRepository = new FakeRepository();
    const first = createHarness(firstRepository);
    await first.service.recordAiContribution({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      executionTaskId: ids.executionTask,
      requestedScope: '整理结果',
      idempotencyKey: 'result-version-a',
    });

    const sameResultRepository = new FakeRepository();
    sameResultRepository.executionTask.updatedAt = new Date('2026-09-01T12:00:00.000Z');
    const sameResult = createHarness(sameResultRepository);
    await sameResult.service.recordAiContribution({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      executionTaskId: ids.executionTask,
      requestedScope: '整理结果',
      idempotencyKey: 'result-version-b',
    });

    const changedResultRepository = new FakeRepository();
    changedResultRepository.executionTask.result = { summary: 'different immutable result' };
    const changedResult = createHarness(changedResultRepository);
    await changedResult.service.recordAiContribution({
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      executionTaskId: ids.executionTask,
      requestedScope: '整理结果',
      idempotencyKey: 'result-version-c',
    });

    expect(sameResultRepository.contributions[0]?.resultVersion).toBe(
      firstRepository.contributions[0]?.resultVersion,
    );
    expect(changedResultRepository.contributions[0]?.resultVersion).not.toBe(
      firstRepository.contributions[0]?.resultVersion,
    );
  });

  it('supports arbitrary bounded contract evidence types and normalizes their labels', async () => {
    const { repository, service } = createHarness();
    const contract = repository.preflightSnapshot.contract;
    if (!contract) throw new Error('missing contract fixture');
    contract.requiredEvidenceTypes = [{ type: ' 用户提供的原始表格 ' }];
    repository.preflightSnapshot.evidenceBindings = [
      { evidenceType: '用户提供的原始表格', sourceValid: true },
    ];
    await expect(
      service.preflight({ actorExternalId: ids.actor, workItemExternalId: ids.workItem }),
    ).resolves.toMatchObject({
      missingEvidenceTypes: [],
      schemaValidation: { valid: true, issueCodes: [] },
    });
  });

  it.each([
    [
      'two source identities',
      {
        id: ids.binding,
        source: { kind: 'taskFile', sourceId: ids.taskFile, evidenceArtifactId: ids.artifact },
        target: { kind: 'workItem' },
        metadata: null,
        createdAt: now.toISOString(),
      },
    ],
    [
      'a target id on a work-item target',
      {
        id: ids.binding,
        source: { kind: 'controlledExternalRef' },
        target: { kind: 'workItem', targetId: externalId('tsb', 's') },
        metadata: null,
        createdAt: now.toISOString(),
      },
    ],
  ])('fails closed while reading a row with %s', async (_label, unsafeBinding) => {
    const repository = new FakeRepository();
    repository.unsafeBinding = unsafeBinding;
    const { service } = createHarness(repository);
    await expect(
      service.getEvidencePackage({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'CONFLICT');
      return true;
    });
  });

  it('fails closed on a replay receipt with extra fields or foreign locked context', async () => {
    const { repository, service } = createHarness();
    const input = {
      actorExternalId: ids.actor,
      workItemExternalId: ids.workItem,
      idempotencyKey: 'strict-replay',
      source: { kind: 'taskFile', taskFileId: ids.taskFile },
    } as const;
    await service.bindEvidence(input);
    const event = repository.events[0];
    if (!event || !isRecordForTest(event.metadata)) throw new Error('missing event fixture');
    const receipt = event.metadata.receipt;
    if (!isRecordForTest(receipt)) throw new Error('missing receipt fixture');
    receipt.extra = 'forged';
    await expect(service.bindEvidence(input)).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'CONFLICT');
      return true;
    });

    Reflect.deleteProperty(receipt, 'extra');
    event.actorUserId = 999;
    await expect(service.bindEvidence(input)).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'CONFLICT');
      return true;
    });
  });

  it.each([
    [{ code: 'ER_NO_REFERENCED_ROW_2' }, 'NOT_FOUND'],
    [{ errno: 1452 }, 'NOT_FOUND'],
    [{ code: 'ER_CHECK_CONSTRAINT_VIOLATED' }, 'CONFLICT'],
    [{ errno: 3819 }, 'CONFLICT'],
  ] as const)('maps known database integrity failures to %s', async (failure, expectedCode) => {
    const repository = new FakeRepository();
    repository.transactionFailure = failure;
    const { service } = createHarness(repository);
    await expect(
      service.getEvidencePackage({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, expectedCode);
      return true;
    });
  });

  it('does not swallow unknown database failures', async () => {
    const repository = new FakeRepository();
    const unknown = new Error('network interrupted');
    repository.transactionFailure = unknown;
    const { service } = createHarness(repository);
    await expect(
      service.getEvidencePackage({
        actorExternalId: ids.actor,
        workItemExternalId: ids.workItem,
      }),
    ).rejects.toBe(unknown);
  });
});

function isRecordForTest(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
