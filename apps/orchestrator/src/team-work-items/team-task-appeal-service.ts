import { createHash } from 'node:crypto';
import { isExternalId, newExternalId } from '@holaday/shared-types';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import { acceptanceContractVersions } from '../db/schema/acceptance-contract-versions.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { projectMembers } from '../db/schema/project-members.js';
import { projects } from '../db/schema/projects.js';
import { teamArbitrationDecisions } from '../db/schema/team-arbitration-decisions.js';
import { teamProjectPlanningEvents } from '../db/schema/team-project-planning-events.js';
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
import type { TeamTaskEvidenceReference, TeamTaskState } from './team-task-state-machine.js';
import { transitionTeamTask } from './team-task-state-machine.js';

export type TeamTaskAppealServiceErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INVALID_INPUT'
  | 'VERSION_CONFLICT'
  | 'APPEAL_WINDOW_EXPIRED'
  | 'ARBITRATOR_REQUIRED';

export class TeamTaskAppealServiceError extends Error {
  constructor(public readonly code: TeamTaskAppealServiceErrorCode) {
    super(code);
    this.name = 'TeamTaskAppealServiceError';
  }
}

export interface AppealWorkItemRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  projectExternalId: string;
  createdByUserId: number;
  status: TeamTaskState;
  version: number;
  currentContractVersionId: number | null;
  revisionRound: number;
}

export interface AppealContractRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  criteria: Array<{ id: string; description: string }>;
  approverUserId: number;
  arbitratorUserId: number;
  confirmedAt: Date | null;
}

export interface AppealSubmissionRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  contractVersionId: number;
  submittedByUserId: number;
  submissionVersion: number;
  submittedAt: Date;
}

export interface AppealReviewRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  submissionId: number;
  contractVersionId: number;
  reviewerUserId: number;
  decision: 'accepted' | 'request_revision';
  reviewedAt: Date;
}

export type AppealDisputeType = 'fact' | 'criterion_application' | 'process_rule';
export type AppealStatus = 'appeal_open' | 'appeal_reviewing' | 'appeal_resolved';

export interface AppealRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  submissionId: number;
  reviewId: number;
  openedByUserId: number;
  disputeType: AppealDisputeType;
  grounds: string;
  status: AppealStatus;
  openedAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AppealDecision =
  | 'uphold_review'
  | 'return_for_review'
  | 'accept_submission'
  | 'reject_final';

export interface AppealConflictSnapshot {
  contractVersionId: number;
  submissionId: number;
  reviewId: number;
  boundArbitratorUserId: number;
  creatorUserId: number;
  responsibleUserId: number;
  collaboratorUserIds: number[];
  latestReviewerUserId: number;
}

export interface AppealDecisionRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  appealId: number;
  arbitratorUserId: number;
  conflictSnapshot: AppealConflictSnapshot;
  decision: AppealDecision;
  criterionIds: string[];
  evidenceReferences: TeamTaskEvidenceReference[];
  rationale: string;
  decidedAt: Date;
  createdAt: Date;
}

export type AppealEventRow = TeamTaskEventRow;
export interface AppealPlanningEventRow {
  organizationId: number;
  idempotencyKey: string;
}

export interface AppealSlaCandidateRow {
  kind: 'review' | 'appeal';
  organizationId: number;
  projectId: number;
  workItemExternalId: string;
  sourceExternalId: string;
  targetUserId: number;
  targetUserExternalId: string;
  organizationTeamProjectsEnabled: boolean;
  startedAt: Date;
}

export interface TeamTaskSlaNotificationRequest {
  delivery: 'in_app_only';
  type: 'team_review_overdue' | 'team_appeal_overdue';
  recipientUserId: number;
  organizationId: number;
  projectId: number;
  workItemId: string;
  sourceId: string;
  overdueAt: string;
}

/** Task 11 archive/final guards must reuse this persisted, locked overlay boundary. */
export interface TeamTaskAppealOverlayLock {
  lockUnresolvedAppealsByWorkItem(workItemId: number): Promise<AppealRow[] | null>;
}

export type AppealAssignmentLockResult =
  | { ok: true; assignments: TeamTaskAssignmentRow[] }
  | { ok: false; reason: 'UNKNOWN_ASSIGNMENT_ROLE_OR_STATUS' };

export interface AppealTransaction extends TeamTaskAppealOverlayLock {
  lockWorkItemAccess(
    actorExternalId: string,
    workItemExternalId: string,
  ): Promise<{ access: TeamTaskProjectAccessSnapshot; workItem: AppealWorkItemRow } | null>;
  lockCurrentContract(workItemId: number, contractId: number): Promise<AppealContractRow | null>;
  listAssignments(workItemId: number): Promise<AppealAssignmentLockResult>;
  lockOrganizationIdempotencyScope(organizationId: number): Promise<boolean>;
  findEventByIdempotencyKey(
    organizationId: number,
    idempotencyKey: string,
  ): Promise<AppealEventRow | null>;
  hasPlanningEventByIdempotencyKey(
    organizationId: number,
    idempotencyKey: string,
  ): Promise<boolean>;
  lockSubmissionByExternalId(
    workItemId: number,
    externalId: string,
  ): Promise<AppealSubmissionRow | null>;
  lockReviewByExternalId(
    workItemId: number,
    submissionId: number,
    externalId: string,
  ): Promise<AppealReviewRow | null>;
  lockAppealBySubmissionId(submissionId: number): Promise<AppealRow | null>;
  lockLatestReview(workItemId: number): Promise<AppealReviewRow | null>;
  lockAppealByExternalId(workItemId: number, externalId: string): Promise<AppealRow | null>;
  lockDecisionByAppealId(appealId: number): Promise<AppealDecisionRow | null>;
  insertAppeal(row: Omit<AppealRow, 'id'>): Promise<number>;
  insertDecision(row: Omit<AppealDecisionRow, 'id'>): Promise<number>;
  updateAppeal(appealId: number, status: AppealStatus, resolvedAt: Date): Promise<boolean>;
  updateWorkItem(
    workItemId: number,
    expectedVersion: number,
    update: Pick<AppealWorkItemRow, 'status' | 'version'>,
  ): Promise<boolean>;
  appendEvent(event: AppealEventRow): Promise<void>;
  listOverdueReviewCandidates(cutoff: Date, limit: number): Promise<AppealSlaCandidateRow[]>;
  listOverdueAppealCandidates(cutoff: Date, limit: number): Promise<AppealSlaCandidateRow[]>;
}

export interface AppealRepository {
  transaction<T>(work: (tx: AppealTransaction) => Promise<T>): Promise<T>;
}

export type AppealReceipt =
  | {
      command: 'appeal';
      eventId: string;
      appealId: string;
      workItemId: string;
      submissionId: string;
      reviewId: string;
      contractVersionId: string;
      appealStatus: 'appeal_open';
      state: TeamTaskState;
      version: number;
    }
  | {
      command: 'decide_appeal';
      eventId: string;
      decisionId: string;
      appealId: string;
      workItemId: string;
      submissionId: string;
      reviewId: string;
      contractVersionId: string;
      decision: AppealDecision;
      appealStatus: 'appeal_resolved';
      state: TeamTaskState;
      version: number;
      revisionRound: number;
    };

