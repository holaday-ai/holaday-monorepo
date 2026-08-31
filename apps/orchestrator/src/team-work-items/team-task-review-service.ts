import { createHash } from 'node:crypto';
import { isExternalId, newExternalId } from '@holaday/shared-types';
import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import { acceptanceContractVersions } from '../db/schema/acceptance-contract-versions.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { projectMembers } from '../db/schema/project-members.js';
import { projects } from '../db/schema/projects.js';
import { teamArbitrationDecisions } from '../db/schema/team-arbitration-decisions.js';
import { teamProjectPlanningEvents } from '../db/schema/team-project-planning-events.js';
import { teamTaskReviewDelegations } from '../db/schema/team-task-review-delegations.js';
import { teamWorkItemAppeals } from '../db/schema/team-work-item-appeals.js';
import { teamWorkItemAssignments } from '../db/schema/team-work-item-assignments.js';
import { teamWorkItemEvents } from '../db/schema/team-work-item-events.js';
import { teamWorkItemReviews } from '../db/schema/team-work-item-reviews.js';
import { teamWorkItemSubmissions } from '../db/schema/team-work-item-submissions.js';
import { teamWorkItems } from '../db/schema/team-work-items.js';
import { users } from '../db/schema/users.js';
import { hasDenseArrayEntries } from './acceptance-contract.js';
import { isTeamTaskLifecycleEnabledFor } from './team-task-access.js';
import { decideTeamTaskPermission } from './team-task-permissions.js';
import type {
  TeamTaskAssignmentRow,
  TeamTaskEventRow,
  TeamTaskProjectAccessSnapshot,
} from './team-task-service.js';
import type {
  TeamTaskEvidenceReference,
  TeamTaskRevisionSnapshot,
  TeamTaskState,
} from './team-task-state-machine.js';
import { transitionTeamTask } from './team-task-state-machine.js';

export type TeamTaskReviewServiceErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INVALID_INPUT'
  | 'VERSION_CONFLICT'
  | 'ARBITRATION_REQUIRED';

export class TeamTaskReviewServiceError extends Error {
  constructor(public readonly code: TeamTaskReviewServiceErrorCode) {
    super(code);
    this.name = 'TeamTaskReviewServiceError';
  }
}

export interface ReviewWorkItemRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  projectExternalId: string;
  createdByUserId: number;
  status: TeamTaskState;
  version: number;
  currentContractVersionId: number | null;
  dueAt: Date | null;
  revisionRound: number;
  closedAt: Date | null;
}

export interface ReviewContractRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  version: number;
  criteria: Array<{ id: string; description: string }>;
  approverUserId: number;
  dueAt: Date;
  maxRevisionRounds: number;
  confirmedByUserId: number | null;
  confirmedAt: Date | null;
}

export interface ReviewSubmissionRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  contractVersionId: number;
  submittedByUserId: number;
  submissionVersion: number;
  summary: string;
  deliverables: string[];
  submittedOnTime: boolean;
  submittedAt: Date;
  createdAt: Date;
}

export interface ReviewDelegationRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  delegatorUserId: number;
  delegateUserId: number;
  validFrom: Date;
  validUntil: Date;
  revokedAt: Date | null;
}

export interface ReviewDecisionRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  submissionId: number;
  contractVersionId: number;
  reviewerUserId: number;
  reviewDelegationId: number | null;
  reviewAttempt: number;
  decision: 'accepted' | 'request_revision';
  failedCriterionIds: string[] | null;
  evidenceReferences: TeamTaskEvidenceReference[] | null;
  revisionInstructions: string[] | null;
  rationale: string | null;
  newDueAt: Date | null;
  reviewedAt: Date;
  createdAt: Date;
}

export interface ReturnForReviewAuthorizationRow {
  appealId: number;
  decisionId: number;
  reviewId: number;
  submissionId: number;
  contractVersionId: number;
  workItemId: number;
  organizationId: number;
  projectId: number;
  decidedAt: Date;
}

export type ReviewEventRow = TeamTaskEventRow;
export interface ReviewPlanningEventRow {
  organizationId: number;
  idempotencyKey: string;
}

export interface ReviewTransaction {
  lockWorkItemAccess(
    actorExternalId: string,
    workItemExternalId: string,
  ): Promise<{ access: TeamTaskProjectAccessSnapshot; workItem: ReviewWorkItemRow } | null>;
  lockCurrentContract(workItemId: number, contractId: number): Promise<ReviewContractRow | null>;
  listAssignments(workItemId: number): Promise<TeamTaskAssignmentRow[]>;
  loadActiveUser(organizationId: number, userId: number): Promise<boolean>;
  findEffectiveDelegation(
    organizationId: number,
    projectId: number,
    delegatorUserId: number,
    delegateUserId: number,
    at: Date,
  ): Promise<ReviewDelegationRow | null>;
  lockOrganizationIdempotencyScope(organizationId: number): Promise<boolean>;
  findEventByIdempotencyKey(
    organizationId: number,
    idempotencyKey: string,
  ): Promise<ReviewEventRow | null>;
  hasPlanningEventByIdempotencyKey(
    organizationId: number,
    idempotencyKey: string,
  ): Promise<boolean>;
  lockLatestSubmission(workItemId: number): Promise<ReviewSubmissionRow | null>;
  lockSubmissionByExternalId(
    workItemId: number,
    externalId: string,
  ): Promise<ReviewSubmissionRow | null>;
  lockReviewsBySubmissionId(submissionId: number): Promise<ReviewDecisionRow[] | null>;
  lockReturnForReviewDecision(
    reviewId: number,
    submissionId: number,
    contractVersionId: number,
    workItemId: number,
    organizationId: number,
    projectId: number,
  ): Promise<ReturnForReviewAuthorizationRow | null>;
  insertSubmission(row: Omit<ReviewSubmissionRow, 'id'>): Promise<number>;
  insertReview(row: Omit<ReviewDecisionRow, 'id'>): Promise<number>;
  updateWorkItem(
    workItemId: number,
    expectedVersion: number,
    update: Partial<
      Pick<ReviewWorkItemRow, 'status' | 'version' | 'dueAt' | 'revisionRound' | 'closedAt'>
    >,
  ): Promise<boolean>;
  appendEvent(event: ReviewEventRow): Promise<void>;
}

