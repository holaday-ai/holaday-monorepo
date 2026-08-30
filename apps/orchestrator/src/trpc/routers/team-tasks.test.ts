import { newExternalId } from '@holaday/shared-types';
import type { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { TeamTaskServiceError } from '../../team-work-items/team-task-service.js';
import { type TeamTasksRouterServices, createTeamTasksRouter } from './team-tasks.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};
const actorId = 'usr_Actor1111111111111111';
const projectId = 'prj_Project11111111111111';
const workItemId = 'twi_Target111111111111111';
const idempotencyKey = '01J6TK66M8H4V3E6XKNB4RM1GP';

function services(): TeamTasksRouterServices {
  const receipt = { command: 'test', eventId: 'twe_event', workItemId, state: 'draft', version: 1 };
  return {
    query: {
      list: vi.fn().mockResolvedValue([{ id: workItemId, projectId, state: 'draft' }]),
      get: vi.fn().mockResolvedValue({ id: workItemId, projectId, state: 'draft' }),
      archive: vi.fn().mockResolvedValue({ ...receipt, command: 'archive', state: 'archived' }),
    },
    task: {
      createDraft: vi.fn().mockResolvedValue({ ...receipt, command: 'create_draft' }),
      publish: vi.fn().mockResolvedValue({ ...receipt, command: 'publish' }),
      offerAssignment: vi.fn().mockResolvedValue({ ...receipt, command: 'offer_assignment' }),
      respondToAssignment: vi.fn().mockResolvedValue({ ...receipt, command: 'respond_assignment' }),
      claim: vi.fn().mockResolvedValue({ ...receipt, command: 'claim' }),
      selectClaim: vi.fn().mockResolvedValue({ ...receipt, command: 'select_claim' }),
    },
    planning: {
      start: vi.fn().mockResolvedValue({ ...receipt, command: 'start' }),
      block: vi.fn().mockResolvedValue({ ...receipt, command: 'block' }),
      unblock: vi.fn().mockResolvedValue({ ...receipt, command: 'unblock' }),
      createContractVersion: vi
        .fn()
        .mockResolvedValue({ ...receipt, command: 'create_contract_version' }),
      confirmContractVersion: vi
        .fn()
        .mockResolvedValue({ ...receipt, command: 'confirm_contract_version' }),
    },
    review: {
      submit: vi.fn().mockResolvedValue({ ...receipt, command: 'submit' }),
      review: vi.fn().mockResolvedValue({ ...receipt, command: 'accept_submission' }),
      close: vi.fn().mockResolvedValue({ ...receipt, command: 'close' }),
    },
    appeal: {
      appeal: vi.fn().mockResolvedValue({ ...receipt, command: 'appeal' }),
      decideAppeal: vi.fn().mockResolvedValue({ ...receipt, command: 'decide_appeal' }),
    },
    evidence: {
      bindEvidence: vi.fn().mockResolvedValue({ ...receipt, command: 'bind_evidence' }),
      recordAiContribution: vi
        .fn()
        .mockResolvedValue({ ...receipt, command: 'record_ai_contribution' }),
      confirmAiContribution: vi
        .fn()
        .mockResolvedValue({ ...receipt, command: 'confirm_ai_contribution' }),
      getEvidencePackage: vi.fn().mockResolvedValue({
        workItemId,
        evidenceBindings: [],
        aiContributions: [],
      }),
      preflight: vi.fn().mockResolvedValue({
        workItemId,
        missingContractFields: [],
        missingEvidenceTypes: [],
        schemaValidation: { valid: true, issueCodes: [] },
        recommendationSummary: { code: 'ready', text: 'Ready' },
      }),
    },
  };
}

function caller(injected = services(), userId: string | null = actorId) {
  return {
    caller: createTeamTasksRouter(() => injected).createCaller({
      db: {} as never,
      userId,
      logger,
    } as never),
    injected,
  };
}

describe('teamTasksRouter createCaller', () => {
  it('requires authentication and forwards list/get through the domain query boundary', async () => {
    await expect(caller(services(), null).caller.list({ projectId })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    const { caller: subject, injected } = caller();
    await expect(subject.list({ projectId })).resolves.toEqual([
      { id: workItemId, projectId, state: 'draft' },
    ]);
    await subject.get({ projectId, workItemId });
    expect(injected.query.list).toHaveBeenCalledWith({ actorId, projectId });
    expect(injected.query.get).toHaveBeenCalledWith({ actorId, projectId, workItemId });
  });

  it('requires project lineage/version/strong idempotency and forwards archive', async () => {
    const { caller: subject, injected } = caller();
    await subject.archive({ projectId, workItemId, expectedVersion: 4, idempotencyKey });
    expect(injected.query.archive).toHaveBeenCalledWith({
      actorId,
      projectId,
      workItemId,
      expectedVersion: 4,
      idempotencyKey,
    });
    await expect(
      subject.archive({ projectId, workItemId, expectedVersion: 4, idempotencyKey: 'weak-key' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('maps hidden domain resources to NOT_FOUND without leaking the domain message', async () => {
    const injected = services();
    vi.mocked(injected.query.get).mockRejectedValue(new TeamTaskServiceError('NOT_FOUND'));
    const { caller: subject } = caller(injected);
    await expect(subject.get({ projectId, workItemId })).rejects.toEqual(
      expect.objectContaining<Partial<TRPCError>>({
        code: 'NOT_FOUND',
        message: 'Team task not found',
      }),
    );
  });

  it('halts a scoped mutation when the project/work-item guard hides the resource', async () => {
    const injected = services();
    vi.mocked(injected.query.get).mockRejectedValue(new TeamTaskServiceError('NOT_FOUND'));
    const { caller: subject } = caller(injected);
    await expect(
      subject.start({ projectId, workItemId, expectedVersion: 3, idempotencyKey }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(injected.planning.start).not.toHaveBeenCalled();
  });

  it('forwards representative lifecycle mutations with the authenticated actor', async () => {
    const { caller: subject, injected } = caller();
    await subject.createDraft({
      projectId,
      title: 'Launch report',
      description: null,
      assignmentMode: 'direct',
      expectedVersion: 0,
      idempotencyKey,
    });
    await subject.start({ projectId, workItemId, expectedVersion: 3, idempotencyKey });
    expect(injected.task.createDraft).toHaveBeenCalledWith({
      actorExternalId: actorId,
      projectExternalId: projectId,
      title: 'Launch report',
      description: null,
      assignmentMode: 'direct',
      expectedVersion: 0,
      idempotencyKey,
    });
    expect(injected.planning.start).toHaveBeenCalledWith({
      actorExternalId: actorId,
      workItemExternalId: workItemId,
      expectedVersion: 3,
      idempotencyKey,
      overrideReason: undefined,
    });
  });

  it('forwards evidence reads without accepting internal identifiers', async () => {
    const { caller: subject, injected } = caller();
    await subject.getEvidencePackage({ projectId, workItemId });
    await subject.preflight({ projectId, workItemId });
    expect(injected.evidence.getEvidencePackage).toHaveBeenCalledWith({
      actorExternalId: actorId,
      workItemExternalId: workItemId,
    });
    expect(injected.evidence.preflight).toHaveBeenCalledWith({
      actorExternalId: actorId,
      workItemExternalId: workItemId,
    });
  });

  it('exposes and scopes every required lifecycle and evidence procedure', async () => {
    const { caller: subject, injected } = caller();
    const memberId = newExternalId('organizationMember');
    const assignmentId = newExternalId('teamWorkItemAssignment');
    const contractVersionId = newExternalId('acceptanceContractVersion');
    const submissionId = newExternalId('teamSubmission');
    const reviewId = newExternalId('teamReview');
    const appealId = newExternalId('teamAppeal');
    const executionTaskId = newExternalId('task');
    const aiContributionId = newExternalId('teamAiContribution');
    const evidenceArtifactId = newExternalId('evidenceArtifact');
    const contract = {
      objective: 'Ship the launch report',
      deliverables: ['Signed report'],
      criteria: [{ id: 'criterion-1', description: 'Report is complete' }],
      requiredEvidenceTypes: [{ type: 'document' }],
      approverId: memberId,
      arbitratorId: newExternalId('organizationMember'),
      dueAt: '2026-09-10T00:00:00.000Z',
      maxRevisionRounds: 2,
    };
    const base = { projectId, workItemId, expectedVersion: 3, idempotencyKey };

    await subject.publish({ ...base, contract });
    await subject.assign({ ...base, targetMemberId: memberId, role: 'responsible' });
    await subject.acceptAssignment({ ...base, assignmentId });
    await subject.claim({ ...base, memberId });
    await subject.selectClaim({ ...base, assignmentId });
    await subject.block({
      ...base,
      responsibleParty: 'Vendor',
      nextAction: 'Confirm delivery',
      reviewAt: '2026-09-02T00:00:00.000Z',
      affectsDueDate: false,
    });
    await subject.unblock(base);
    await subject.createContractVersion({
      ...base,
      contract,
      versionNote: 'Clarify evidence.',
    });
    await subject.confirmContractVersion({ ...base, contractVersionId });
    await subject.submit({ ...base, summary: 'Complete', deliverables: ['Report'] });
    await subject.review({
      ...base,
      submissionId,
      decision: 'accepted',
      rationale: 'All criteria met.',
    });
    await subject.appeal({
      ...base,
      submissionId,
      reviewId,
      disputeType: 'fact',
      grounds: 'The linked evidence establishes the fact.',
    });
    await subject.decideAppeal({
      ...base,
      submissionId,
      reviewId,
      appealId,
      decision: 'uphold_review',
      criterionIds: ['criterion-1'],
      evidenceReferences: [{ kind: 'evidence', reference: 'teb_reference' }],
      rationale: 'The original review remains supported.',
    });
    await subject.close(base);
    await subject.bindEvidence({
      projectId,
      workItemId,
      expectedVersion: 3,
      idempotencyKey,
      source: { kind: 'evidenceArtifact', evidenceArtifactId },
      target: { kind: 'submission', id: submissionId },
      metadata: { evidenceType: 'document' },
    });
    await subject.recordAiContribution({
      projectId,
      workItemId,
      executionTaskId,
      requestedScope: 'Summarize linked evidence',
      expectedVersion: 3,
      idempotencyKey,
    });
    await subject.confirmAiContribution({
      projectId,
      workItemId,
      aiContributionId,
      status: 'confirmed',
      expectedVersion: 3,
      idempotencyKey,
    });

    expect(injected.query.get).toHaveBeenCalledTimes(17);
    const actorWorkItem = { actorExternalId: actorId, workItemExternalId: workItemId };
    expect(injected.task.publish).toHaveBeenCalledWith({
      ...actorWorkItem,
      expectedVersion: 3,
      idempotencyKey,
      contract,
    });
    expect(injected.task.offerAssignment).toHaveBeenCalledWith({
      ...actorWorkItem,
      targetMemberExternalId: memberId,
      role: 'responsible',
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.task.respondToAssignment).toHaveBeenCalledWith({
      ...actorWorkItem,
      assignmentExternalId: assignmentId,
      response: 'accept',
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.task.claim).toHaveBeenCalledWith({
      ...actorWorkItem,
      memberExternalId: memberId,
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.task.selectClaim).toHaveBeenCalledWith({
      ...actorWorkItem,
      assignmentExternalId: assignmentId,
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.planning.block).toHaveBeenCalledWith({
      ...actorWorkItem,
      responsibleParty: 'Vendor',
      nextAction: 'Confirm delivery',
      reviewAt: '2026-09-02T00:00:00.000Z',
      affectsDueDate: false,
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.planning.unblock).toHaveBeenCalledWith({
      ...actorWorkItem,
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.planning.createContractVersion).toHaveBeenCalledWith({
      ...actorWorkItem,
      contract,
      versionNote: 'Clarify evidence.',
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.planning.confirmContractVersion).toHaveBeenCalledWith({
      ...actorWorkItem,
      contractVersionExternalId: contractVersionId,
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.review.submit).toHaveBeenCalledWith({
      actorId,
      workItemId,
      summary: 'Complete',
      deliverables: ['Report'],
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.review.review).toHaveBeenCalledWith({
      actorId,
      workItemId,
      submissionId,
      decision: 'accepted',
      rationale: 'All criteria met.',
      failedCriterionIds: undefined,
      evidenceReferences: undefined,
      revisionInstructions: undefined,
      newDeadline: undefined,
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.appeal.appeal).toHaveBeenCalledWith({
      actorId,
      workItemId,
      submissionId,
      reviewId,
      disputeType: 'fact',
      grounds: 'The linked evidence establishes the fact.',
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.appeal.decideAppeal).toHaveBeenCalledWith({
      actorId,
      workItemId,
      submissionId,
      reviewId,
      appealId,
      decision: 'uphold_review',
      criterionIds: ['criterion-1'],
      evidenceReferences: [{ kind: 'evidence', reference: 'teb_reference' }],
      rationale: 'The original review remains supported.',
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.review.close).toHaveBeenCalledWith({
      actorId,
      workItemId,
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.evidence.bindEvidence).toHaveBeenCalledWith({
      ...actorWorkItem,
      source: { kind: 'evidenceArtifact', evidenceArtifactId },
      target: { kind: 'submission', id: submissionId },
      metadata: { evidenceType: 'document' },
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.evidence.recordAiContribution).toHaveBeenCalledWith({
      ...actorWorkItem,
      executionTaskId,
      requestedScope: 'Summarize linked evidence',
      expectedVersion: 3,
      idempotencyKey,
    });
    expect(injected.evidence.confirmAiContribution).toHaveBeenCalledWith({
      ...actorWorkItem,
      aiContributionId,
      status: 'confirmed',
      humanChangesSummary: undefined,
      expectedVersion: 3,
      idempotencyKey,
    });
  });
});
