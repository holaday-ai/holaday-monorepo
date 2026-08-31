import { describe, expect, it } from 'vitest';
import * as appealServiceModule from './team-task-appeal-service.js';
import {
  type AppealAssignmentLockResult,
  type AppealContractRow,
  type AppealDecisionRow,
  type AppealEventRow,
  type AppealPlanningEventRow,
  type AppealReviewRow,
  type AppealRow,
  type AppealSlaCandidateRow,
  type AppealSubmissionRow,
  type AppealTransaction,
  type AppealWorkItemRow,
  TeamTaskAppealService,
  TeamTaskAppealServiceError,
} from './team-task-appeal-service.js';
import {
  type ReviewContractRow,
  type ReviewDecisionRow,
  type ReviewEventRow,
  type ReviewSubmissionRow,
  type ReviewTransaction,
  type ReviewWorkItemRow,
  TeamTaskReviewService,
} from './team-task-review-service.js';
import type { TeamTaskAssignmentRow, TeamTaskProjectAccessSnapshot } from './team-task-service.js';
import { transitionTeamTask } from './team-task-state-machine.js';

const ext = (prefix: string, char: string) => `${prefix}_${char.repeat(21)}`;
const NOW = '2026-08-31T04:00:00.000Z';
const HOUR = 60 * 60 * 1_000;

class MemoryTransaction implements AppealTransaction {
  access: TeamTaskProjectAccessSnapshot = {
    actorUserId: 10,
    actorExternalId: ext('usr', 'a'),
    actorOrganizationRole: 'member',
    actorOrganizationMembershipActive: true,
    actorProjectRole: 'member',
    actorProjectMembershipActive: true,
    organizationId: 1,
    organizationExternalId: ext('org', 'o'),
    organizationActive: true,
    organizationTeamProjectsEnabled: true,
    projectId: 2,
    projectExternalId: ext('prj', 'p'),
    projectOrganizationId: 1,
  };
  workItem: AppealWorkItemRow = {
    id: 3,
    externalId: ext('twi', 'w'),
    organizationId: 1,
    projectId: 2,
    projectExternalId: ext('prj', 'p'),
    createdByUserId: 30,
    status: 'revision_requested',
    version: 4,
    currentContractVersionId: 5,
    revisionRound: 2,
  };
  contract: AppealContractRow = {
    id: 5,
    externalId: ext('acv', 'c'),
    organizationId: 1,
    projectId: 2,
    workItemId: 3,
    criteria: [
      { id: 'quality', description: 'Quality' },
      { id: 'evidence', description: 'Evidence' },
    ],
    approverUserId: 20,
    arbitratorUserId: 40,
    confirmedAt: new Date('2026-08-29T04:00:00.000Z'),
  };
  assignments: TeamTaskAssignmentRow[] = [
    {
      id: 1,
      externalId: ext('twa', 'r'),
      organizationId: 1,
      projectId: 2,
      workItemId: 3,
      userId: 10,
      organizationMemberExternalId: ext('omem', 'r'),
      role: 'responsible',
      status: 'accepted',
      offeredByUserId: 30,
      respondedAt: new Date('2026-08-29T04:00:00.000Z'),
    },
    {
      id: 2,
      externalId: ext('twa', 'l'),
      organizationId: 1,
      projectId: 2,
      workItemId: 3,
      userId: 11,
      organizationMemberExternalId: ext('omem', 'l'),
      role: 'collaborator',
      status: 'accepted',
      offeredByUserId: 30,
      respondedAt: new Date('2026-08-29T04:00:00.000Z'),
    },
  ];
  assignmentResultOverride: AppealAssignmentLockResult | undefined;
  submission: AppealSubmissionRow = {
    id: 100,
    externalId: ext('tsb', 's'),
    organizationId: 1,
    projectId: 2,
    workItemId: 3,
    contractVersionId: 5,
    submittedByUserId: 10,
    submissionVersion: 2,
    submittedAt: new Date('2026-08-29T04:00:00.000Z'),
  };
  review: AppealReviewRow = {
    id: 200,
    externalId: ext('trv', 'v'),
    organizationId: 1,
    projectId: 2,
    workItemId: 3,
    submissionId: 100,
    contractVersionId: 5,
    reviewerUserId: 20,
    decision: 'request_revision',
    reviewedAt: new Date('2026-08-30T04:00:00.000Z'),
  };
  latestReview: AppealReviewRow = { ...this.review };
  appeals: AppealRow[] = [];
  decisions: AppealDecisionRow[] = [];
  events: AppealEventRow[] = [];
  planningEvents: AppealPlanningEventRow[] = [];
  slaCandidates: AppealSlaCandidateRow[] = [];
  locks: string[] = [];
  failAppend = false;