export interface ReviewRepository {
  transaction<T>(work: (tx: ReviewTransaction) => Promise<T>): Promise<T>;
}

export type ReviewReceipt =
  | {
      command: 'submit' | 'resubmit';
      eventId: string;
      workItemId: string;
      submissionId: string;
      contractVersionId: string;
      submissionVersion: number;
      submittedOnTime: boolean;
      state: TeamTaskState;
      version: number;
    }
  | {
      command: 'accept_submission' | 'request_revision';
      eventId: string;
      reviewId: string;
      workItemId: string;
      submissionId: string;
      reviewDelegationId: string | null;
      reviewAttempt: number;
      state: TeamTaskState;
      version: number;
      revisionRound: number;
      dueAt?: string;
    }
  | {
      command: 'close';
      eventId: string;
      workItemId: string;
      state: TeamTaskState;
      version: number;
      closedAt: string;
    };

interface Dependencies {
  now: () => string;
  isLifecycleEnabled: (actorExternalId: string, organizationEnabled: boolean) => boolean;
  newId: (kind: 'teamSubmission' | 'teamReview' | 'teamWorkItemEvent') => string;
}

const defaults: Dependencies = {
  now: () => new Date().toISOString(),
  isLifecycleEnabled: isTeamTaskLifecycleEnabledFor,
  newId: (kind) => newExternalId(kind),
};

const MAX_REVIEW_ATTEMPTS = 100;

function fail(code: TeamTaskReviewServiceErrorCode): never {
  throw new TeamTaskReviewServiceError(code);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, max: number, kind?: Parameters<typeof isExternalId>[1]) {
  if (typeof value !== 'string') return fail('INVALID_INPUT');
  const result = value.trim();
  if (!result || result.length > max || (kind && !isExternalId(result, kind))) {
    return fail('INVALID_INPUT');
  }
  return result;
}

function versionField(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) return fail('INVALID_INPUT');
  return value as number;
}

function idempotencyField(value: unknown) {
  const result = stringField(value, 64);
  if (/[^\u0021-\u007e]/u.test(result)) return fail('INVALID_INPUT');
  return result;
}

function stringList(value: unknown, maxCount: number, maxLength: number): string[] {
  if (
    !Array.isArray(value) ||
    !hasDenseArrayEntries(value) ||
    value.length < 1 ||
    value.length > maxCount
  ) {
    return fail('INVALID_INPUT');
  }
  const result = value.map((entry) => stringField(entry, maxLength));
  if (new Set(result.map((entry) => entry.toLocaleLowerCase('en-US'))).size !== result.length) {
    return fail('INVALID_INPUT');
  }
  return result;
}

function instant(value: unknown): Date {
  if (typeof value !== 'string') return fail('INVALID_INPUT');
  const result = new Date(value);
  if (!Number.isFinite(result.valueOf()) || result.toISOString() !== value) {
    return fail('INVALID_INPUT');
  }
  return result;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stable(entry)]),
  );
}

function requestHash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

function receiptFromEvent(event: ReviewEventRow, hash: string): ReviewReceipt {
  if (!isRecord(event.metadata) || event.metadata.requestHash !== hash) return fail('CONFLICT');
  const receipt = event.metadata.receipt;
  if (!isRecord(receipt) || typeof receipt.command !== 'string') return fail('CONFLICT');
  if (
    (receipt.command === 'accept_submission' || receipt.command === 'request_revision') &&
    (!Number.isSafeInteger(receipt.reviewAttempt) ||
      (receipt.reviewAttempt as number) < 1 ||
      (receipt.reviewAttempt as number) > MAX_REVIEW_ATTEMPTS)
  ) {
    return fail('CONFLICT');
  }
  return receipt as unknown as ReviewReceipt;
}

function translateTransition(result: ReturnType<typeof transitionTeamTask>) {
  if (!result.ok) return fail('INVALID_INPUT');
  return result;
}

function checkAccess(
  dependencies: Dependencies,
  access: TeamTaskProjectAccessSnapshot,
  workItem: ReviewWorkItemRow,
) {
  if (
    !access.organizationActive ||
    !access.actorOrganizationMembershipActive ||
    !access.actorProjectMembershipActive ||
    access.projectOrganizationId !== access.organizationId ||
    workItem.organizationId !== access.organizationId ||
    workItem.projectId !== access.projectId
  ) {
    fail('NOT_FOUND');
  }
  if (
    !dependencies.isLifecycleEnabled(access.actorExternalId, access.organizationTeamProjectsEnabled)
  ) {
    fail('NOT_FOUND');
  }
}

function permissionContext(
  access: TeamTaskProjectAccessSnapshot,
  workItem: ReviewWorkItemRow,
  responsibleUserId: number,
  designated: boolean,
) {
  return {
    actorOrganizationRole: access.actorOrganizationRole,
    actorOrganizationMembershipActive: access.actorOrganizationMembershipActive,
    actorProjectRole: access.actorProjectRole,
    actorProjectMembershipActive: access.actorProjectMembershipActive,
    actorIsCreator: access.actorUserId === workItem.createdByUserId,
    actorIsResponsible: access.actorUserId === responsibleUserId,
    actorIsLatestReviewer: false,
    actorIsDesignatedApprover: designated,
    actorIsDesignatedIndependentArbitrator: false,
  } as const;
}

function oneResponsible(assignments: TeamTaskAssignmentRow[]) {
  const active = assignments.filter(
    (assignment) => assignment.role === 'responsible' && assignment.status === 'accepted',
  );
  if (active.length !== 1) return fail('CONFLICT');
  const [responsible] = active;
  if (!responsible) return fail('CONFLICT');
  return responsible;
}

function eventMetadata(hash: string, receipt: ReviewReceipt) {
  return { requestHash: hash, receipt };
}

function verifyReviewHistory(
  reviews: ReviewDecisionRow[],
  submission: ReviewSubmissionRow,
  workItem: ReviewWorkItemRow,
  contract: ReviewContractRow,
) {
  if (reviews.length > MAX_REVIEW_ATTEMPTS) return fail('CONFLICT');
  for (let index = 0; index < reviews.length; index += 1) {
    const review = reviews[index];
    if (
      !review ||
      review.reviewAttempt !== index + 1 ||
      review.organizationId !== workItem.organizationId ||
      review.projectId !== workItem.projectId ||
      review.workItemId !== workItem.id ||
      review.submissionId !== submission.id ||
      review.contractVersionId !== contract.id
    ) {
      return fail('CONFLICT');
    }
  }
}

