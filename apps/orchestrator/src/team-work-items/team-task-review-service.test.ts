import { describe, expect, it } from 'vitest';
import {
  type ReviewContractRow,
  type ReviewDecisionRow,
  type ReviewDelegationRow,
  type ReviewEventRow,
  type ReviewPlanningEventRow,
  type ReviewSubmissionRow,
  type ReviewTransaction,
  type ReviewWorkItemRow,
  TeamTaskReviewService,
  TeamTaskReviewServiceError,
} from './team-task-review-service.js';
import type { TeamTaskAssignmentRow, TeamTaskProjectAccessSnapshot } from './team-task-service.js';

const ext = (prefix: string, char: string) => `${prefix}_${char.repeat(21)}`;
const NOW = '2026-08-31T04:00:00.000Z';

class MemoryTransaction implements ReviewTransaction {
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
  workItem: ReviewWorkItemRow = {
    id: 3,
    externalId: ext('twi', 'w'),
    organizationId: 1,
    projectId: 2,
    projectExternalId: ext('prj', 'p'),
    createdByUserId: 30,
    status: 'in_progress',
    version: 4,
    currentContractVersionId: 5,
    dueAt: new Date('2026-08-31T05:00:00.000Z'),
    revisionRound: 0,
    closedAt: null,
  };
  contract: ReviewContractRow = {
    id: 5,
    externalId: ext('acv', 'c'),
    organizationId: 1,
    projectId: 2,
    workItemId: 3,
    version: 1,
    criteria: [
      { id: 'quality', description: 'Quality' },
      { id: 'evidence', description: 'Evidence' },
    ],
    approverUserId: 20,
    dueAt: new Date('2026-08-31T05:00:00.000Z'),
    maxRevisionRounds: 2,
    confirmedByUserId: 10,
    confirmedAt: new Date('2026-08-30T00:00:00.000Z'),
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
      respondedAt: new Date(),
    },
  ];
  activeUsers = new Set([10, 20, 30, 40]);
  delegations: ReviewDelegationRow[] = [];
  forcedDelegation: ReviewDelegationRow | null | undefined;
  events: ReviewEventRow[] = [];
  planningEvents: ReviewPlanningEventRow[] = [];
  submissions: ReviewSubmissionRow[] = [];
  reviews: ReviewDecisionRow[] = [];
  locks: string[] = [];

  async lockWorkItemAccess(actorExternalId: string) {
    this.access.actorExternalId = actorExternalId;
    return { access: { ...this.access }, workItem: { ...this.workItem } };
  }
  async lockCurrentContract(workItemId: number, contractId: number) {
    this.locks.push('contract');
    return workItemId === 3 && contractId === 5 ? { ...this.contract } : null;
  }
  async listAssignments() {
    this.locks.push('assignments');
    return this.assignments.map((row) => ({ ...row }));
  }
  async loadActiveUser(_organizationId: number, userId: number) {
    return this.activeUsers.has(userId);
  }
  async findEffectiveDelegation(
    organizationId: number,
    projectId: number,
    delegatorUserId: number,
    delegateUserId: number,
    at: Date,
  ) {
    if (this.forcedDelegation !== undefined) return this.forcedDelegation;
    return (
      this.delegations
        .filter(
          (grant) =>
            grant.organizationId === organizationId &&
            grant.projectId === projectId &&
            grant.delegatorUserId === delegatorUserId &&
            grant.delegateUserId === delegateUserId &&
            grant.revokedAt === null &&
            grant.validFrom <= at &&
            grant.validUntil >= at,
        )
        .sort((left, right) => right.validFrom.valueOf() - left.validFrom.valueOf())[0] ?? null
    );
  }
  async lockOrganizationIdempotencyScope() {
    this.locks.push('organization');
    return true;
  }
  async findEventByIdempotencyKey(organizationId: number, key: string) {
    return (
      this.events.find(
        (event) => event.organizationId === organizationId && event.idempotencyKey === key,
      ) ?? null
    );
  }
  async hasPlanningEventByIdempotencyKey(organizationId: number, key: string) {
    return this.planningEvents.some(
      (event) => event.organizationId === organizationId && event.idempotencyKey === key,
    );
  }
  async lockLatestSubmission() {
    this.locks.push('submission');
    return this.submissions.at(-1) ?? null;
  }
  async lockSubmissionByExternalId(_workItemId: number, externalId: string) {
    this.locks.push('submission');
    return this.submissions.find((submission) => submission.externalId === externalId) ?? null;
  }
  async lockReviewBySubmissionId(submissionId: number) {
    this.locks.push('review');
    return this.reviews.find((review) => review.submissionId === submissionId) ?? null;
  }
  async insertSubmission(row: Omit<ReviewSubmissionRow, 'id'>) {
    const id = this.submissions.length + 100;
    this.submissions.push({ ...row, id });
    return id;
  }
  async insertReview(row: Omit<ReviewDecisionRow, 'id'>) {
    const id = this.reviews.length + 200;
    this.reviews.push({ ...row, id });
    return id;
  }
  async updateWorkItem(_id: number, expectedVersion: number, update: Partial<ReviewWorkItemRow>) {
    if (this.workItem.version !== expectedVersion) return false;
    this.workItem = { ...this.workItem, ...update };
    return true;
  }
  async appendEvent(row: ReviewEventRow) {
    this.events.push(row);
  }
}