  async lockWorkItemAccess(actorExternalId: string) {
    this.access.actorExternalId = actorExternalId;
    return { access: { ...this.access }, workItem: { ...this.workItem } };
  }
  async lockCurrentContract(workItemId: number, contractId: number) {
    this.locks.push('contract');
    return workItemId === this.workItem.id && contractId === this.contract.id
      ? { ...this.contract, criteria: this.contract.criteria.map((entry) => ({ ...entry })) }
      : null;
  }
  async listAssignments() {
    this.locks.push('assignments');
    if (this.assignmentResultOverride !== undefined) return this.assignmentResultOverride;
    return { ok: true as const, assignments: this.assignments.map((row) => ({ ...row })) };
  }
  async lockOrganizationIdempotencyScope() {
    this.locks.push('organization');
    return true;
  }
  async findEventByIdempotencyKey(organizationId: number, idempotencyKey: string) {
    return (
      this.events.find(
        (event) =>
          event.organizationId === organizationId && event.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }
  async hasPlanningEventByIdempotencyKey(organizationId: number, idempotencyKey: string) {
    return this.planningEvents.some(
      (event) => event.organizationId === organizationId && event.idempotencyKey === idempotencyKey,
    );
  }
  async lockSubmissionByExternalId(_workItemId: number, externalId: string) {
    this.locks.push('submission');
    return externalId === this.submission.externalId ? { ...this.submission } : null;
  }
  async lockReviewByExternalId(_workItemId: number, submissionId: number, externalId: string) {
    this.locks.push('review');
    return submissionId === this.review.submissionId && externalId === this.review.externalId
      ? { ...this.review }
      : null;
  }
  async lockLatestReview() {
    this.locks.push('latest-review');
    return { ...this.latestReview };
  }
  async lockAppealBySubmissionId(submissionId: number) {
    this.locks.push('submission-appeal');
    return this.appeals.find((appeal) => appeal.submissionId === submissionId) ?? null;
  }
  async lockUnresolvedAppealsByWorkItem(workItemId: number) {
    this.locks.push('appeals');
    return this.appeals
      .filter(
        (appeal) =>
          appeal.workItemId === workItemId &&
          (appeal.status === 'appeal_open' || appeal.status === 'appeal_reviewing'),
      )
      .sort((left, right) => left.id - right.id);
  }
  async lockAppealByExternalId(_workItemId: number, externalId: string) {
    this.locks.push('appeal');
    return this.appeals.find((appeal) => appeal.externalId === externalId) ?? null;
  }
  async lockDecisionByAppealId(appealId: number) {
    this.locks.push('decision');
    return this.decisions.find((decision) => decision.appealId === appealId) ?? null;
  }
  async insertAppeal(row: Omit<AppealRow, 'id'>) {
    const id = 300 + this.appeals.length;
    this.appeals.push({ ...row, id });
    return id;
  }
  async insertDecision(row: Omit<AppealDecisionRow, 'id'>) {
    const id = 400 + this.decisions.length;
    this.decisions.push({ ...row, id });
    return id;
  }
  async updateAppeal(appealId: number, status: AppealRow['status'], resolvedAt: Date) {
    const appeal = this.appeals.find((candidate) => candidate.id === appealId);
    if (!appeal || appeal.status === 'appeal_resolved') return false;
    appeal.status = status;
    appeal.resolvedAt = resolvedAt;
    return true;
  }
  async updateWorkItem(
    _workItemId: number,
    expectedVersion: number,
    update: Pick<AppealWorkItemRow, 'status' | 'version'>,
  ) {
    if (this.workItem.version !== expectedVersion) return false;
    this.workItem = { ...this.workItem, ...update };
    return true;
  }
  async appendEvent(row: AppealEventRow) {
    if (this.failAppend) throw new Error('append failed');
    this.events.push(row);
  }
  async listOverdueReviewCandidates(cutoff: Date, limit: number) {
    return this.slaCandidates
      .filter((row) => row.kind === 'review' && row.startedAt <= cutoff)
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }
  async listOverdueAppealCandidates(cutoff: Date, limit: number) {
    return this.slaCandidates
      .filter((row) => row.kind === 'appeal' && row.startedAt <= cutoff)
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }
}

class MemoryRepository {
  duplicateOnce = false;
  committedWinnerOnDuplicate: (() => void) | undefined;
  constructor(readonly tx = new MemoryTransaction()) {}
  async transaction<T>(work: (tx: AppealTransaction) => Promise<T>) {
    if (this.duplicateOnce) {
      this.duplicateOnce = false;
      this.committedWinnerOnDuplicate?.();
      throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
    }
    const snapshot = structuredClone({
      workItem: this.tx.workItem,
      appeals: this.tx.appeals,
      decisions: this.tx.decisions,
      events: this.tx.events,
    });
    try {
      return await work(this.tx);
    } catch (error) {
      this.tx.workItem = snapshot.workItem;
      this.tx.appeals = snapshot.appeals;
      this.tx.decisions = snapshot.decisions;
      this.tx.events = snapshot.events;
      throw error;
    }
  }
}

const service = (repo = new MemoryRepository()) => ({
  repo,
  service: new TeamTaskAppealService(repo, {
    now: () => NOW,
    isLifecycleEnabled: () => true,
    appealWindowMs: 72 * HOUR,
    reviewSlaMs: 24 * HOUR,
    appealSlaMs: 12 * HOUR,
    newId: (kind) =>
      kind === 'teamAppeal'
        ? ext('tap', 'a')
        : kind === 'teamArbitrationDecision'
          ? ext('tad', 'd')
          : ext('twe', 'e'),
  }),
});

const appealInput = () => ({
  actorId: ext('usr', 'a'),
  workItemId: ext('twi', 'w'),
  submissionId: ext('tsb', 's'),
  reviewId: ext('trv', 'v'),
  expectedVersion: 4,
  idempotencyKey: 'appeal-1',
  disputeType: 'criterion_application' as const,
  grounds: '  Criterion quality was applied to work outside the agreed scope.  ',
});

const decisionInput = (decision = 'accept_submission' as const) => ({
  actorId: ext('usr', 'd'),
  workItemId: ext('twi', 'w'),
  submissionId: ext('tsb', 's'),
  reviewId: ext('trv', 'v'),
  appealId: ext('tap', 'a'),
  expectedVersion: 5,
  idempotencyKey: `decision-${decision}`,
  decision,
  criterionIds: [' quality ', 'evidence'],
  evidenceReferences: [
    { kind: 'evidence' as const, reference: ' artifact://proof ' },
    { kind: 'evidence' as const, reference: 'ARTIFACT://PROOF' },
  ],
  rationale: 'The persisted submission evidence satisfies the confirmed contract.',
});

function withOpenAppeal() {
  const prepared = service();
  prepared.repo.tx.appeals.push({
    id: 300,
    externalId: ext('tap', 'a'),
    organizationId: 1,
    projectId: 2,
    workItemId: 3,
    submissionId: 100,
    reviewId: 200,
    openedByUserId: 10,
    disputeType: 'criterion_application',
    grounds: 'Criterion was applied outside scope.',
    status: 'appeal_open',
    openedAt: new Date(NOW),
    resolvedAt: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  });
  prepared.repo.tx.workItem.version = 5;
  prepared.repo.tx.access.actorUserId = 40;
  prepared.repo.tx.access.actorExternalId = ext('usr', 'd');
  prepared.repo.tx.access.actorOrganizationRole = 'manager';
  return prepared;
}

describe('TeamTaskAppealService appeal overlay', () => {
  it('opens one normalized appeal for the current responsible assignee without overwriting state', async () => {
    const { repo, service: subject } = service();
    const first = await subject.appeal(appealInput());
    expect(first).toMatchObject({
      command: 'appeal',
      appealId: ext('tap', 'a'),
      appealStatus: 'appeal_open',
      state: 'revision_requested',
      version: 5,
    });
    expect(repo.tx.workItem).toMatchObject({ status: 'revision_requested', version: 5 });
    expect(repo.tx.appeals).toHaveLength(1);
    expect(repo.tx.appeals[0]).toMatchObject({
      reviewId: 200,
      submissionId: 100,
      disputeType: 'criterion_application',
      grounds: 'Criterion quality was applied to work outside the agreed scope.',
    });
    expect(repo.tx.locks).toEqual([
      'contract',
      'assignments',
      'organization',
      'submission',
      'review',
      'appeals',
      'submission-appeal',
    ]);
    expect(await subject.appeal(appealInput())).toEqual(first);
    expect(repo.tx.appeals).toHaveLength(1);
  });

  it('allows only the active responsible assignee during the configured review window', async () => {
    const nonResponsible = service();
    nonResponsible.repo.tx.access.actorUserId = 11;
    await expect(nonResponsible.service.appeal(appealInput())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const inactive = service();
    inactive.repo.tx.access.actorProjectMembershipActive = false;
    await expect(inactive.service.appeal(appealInput())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const expired = service();
    expired.repo.tx.review.reviewedAt = new Date('2026-08-27T03:59:59.999Z');
    await expect(expired.service.appeal(appealInput())).rejects.toMatchObject({
      code: 'APPEAL_WINDOW_EXPIRED',
    });
  });

  it('rejects a second formal appeal, malformed reasons, sparse arrays, and prototype objects', async () => {
    const duplicate = withOpenAppeal();
    duplicate.repo.tx.access.actorUserId = 10;
    duplicate.repo.tx.workItem.version = 4;
    const existing = duplicate.repo.tx.appeals[0];
    if (!existing) throw new Error('fixture missing appeal');
    existing.reviewId = 999;
    await expect(duplicate.service.appeal(appealInput())).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const resolvedDuplicate = withOpenAppeal();
    resolvedDuplicate.repo.tx.access.actorUserId = 10;
    resolvedDuplicate.repo.tx.workItem.version = 4;
    const resolved = resolvedDuplicate.repo.tx.appeals[0];
    if (!resolved) throw new Error('fixture missing resolved appeal');
    resolved.reviewId = 999;
    resolved.status = 'appeal_resolved';
    resolved.resolvedAt = new Date(NOW);
    await expect(resolvedDuplicate.service.appeal(appealInput())).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(resolvedDuplicate.repo.tx.appeals).toHaveLength(1);

    await expect(
      service().service.appeal({ ...appealInput(), disputeType: 'quality' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      service().service.appeal({ ...appealInput(), grounds: 'x'.repeat(4_001) }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const prototypeInput = Object.assign(Object.create({ inherited: true }), appealInput());
    await expect(service().service.appeal(prototypeInput)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });

    const prepared = withOpenAppeal();
    await expect(
      prepared.service.decideAppeal({ ...decisionInput(), criterionIds: new Array(1) }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      prepared.service.decideAppeal({
        ...decisionInput(),
        evidenceReferences: [Object.create({ kind: 'evidence', reference: 'artifact://proof' })],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects opening an appeal while another submission on the work item is unresolved', async () => {
    const prepared = service();
    prepared.repo.tx.appeals.push({
      id: 299,
      externalId: ext('tap', 'x'),
      organizationId: 1,
      projectId: 2,
      workItemId: 3,
      submissionId: 99,
      reviewId: 199,
      openedByUserId: 10,
      disputeType: 'fact',
      grounds: 'Earlier submission dispute.',
      status: 'appeal_open',
      openedAt: new Date('2026-08-30T03:00:00.000Z'),
      resolvedAt: null,
      createdAt: new Date('2026-08-30T03:00:00.000Z'),
      updatedAt: new Date('2026-08-30T03:00:00.000Z'),
    });

    await expect(prepared.service.appeal(appealInput())).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(prepared.repo.tx.appeals).toHaveLength(1);
  });

  it('keeps the unresolved overlay authoritative for final rejection and archive guards', async () => {
    expect(
      appealServiceModule.hasUnresolvedTeamTaskAppeal([
        { status: 'appeal_open' },
        { status: 'appeal_resolved' },
      ]),
    ).toBe(true);
    expect(appealServiceModule.hasUnresolvedTeamTaskAppeal([{ status: 'appeal_resolved' }])).toBe(
      false,
    );
    expect(
      transitionTeamTask(
        { state: 'in_review', appealOpen: true },
        { type: 'reject_final', finalDecisionAuthorized: true },
      ),
    ).toEqual({ ok: false, code: 'APPEAL_OPEN' });
    expect(
      transitionTeamTask({ state: 'rejected_final', appealOpen: true }, { type: 'archive' }),
    ).toEqual({ ok: false, code: 'APPEAL_OPEN' });
  });

  it('fails closed for cross-tenant review, submission, and contract lineage', async () => {
    for (const mutate of [
      (tx: MemoryTransaction) => {
        tx.submission.projectId = 9;
      },
      (tx: MemoryTransaction) => {
        tx.review.submissionId = 999;
      },
      (tx: MemoryTransaction) => {
        tx.review.contractVersionId = 999;
      },
    ]) {
      const prepared = service();
      mutate(prepared.repo.tx);
      await expect(prepared.service.appeal(appealInput())).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });

  it('fails closed for foreign assignments and malformed persisted contract criteria', async () => {
    const foreignAssignment = service();
    const responsible = foreignAssignment.repo.tx.assignments[0];
    if (!responsible) throw new Error('fixture missing responsible');
    responsible.organizationId = 9;
    await expect(foreignAssignment.service.appeal(appealInput())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const malformedContract = service();
    malformedContract.repo.tx.contract.criteria = new Array(1);
    await expect(malformedContract.service.appeal(appealInput())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('maps an explicit damaged-assignment lock result to a stable domain conflict', async () => {
    const prepared = service();
    prepared.repo.tx.assignmentResultOverride = {
      ok: false,
      reason: 'UNKNOWN_ASSIGNMENT_ROLE_OR_STATUS',
    };
    await expect(prepared.service.appeal(appealInput())).rejects.toEqual(
      new TeamTaskAppealServiceError('CONFLICT'),
    );
  });

  it('makes the Drizzle assignment adapter reject unknown role or status instead of dropping it', () => {
    const normalizer = (appealServiceModule as unknown as Record<string, unknown>)
      .normalizeAppealAssignmentRows;
    expect(normalizer).toBeTypeOf('function');
    if (typeof normalizer !== 'function') return;
    const responsible = new MemoryTransaction().assignments[0];
    if (!responsible) throw new Error('fixture missing responsible');
    expect(normalizer([{ ...responsible, role: 'collaborator', status: 'legacy_status' }])).toEqual(
      {
        ok: false,
        reason: 'UNKNOWN_ASSIGNMENT_ROLE_OR_STATUS',
      },
    );
  });
});

describe('TeamTaskAppealService conflict-free arbitration', () => {
  it.each([
    ['creator', 30],
    ['responsible', 10],
    ['collaborator', 11],
    ['latest reviewer', 20],
    ['unbound manager', 50],
  ])('requires another bound arbitrator when the actor is the %s', async (_kind, actorUserId) => {
    const prepared = withOpenAppeal();
    prepared.repo.tx.access.actorUserId = actorUserId;
    if (actorUserId === 20) prepared.repo.tx.contract.arbitratorUserId = 20;
    if (actorUserId !== 50 && actorUserId !== 20) {
      prepared.repo.tx.contract.arbitratorUserId = actorUserId;
    }
    await expect(prepared.service.decideAppeal(decisionInput())).rejects.toMatchObject({
      code: 'ARBITRATOR_REQUIRED',
    });
  });

  it.each([
    ['uphold_review', 'revision_requested'],
    ['return_for_review', 'resubmitted'],
    ['accept_submission', 'accepted'],
    ['reject_final', 'rejected_final'],
  ] as const)(
    'records immutable %s lineage and moves to %s atomically',
    async (decision, state) => {
      const { repo, service: subject } = withOpenAppeal();
      const result = await subject.decideAppeal({ ...decisionInput(), decision });
      expect(result).toMatchObject({
        command: 'decide_appeal',
        decision,
        appealStatus: 'appeal_resolved',
        state,
        version: 6,
        revisionRound: 2,
      });
      expect(repo.tx.workItem).toMatchObject({ status: state, version: 6, revisionRound: 2 });
      expect(repo.tx.appeals[0]).toMatchObject({ status: 'appeal_resolved' });
      expect(repo.tx.decisions).toHaveLength(1);
      expect(repo.tx.decisions[0]).toMatchObject({
        organizationId: 1,
        projectId: 2,
        workItemId: 3,
        appealId: 300,
        arbitratorUserId: 40,
        decision,
        criterionIds: ['quality', 'evidence'],
        evidenceReferences: [{ kind: 'evidence', reference: 'artifact://proof' }],
        conflictSnapshot: {
          contractVersionId: 5,
          submissionId: 100,
          reviewId: 200,
          boundArbitratorUserId: 40,
          creatorUserId: 30,
          responsibleUserId: 10,
          collaboratorUserIds: [11],
          latestReviewerUserId: 20,
        },
      });
    },
  );

  it('lets Task 8 create attempt 2 from the immutable Task 9 return-for-review decision', async () => {
    const prepared = withOpenAppeal();
    const appealReceipt = await prepared.service.decideAppeal({
      ...decisionInput(),
      decision: 'return_for_review',
    });
    expect(appealReceipt).toMatchObject({ state: 'resubmitted', revisionRound: 2 });
    const persistedAppeal = prepared.repo.tx.appeals[0];
    const persistedDecision = prepared.repo.tx.decisions[0];
    if (!persistedAppeal || !persistedDecision) throw new Error('missing arbitration fixture');

    const reviewWorkItem: ReviewWorkItemRow = {
      ...prepared.repo.tx.workItem,
      dueAt: new Date('2026-09-01T04:00:00.000Z'),
      closedAt: null,
    };
    const reviewContract: ReviewContractRow = {
      ...prepared.repo.tx.contract,
      version: 1,
      dueAt: new Date('2026-09-01T04:00:00.000Z'),
      maxRevisionRounds: 2,
      confirmedByUserId: 10,
    };
    const submissions: ReviewSubmissionRow[] = [
      {
        ...prepared.repo.tx.submission,
        summary: 'done',
        deliverables: ['artifact://proof'],
        submittedOnTime: true,
        createdAt: prepared.repo.tx.submission.submittedAt,
      },
    ];
    const reviews: ReviewDecisionRow[] = [
      {
        ...prepared.repo.tx.review,
        externalId: ext('trv', 'v'),
        reviewDelegationId: null,
        reviewAttempt: 1,
        failedCriterionIds: ['quality'],
        evidenceReferences: [{ kind: 'evidence', reference: 'artifact://proof' }],
        revisionInstructions: ['Fix quality.'],
        rationale: 'Quality failed.',
        newDueAt: new Date('2026-09-01T04:00:00.000Z'),
        createdAt: prepared.repo.tx.review.reviewedAt,
      },
    ];
    const events: ReviewEventRow[] = [];
    const reviewerAccess: TeamTaskProjectAccessSnapshot = {
      ...prepared.repo.tx.access,
      actorUserId: 20,
      actorExternalId: ext('usr', 'b'),
      actorOrganizationRole: 'member',
      actorProjectRole: 'member',
    };
    const reviewTx: ReviewTransaction = {
      async lockWorkItemAccess(actorExternalId) {
        reviewerAccess.actorExternalId = actorExternalId;
        return { access: { ...reviewerAccess }, workItem: { ...reviewWorkItem } };
      },
      async lockCurrentContract(workItemId, contractId) {
        return workItemId === reviewWorkItem.id && contractId === reviewContract.id
          ? { ...reviewContract }
          : null;
      },
      async listAssignments() {
        return prepared.repo.tx.assignments.map((row) => ({ ...row }));
      },
      async loadActiveUser(_organizationId, userId) {
        return userId === 20;
      },
      async findEffectiveDelegation() {
        return null;
      },
      async lockOrganizationIdempotencyScope() {
        return true;
      },
      async findEventByIdempotencyKey(organizationId, key) {
        return (
          events.find(
            (event) => event.organizationId === organizationId && event.idempotencyKey === key,
          ) ?? null
        );
      },
      async hasPlanningEventByIdempotencyKey() {
        return false;
      },
      async lockLatestSubmission() {
        return submissions.at(-1) ?? null;
      },
      async lockSubmissionByExternalId(_workItemId, externalId) {
        return submissions.find((submission) => submission.externalId === externalId) ?? null;
      },
      async lockReviewsBySubmissionId(submissionId) {
        return reviews
          .filter((review) => review.submissionId === submissionId)
          .sort((left, right) => left.reviewAttempt - right.reviewAttempt);
      },
      async lockReturnForReviewDecision(
        reviewId,
        submissionId,
        contractVersionId,
        workItemId,
        organizationId,
        projectId,
      ) {
        if (
          persistedDecision.decision !== 'return_for_review' ||
          persistedDecision.appealId !== persistedAppeal.id ||
          persistedAppeal.reviewId !== reviewId ||
          persistedAppeal.submissionId !== submissionId ||
          persistedDecision.conflictSnapshot.contractVersionId !== contractVersionId ||
          persistedDecision.workItemId !== workItemId ||
          persistedDecision.organizationId !== organizationId ||
          persistedDecision.projectId !== projectId
        ) {
          return null;
        }
        return {
          appealId: persistedAppeal.id,
          decisionId: persistedDecision.id,
          reviewId,
          submissionId,
          contractVersionId,
          workItemId,
          organizationId,
          projectId,
          decidedAt: persistedDecision.decidedAt,
        };
      },
      async insertSubmission(row) {
        const id = 100 + submissions.length;
        submissions.push({ ...row, id });
        return id;
      },
      async insertReview(row) {
        const id = 200 + reviews.length;
        reviews.push({ ...row, id });
        return id;
      },
      async updateWorkItem(_workItemId, expectedVersion, update) {
        if (reviewWorkItem.version !== expectedVersion) return false;
        Object.assign(reviewWorkItem, update);
        Object.assign(prepared.repo.tx.workItem, {
          status: reviewWorkItem.status,
          version: reviewWorkItem.version,
          revisionRound: reviewWorkItem.revisionRound,
        });
        return true;
      },
      async appendEvent(event) {
        events.push(event);
      },
    };
    const reviewService = new TeamTaskReviewService(
      {
        async transaction(work) {
          return work(reviewTx);
        },
      },
      {
        now: () => NOW,
        isLifecycleEnabled: () => true,
        newId: (kind) =>
          kind === 'teamSubmission'
            ? ext('tsb', 'n')
            : kind === 'teamReview'
              ? ext('trv', 'n')
              : ext('twe', 'n'),
      },
    );

    const result = await reviewService.review({
      actorId: ext('usr', 'b'),
      workItemId: ext('twi', 'w'),
      submissionId: ext('tsb', 's'),
      expectedVersion: 6,
      idempotencyKey: 'task9-return-task8-attempt-2',
      decision: 'accepted',
      rationale: 'The returned review now passes.',
    });
    expect(result).toMatchObject({ reviewAttempt: 2, state: 'accepted', revisionRound: 2 });
    expect(reviews).toHaveLength(2);
    expect(reviews[1]).toMatchObject({ reviewAttempt: 2, submissionId: 100 });
    expect(prepared.repo.tx.workItem).toMatchObject({ revisionRound: 2, version: 7 });
  });

  it('requires bounded contract criterion and evidence references for every exact outcome', async () => {
    for (const input of [
      { ...decisionInput(), decision: 'other' },
      { ...decisionInput(), criterionIds: [] },
      { ...decisionInput(), criterionIds: ['outside-contract'] },
      { ...decisionInput(), evidenceReferences: [] },
      { ...decisionInput(), evidenceReferences: new Array(1) },
      { ...decisionInput(), rationale: 'x'.repeat(4_001) },
    ]) {
      await expect(withOpenAppeal().service.decideAppeal(input)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    }
  });

  it.each(['uphold_review', 'return_for_review', 'accept_submission', 'reject_final'] as const)(
    'rejects %s when persisted corruption exposes a sibling unresolved appeal',
    async (decision) => {
      const prepared = withOpenAppeal();
      const targetAppeal = prepared.repo.tx.appeals[0];
      if (!targetAppeal) throw new Error('missing target appeal fixture');
      prepared.repo.tx.appeals.push({
        ...targetAppeal,
        id: 301,
        externalId: ext('tap', 'x'),
        submissionId: 99,
        reviewId: 199,
        grounds: 'Sibling unresolved appeal.',
      });

      await expect(
        prepared.service.decideAppeal({ ...decisionInput(), decision }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(prepared.repo.tx.appeals.every((appeal) => appeal.status === 'appeal_open')).toBe(
        true,
      );
      expect(prepared.repo.tx.decisions).toHaveLength(0);
      expect(prepared.repo.tx.workItem).toMatchObject({ status: 'revision_requested', version: 5 });
    },
  );

  it('replays the first organization-scoped result and rejects a distinct stale decision', async () => {
    const { repo, service: subject } = withOpenAppeal();
    const input = decisionInput();
    const first = await subject.decideAppeal(input);
    expect(await subject.decideAppeal(input)).toEqual(first);
    expect(repo.tx.decisions).toHaveLength(1);
    await expect(
      subject.decideAppeal({ ...input, idempotencyKey: 'different-key' }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('maps lock races without leaking raw database details', async () => {
    for (const databaseCode of ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']) {
      const repository = new MemoryRepository();
      repository.transaction = async () => {
        throw Object.assign(new Error('raw database detail'), { code: databaseCode });
      };
      await expect(service(repository).service.appeal(appealInput())).rejects.toEqual(
        new TeamTaskAppealServiceError('CONFLICT'),
      );
    }
  });

  it('replays the committed same-key winner after the losing insert reports duplicate', async () => {
    const winner = withOpenAppeal();
    const input = decisionInput();
    const winnerReceipt = await winner.service.decideAppeal(input);

    const contender = withOpenAppeal();
    contender.repo.duplicateOnce = true;
    contender.repo.committedWinnerOnDuplicate = () => {
      contender.repo.tx.workItem = structuredClone(winner.repo.tx.workItem);
      contender.repo.tx.appeals = structuredClone(winner.repo.tx.appeals);
      contender.repo.tx.decisions = structuredClone(winner.repo.tx.decisions);
      contender.repo.tx.events = structuredClone(winner.repo.tx.events);
    };

    await expect(contender.service.decideAppeal(input)).resolves.toEqual(winnerReceipt);
    expect(contender.repo.tx.decisions).toHaveLength(1);
    expect(contender.repo.tx.events).toHaveLength(1);
  });

  it('rolls back decision, overlay, event, and main state when an atomic write fails', async () => {
    const { repo, service: subject } = withOpenAppeal();
    repo.tx.failAppend = true;
    await expect(subject.decideAppeal(decisionInput())).rejects.toThrow('append failed');
    expect(repo.tx.decisions).toHaveLength(0);
    expect(repo.tx.appeals[0]).toMatchObject({ status: 'appeal_open', resolvedAt: null });
    expect(repo.tx.workItem).toMatchObject({ status: 'revision_requested', version: 5 });
    expect(repo.tx.events).toHaveLength(0);
  });

  it('rejects cross-family idempotency reuse and preserves the fixed record lock order', async () => {
    const prepared = withOpenAppeal();
    prepared.repo.tx.planningEvents.push({
      organizationId: 1,
      idempotencyKey: 'decision-accept_submission',
    });
    await expect(prepared.service.decideAppeal(decisionInput())).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const ordered = withOpenAppeal();
    await ordered.service.decideAppeal(decisionInput());
    expect(ordered.repo.tx.locks).toEqual([
      'contract',
      'assignments',
      'organization',
      'submission',
      'review',
      'appeals',
      'appeal',
      'latest-review',
      'decision',
    ]);
  });
});

describe('TeamTaskAppealService deterministic SLA notifications', () => {
  it('returns a bounded deterministic in-app-only merge from persisted review and appeal timestamps', async () => {
    const { repo, service: subject } = service();
    repo.tx.slaCandidates.push(
      {
        kind: 'appeal',
        organizationId: 1,
        projectId: 2,
        workItemExternalId: ext('twi', 'a'),
        sourceExternalId: ext('tap', 'q'),
        targetUserId: 40,
        targetUserExternalId: ext('usr', 'd'),
        organizationTeamProjectsEnabled: true,
        startedAt: new Date('2026-08-30T15:00:00.000Z'),
      },
      {
        kind: 'review',
        organizationId: 1,
        projectId: 2,
        workItemExternalId: ext('twi', 'b'),
        sourceExternalId: ext('tsb', 'r'),
        targetUserId: 20,
        targetUserExternalId: ext('usr', 'b'),
        organizationTeamProjectsEnabled: true,
        startedAt: new Date('2026-08-30T03:00:00.000Z'),
      },
      {
        kind: 'review',
        organizationId: 1,
        projectId: 2,
        workItemExternalId: ext('twi', 'c'),
        sourceExternalId: ext('tsb', 't'),
        targetUserId: 21,
        targetUserExternalId: ext('usr', 'c'),
        organizationTeamProjectsEnabled: true,
        startedAt: new Date('2026-08-30T03:30:00.000Z'),
      },
    );
    const requests = await subject.listOverdueNotifications({ now: NOW, limit: 2 });
    expect(requests).toEqual([
      {
        delivery: 'in_app_only',
        type: 'team_review_overdue',
        recipientUserId: 20,
        organizationId: 1,
        projectId: 2,
        workItemId: ext('twi', 'b'),
        sourceId: ext('tsb', 'r'),
        overdueAt: '2026-08-31T03:00:00.000Z',
      },
      {
        delivery: 'in_app_only',
        type: 'team_appeal_overdue',
        recipientUserId: 40,
        organizationId: 1,
        projectId: 2,
        workItemId: ext('twi', 'a'),
        sourceId: ext('tap', 'q'),
        overdueAt: '2026-08-31T03:00:00.000Z',
      },
    ]);
    expect(repo.tx.workItem).toMatchObject({ status: 'revision_requested', version: 4 });
    expect(repo.tx.events).toHaveLength(0);
    expect(repo.tx.decisions).toHaveLength(0);
  });

  it('rejects invalid clocks and limits and filters feature-disabled candidates', async () => {
    const prepared = service();
    prepared.repo.tx.slaCandidates.push({
      kind: 'review',
      organizationId: 1,
      projectId: 2,
      workItemExternalId: ext('twi', 'b'),
      sourceExternalId: ext('tsb', 'r'),
      targetUserId: 20,
      targetUserExternalId: ext('usr', 'b'),
      organizationTeamProjectsEnabled: false,
      startedAt: new Date('2026-08-30T03:00:00.000Z'),
    });
    expect(await prepared.service.listOverdueNotifications({ now: NOW, limit: 10 })).toEqual([]);
    await expect(
      prepared.service.listOverdueNotifications({ now: 'not-an-instant', limit: 10 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      prepared.service.listOverdueNotifications({ now: NOW, limit: 101 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