function verifyReturnAuthorization(
  authorization: ReturnForReviewAuthorizationRow,
  review: ReviewDecisionRow,
  submission: ReviewSubmissionRow,
  workItem: ReviewWorkItemRow,
  contract: ReviewContractRow,
) {
  if (
    authorization.reviewId !== review.id ||
    authorization.submissionId !== submission.id ||
    authorization.contractVersionId !== contract.id ||
    authorization.workItemId !== workItem.id ||
    authorization.organizationId !== workItem.organizationId ||
    authorization.projectId !== workItem.projectId
  ) {
    return fail('NOT_FOUND');
  }
}

function isLockConflict(error: unknown) {
  return (
    isRecord(error) &&
    (error.code === 'ER_LOCK_DEADLOCK' ||
      error.code === 'ER_LOCK_WAIT_TIMEOUT' ||
      error.code === 'ER_DUP_ENTRY')
  );
}

export class TeamTaskReviewService {
  private readonly dependencies: Dependencies;

  constructor(
    private readonly repository: ReviewRepository,
    dependencies: Partial<Dependencies> = {},
  ) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  private async run<T>(work: (tx: ReviewTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.repository.transaction(work);
    } catch (error) {
      if (isLockConflict(error)) return fail('CONFLICT');
      throw error;
    }
  }

  async submit(input: unknown): Promise<ReviewReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorId = stringField(input.actorId, 32, 'user');
    const workItemId = stringField(input.workItemId, 32, 'teamWorkItem');
    const expectedVersion = versionField(input.expectedVersion);
    const idempotencyKey = idempotencyField(input.idempotencyKey);
    const summary = stringField(input.summary, 4_000);
    const deliverables = stringList(input.deliverables, 100, 1_000);
    const hash = requestHash({ actorId, workItemId, expectedVersion, summary, deliverables });

    return this.run(async (tx) => {
      const locked = await tx.lockWorkItemAccess(actorId, workItemId);
      if (!locked) return fail('NOT_FOUND');
      const { access, workItem } = locked;
      checkAccess(this.dependencies, access, workItem);
      if (!workItem.currentContractVersionId) return fail('CONFLICT');
      const contract = await tx.lockCurrentContract(workItem.id, workItem.currentContractVersionId);
      if (
        !contract ||
        contract.organizationId !== workItem.organizationId ||
        contract.projectId !== workItem.projectId ||
        contract.workItemId !== workItem.id
      ) {
        return fail('NOT_FOUND');
      }
      const assignments = await tx.listAssignments(workItem.id);
      const responsible = oneResponsible(assignments);
      if (!(await tx.lockOrganizationIdempotencyScope(workItem.organizationId))) {
        return fail('NOT_FOUND');
      }
      const previous = await tx.findEventByIdempotencyKey(workItem.organizationId, idempotencyKey);
      if (previous) return receiptFromEvent(previous, hash);
      if (await tx.hasPlanningEventByIdempotencyKey(workItem.organizationId, idempotencyKey)) {
        return fail('CONFLICT');
      }
      if (workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
      if (!contract.confirmedAt || contract.confirmedByUserId !== responsible.userId) {
        return fail('CONFLICT');
      }
      if (!(await tx.loadActiveUser(workItem.organizationId, responsible.userId))) {
        return fail('NOT_FOUND');
      }
      const permission = decideTeamTaskPermission(
        'submit',
        permissionContext(access, workItem, responsible.userId, false),
      );
      if (!permission.allowed) return fail('FORBIDDEN');
      if (!workItem.dueAt) return fail('CONFLICT');
      const latest = await tx.lockLatestSubmission(workItem.id);
      const command = workItem.status === 'revision_requested' ? 'resubmit' : 'submit';
      const at = instant(this.dependencies.now());
      const transition = translateTransition(
        transitionTeamTask(
          { state: workItem.status, appealOpen: false },
          {
            type: command,
            submittedAt: at.toISOString(),
            dueAt: workItem.dueAt.toISOString(),
          },
        ),
      );
      if (!transition.submission) return fail('CONFLICT');
      const submissionExternalId = this.dependencies.newId('teamSubmission');
      const eventId = this.dependencies.newId('teamWorkItemEvent');
      const submissionVersion = (latest?.submissionVersion ?? 0) + 1;
      await tx.insertSubmission({
        externalId: submissionExternalId,
        organizationId: workItem.organizationId,
        projectId: workItem.projectId,
        workItemId: workItem.id,
        contractVersionId: contract.id,
        submittedByUserId: access.actorUserId,
        submissionVersion,
        summary,
        deliverables,
        submittedOnTime: transition.submission.submittedOnTime,
        submittedAt: at,
        createdAt: at,
      });
      if (
        !(await tx.updateWorkItem(workItem.id, expectedVersion, {
          status: transition.state,
          version: expectedVersion + 1,
        }))
      ) {
        return fail('VERSION_CONFLICT');
      }
      const receipt: ReviewReceipt = {
        command,
        eventId,
        workItemId,
        submissionId: submissionExternalId,
        contractVersionId: contract.externalId,
        submissionVersion,
        submittedOnTime: transition.submission.submittedOnTime,
        state: transition.state,
        version: expectedVersion + 1,
      };
      await tx.appendEvent({
        externalId: eventId,
        organizationId: workItem.organizationId,
        projectId: workItem.projectId,
        workItemId: workItem.id,
        actorUserId: access.actorUserId,
        eventType: command === 'submit' ? 'task_submitted' : 'task_resubmitted',
        fromState: workItem.status,
        toState: transition.state,
        contractVersionId: contract.id,
        idempotencyKey,
        metadata: eventMetadata(hash, receipt),
        occurredAt: at,
      });
      return receipt;
    });
  }