interface Dependencies {
  now: () => string;
  isLifecycleEnabled: (actorExternalId: string, organizationEnabled: boolean) => boolean;
  appealWindowMs: number;
  reviewSlaMs: number;
  appealSlaMs: number;
  newId: (kind: 'teamAppeal' | 'teamArbitrationDecision' | 'teamWorkItemEvent') => string;
}

const HOUR_MS = 60 * 60 * 1_000;
const MAX_CONFIG_DURATION_MS = 30 * 24 * HOUR_MS;
const MAX_GROUNDS_LENGTH = 4_000;
const MAX_RATIONALE_LENGTH = 4_000;
const MAX_CRITERION_COUNT = 100;
const MAX_CRITERION_LENGTH = 100;
const MAX_EVIDENCE_COUNT = 100;
const MAX_EVIDENCE_REFERENCE_LENGTH = 500;
const MAX_COLLABORATOR_SNAPSHOT_COUNT = 100;
const MAX_SLA_NOTIFICATIONS = 100;

const defaults: Dependencies = {
  now: () => new Date().toISOString(),
  isLifecycleEnabled: isTeamTaskLifecycleEnabledFor,
  appealWindowMs: 7 * 24 * HOUR_MS,
  reviewSlaMs: 24 * HOUR_MS,
  appealSlaMs: 24 * HOUR_MS,
  newId: (kind) => newExternalId(kind),
};

function fail(code: TeamTaskAppealServiceErrorCode): never {
  throw new TeamTaskAppealServiceError(code);
}

function isPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

const appealAssignmentRoles = new Set(['responsible', 'collaborator']);
const appealAssignmentStatuses = new Set(['offered', 'applied', 'accepted', 'declined', 'removed']);

/** Converts locked DB rows without silently discarding enum values unknown to this service. */
export function normalizeAppealAssignmentRows(
  rows: readonly unknown[],
): AppealAssignmentLockResult {
  if (
    rows.some(
      (row) =>
        !isPlainRecord(row) ||
        !appealAssignmentRoles.has(row.role as string) ||
        !appealAssignmentStatuses.has(row.status as string),
    )
  ) {
    return { ok: false, reason: 'UNKNOWN_ASSIGNMENT_ROLE_OR_STATUS' };
  }
  return {
    ok: true,
    assignments: rows.map((row) => row as TeamTaskAssignmentRow),
  };
}