class MemoryRepository {
  constructor(readonly tx = new MemoryTransaction()) {}
  async transaction<T>(work: (tx: ReviewTransaction) => Promise<T>) {
    return work(this.tx);
  }
}

const service = (repo = new MemoryRepository()) => ({
  repo,
  service: new TeamTaskReviewService(repo, {
    now: () => NOW,
    isLifecycleEnabled: () => true,
    newId: (kind) =>
      kind === 'teamSubmission'
        ? ext('tsb', 's')
        : kind === 'teamReview'
          ? ext('trv', 'v')
          : ext('twe', 'e'),
  }),
});

const submitInput = () => ({
  actorId: ext('usr', 'a'),
  workItemId: ext('twi', 'w'),
  expectedVersion: 4,
  idempotencyKey: 'submit-1',
  summary: 'Delivered the agreed scope.',
  deliverables: ['artifact://one'],
});

const delegation = (overrides: Partial<ReviewDelegationRow> = {}): ReviewDelegationRow => ({
  id: 60,
  externalId: ext('trd', 'g'),
  organizationId: 1,
  projectId: 2,
  delegatorUserId: 20,
  delegateUserId: 40,
  validFrom: new Date('2026-08-31T00:00:00.000Z'),
  validUntil: new Date('2026-09-01T00:00:00.000Z'),
  revokedAt: null,
  ...overrides,
});