  async review(input: unknown): Promise<ReviewReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorId = stringField(input.actorId, 32, 'user');
    const workItemId = stringField(input.workItemId, 32, 'teamWorkItem');
    const submissionId = stringField(input.submissionId, 32, 'teamSubmission');
    const expectedVersion = versionField(input.expectedVersion);
    const idempotencyKey = idempotencyField(input.idempotencyKey);
    const decision = input.decision;
    if (
      decision !== 'accepted' &&
      decision !== 'request_revision' &&
      decision !== 'escalate_arbitration'
    )
      return fail('INVALID_INPUT');
    const rationale =
      input.rationale === undefined || input.rationale === null
        ? null
        : stringField(input.rationale, 4_000);
    const revision =
      decision === 'request_revision'
        ? {
            failedCriterionIds: stringList(input.failedCriterionIds, 100, 100),
            evidenceReferences: this.evidenceReferences(input.evidenceReferences),
            revisionInstructions: stringList(input.revisionInstructions, 50, 1_000),
            newDeadline: instant(input.newDeadline),
          }
        : null;
    const hash = requestHash({
      actorId,
      workItemId,
      submissionId,
      expectedVersion,
      decision,
      rationale,
      revision: revision && { ...revision, newDeadline: revision.newDeadline.toISOString() },
    });

    return this.run(async (tx) => {
      const locked = await tx.lockWorkItemAccess(actorId, workItemId);
      if (!locked) return fail('NOT_FOUND');
      const { access, workItem } = locked;
      checkAccess(this.dependencies, access, workItem);
      if (!workItem.currentContractVersionId) return fail('CONFLICT');
      const contract = await tx.lockCurrentContract(workItem.id, workItem.currentContractVersionId);
      if (
        !contract ||
        contract.organizationId !== workItem.organizationId ||
        contract.projectId !== workItem.projectId ||
        contract.workItemId !== workItem.id ||
        !contract.confirmedAt
      ) {
        return fail('NOT_FOUND');
      }
      const assignments = await tx.listAssignments(workItem.id);
      const responsible = oneResponsible(assignments);
      if (!(await tx.lockOrganizationIdempotencyScope(workItem.organizationId))) {
        return fail('NOT_FOUND');
      }
      const previous = await tx.findEventByIdempotencyKey(workItem.organizationId, idempotencyKey);
      if (previous) return receiptFromEvent(previous, hash);
      if (await tx.hasPlanningEventByIdempotencyKey(workItem.organizationId, idempotencyKey)) {
        return fail('CONFLICT');
      }
      if (workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
      const submission = await tx.lockSubmissionByExternalId(workItem.id, submissionId);
      if (
        !submission ||
        submission.organizationId !== workItem.organizationId ||
        submission.projectId !== workItem.projectId ||
        submission.contractVersionId !== contract.id
      ) {
        return fail('NOT_FOUND');
      }
      const reviewHistory = await tx.lockReviewsBySubmissionId(submission.id);
      if (!reviewHistory) return fail('CONFLICT');
      verifyReviewHistory(reviewHistory, submission, workItem, contract);
      let reviewAttempt = 1;
      const previousReview = reviewHistory.at(-1);
      if (previousReview) {
        if (previousReview.reviewAttempt >= MAX_REVIEW_ATTEMPTS) return fail('CONFLICT');
        const returnAuthorization = await tx.lockReturnForReviewDecision(
          previousReview.id,
          submission.id,
          contract.id,
          workItem.id,
          workItem.organizationId,
          workItem.projectId,
        );
        if (!returnAuthorization) return fail('CONFLICT');
        verifyReturnAuthorization(
          returnAuthorization,
          previousReview,
          submission,
          workItem,
          contract,
        );
        reviewAttempt = previousReview.reviewAttempt + 1;
      }
      const isDirect = access.actorUserId === contract.approverUserId;
      if (!(await tx.loadActiveUser(workItem.organizationId, contract.approverUserId))) {
        return fail('NOT_FOUND');
      }
      let effectiveDelegation: ReviewDelegationRow | null = null;
      const at = instant(this.dependencies.now());
      if (!isDirect) {
        if (!(await tx.loadActiveUser(workItem.organizationId, access.actorUserId))) {
          return fail('NOT_FOUND');
        }
        effectiveDelegation = await tx.findEffectiveDelegation(
          workItem.organizationId,
          workItem.projectId,
          contract.approverUserId,
          access.actorUserId,
          at,
        );
        if (
          effectiveDelegation &&
          (effectiveDelegation.organizationId !== workItem.organizationId ||
            effectiveDelegation.projectId !== workItem.projectId ||
            effectiveDelegation.delegatorUserId !== contract.approverUserId ||
            effectiveDelegation.delegateUserId !== access.actorUserId ||
            effectiveDelegation.revokedAt !== null ||
            effectiveDelegation.validFrom > at ||
            effectiveDelegation.validUntil < at)
        ) {
          return fail('NOT_FOUND');
        }
      }
      if (access.actorUserId === submission.submittedByUserId) return fail('FORBIDDEN');
      if (
        assignments.some(
          (assignment) =>
            assignment.userId === access.actorUserId && assignment.status === 'accepted',
        )
      ) {
        return fail('FORBIDDEN');
      }
      const permission = decideTeamTaskPermission(
        'review',
        permissionContext(access, workItem, responsible.userId, isDirect || !!effectiveDelegation),
      );
      if (!permission.allowed) return fail('FORBIDDEN');
      const started = translateTransition(
        transitionTeamTask({ state: workItem.status, appealOpen: false }, { type: 'start_review' }),
      );
      const reviewExternalId = this.dependencies.newId('teamReview');
      const eventId = this.dependencies.newId('teamWorkItemEvent');
      let nextState: TeamTaskState;
      let revisionRound = workItem.revisionRound;
      let dueAt: Date | null = workItem.dueAt;
      let normalizedRevision: TeamTaskRevisionSnapshot | null = null;
      if (decision === 'accepted') {
        nextState = translateTransition(
          transitionTeamTask({ state: started.state, appealOpen: false }, { type: 'accept' }),
        ).state;
      } else if (decision === 'escalate_arbitration') {
        if (workItem.revisionRound < Math.min(contract.maxRevisionRounds, 2)) {
          return fail('CONFLICT');
        }
        nextState = 'revision_requested';
      } else {
        const requiredRevision = revision;
        if (!requiredRevision) return fail('INVALID_INPUT');
        if (workItem.revisionRound >= Math.min(contract.maxRevisionRounds, 2)) {
          return fail('ARBITRATION_REQUIRED');
        }
        const allowedCriterionIds = new Set(contract.criteria.map((criterion) => criterion.id));
        if (
          !requiredRevision.failedCriterionIds.every((criterionId) =>
            allowedCriterionIds.has(criterionId),
          )
        ) {
          return fail('INVALID_INPUT');
        }
        const transitioned = translateTransition(
          transitionTeamTask(
            { state: started.state, appealOpen: false },
            {
              type: 'request_revision',
              failedCriterionIds: requiredRevision.failedCriterionIds,
              evidenceReferences: requiredRevision.evidenceReferences,
              revisionInstructions: requiredRevision.revisionInstructions,
              newDeadline: requiredRevision.newDeadline.toISOString(),
              reviewAt: at.toISOString(),
            },
          ),
        );
        if (!transitioned.revision) return fail('CONFLICT');
        normalizedRevision = transitioned.revision;
        nextState = transitioned.state;
        revisionRound += 1;
        dueAt = new Date(normalizedRevision.newDeadline);
      }
      await tx.insertReview({
        externalId: reviewExternalId,
        organizationId: workItem.organizationId,
        projectId: workItem.projectId,
        workItemId: workItem.id,
        submissionId: submission.id,
        contractVersionId: contract.id,
        reviewerUserId: access.actorUserId,
        reviewDelegationId: effectiveDelegation?.id ?? null,
        reviewAttempt,
        decision: decision === 'accepted' ? 'accepted' : 'request_revision',
        failedCriterionIds: normalizedRevision?.failedCriterionIds ?? null,
        evidenceReferences: normalizedRevision?.evidenceReferences ?? null,
        revisionInstructions: normalizedRevision?.revisionInstructions ?? null,
        rationale,
        newDueAt: normalizedRevision ? new Date(normalizedRevision.newDeadline) : null,
        reviewedAt: at,
        createdAt: at,
      });
      if (
        !(await tx.updateWorkItem(workItem.id, expectedVersion, {
          status: nextState,
          version: expectedVersion + 1,
          revisionRound,
          dueAt,
        }))
      ) {
        return fail('VERSION_CONFLICT');
      }
      const receipt: ReviewReceipt = {
        command: decision === 'accepted' ? 'accept_submission' : 'request_revision',
        eventId,
        reviewId: reviewExternalId,
        workItemId,
        submissionId,
        reviewDelegationId: effectiveDelegation?.externalId ?? null,
        reviewAttempt,
        state: nextState,
        version: expectedVersion + 1,
        revisionRound,
        ...(revision ? { dueAt: revision.newDeadline.toISOString() } : {}),
      };
      await tx.appendEvent({
        externalId: eventId,
        organizationId: workItem.organizationId,
        projectId: workItem.projectId,
        workItemId: workItem.id,
        actorUserId: access.actorUserId,
        eventType:
          decision === 'accepted' ? 'submission_accepted' : 'submission_revision_requested',
        fromState: workItem.status,
        toState: nextState,
        contractVersionId: contract.id,
        idempotencyKey,
        metadata: eventMetadata(hash, receipt),
        occurredAt: at,
      });
      return receipt;
    });
  }