function requireAppealAssignments(result: AppealAssignmentLockResult) {
  if (!result.ok) return fail('CONFLICT');
  return result.assignments;
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

function instant(value: unknown): Date {
  if (typeof value !== 'string') return fail('INVALID_INPUT');
  const result = new Date(value);
  if (!Number.isFinite(result.valueOf()) || result.toISOString() !== value) {
    return fail('INVALID_INPUT');
  }
  return result;
}

function boundedDuration(value: number) {
  if (!Number.isSafeInteger(value) || value < HOUR_MS || value > MAX_CONFIG_DURATION_MS) {
    throw new RangeError('Team task appeal/SLA durations must be between one hour and 30 days');
  }
  return value;
}

function normalizedStringList(value: unknown, maxCount: number, maxLength: number): string[] {
  if (
    !Array.isArray(value) ||
    !hasDenseArrayEntries(value) ||
    value.length < 1 ||
    value.length > maxCount
  ) {
    return fail('INVALID_INPUT');
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = stringField(entry, maxLength);
    const key = normalized.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  if (result.length === 0) return fail('INVALID_INPUT');
  return result;
}

function normalizedEvidenceReferences(value: unknown): TeamTaskEvidenceReference[] {
  if (
    !Array.isArray(value) ||
    !hasDenseArrayEntries(value) ||
    value.length < 1 ||
    value.length > MAX_EVIDENCE_COUNT
  ) {
    return fail('INVALID_INPUT');
  }
  const result: TeamTaskEvidenceReference[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isPlainRecord(entry) || (entry.kind !== 'evidence' && entry.kind !== 'missing_evidence')) {
      return fail('INVALID_INPUT');
    }
    const reference = stringField(entry.reference, MAX_EVIDENCE_REFERENCE_LENGTH);
    const key = `${entry.kind}:${reference.toLocaleLowerCase('en-US')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ kind: entry.kind, reference });
  }
  if (result.length === 0) return fail('INVALID_INPUT');
  return result;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!isPlainRecord(value)) return value;
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

function receiptFromEvent(event: AppealEventRow, hash: string): AppealReceipt {
  if (!isPlainRecord(event.metadata) || event.metadata.requestHash !== hash) {
    return fail('CONFLICT');
  }
  const receipt = event.metadata.receipt;
  if (
    !isPlainRecord(receipt) ||
    (receipt.command !== 'appeal' && receipt.command !== 'decide_appeal')
  ) {
    return fail('CONFLICT');
  }
  return receipt as unknown as AppealReceipt;
}

function isDatabaseCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function isLockConflict(error: unknown) {
  return (
    isDatabaseCode(error, 'ER_LOCK_DEADLOCK') ||
    isDatabaseCode(error, 'ER_LOCK_WAIT_TIMEOUT') ||
    isDatabaseCode(error, 'ER_DUP_ENTRY')
  );
}

function checkAccess(
  dependencies: Dependencies,
  access: TeamTaskProjectAccessSnapshot,
  workItem: AppealWorkItemRow,
) {
  if (
    !access.organizationActive ||
    !access.actorOrganizationMembershipActive ||
    !access.actorProjectMembershipActive ||
    access.projectOrganizationId !== access.organizationId ||
    workItem.organizationId !== access.organizationId ||
    workItem.projectId !== access.projectId
  ) {
    return fail('NOT_FOUND');
  }
  if (
    !dependencies.isLifecycleEnabled(access.actorExternalId, access.organizationTeamProjectsEnabled)
  ) {
    return fail('NOT_FOUND');
  }
}

function oneResponsible(assignments: TeamTaskAssignmentRow[]) {
  const active = assignments.filter(
    (assignment) => assignment.role === 'responsible' && assignment.status === 'accepted',
  );
  if (active.length !== 1) return fail('CONFLICT');
  const responsible = active[0];
  if (!responsible) return fail('CONFLICT');
  return responsible;
}

function verifyAssignmentLineage(
  assignments: TeamTaskAssignmentRow[],
  workItem: AppealWorkItemRow,
) {
  if (
    assignments.some(
      (assignment) =>
        assignment.organizationId !== workItem.organizationId ||
        assignment.projectId !== workItem.projectId ||
        assignment.workItemId !== workItem.id,
    )
  ) {
    return fail('NOT_FOUND');
  }
}

function permissionContext(
  access: TeamTaskProjectAccessSnapshot,
  workItem: AppealWorkItemRow,
  responsibleUserId: number,
  latestReviewerUserId: number,
  arbitratorUserId: number,
) {
  return {
    actorOrganizationRole: access.actorOrganizationRole,
    actorOrganizationMembershipActive: access.actorOrganizationMembershipActive,
    actorProjectRole: access.actorProjectRole,
    actorProjectMembershipActive: access.actorProjectMembershipActive,
    actorIsCreator: access.actorUserId === workItem.createdByUserId,
    actorIsResponsible: access.actorUserId === responsibleUserId,
    actorIsLatestReviewer: access.actorUserId === latestReviewerUserId,
    actorIsDesignatedApprover: false,
    actorIsDesignatedIndependentArbitrator: access.actorUserId === arbitratorUserId,
  } as const;
}

function verifyContractLineage(contract: AppealContractRow, workItem: AppealWorkItemRow) {
  const criterionIds = new Set<string>();
  if (
    contract.organizationId !== workItem.organizationId ||
    contract.projectId !== workItem.projectId ||
    contract.workItemId !== workItem.id ||
    !contract.confirmedAt ||
    !Array.isArray(contract.criteria) ||
    !hasDenseArrayEntries(contract.criteria) ||
    contract.criteria.length < 1 ||
    contract.criteria.length > MAX_CRITERION_COUNT
  ) {
    return fail('NOT_FOUND');
  }
  for (const criterion of contract.criteria) {
    if (
      !isPlainRecord(criterion) ||
      typeof criterion.id !== 'string' ||
      typeof criterion.description !== 'string' ||
      criterion.id.trim() !== criterion.id ||
      criterion.id.length < 1 ||
      criterion.id.length > MAX_CRITERION_LENGTH
    ) {
      return fail('NOT_FOUND');
    }
    const key = criterion.id.toLocaleLowerCase('en-US');
    if (criterionIds.has(key)) return fail('NOT_FOUND');
    criterionIds.add(key);
  }
}

function verifySubmissionLineage(
  submission: AppealSubmissionRow,
  workItem: AppealWorkItemRow,
  contract: AppealContractRow,
) {
  if (
    submission.organizationId !== workItem.organizationId ||
    submission.projectId !== workItem.projectId ||
    submission.workItemId !== workItem.id ||
    submission.contractVersionId !== contract.id
  ) {
    return fail('NOT_FOUND');
  }
}

function verifyReviewLineage(
  review: AppealReviewRow,
  submission: AppealSubmissionRow,
  workItem: AppealWorkItemRow,
  contract: AppealContractRow,
) {
  if (
    review.organizationId !== workItem.organizationId ||
    review.projectId !== workItem.projectId ||
    review.workItemId !== workItem.id ||
    review.submissionId !== submission.id ||
    review.contractVersionId !== contract.id
  ) {
    return fail('NOT_FOUND');
  }
}

function verifyAppealLineage(
  appeal: AppealRow,
  review: AppealReviewRow,
  submission: AppealSubmissionRow,
  workItem: AppealWorkItemRow,
) {
  if (
    appeal.organizationId !== workItem.organizationId ||
    appeal.projectId !== workItem.projectId ||
    appeal.workItemId !== workItem.id ||
    appeal.submissionId !== submission.id ||
    appeal.reviewId !== review.id
  ) {
    return fail('NOT_FOUND');
  }
}

export function hasUnresolvedTeamTaskAppeal(
  appeals: readonly Pick<AppealRow, 'status'>[],
): boolean {
  return appeals.some(
    (appeal) => appeal.status === 'appeal_open' || appeal.status === 'appeal_reviewing',
  );
}

function verifyUnresolvedAppealOverlay(appeals: AppealRow[], workItem: AppealWorkItemRow) {
  let previousId = 0;
  for (const appeal of appeals) {
    if (
      appeal.id <= previousId ||
      appeal.workItemId !== workItem.id ||
      appeal.organizationId !== workItem.organizationId ||
      appeal.projectId !== workItem.projectId ||
      (appeal.status !== 'appeal_open' && appeal.status !== 'appeal_reviewing')
    ) {
      return fail('CONFLICT');
    }
    previousId = appeal.id;
  }
}

function expectedReviewedState(review: AppealReviewRow): TeamTaskState {
  return review.decision === 'accepted' ? 'accepted' : 'revision_requested';
}

function transitionOrConflict(
  state: TeamTaskState,
  command: Parameters<typeof transitionTeamTask>[1],
) {
  const result = transitionTeamTask({ state, appealOpen: false }, command);
  if (!result.ok) return fail('CONFLICT');
  return result.state;
}

function arbitrationState(
  workItem: AppealWorkItemRow,
  submission: AppealSubmissionRow,
  decision: AppealDecision,
) {
  if (decision === 'uphold_review') return workItem.status;
  const submittedState: TeamTaskState =
    submission.submissionVersion === 1 ? 'submitted' : 'resubmitted';
  const reviewableState = transitionOrConflict(submittedState, { type: 'start_review' });
  if (decision === 'return_for_review') return submittedState;
  if (decision === 'accept_submission') {
    return transitionOrConflict(reviewableState, { type: 'accept' });
  }
  return transitionOrConflict(reviewableState, {
    type: 'reject_final',
    finalDecisionAuthorized: true,
  });
}

function eventMetadata(hash: string, receipt: AppealReceipt) {
  return { requestHash: hash, receipt };
}

export class TeamTaskAppealService {
  private readonly dependencies: Dependencies;

  constructor(
    private readonly repository: AppealRepository,
    dependencies: Partial<Dependencies> = {},
  ) {
    this.dependencies = { ...defaults, ...dependencies };
    this.dependencies.appealWindowMs = boundedDuration(this.dependencies.appealWindowMs);
    this.dependencies.reviewSlaMs = boundedDuration(this.dependencies.reviewSlaMs);
    this.dependencies.appealSlaMs = boundedDuration(this.dependencies.appealSlaMs);
  }

  private async run<T>(work: (tx: AppealTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.repository.transaction(work);
    } catch (error) {
      if (isDatabaseCode(error, 'ER_DUP_ENTRY')) {
        try {
          return await this.repository.transaction(work);
        } catch (retryError) {
          if (isLockConflict(retryError)) return fail('CONFLICT');
          throw retryError;
        }
      }
      if (isLockConflict(error)) return fail('CONFLICT');
      throw error;
    }
  }

  async appeal(input: unknown): Promise<AppealReceipt> {
    if (!isPlainRecord(input)) return fail('INVALID_INPUT');
    const actorId = stringField(input.actorId, 32, 'user');
    const workItemId = stringField(input.workItemId, 32, 'teamWorkItem');
    const submissionId = stringField(input.submissionId, 32, 'teamSubmission');
    const reviewId = stringField(input.reviewId, 32, 'teamReview');
    const expectedVersion = versionField(input.expectedVersion);
    const idempotencyKey = idempotencyField(input.idempotencyKey);
    const disputeType = input.disputeType;
    if (
      disputeType !== 'fact' &&
      disputeType !== 'criterion_application' &&
      disputeType !== 'process_rule'
    ) {
      return fail('INVALID_INPUT');
    }
    const grounds = stringField(input.grounds, MAX_GROUNDS_LENGTH);
    const hash = requestHash({
      actorId,
      workItemId,
      submissionId,
      reviewId,
      expectedVersion,
      disputeType,
      grounds,
    });

    return this.run(async (tx) => {
      const locked = await tx.lockWorkItemAccess(actorId, workItemId);
      if (!locked) return fail('NOT_FOUND');
      const { access, workItem } = locked;
      checkAccess(this.dependencies, access, workItem);
      if (!workItem.currentContractVersionId) return fail('CONFLICT');
      const contract = await tx.lockCurrentContract(workItem.id, workItem.currentContractVersionId);
      if (!contract) return fail('NOT_FOUND');
      verifyContractLineage(contract, workItem);
      const assignments = requireAppealAssignments(await tx.listAssignments(workItem.id));
      verifyAssignmentLineage(assignments, workItem);
      const responsible = oneResponsible(assignments);
      if (!(await tx.lockOrganizationIdempotencyScope(workItem.organizationId))) {
        return fail('NOT_FOUND');
      }
      const submission = await tx.lockSubmissionByExternalId(workItem.id, submissionId);
      if (!submission) return fail('NOT_FOUND');
      verifySubmissionLineage(submission, workItem, contract);
      const review = await tx.lockReviewByExternalId(workItem.id, submission.id, reviewId);
      if (!review) return fail('NOT_FOUND');
      verifyReviewLineage(review, submission, workItem, contract);
      const unresolvedAppeals = await tx.lockUnresolvedAppealsByWorkItem(workItem.id);
      if (!unresolvedAppeals) return fail('CONFLICT');
      verifyUnresolvedAppealOverlay(unresolvedAppeals, workItem);
      const existingSubmissionAppeal = await tx.lockAppealBySubmissionId(submission.id);
      if (
        existingSubmissionAppeal &&
        (existingSubmissionAppeal.organizationId !== workItem.organizationId ||
          existingSubmissionAppeal.projectId !== workItem.projectId ||
          existingSubmissionAppeal.workItemId !== workItem.id ||
          existingSubmissionAppeal.submissionId !== submission.id)
      ) {
        return fail('NOT_FOUND');
      }

      const permission = decideTeamTaskPermission(
        'appeal',
        permissionContext(access, workItem, responsible.userId, review.reviewerUserId, 0),
      );
      if (!permission.allowed) return fail('FORBIDDEN');

      const previous = await tx.findEventByIdempotencyKey(workItem.organizationId, idempotencyKey);
      if (previous) return receiptFromEvent(previous, hash);
      if (await tx.hasPlanningEventByIdempotencyKey(workItem.organizationId, idempotencyKey)) {
        return fail('CONFLICT');
      }
      if (workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
      if (existingSubmissionAppeal) return fail('CONFLICT');
      if (hasUnresolvedTeamTaskAppeal(unresolvedAppeals)) return fail('CONFLICT');
      if (workItem.status !== expectedReviewedState(review)) return fail('CONFLICT');

      const at = instant(this.dependencies.now());
      const appealDeadline = review.reviewedAt.valueOf() + this.dependencies.appealWindowMs;
      if (at < review.reviewedAt || at.valueOf() > appealDeadline) {
        return fail('APPEAL_WINDOW_EXPIRED');
      }
      const appealExternalId = this.dependencies.newId('teamAppeal');
      const eventId = this.dependencies.newId('teamWorkItemEvent');
      await tx.insertAppeal({
        externalId: appealExternalId,
        organizationId: workItem.organizationId,
        projectId: workItem.projectId,
        workItemId: workItem.id,
        submissionId: submission.id,
        reviewId: review.id,
        openedByUserId: access.actorUserId,
        disputeType,
        grounds,
        status: 'appeal_open',
        openedAt: at,
        resolvedAt: null,
        createdAt: at,
        updatedAt: at,
      });
      if (
        !(await tx.updateWorkItem(workItem.id, expectedVersion, {
          status: workItem.status,
          version: expectedVersion + 1,
        }))
      ) {
        return fail('VERSION_CONFLICT');
      }
      const receipt: AppealReceipt = {
        command: 'appeal',
        eventId,
        appealId: appealExternalId,
        workItemId,
        submissionId,
        reviewId,
        contractVersionId: contract.externalId,
        appealStatus: 'appeal_open',
        state: workItem.status,
        version: expectedVersion + 1,
      };
      await tx.appendEvent({
        externalId: eventId,
        organizationId: workItem.organizationId,
        projectId: workItem.projectId,
        workItemId: workItem.id,
        actorUserId: access.actorUserId,
        eventType: 'task_appealed',
        fromState: workItem.status,
        toState: workItem.status,
        contractVersionId: contract.id,
        idempotencyKey,
        metadata: eventMetadata(hash, receipt),
        occurredAt: at,
      });
      return receipt;
    });
  }

  async decideAppeal(input: unknown): Promise<AppealReceipt> {
    if (!isPlainRecord(input)) return fail('INVALID_INPUT');
    const actorId = stringField(input.actorId, 32, 'user');
    const workItemId = stringField(input.workItemId, 32, 'teamWorkItem');
    const submissionId = stringField(input.submissionId, 32, 'teamSubmission');
    const reviewId = stringField(input.reviewId, 32, 'teamReview');
    const appealId = stringField(input.appealId, 32, 'teamAppeal');
    const expectedVersion = versionField(input.expectedVersion);
    const idempotencyKey = idempotencyField(input.idempotencyKey);
    const decision = input.decision;
    if (
      decision !== 'uphold_review' &&
      decision !== 'return_for_review' &&
      decision !== 'accept_submission' &&
      decision !== 'reject_final'
    ) {
      return fail('INVALID_INPUT');
    }
    const criterionIds = normalizedStringList(
      input.criterionIds,
      MAX_CRITERION_COUNT,
      MAX_CRITERION_LENGTH,
    );
    const evidenceReferences = normalizedEvidenceReferences(input.evidenceReferences);
    const rationale = stringField(input.rationale, MAX_RATIONALE_LENGTH);
    const hash = requestHash({
      actorId,
      workItemId,
      submissionId,
      reviewId,
      appealId,
      expectedVersion,
      idempotencyKey,
      decision,
      criterionIds,
      evidenceReferences,
      rationale,
    });

    return this.run(async (tx) => {
      const locked = await tx.lockWorkItemAccess(actorId, workItemId);
      if (!locked) return fail('NOT_FOUND');
      const { access, workItem } = locked;
      checkAccess(this.dependencies, access, workItem);
      if (!workItem.currentContractVersionId) return fail('CONFLICT');
      const contract = await tx.lockCurrentContract(workItem.id, workItem.currentContractVersionId);
      if (!contract) return fail('NOT_FOUND');
      verifyContractLineage(contract, workItem);
      const assignments = requireAppealAssignments(await tx.listAssignments(workItem.id));
      verifyAssignmentLineage(assignments, workItem);
      const responsible = oneResponsible(assignments);
      if (!(await tx.lockOrganizationIdempotencyScope(workItem.organizationId))) {
        return fail('NOT_FOUND');
      }
      const submission = await tx.lockSubmissionByExternalId(workItem.id, submissionId);
      if (!submission) return fail('NOT_FOUND');
      verifySubmissionLineage(submission, workItem, contract);
      const review = await tx.lockReviewByExternalId(workItem.id, submission.id, reviewId);
      if (!review) return fail('NOT_FOUND');
      verifyReviewLineage(review, submission, workItem, contract);
      const unresolvedAppeals = await tx.lockUnresolvedAppealsByWorkItem(workItem.id);
      if (!unresolvedAppeals) return fail('CONFLICT');
      verifyUnresolvedAppealOverlay(unresolvedAppeals, workItem);
      const appeal = await tx.lockAppealByExternalId(workItem.id, appealId);
      if (!appeal) return fail('NOT_FOUND');
      verifyAppealLineage(appeal, review, submission, workItem);
      const latestReview = await tx.lockLatestReview(workItem.id);
      if (!latestReview) return fail('NOT_FOUND');
      if (
        latestReview.organizationId !== workItem.organizationId ||
        latestReview.projectId !== workItem.projectId ||
        latestReview.workItemId !== workItem.id
      ) {
        return fail('NOT_FOUND');
      }
      const existingDecision = await tx.lockDecisionByAppealId(appeal.id);

      const collaborators = Array.from(
        new Set(
          assignments
            .filter((assignment) => assignment.role === 'collaborator')
            .map((assignment) => assignment.userId),
        ),
      ).sort((left, right) => left - right);
      if (collaborators.length > MAX_COLLABORATOR_SNAPSHOT_COUNT) return fail('CONFLICT');
      const actorHasConflict =
        access.actorUserId !== contract.arbitratorUserId ||
        access.actorUserId === workItem.createdByUserId ||
        access.actorUserId === responsible.userId ||
        access.actorUserId === latestReview.reviewerUserId ||
        collaborators.includes(access.actorUserId);
      const permission = decideTeamTaskPermission(
        'arbitrate',
        permissionContext(
          access,
          workItem,
          responsible.userId,
          latestReview.reviewerUserId,
          contract.arbitratorUserId,
        ),
      );
      if (actorHasConflict || !permission.allowed) return fail('ARBITRATOR_REQUIRED');

      const previous = await tx.findEventByIdempotencyKey(workItem.organizationId, idempotencyKey);
      if (previous) return receiptFromEvent(previous, hash);
      if (await tx.hasPlanningEventByIdempotencyKey(workItem.organizationId, idempotencyKey)) {
        return fail('CONFLICT');
      }
      if (workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
      if (unresolvedAppeals.length !== 1 || unresolvedAppeals[0]?.id !== appeal.id) {
        return fail('CONFLICT');
      }
      if (appeal.status === 'appeal_resolved' || existingDecision) return fail('CONFLICT');
      if (workItem.status !== expectedReviewedState(review)) return fail('CONFLICT');
      const allowedCriteria = new Set(contract.criteria.map((criterion) => criterion.id));
      if (!criterionIds.every((criterionId) => allowedCriteria.has(criterionId))) {
        return fail('INVALID_INPUT');
      }

      const at = instant(this.dependencies.now());
      const state = arbitrationState(workItem, submission, decision);
      const decisionExternalId = this.dependencies.newId('teamArbitrationDecision');
      const eventId = this.dependencies.newId('teamWorkItemEvent');
      const conflictSnapshot: AppealConflictSnapshot = {
        contractVersionId: contract.id,
        submissionId: submission.id,
        reviewId: review.id,
        boundArbitratorUserId: contract.arbitratorUserId,
        creatorUserId: workItem.createdByUserId,
        responsibleUserId: responsible.userId,
        collaboratorUserIds: collaborators,
        latestReviewerUserId: latestReview.reviewerUserId,
      };
      await tx.insertDecision({
        externalId: decisionExternalId,
        organizationId: workItem.organizationId,
        projectId: workItem.projectId,
        workItemId: workItem.id,
        appealId: appeal.id,
        arbitratorUserId: access.actorUserId,
        conflictSnapshot,
        decision,
        criterionIds,
        evidenceReferences,
        rationale,
        decidedAt: at,
        createdAt: at,
      });
      if (!(await tx.updateAppeal(appeal.id, 'appeal_resolved', at))) return fail('CONFLICT');
      if (
        !(await tx.updateWorkItem(workItem.id, expectedVersion, {
          status: state,
          version: expectedVersion + 1,
        }))
      ) {
        return fail('VERSION_CONFLICT');
      }
      const receipt: AppealReceipt = {
        command: 'decide_appeal',
        eventId,
        decisionId: decisionExternalId,
        appealId,
        workItemId,
        submissionId,
        reviewId,
        contractVersionId: contract.externalId,
        decision,
        appealStatus: 'appeal_resolved',
        state,
        version: expectedVersion + 1,
        revisionRound: workItem.revisionRound,
      };
      await tx.appendEvent({
        externalId: eventId,
        organizationId: workItem.organizationId,
        projectId: workItem.projectId,
        workItemId: workItem.id,
        actorUserId: access.actorUserId,
        eventType: 'appeal_decided',
        fromState: workItem.status,
        toState: state,
        contractVersionId: contract.id,
        idempotencyKey,
        metadata: eventMetadata(hash, receipt),
        occurredAt: at,
      });
      return receipt;
    });
  }

  async listOverdueNotifications(input: unknown): Promise<TeamTaskSlaNotificationRequest[]> {
    if (!isPlainRecord(input)) return fail('INVALID_INPUT');
    const now = instant(input.now);
    const limit = input.limit;
    if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100) {
      return fail('INVALID_INPUT');
    }
    const boundedLimit = limit as number;
    const reviewCutoff = new Date(now.valueOf() - this.dependencies.reviewSlaMs);
    const appealCutoff = new Date(now.valueOf() - this.dependencies.appealSlaMs);
    const candidates = await this.repository.transaction(async (tx) => [
      ...(await tx.listOverdueReviewCandidates(reviewCutoff, boundedLimit)),
      ...(await tx.listOverdueAppealCandidates(appealCutoff, boundedLimit)),
    ]);

    return candidates
      .filter(
        (candidate) =>
          (candidate.kind === 'review' || candidate.kind === 'appeal') &&
          candidate.startedAt instanceof Date &&
          Number.isFinite(candidate.startedAt.valueOf()) &&
          candidate.organizationTeamProjectsEnabled === true &&
          this.dependencies.isLifecycleEnabled(
            candidate.targetUserExternalId,
            candidate.organizationTeamProjectsEnabled,
          ),
      )
      .map((candidate) => {
        const duration =
          candidate.kind === 'review'
            ? this.dependencies.reviewSlaMs
            : this.dependencies.appealSlaMs;
        return {
          delivery: 'in_app_only' as const,
          type:
            candidate.kind === 'review'
              ? ('team_review_overdue' as const)
              : ('team_appeal_overdue' as const),
          recipientUserId: candidate.targetUserId,
          organizationId: candidate.organizationId,
          projectId: candidate.projectId,
          workItemId: candidate.workItemExternalId,
          sourceId: candidate.sourceExternalId,
          overdueAt: new Date(candidate.startedAt.valueOf() + duration).toISOString(),
          kindOrder: candidate.kind === 'review' ? 0 : 1,
        };
      })
      .sort(
        (left, right) =>
          left.overdueAt.localeCompare(right.overdueAt) ||
          left.kindOrder - right.kindOrder ||
          left.sourceId.localeCompare(right.sourceId),
      )
      .slice(0, Math.min(boundedLimit, MAX_SLA_NOTIFICATIONS))
      .map(({ kindOrder: _kindOrder, ...request }) => request);
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

function normalizeCriteria(value: unknown): AppealContractRow['criteria'] | null {
  if (!Array.isArray(value) || !hasDenseArrayEntries(value)) return null;
  const criteria: AppealContractRow['criteria'] = [];
  for (const entry of value) {
    if (
      !isPlainRecord(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.description !== 'string'
    ) {
      return null;
    }
    criteria.push({ id: entry.id, description: entry.description });
  }
  return criteria;
}

function normalizeEvidence(value: unknown): TeamTaskEvidenceReference[] | null {
  if (!Array.isArray(value) || !hasDenseArrayEntries(value)) return null;
  const result: TeamTaskEvidenceReference[] = [];
  for (const entry of value) {
    if (
      !isPlainRecord(entry) ||
      (entry.kind !== 'evidence' && entry.kind !== 'missing_evidence') ||
      typeof entry.reference !== 'string'
    ) {
      return null;
    }
    result.push({ kind: entry.kind, reference: entry.reference });
  }
  return result;
}

function normalizeConflictSnapshot(value: unknown): AppealConflictSnapshot | null {
  if (!isPlainRecord(value) || !Array.isArray(value.collaboratorUserIds)) return null;
  const numberFields = [
    value.contractVersionId,
    value.submissionId,
    value.reviewId,
    value.boundArbitratorUserId,
    value.creatorUserId,
    value.responsibleUserId,
    value.latestReviewerUserId,
  ];
  if (
    numberFields.some((entry) => !Number.isSafeInteger(entry)) ||
    !hasDenseArrayEntries(value.collaboratorUserIds) ||
    value.collaboratorUserIds.some((entry) => !Number.isSafeInteger(entry))
  ) {
    return null;
  }
  return {
    contractVersionId: value.contractVersionId as number,
    submissionId: value.submissionId as number,
    reviewId: value.reviewId as number,
    boundArbitratorUserId: value.boundArbitratorUserId as number,
    creatorUserId: value.creatorUserId as number,
    responsibleUserId: value.responsibleUserId as number,
    collaboratorUserIds: value.collaboratorUserIds as number[],
    latestReviewerUserId: value.latestReviewerUserId as number,
  };
}

class DrizzleAppealTransaction implements AppealTransaction {
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
        revisionRound: teamWorkItems.revisionRound,
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
    return {
      access: {
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
      },
      workItem: {
        id: row.workItemId,
        externalId: row.workItemExternalId,
        organizationId: row.organizationId,
        projectId: row.projectId,
        projectExternalId: row.projectExternalId,
        createdByUserId: row.workItemCreatedByUserId,
        status: row.workItemStatus as TeamTaskState,
        version: row.workItemVersion,
        currentContractVersionId: row.currentContractVersionId,
        revisionRound: row.revisionRound,
      },
    };
  }

  async lockCurrentContract(workItemId: number, contractId: number) {
    const [row] = await this.db
      .select({
        id: acceptanceContractVersions.id,
        externalId: acceptanceContractVersions.externalId,
        organizationId: acceptanceContractVersions.organizationId,
        projectId: acceptanceContractVersions.projectId,
        workItemId: acceptanceContractVersions.workItemId,
        criteria: acceptanceContractVersions.criteriaJson,
        approverUserId: acceptanceContractVersions.approverUserId,
        arbitratorUserId: acceptanceContractVersions.arbitratorUserId,
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
    return normalizeAppealAssignmentRows(rows);
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

  async lockSubmissionByExternalId(workItemId: number, externalId: string) {
    const [row] = await this.db
      .select({
        id: teamWorkItemSubmissions.id,
        externalId: teamWorkItemSubmissions.externalId,
        organizationId: teamWorkItemSubmissions.organizationId,
        projectId: teamWorkItemSubmissions.projectId,
        workItemId: teamWorkItemSubmissions.workItemId,
        contractVersionId: teamWorkItemSubmissions.contractVersionId,
        submittedByUserId: teamWorkItemSubmissions.submittedByUserId,
        submissionVersion: teamWorkItemSubmissions.submissionVersion,
        submittedAt: teamWorkItemSubmissions.submittedAt,
      })
      .from(teamWorkItemSubmissions)
      .where(
        and(
          eq(teamWorkItemSubmissions.workItemId, workItemId),
          eq(teamWorkItemSubmissions.externalId, externalId),
        ),
      )
      .for('update')
      .limit(1);
    return row ?? null;
  }

  async lockReviewByExternalId(workItemId: number, submissionId: number, externalId: string) {
    const [row] = await this.db
      .select({
        id: teamWorkItemReviews.id,
        externalId: teamWorkItemReviews.externalId,
        organizationId: teamWorkItemReviews.organizationId,
        projectId: teamWorkItemReviews.projectId,
        workItemId: teamWorkItemReviews.workItemId,
        submissionId: teamWorkItemReviews.submissionId,
        contractVersionId: teamWorkItemReviews.contractVersionId,
        reviewerUserId: teamWorkItemReviews.reviewerUserId,
        decision: teamWorkItemReviews.decision,
        reviewedAt: teamWorkItemReviews.reviewedAt,
      })
      .from(teamWorkItemReviews)
      .where(
        and(
          eq(teamWorkItemReviews.workItemId, workItemId),
          eq(teamWorkItemReviews.submissionId, submissionId),
          eq(teamWorkItemReviews.externalId, externalId),
        ),
      )
      .for('update')
      .limit(1);
    return row && (row.decision === 'accepted' || row.decision === 'request_revision')
      ? { ...row, decision: row.decision as AppealReviewRow['decision'] }
      : null;
  }

  async lockLatestReview(workItemId: number) {
    const [row] = await this.db
      .select({
        id: teamWorkItemReviews.id,
        externalId: teamWorkItemReviews.externalId,
        organizationId: teamWorkItemReviews.organizationId,
        projectId: teamWorkItemReviews.projectId,
        workItemId: teamWorkItemReviews.workItemId,
        submissionId: teamWorkItemReviews.submissionId,
        contractVersionId: teamWorkItemReviews.contractVersionId,
        reviewerUserId: teamWorkItemReviews.reviewerUserId,
        decision: teamWorkItemReviews.decision,
        reviewedAt: teamWorkItemReviews.reviewedAt,
      })
      .from(teamWorkItemReviews)
      .where(eq(teamWorkItemReviews.workItemId, workItemId))
      .orderBy(desc(teamWorkItemReviews.reviewedAt), desc(teamWorkItemReviews.id))
      .for('update')
      .limit(1);
    return row && (row.decision === 'accepted' || row.decision === 'request_revision')
      ? { ...row, decision: row.decision as AppealReviewRow['decision'] }
      : null;
  }

  async lockAppealBySubmissionId(submissionId: number) {
    const [row] = await this.db
      .select()
      .from(teamWorkItemAppeals)
      .where(eq(teamWorkItemAppeals.submissionId, submissionId))
      .for('update')
      .limit(1);
    return this.normalizeAppeal(row);
  }

  async lockUnresolvedAppealsByWorkItem(workItemId: number) {
    const rows = await this.db
      .select()
      .from(teamWorkItemAppeals)
      .where(
        and(
          eq(teamWorkItemAppeals.workItemId, workItemId),
          inArray(teamWorkItemAppeals.status, ['appeal_open', 'appeal_reviewing']),
        ),
      )
      .orderBy(asc(teamWorkItemAppeals.id))
      .for('update');
    const appeals: AppealRow[] = [];
    for (const row of rows) {
      const appeal = this.normalizeAppeal(row);
      if (!appeal) return null;
      appeals.push(appeal);
    }
    return appeals;
  }

  async lockAppealByExternalId(workItemId: number, externalId: string) {
    const [row] = await this.db
      .select()
      .from(teamWorkItemAppeals)
      .where(
        and(
          eq(teamWorkItemAppeals.workItemId, workItemId),
          eq(teamWorkItemAppeals.externalId, externalId),
        ),
      )
      .for('update')
      .limit(1);
    return this.normalizeAppeal(row);
  }

  async lockDecisionByAppealId(appealId: number) {
    const [row] = await this.db
      .select()
      .from(teamArbitrationDecisions)
      .where(eq(teamArbitrationDecisions.appealId, appealId))
      .for('update')
      .limit(1);
    if (
      !row ||
      !['uphold_review', 'return_for_review', 'accept_submission', 'reject_final'].includes(
        row.decision,
      )
    ) {
      return null;
    }
    const conflictSnapshot = normalizeConflictSnapshot(row.conflictSnapshotJson);
    const criterionIds =
      Array.isArray(row.criterionIdsJson) &&
      hasDenseArrayEntries(row.criterionIdsJson) &&
      row.criterionIdsJson.every((entry) => typeof entry === 'string')
        ? row.criterionIdsJson
        : null;
    const evidenceReferences = normalizeEvidence(row.evidenceRefsJson);
    if (!conflictSnapshot || !criterionIds || !evidenceReferences) return null;
    return {
      id: row.id,
      externalId: row.externalId,
      organizationId: row.organizationId,
      projectId: row.projectId,
      workItemId: row.workItemId,
      appealId: row.appealId,
      arbitratorUserId: row.arbitratorUserId,
      conflictSnapshot,
      decision: row.decision as AppealDecision,
      criterionIds,
      evidenceReferences,
      rationale: row.rationale,
      decidedAt: row.decidedAt,
      createdAt: row.createdAt,
    };
  }

  async insertAppeal(row: Omit<AppealRow, 'id'>) {
    return readInsertId(
      await this.db.insert(teamWorkItemAppeals).values({
        externalId: row.externalId,
        organizationId: row.organizationId,
        projectId: row.projectId,
        workItemId: row.workItemId,
        submissionId: row.submissionId,
        reviewId: row.reviewId,
        openedByUserId: row.openedByUserId,
        disputeType: row.disputeType,
        grounds: row.grounds,
        status: row.status,
        openedAt: row.openedAt,
        resolvedAt: row.resolvedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
    );
  }

  async insertDecision(row: Omit<AppealDecisionRow, 'id'>) {
    return readInsertId(
      await this.db.insert(teamArbitrationDecisions).values({
        externalId: row.externalId,
        organizationId: row.organizationId,
        projectId: row.projectId,
        workItemId: row.workItemId,
        appealId: row.appealId,
        arbitratorUserId: row.arbitratorUserId,
        conflictSnapshotJson: row.conflictSnapshot,
        decision: row.decision,
        criterionIdsJson: row.criterionIds,
        evidenceRefsJson: row.evidenceReferences,
        rationale: row.rationale,
        decidedAt: row.decidedAt,
        createdAt: row.createdAt,
      }),
    );
  }

  async updateAppeal(appealId: number, status: AppealStatus, resolvedAt: Date) {
    return (
      readAffectedRows(
        await this.db
          .update(teamWorkItemAppeals)
          .set({ status, resolvedAt, updatedAt: resolvedAt })
          .where(
            and(
              eq(teamWorkItemAppeals.id, appealId),
              inArray(teamWorkItemAppeals.status, ['appeal_open', 'appeal_reviewing']),
            ),
          ),
      ) === 1
    );
  }

  async updateWorkItem(
    workItemId: number,
    expectedVersion: number,
    update: Pick<AppealWorkItemRow, 'status' | 'version'>,
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

  async appendEvent(row: AppealEventRow) {
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

  async listOverdueReviewCandidates(cutoff: Date, limit: number) {
    const initialRows = await this.db
      .select({
        organizationId: teamWorkItems.organizationId,
        projectId: teamWorkItems.projectId,
        workItemExternalId: teamWorkItems.externalId,
        sourceExternalId: teamWorkItemSubmissions.externalId,
        targetUserId: acceptanceContractVersions.approverUserId,
        targetUserExternalId: users.externalId,
        organizationTeamProjectsEnabled: organizations.teamProjectsEnabled,
        startedAt: teamWorkItemSubmissions.submittedAt,
      })
      .from(teamWorkItemSubmissions)
      .innerJoin(teamWorkItems, eq(teamWorkItems.id, teamWorkItemSubmissions.workItemId))
      .innerJoin(
        acceptanceContractVersions,
        eq(acceptanceContractVersions.id, teamWorkItemSubmissions.contractVersionId),
      )
      .innerJoin(organizations, eq(organizations.id, teamWorkItems.organizationId))
      .innerJoin(users, eq(users.id, acceptanceContractVersions.approverUserId))
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.organizationId, organizations.id),
          eq(organizationMembers.userId, users.id),
          eq(organizationMembers.status, 'active'),
        ),
      )
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, teamWorkItems.projectId),
          eq(projectMembers.userId, users.id),
          eq(projectMembers.status, 'active'),
        ),
      )
      .leftJoin(
        teamWorkItemReviews,
        eq(teamWorkItemReviews.submissionId, teamWorkItemSubmissions.id),
      )
      .where(
        and(
          lte(teamWorkItemSubmissions.submittedAt, cutoff),
          isNull(teamWorkItemReviews.id),
          inArray(teamWorkItems.status, ['submitted', 'resubmitted', 'in_review']),
          eq(organizations.status, 'active'),
        ),
      )
      .orderBy(asc(teamWorkItemSubmissions.submittedAt), asc(teamWorkItemSubmissions.id))
      .limit(limit);

    const nextReviewAttempts = alias(teamWorkItemReviews, 'next_team_work_item_reviews');
    const returnedRows = await this.db
      .select({
        organizationId: teamWorkItemAppeals.organizationId,
        projectId: teamWorkItemAppeals.projectId,
        workItemExternalId: teamWorkItems.externalId,
        sourceExternalId: teamWorkItemSubmissions.externalId,
        targetUserId: acceptanceContractVersions.approverUserId,
        targetUserExternalId: users.externalId,
        organizationTeamProjectsEnabled: organizations.teamProjectsEnabled,
        startedAt: teamArbitrationDecisions.decidedAt,
      })
      .from(teamArbitrationDecisions)
      .innerJoin(teamWorkItemAppeals, eq(teamWorkItemAppeals.id, teamArbitrationDecisions.appealId))
      .innerJoin(
        teamWorkItemReviews,
        and(
          eq(teamWorkItemReviews.id, teamWorkItemAppeals.reviewId),
          eq(teamWorkItemReviews.submissionId, teamWorkItemAppeals.submissionId),
        ),
      )
      .innerJoin(
        teamWorkItemSubmissions,
        and(
          eq(teamWorkItemSubmissions.id, teamWorkItemAppeals.submissionId),
          eq(teamWorkItemSubmissions.workItemId, teamWorkItemAppeals.workItemId),
        ),
      )
      .innerJoin(teamWorkItems, eq(teamWorkItems.id, teamWorkItemAppeals.workItemId))
      .innerJoin(
        acceptanceContractVersions,
        eq(acceptanceContractVersions.id, teamWorkItemReviews.contractVersionId),
      )
      .innerJoin(organizations, eq(organizations.id, teamWorkItemAppeals.organizationId))
      .innerJoin(users, eq(users.id, acceptanceContractVersions.approverUserId))
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.organizationId, organizations.id),
          eq(organizationMembers.userId, users.id),
          eq(organizationMembers.status, 'active'),
        ),
      )
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, teamWorkItemAppeals.projectId),
          eq(projectMembers.userId, users.id),
          eq(projectMembers.status, 'active'),
        ),
      )
      .leftJoin(
        nextReviewAttempts,
        and(
          eq(nextReviewAttempts.submissionId, teamWorkItemAppeals.submissionId),
          eq(nextReviewAttempts.reviewAttempt, sql`${teamWorkItemReviews.reviewAttempt} + 1`),
        ),
      )
      .where(
        and(
          eq(teamArbitrationDecisions.decision, 'return_for_review'),
          eq(teamWorkItemAppeals.status, 'appeal_resolved'),
          lte(teamArbitrationDecisions.decidedAt, cutoff),
          isNull(nextReviewAttempts.id),
          inArray(teamWorkItems.status, ['submitted', 'resubmitted']),
          eq(organizations.status, 'active'),
        ),
      )
      .orderBy(asc(teamArbitrationDecisions.decidedAt), asc(teamArbitrationDecisions.id))
      .limit(limit);

    return [...initialRows, ...returnedRows]
      .sort(
        (left, right) =>
          left.startedAt.valueOf() - right.startedAt.valueOf() ||
          left.sourceExternalId.localeCompare(right.sourceExternalId),
      )
      .slice(0, limit)
      .map((row) => ({ ...row, kind: 'review' as const }));
  }

  async listOverdueAppealCandidates(cutoff: Date, limit: number) {
    const rows = await this.db
      .select({
        organizationId: teamWorkItemAppeals.organizationId,
        projectId: teamWorkItemAppeals.projectId,
        workItemExternalId: teamWorkItems.externalId,
        sourceExternalId: teamWorkItemAppeals.externalId,
        targetUserId: acceptanceContractVersions.arbitratorUserId,
        targetUserExternalId: users.externalId,
        organizationTeamProjectsEnabled: organizations.teamProjectsEnabled,
        startedAt: teamWorkItemAppeals.openedAt,
      })
      .from(teamWorkItemAppeals)
      .innerJoin(teamWorkItems, eq(teamWorkItems.id, teamWorkItemAppeals.workItemId))
      .innerJoin(teamWorkItemReviews, eq(teamWorkItemReviews.id, teamWorkItemAppeals.reviewId))
      .innerJoin(
        acceptanceContractVersions,
        eq(acceptanceContractVersions.id, teamWorkItemReviews.contractVersionId),
      )
      .innerJoin(organizations, eq(organizations.id, teamWorkItemAppeals.organizationId))
      .innerJoin(users, eq(users.id, acceptanceContractVersions.arbitratorUserId))
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.organizationId, organizations.id),
          eq(organizationMembers.userId, users.id),
          eq(organizationMembers.status, 'active'),
        ),
      )
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, teamWorkItemAppeals.projectId),
          eq(projectMembers.userId, users.id),
          eq(projectMembers.status, 'active'),
        ),
      )
      .where(
        and(
          lte(teamWorkItemAppeals.openedAt, cutoff),
          inArray(teamWorkItemAppeals.status, ['appeal_open', 'appeal_reviewing']),
          eq(organizations.status, 'active'),
        ),
      )
      .orderBy(asc(teamWorkItemAppeals.openedAt), asc(teamWorkItemAppeals.id))
      .limit(limit);
    return rows.map((row) => ({ ...row, kind: 'appeal' as const }));
  }

  private normalizeAppeal(row: typeof teamWorkItemAppeals.$inferSelect | undefined) {
    if (
      !row ||
      !['fact', 'criterion_application', 'process_rule'].includes(row.disputeType) ||
      !['appeal_open', 'appeal_reviewing', 'appeal_resolved'].includes(row.status)
    ) {
      return null;
    }
    return {
      ...row,
      disputeType: row.disputeType as AppealDisputeType,
      status: row.status as AppealStatus,
    };
  }
}

export class DrizzleAppealRepository implements AppealRepository {
  constructor(private readonly db: DB) {}

  transaction<T>(work: (tx: AppealTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleAppealTransaction(tx)));
  }
}

export function createTeamTaskAppealService(db: DB): TeamTaskAppealService {
  return new TeamTaskAppealService(new DrizzleAppealRepository(db));
}