describe('TeamTaskReviewService submissions', () => {
  it('creates immutable, monotonic, confirmed-contract-bound submissions and replays exactly', async () => {
    const { repo, service: subject } = service();
    const first = await subject.submit(submitInput());
    expect(first).toMatchObject({
      command: 'submit',
      submissionVersion: 1,
      submittedOnTime: true,
      state: 'submitted',
      version: 5,
    });
    expect(repo.tx.submissions[0]).toMatchObject({
      contractVersionId: 5,
      submittedByUserId: 10,
      submissionVersion: 1,
    });
    expect(repo.tx.locks).toEqual(['contract', 'assignments', 'organization', 'submission']);
    const replay = await subject.submit(submitInput());
    expect(replay).toEqual(first);
    expect(repo.tx.submissions).toHaveLength(1);
  });

  it('resubmits as the next version and computes timeliness against the current revision deadline', async () => {
    const { repo, service: subject } = service();
    repo.tx.workItem.status = 'revision_requested';
    repo.tx.workItem.dueAt = new Date('2026-08-31T03:00:00.000Z');
    repo.tx.submissions.push({
      id: 99,
      externalId: ext('tsb', 'x'),
      organizationId: 1,
      projectId: 2,
      workItemId: 3,
      contractVersionId: 5,
      submittedByUserId: 10,
      submissionVersion: 1,
      summary: 'v1',
      deliverables: ['one'],
      submittedOnTime: true,
      submittedAt: new Date('2026-08-30T00:00:00.000Z'),
      createdAt: new Date('2026-08-30T00:00:00.000Z'),
    });
    const result = await subject.submit({ ...submitInput(), idempotencyKey: 'resubmit-2' });
    expect(result).toMatchObject({
      command: 'resubmit',
      submissionVersion: 2,
      submittedOnTime: false,
      state: 'resubmitted',
    });
    expect(repo.tx.submissions).toHaveLength(2);
  });

  it.each([
    ['collaborator', 11, 'FORBIDDEN'],
    ['inactive responsible', 10, 'NOT_FOUND'],
  ])('rejects %s submission', async (kind, userId, code) => {
    const { repo, service: subject } = service();
    if (kind === 'collaborator') {
      repo.tx.access.actorUserId = userId;
      const [responsible] = repo.tx.assignments;
      if (!responsible) throw new Error('fixture missing responsible');
      repo.tx.assignments.push({ ...responsible, id: 2, userId, role: 'collaborator' });
    } else repo.tx.activeUsers.delete(userId);
    await expect(subject.submit(submitInput())).rejects.toMatchObject({ code });
  });

  it('rejects stale versions and unconfirmed or foreign contract substitution', async () => {
    const { repo, service: subject } = service();
    await expect(subject.submit({ ...submitInput(), expectedVersion: 3 })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    repo.tx.contract.confirmedAt = null;
    await expect(
      subject.submit({ ...submitInput(), idempotencyKey: 'unconfirmed' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    repo.tx.contract.confirmedAt = new Date();
    repo.tx.contract.organizationId = 9;
    await expect(
      subject.submit({ ...submitInput(), idempotencyKey: 'foreign' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects sparse immutable submission deliverables', async () => {
    const { service: subject } = service();
    await expect(
      subject.submit({ ...submitInput(), deliverables: new Array(1) }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('TeamTaskReviewService review and limited rework', () => {
  function submittedForReview() {
    const prepared = service();
    prepared.repo.tx.workItem.status = 'submitted';
    prepared.repo.tx.submissions.push({
      id: 100,
      externalId: ext('tsb', 's'),
      organizationId: 1,
      projectId: 2,
      workItemId: 3,
      contractVersionId: 5,
      submittedByUserId: 10,
      submissionVersion: 1,
      summary: 'done',
      deliverables: ['artifact://one'],
      submittedOnTime: true,
      submittedAt: new Date(NOW),
      createdAt: new Date(NOW),
    });
    prepared.repo.tx.access.actorUserId = 20;
    prepared.repo.tx.access.actorExternalId = ext('usr', 'b');
    return prepared;
  }

  const acceptInput = () => ({
    actorId: ext('usr', 'b'),
    workItemId: ext('twi', 'w'),
    submissionId: ext('tsb', 's'),
    expectedVersion: 4,
    idempotencyKey: 'review-pass',
    decision: 'accepted' as const,
    rationale: 'All contract criteria passed.',
  });

  it('atomically accepts by bound approver, exactly replays, then separately closes by management', async () => {
    const { repo, service: subject } = submittedForReview();
    const accepted = await subject.review(acceptInput());
    expect(accepted).toMatchObject({
      command: 'accept_submission',
      state: 'accepted',
      version: 5,
      submissionId: ext('tsb', 's'),
    });
    expect(repo.tx.reviews).toHaveLength(1);
    expect(repo.tx.reviews[0]).toMatchObject({ reviewDelegationId: null });
    expect(repo.tx.events).toHaveLength(1);
    expect(await subject.review(acceptInput())).toEqual(accepted);
    repo.tx.access.actorOrganizationRole = 'manager';
    await expect(
      subject.close({
        actorId: ext('usr', 'b'),
        workItemId: ext('twi', 'w'),
        expectedVersion: 5,
        idempotencyKey: 'close-member',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    repo.tx.access.actorProjectRole = 'lead';
    const closed = await subject.close({
      actorId: ext('usr', 'b'),
      workItemId: ext('twi', 'w'),
      expectedVersion: 5,
      idempotencyKey: 'close-1',
    });
    expect(closed).toMatchObject({ command: 'close', state: 'completed', version: 6 });
    expect(
      await subject.close({
        actorId: ext('usr', 'b'),
        workItemId: ext('twi', 'w'),
        expectedVersion: 5,
        idempotencyKey: 'close-1',
      }),
    ).toEqual(closed);
  });

  it('allows only an in-window, active, same-project delegated approver with no assignment conflict', async () => {
    const { repo, service: subject } = submittedForReview();
    repo.tx.access.actorUserId = 40;
    repo.tx.access.actorExternalId = ext('usr', 'd');
    repo.tx.delegations.push(
      delegation(),
      delegation({
        id: 61,
        externalId: ext('trd', 'h'),
        validFrom: new Date('2026-08-31T03:00:00.000Z'),
      }),
    );
    const delegated = await subject.review({
      ...acceptInput(),
      actorId: ext('usr', 'd'),
      idempotencyKey: 'delegated',
    });
    expect(delegated).toMatchObject({
      state: 'accepted',
      reviewDelegationId: ext('trd', 'h'),
    });
    expect(repo.tx.reviews[0]).toMatchObject({ reviewDelegationId: 61 });

    const conflicted = submittedForReview();
    conflicted.repo.tx.access.actorUserId = 40;
    conflicted.repo.tx.delegations.push(delegation());
    const [responsible] = conflicted.repo.tx.assignments;
    if (!responsible) throw new Error('fixture missing responsible');
    conflicted.repo.tx.assignments.push({
      ...responsible,
      id: 2,
      userId: 40,
      role: 'collaborator',
    });
    await expect(
      conflicted.service.review({
        ...acceptInput(),
        actorId: ext('usr', 'd'),
        idempotencyKey: 'conflict',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects expired, cross-project, revoked, or inactive delegation through the effective grant boundary', async () => {
    const { repo, service: subject } = submittedForReview();
    repo.tx.access.actorUserId = 40;
    repo.tx.delegations.push(delegation({ revokedAt: new Date('2026-08-31T03:30:00.000Z') }));
    await expect(
      subject.review({ ...acceptInput(), actorId: ext('usr', 'd') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    repo.tx.delegations = [delegation()];
    repo.tx.activeUsers.delete(20);
    await expect(
      subject.review({
        ...acceptInput(),
        actorId: ext('usr', 'd'),
        idempotencyKey: 'inactive-delegator',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const foreign = submittedForReview();
    foreign.repo.tx.access.actorUserId = 40;
    foreign.repo.tx.forcedDelegation = delegation({ organizationId: 9 });
    await expect(
      foreign.service.review({
        ...acceptInput(),
        actorId: ext('usr', 'd'),
        idempotencyKey: 'foreign-grant',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects the immutable submission author after responsibility is transferred', async () => {
    const { repo, service: subject } = submittedForReview();
    const [submission] = repo.tx.submissions;
    const [responsible] = repo.tx.assignments;
    if (!submission || !responsible) throw new Error('fixture incomplete');
    submission.submittedByUserId = 20;
    responsible.userId = 11;
    repo.tx.activeUsers.add(11);
    await expect(subject.review(acceptInput())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('requires structured revision fields, rejects scope-add, and increments the server round once', async () => {
    const { repo, service: subject } = submittedForReview();
    const request = {
      ...acceptInput(),
      decision: 'request_revision' as const,
      idempotencyKey: 'revision-1',
      failedCriterionIds: ['quality'],
      evidenceReferences: [{ kind: 'missing_evidence' as const, reference: 'screenshot' }],
      revisionInstructions: ['Attach a readable screenshot.'],
      newDeadline: '2026-09-01T04:00:00.000Z',
    };
    const result = await subject.review(request);
    expect(result).toMatchObject({
      command: 'request_revision',
      state: 'revision_requested',
      revisionRound: 1,
    });
    expect(repo.tx.workItem.revisionRound).toBe(1);
    expect(repo.tx.reviews[0]).toMatchObject({
      evidenceReferences: [{ kind: 'missing_evidence', reference: 'screenshot' }],
    });
    expect(await subject.review(request)).toEqual(result);
    expect(repo.tx.workItem.revisionRound).toBe(1);

    const scopeAdd = submittedForReview();
    await expect(
      scopeAdd.service.review({ ...request, failedCriterionIds: ['new-scope'] }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const incomplete = submittedForReview();
    await expect(
      incomplete.service.review({ ...request, revisionInstructions: [] }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('persists canonical state-machine revision evidence rather than raw duplicates', async () => {
    const { repo, service: subject } = submittedForReview();
    await subject.review({
      ...acceptInput(),
      decision: 'request_revision',
      idempotencyKey: 'canonical-revision',
      failedCriterionIds: ['quality'],
      evidenceReferences: [
        { kind: 'evidence', reference: ' Artifact://Proof ' },
        { kind: 'evidence', reference: 'artifact://proof' },
      ],
      revisionInstructions: ['Attach proof.'],
      newDeadline: '2026-09-01T04:00:00.000Z',
    });
    expect(repo.tx.reviews[0]?.evidenceReferences).toEqual([
      { kind: 'evidence', reference: 'Artifact://Proof' },
    ]);
  });

  it.each(['failedCriterionIds', 'evidenceReferences', 'revisionInstructions'] as const)(
    'rejects sparse immutable revision array %s',
    async (field) => {
      const prepared = submittedForReview();
      await expect(
        prepared.service.review({
          ...acceptInput(),
          decision: 'request_revision',
          idempotencyKey: `sparse-${field}`,
          failedCriterionIds: ['quality'],
          evidenceReferences: [{ kind: 'evidence', reference: 'artifact://proof' }],
          revisionInstructions: ['Attach proof.'],
          newDeadline: '2026-09-01T04:00:00.000Z',
          [field]: new Array(1),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    },
  );

  it('requires arbitration on the third rejection and ignores a client revisionRound reset', async () => {
    const { repo, service: subject } = submittedForReview();
    repo.tx.workItem.revisionRound = 2;
    await expect(
      subject.review({
        ...acceptInput(),
        decision: 'request_revision',
        idempotencyKey: 'third-reject',
        failedCriterionIds: ['quality'],
        evidenceReferences: [{ kind: 'evidence', reference: 'artifact://bad' }],
        revisionInstructions: ['Correct the defect.'],
        newDeadline: '2026-09-01T04:00:00.000Z',
        revisionRound: 0,
      }),
    ).rejects.toMatchObject({ code: 'ARBITRATION_REQUIRED' });
    expect(repo.tx.workItem.revisionRound).toBe(2);
  });

  it('fails closed for inactive organization/project actors before exact receipt replay', async () => {
    const newSubmission = service();
    newSubmission.repo.tx.access.actorOrganizationMembershipActive = false;
    await expect(newSubmission.service.submit(submitInput())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const newReview = submittedForReview();
    newReview.repo.tx.access.actorProjectMembershipActive = false;
    await expect(newReview.service.review(acceptInput())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const newClose = submittedForReview();
    newClose.repo.tx.workItem.status = 'accepted';
    newClose.repo.tx.access.actorProjectRole = 'lead';
    newClose.repo.tx.access.actorProjectMembershipActive = false;
    await expect(
      newClose.service.close({
        actorId: ext('usr', 'b'),
        workItemId: ext('twi', 'w'),
        expectedVersion: 4,
        idempotencyKey: 'inactive-new-close',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const submitted = service();
    await submitted.service.submit(submitInput());
    submitted.repo.tx.access.actorOrganizationMembershipActive = false;
    await expect(submitted.service.submit(submitInput())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const reviewed = submittedForReview();
    await reviewed.service.review(acceptInput());
    reviewed.repo.tx.access.actorProjectMembershipActive = false;
    await expect(reviewed.service.review(acceptInput())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const closed = submittedForReview();
    await closed.service.review(acceptInput());
    closed.repo.tx.access.actorProjectRole = 'lead';
    const closeInput = {
      actorId: ext('usr', 'b'),
      workItemId: ext('twi', 'w'),
      expectedVersion: 5,
      idempotencyKey: 'inactive-close-replay',
    };
    await closed.service.close(closeInput);
    closed.repo.tx.access.actorProjectMembershipActive = false;
    await expect(closed.service.close(closeInput)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_DUP_ENTRY'])(
    'rejects cross-family idempotency reuse and maps %s to a stable conflict',
    async (databaseCode) => {
      const prepared = submittedForReview();
      prepared.repo.tx.planningEvents.push({ organizationId: 1, idempotencyKey: 'review-pass' });
      await expect(prepared.service.review(acceptInput())).rejects.toMatchObject({
        code: 'CONFLICT',
      });

      const deadlockRepo = new MemoryRepository();
      deadlockRepo.transaction = async () => {
        throw Object.assign(new Error('raw mysql detail'), { code: databaseCode });
      };
      await expect(service(deadlockRepo).service.submit(submitInput())).rejects.toEqual(
        new TeamTaskReviewServiceError('CONFLICT'),
      );
    },
  );
});