  async close(input: unknown): Promise<ReviewReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorId = stringField(input.actorId, 32, 'user');
    const workItemId = stringField(input.workItemId, 32, 'teamWorkItem');
    const expectedVersion = versionField(input.expectedVersion);
    const idempotencyKey = idempotencyField(input.idempotencyKey);
    const hash = requestHash({ actorId, workItemId, expectedVersion });
    return this.run(async (tx) => {
      const locked = await tx.lockWorkItemAccess(actorId, workItemId);
      if (!locked) return fail('NOT_FOUND');
      const { access, workItem } = locked;
      checkAccess(this.dependencies, access, workItem);
      if (!workItem.currentContractVersionId) return fail('CONFLICT');
      const contract = await tx.lockCurrentContract(workItem.id, workItem.currentContractVersionId);
      if (
        !contract ||
        contract.organizationId !== workItem.organizationId ||
        contract.projectId !== workItem.projectId ||
        contract.workItemId !== workItem.id
      ) {
        return fail('NOT_FOUND');
      }
      const assignments = await tx.listAssignments(workItem.id);
      const responsible = oneResponsible(assignments);
      if (!(await tx.lockOrganizationIdempotencyScope(workItem.organizationId)))
        return fail('NOT_FOUND');
      const previous = await tx.findEventByIdempotencyKey(workItem.organizationId, idempotencyKey);
      if (previous) return receiptFromEvent(previous, hash);
      if (await tx.hasPlanningEventByIdempotencyKey(workItem.organizationId, idempotencyKey))
        return fail('CONFLICT');
      if (workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
      if (access.actorProjectRole !== 'lead') return fail('FORBIDDEN');
      const permission = decideTeamTaskPermission(
        'close',
        permissionContext(access, workItem, responsible.userId, false),
      );
      if (!permission.allowed) return fail('FORBIDDEN');
      const transition = translateTransition(
        transitionTeamTask({ state: workItem.status, appealOpen: false }, { type: 'complete' }),
      );
      const at = instant(this.dependencies.now());
      const eventId = this.dependencies.newId('teamWorkItemEvent');
      if (
        !(await tx.updateWorkItem(workItem.id, expectedVersion, {
          status: transition.state,
          version: expectedVersion + 1,
          closedAt: at,
        }))
      ) {
        return fail('VERSION_CONFLICT');
      }
      const receipt: ReviewReceipt = {
        command: 'close',
        eventId,
        workItemId,
        state: transition.state,
        version: expectedVersion + 1,
        closedAt: at.toISOString(),
      };
      await tx.appendEvent({
        externalId: eventId,
        organizationId: workItem.organizationId,
        projectId: workItem.projectId,
        workItemId: workItem.id,
        actorUserId: access.actorUserId,
        eventType: 'task_completed',
        fromState: workItem.status,
        toState: transition.state,
        contractVersionId: contract.id,
        idempotencyKey,
        metadata: eventMetadata(hash, receipt),
        occurredAt: at,
      });
      return receipt;
    });
  }

  private evidenceReferences(value: unknown): TeamTaskEvidenceReference[] {
    if (
      !Array.isArray(value) ||
      !hasDenseArrayEntries(value) ||
      value.length < 1 ||
      value.length > 100
    )
      return fail('INVALID_INPUT');
    return value.map((entry) => {
      if (!isRecord(entry) || (entry.kind !== 'evidence' && entry.kind !== 'missing_evidence')) {
        return fail('INVALID_INPUT');
      }
      return { kind: entry.kind, reference: stringField(entry.reference, 500) };
    });
  }
}

type DrizzleExecutor = Pick<DB, 'select' | 'insert' | 'update'>;
const states = new Set<string>([
  'draft',
  'ready',
  'assigned',
  'claimable',
  'accepted_by_member',
  'in_progress',
  'blocked',
  'submitted',
  'in_review',
  'revision_requested',
  'resubmitted',
  'accepted',
  'completed',
  'cancelled',
  'rejected_final',
  'archived',
]);
const organizationRoles = new Set(['owner', 'admin', 'manager', 'member']);
const projectRoles = new Set(['lead', 'member', 'viewer']);

function normalizeCriteria(value: unknown): ReviewContractRow['criteria'] | null {
  if (!Array.isArray(value)) return null;
  const criteria: ReviewContractRow['criteria'] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.description !== 'string') {
      return null;
    }
    criteria.push({ id: entry.id, description: entry.description });
  }
  return criteria;
}

function normalizeStrings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
}

function normalizeEvidence(value: unknown): TeamTaskEvidenceReference[] | null {
  if (!Array.isArray(value)) return null;
  const result: TeamTaskEvidenceReference[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      (entry.kind !== 'evidence' && entry.kind !== 'missing_evidence') ||
      typeof entry.reference !== 'string'
    ) {
      return null;
    }
    result.push({ kind: entry.kind, reference: entry.reference });
  }
  return result;
}

class DrizzleReviewTransaction implements ReviewTransaction {
  constructor(private readonly db: DrizzleExecutor) {}

  async lockWorkItemAccess(actorExternalId: string, workItemExternalId: string) {
    const [row] = await this.db
      .select({
        actorUserId: users.id,
        actorExternalId: users.externalId,
        actorOrganizationRole: organizationMembers.role,
        actorOrganizationMembershipStatus: organizationMembers.status,
        actorProjectRole: projectMembers.role,
        actorProjectMembershipStatus: projectMembers.status,
        organizationId: organizations.id,
        organizationExternalId: organizations.externalId,
        organizationStatus: organizations.status,
        organizationTeamProjectsEnabled: organizations.teamProjectsEnabled,
        projectId: projects.id,
        projectExternalId: projects.externalId,
        projectOrganizationId: projects.organizationId,
        workItemId: teamWorkItems.id,
        workItemExternalId: teamWorkItems.externalId,
        workItemCreatedByUserId: teamWorkItems.createdByUserId,
        workItemStatus: teamWorkItems.status,
        workItemVersion: teamWorkItems.version,
        currentContractVersionId: teamWorkItems.currentContractVersionId,
        dueAt: teamWorkItems.dueAt,
        revisionRound: teamWorkItems.revisionRound,
        closedAt: teamWorkItems.closedAt,
      })
      .from(teamWorkItems)
      .innerJoin(projects, eq(projects.id, teamWorkItems.projectId))
      .innerJoin(organizations, eq(organizations.id, teamWorkItems.organizationId))
      .innerJoin(users, eq(users.externalId, actorExternalId))
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.organizationId, organizations.id),
          eq(organizationMembers.userId, users.id),
        ),
      )
      .innerJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, users.id)),
      )
      .where(eq(teamWorkItems.externalId, workItemExternalId))
      .for('update')
      .limit(1);
    if (
      !row ||
      !states.has(row.workItemStatus) ||
      !organizationRoles.has(row.actorOrganizationRole) ||
      !projectRoles.has(row.actorProjectRole)
    ) {
      return null;
    }
    const access: TeamTaskProjectAccessSnapshot = {
      actorUserId: row.actorUserId,
      actorExternalId: row.actorExternalId,
      actorOrganizationRole:
        row.actorOrganizationRole as TeamTaskProjectAccessSnapshot['actorOrganizationRole'],
      actorOrganizationMembershipActive: row.actorOrganizationMembershipStatus === 'active',
      actorProjectRole: row.actorProjectRole as TeamTaskProjectAccessSnapshot['actorProjectRole'],
      actorProjectMembershipActive: row.actorProjectMembershipStatus === 'active',
      organizationId: row.organizationId,
      organizationExternalId: row.organizationExternalId,
      organizationActive: row.organizationStatus === 'active',
      organizationTeamProjectsEnabled: row.organizationTeamProjectsEnabled,
      projectId: row.projectId,
      projectExternalId: row.projectExternalId,
      projectOrganizationId: row.projectOrganizationId,
    };
    const workItem: ReviewWorkItemRow = {
      id: row.workItemId,
      externalId: row.workItemExternalId,
      organizationId: row.organizationId,
      projectId: row.projectId,
      projectExternalId: row.projectExternalId,
      createdByUserId: row.workItemCreatedByUserId,
      status: row.workItemStatus as TeamTaskState,
      version: row.workItemVersion,
      currentContractVersionId: row.currentContractVersionId,
      dueAt: row.dueAt,
      revisionRound: row.revisionRound,
      closedAt: row.closedAt,
    };
    return { access, workItem };
  }

  async lockCurrentContract(workItemId: number, contractId: number) {
    const [row] = await this.db
      .select({
        id: acceptanceContractVersions.id,
        externalId: acceptanceContractVersions.externalId,
        organizationId: acceptanceContractVersions.organizationId,
        projectId: acceptanceContractVersions.projectId,
        workItemId: acceptanceContractVersions.workItemId,
        version: acceptanceContractVersions.version,
        criteria: acceptanceContractVersions.criteriaJson,
        approverUserId: acceptanceContractVersions.approverUserId,
        dueAt: acceptanceContractVersions.dueAt,
        maxRevisionRounds: acceptanceContractVersions.maxRevisionRounds,
        confirmedByUserId: acceptanceContractVersions.confirmedByUserId,
        confirmedAt: acceptanceContractVersions.confirmedAt,
      })
      .from(acceptanceContractVersions)
      .where(
        and(
          eq(acceptanceContractVersions.id, contractId),
          eq(acceptanceContractVersions.workItemId, workItemId),
        ),
      )
      .for('update')
      .limit(1);
    const criteria = normalizeCriteria(row?.criteria);
    return row && criteria ? { ...row, criteria } : null;
  }

  async listAssignments(workItemId: number) {
    const rows = await this.db
      .select({
        id: teamWorkItemAssignments.id,
        externalId: teamWorkItemAssignments.externalId,
        organizationId: teamWorkItemAssignments.organizationId,
        projectId: teamWorkItemAssignments.projectId,
        workItemId: teamWorkItemAssignments.workItemId,
        userId: teamWorkItemAssignments.userId,
        organizationMemberExternalId: organizationMembers.externalId,
        role: teamWorkItemAssignments.role,
        status: teamWorkItemAssignments.status,
        offeredByUserId: teamWorkItemAssignments.offeredByUserId,
        respondedAt: teamWorkItemAssignments.respondedAt,
      })
      .from(teamWorkItemAssignments)
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.organizationId, teamWorkItemAssignments.organizationId),
          eq(organizationMembers.userId, teamWorkItemAssignments.userId),
        ),
      )
      .where(eq(teamWorkItemAssignments.workItemId, workItemId))
      .for('update');
    return rows.flatMap((row) =>
      (row.role === 'responsible' || row.role === 'collaborator') &&
      ['offered', 'applied', 'accepted', 'declined', 'removed'].includes(row.status)
        ? [
            {
              ...row,
              role: row.role as TeamTaskAssignmentRow['role'],
              status: row.status as TeamTaskAssignmentRow['status'],
            },
          ]
        : [],
    );
  }

  async loadActiveUser(organizationId: number, userId: number) {
    const [row] = await this.db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, userId),
          eq(organizationMembers.status, 'active'),
        ),
      )
      .for('update')
      .limit(1);
    return row !== undefined;
  }

  async findEffectiveDelegation(
    organizationId: number,
    projectId: number,
    delegatorUserId: number,
    delegateUserId: number,
    at: Date,
  ) {
    const [row] = await this.db
      .select({
        id: teamTaskReviewDelegations.id,
        externalId: teamTaskReviewDelegations.externalId,
        organizationId: teamTaskReviewDelegations.organizationId,
        projectId: teamTaskReviewDelegations.projectId,
        delegatorUserId: teamTaskReviewDelegations.delegatorUserId,
        delegateUserId: teamTaskReviewDelegations.delegateUserId,
        validFrom: teamTaskReviewDelegations.validFrom,
        validUntil: teamTaskReviewDelegations.validUntil,
        revokedAt: teamTaskReviewDelegations.revokedAt,
      })
      .from(teamTaskReviewDelegations)
      .where(
        and(
          eq(teamTaskReviewDelegations.organizationId, organizationId),
          eq(teamTaskReviewDelegations.projectId, projectId),
          eq(teamTaskReviewDelegations.delegatorUserId, delegatorUserId),
          eq(teamTaskReviewDelegations.delegateUserId, delegateUserId),
          lte(teamTaskReviewDelegations.validFrom, at),
          gte(teamTaskReviewDelegations.validUntil, at),
          isNull(teamTaskReviewDelegations.revokedAt),
        ),
      )
      .orderBy(desc(teamTaskReviewDelegations.validFrom), desc(teamTaskReviewDelegations.id))
      .for('update')
      .limit(1);
    return row ?? null;
  }

  async lockOrganizationIdempotencyScope(organizationId: number) {
    const [row] = await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .for('update')
      .limit(1);
    return row?.id === organizationId;
  }

  async findEventByIdempotencyKey(organizationId: number, idempotencyKey: string) {
    const [row] = await this.db
      .select({
        externalId: teamWorkItemEvents.externalId,
        organizationId: teamWorkItemEvents.organizationId,
        projectId: teamWorkItemEvents.projectId,
        workItemId: teamWorkItemEvents.workItemId,
        actorUserId: teamWorkItemEvents.actorUserId,
        eventType: teamWorkItemEvents.eventType,
        fromState: teamWorkItemEvents.fromState,
        toState: teamWorkItemEvents.toState,
        contractVersionId: teamWorkItemEvents.contractVersionId,
        idempotencyKey: teamWorkItemEvents.idempotencyKey,
        metadata: teamWorkItemEvents.metadataJson,
        occurredAt: teamWorkItemEvents.occurredAt,
      })
      .from(teamWorkItemEvents)
      .where(
        and(
          eq(teamWorkItemEvents.organizationId, organizationId),
          eq(teamWorkItemEvents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (
      !row ||
      (row.fromState !== null && !states.has(row.fromState)) ||
      (row.toState !== null && !states.has(row.toState))
    ) {
      return null;
    }
    return {
      ...row,
      fromState: row.fromState as TeamTaskState | null,
      toState: row.toState as TeamTaskState | null,
    };
  }

  async hasPlanningEventByIdempotencyKey(organizationId: number, idempotencyKey: string) {
    const [row] = await this.db
      .select({ id: teamProjectPlanningEvents.id })
      .from(teamProjectPlanningEvents)
      .where(
        and(
          eq(teamProjectPlanningEvents.organizationId, organizationId),
          eq(teamProjectPlanningEvents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async lockLatestSubmission(workItemId: number) {
    const [row] = await this.db
      .select()
      .from(teamWorkItemSubmissions)
      .where(eq(teamWorkItemSubmissions.workItemId, workItemId))
      .orderBy(desc(teamWorkItemSubmissions.submissionVersion))
      .for('update')
      .limit(1);
    if (!row) return null;
    const deliverables = normalizeStrings(row.deliverablesJson);
    return deliverables ? { ...row, deliverables } : null;
  }

  async lockSubmissionByExternalId(workItemId: number, externalId: string) {
    const [row] = await this.db
      .select()
      .from(teamWorkItemSubmissions)
      .where(
        and(
          eq(teamWorkItemSubmissions.workItemId, workItemId),
          eq(teamWorkItemSubmissions.externalId, externalId),
        ),
      )
      .for('update')
      .limit(1);
    if (!row) return null;
    const deliverables = normalizeStrings(row.deliverablesJson);
    return deliverables ? { ...row, deliverables } : null;
  }

  async lockReviewsBySubmissionId(submissionId: number) {
    const rows = await this.db
      .select()
      .from(teamWorkItemReviews)
      .where(eq(teamWorkItemReviews.submissionId, submissionId))
      .orderBy(asc(teamWorkItemReviews.reviewAttempt), asc(teamWorkItemReviews.id))
      .for('update');
    const reviews: ReviewDecisionRow[] = [];
    for (const row of rows) {
      const review = this.normalizeReview(row);
      if (!review) return null;
      reviews.push(review);
    }
    return reviews;
  }

  async lockReturnForReviewDecision(
    reviewId: number,
    submissionId: number,
    contractVersionId: number,
    workItemId: number,
    organizationId: number,
    projectId: number,
  ) {
    const [row] = await this.db
      .select({
        appealId: teamWorkItemAppeals.id,
        decisionId: teamArbitrationDecisions.id,
        reviewId: teamWorkItemAppeals.reviewId,
        submissionId: teamWorkItemAppeals.submissionId,
        contractVersionId: teamWorkItemReviews.contractVersionId,
        workItemId: teamWorkItemAppeals.workItemId,
        organizationId: teamWorkItemAppeals.organizationId,
        projectId: teamWorkItemAppeals.projectId,
        decidedAt: teamArbitrationDecisions.decidedAt,
      })
      .from(teamWorkItemAppeals)
      .innerJoin(
        teamWorkItemReviews,
        and(
          eq(teamWorkItemReviews.id, teamWorkItemAppeals.reviewId),
          eq(teamWorkItemReviews.submissionId, teamWorkItemAppeals.submissionId),
        ),
      )
      .innerJoin(
        teamArbitrationDecisions,
        eq(teamArbitrationDecisions.appealId, teamWorkItemAppeals.id),
      )
      .where(
        and(
          eq(teamWorkItemAppeals.reviewId, reviewId),
          eq(teamWorkItemAppeals.submissionId, submissionId),
          eq(teamWorkItemReviews.contractVersionId, contractVersionId),
          eq(teamWorkItemAppeals.workItemId, workItemId),
          eq(teamWorkItemAppeals.organizationId, organizationId),
          eq(teamWorkItemAppeals.projectId, projectId),
          eq(teamWorkItemAppeals.status, 'appeal_resolved'),
          eq(teamArbitrationDecisions.decision, 'return_for_review'),
        ),
      )
      .for('update')
      .limit(1);
    return row ?? null;
  }

  private normalizeReview(row: typeof teamWorkItemReviews.$inferSelect) {
    if (!row || (row.decision !== 'accepted' && row.decision !== 'request_revision')) return null;
    const failedCriterionIds =
      row.failedCriterionIdsJson === null ? null : normalizeStrings(row.failedCriterionIdsJson);
    const evidenceReferences =
      row.evidenceRefsJson === null ? null : normalizeEvidence(row.evidenceRefsJson);
    const revisionInstructions =
      row.revisionInstructionsJson === null ? null : normalizeStrings(row.revisionInstructionsJson);
    if (
      (row.failedCriterionIdsJson !== null && !failedCriterionIds) ||
      (row.evidenceRefsJson !== null && !evidenceReferences) ||
      (row.revisionInstructionsJson !== null && !revisionInstructions)
    ) {
      return null;
    }
    return {
      ...row,
      decision: row.decision as ReviewDecisionRow['decision'],
      failedCriterionIds,
      evidenceReferences,
      revisionInstructions,
    };
  }

  async insertSubmission(row: Omit<ReviewSubmissionRow, 'id'>) {
    return readInsertId(
      await this.db.insert(teamWorkItemSubmissions).values({
        externalId: row.externalId,
        organizationId: row.organizationId,
        projectId: row.projectId,
        workItemId: row.workItemId,
        contractVersionId: row.contractVersionId,
        submittedByUserId: row.submittedByUserId,
        submissionVersion: row.submissionVersion,
        summary: row.summary,
        deliverablesJson: row.deliverables,
        submittedOnTime: row.submittedOnTime,
        submittedAt: row.submittedAt,
        createdAt: row.createdAt,
      }),
    );
  }

  async insertReview(row: Omit<ReviewDecisionRow, 'id'>) {
    return readInsertId(
      await this.db.insert(teamWorkItemReviews).values({
        externalId: row.externalId,
        organizationId: row.organizationId,
        projectId: row.projectId,
        workItemId: row.workItemId,
        submissionId: row.submissionId,
        contractVersionId: row.contractVersionId,
        reviewerUserId: row.reviewerUserId,
        reviewDelegationId: row.reviewDelegationId,
        reviewAttempt: row.reviewAttempt,
        decision: row.decision,
        failedCriterionIdsJson: row.failedCriterionIds,
        evidenceRefsJson: row.evidenceReferences,
        revisionInstructionsJson: row.revisionInstructions,
        rationale: row.rationale,
        newDueAt: row.newDueAt,
        reviewedAt: row.reviewedAt,
        createdAt: row.createdAt,
      }),
    );
  }

  async updateWorkItem(
    workItemId: number,
    expectedVersion: number,
    update: Partial<
      Pick<ReviewWorkItemRow, 'status' | 'version' | 'dueAt' | 'revisionRound' | 'closedAt'>
    >,
  ) {
    return (
      readAffectedRows(
        await this.db
          .update(teamWorkItems)
          .set(update)
          .where(and(eq(teamWorkItems.id, workItemId), eq(teamWorkItems.version, expectedVersion))),
      ) === 1
    );
  }

  async appendEvent(row: ReviewEventRow) {
    await this.db.insert(teamWorkItemEvents).values({
      externalId: row.externalId,
      organizationId: row.organizationId,
      projectId: row.projectId,
      workItemId: row.workItemId,
      actorUserId: row.actorUserId,
      eventType: row.eventType,
      fromState: row.fromState,
      toState: row.toState,
      contractVersionId: row.contractVersionId,
      idempotencyKey: row.idempotencyKey,
      metadataJson: row.metadata,
      occurredAt: row.occurredAt,
    });
  }
}

export class DrizzleReviewRepository implements ReviewRepository {
  constructor(private readonly db: DB) {}

  transaction<T>(work: (tx: ReviewTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleReviewTransaction(tx)));
  }
}

export function createTeamTaskReviewService(db: DB): TeamTaskReviewService {
  return new TeamTaskReviewService(new DrizzleReviewRepository(db));
}
