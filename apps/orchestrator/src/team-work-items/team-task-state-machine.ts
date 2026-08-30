export const TEAM_TASK_STATES = [
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
] as const;

export type TeamTaskState = (typeof TEAM_TASK_STATES)[number];

export const TEAM_TASK_COMMAND_TYPES = [
  'publish',
  'assign',
  'make_claimable',
  'accept_assignment',
  'claim',
  'start',
  'block',
  'unblock',
  'submit',
  'start_review',
  'request_revision',
  'resubmit',
  'accept',
  'complete',
  'cancel',
  'reject_final',
  'archive',
] as const;

export interface TeamTaskEvidenceReference {
  kind: 'evidence' | 'missing_evidence';
  reference: string;
}

export interface TeamTaskCurrent {
  state: TeamTaskState;
  appealOpen: boolean;
}

export type TeamTaskCommand =
  | { type: 'publish' }
  | { type: 'assign' }
  | { type: 'make_claimable' }
  | { type: 'accept_assignment' }
  | { type: 'claim' }
  | { type: 'start' }
  | {
      type: 'block';
      responsibleParty: string;
      nextAction: string;
      reviewAt: string;
      affectsDueDate: boolean;
      now: string;
    }
  | { type: 'unblock' }
  | { type: 'submit'; submittedAt: string; dueAt: string }
  | { type: 'start_review' }
  | {
      type: 'request_revision';
      failedCriterionIds: readonly string[];
      evidenceReferences: readonly TeamTaskEvidenceReference[];
      revisionInstructions: readonly string[];
      newDeadline: string;
      reviewAt: string;
    }
  | { type: 'resubmit'; submittedAt: string; dueAt: string }
  | { type: 'accept' }
  | { type: 'complete' }
  | { type: 'cancel' }
  | { type: 'reject_final'; finalDecisionAuthorized: boolean }
  | { type: 'archive' };

export interface TeamTaskBlockerSnapshot {
  responsibleParty: string;
  nextAction: string;
  reviewAt: string;
  affectsDueDate: boolean;
}

export interface TeamTaskSubmissionSnapshot {
  submittedAt: string;
  dueAt: string;
  submittedOnTime: boolean;
}

export interface TeamTaskRevisionSnapshot {
  failedCriterionIds: string[];
  evidenceReferences: TeamTaskEvidenceReference[];
  revisionInstructions: string[];
  newDeadline: string;
}

export type TeamTaskTransitionErrorCode =
  | 'INVALID_TRANSITION'
  | 'APPEAL_OPEN'
  | 'FINAL_DECISION_REQUIRED'
  | 'BLOCK_RESPONSIBLE_PARTY_REQUIRED'
  | 'BLOCK_RESPONSIBLE_PARTY_TOO_LONG'
  | 'BLOCK_NEXT_ACTION_REQUIRED'
  | 'BLOCK_NEXT_ACTION_TOO_LONG'
  | 'BLOCK_REVIEW_AT_INVALID'
  | 'BLOCK_REVIEW_AT_NOT_FUTURE'
  | 'BLOCK_REFERENCE_TIME_INVALID'
  | 'BLOCK_AFFECTS_DUE_DATE_REQUIRED'
  | 'SUBMITTED_AT_INVALID'
  | 'DUE_AT_INVALID'
  | 'REVISION_FAILED_CRITERIA_REQUIRED'
  | 'REVISION_FAILED_CRITERIA_TOO_LONG'
  | 'REVISION_FAILED_CRITERIA_COUNT_EXCEEDED'
  | 'REVISION_EVIDENCE_REQUIRED'
  | 'REVISION_EVIDENCE_TOO_LONG'
  | 'REVISION_EVIDENCE_COUNT_EXCEEDED'
  | 'REVISION_INSTRUCTIONS_REQUIRED'
  | 'REVISION_INSTRUCTIONS_TOO_LONG'
  | 'REVISION_INSTRUCTIONS_COUNT_EXCEEDED'
  | 'REVISION_DEADLINE_INVALID'
  | 'REVISION_DEADLINE_NOT_FUTURE'
  | 'REVISION_REFERENCE_TIME_INVALID';

export type TeamTaskTransitionResult =
  | {
      ok: true;
      state: TeamTaskState;
      blocker?: TeamTaskBlockerSnapshot;
      submission?: TeamTaskSubmissionSnapshot;
      revision?: TeamTaskRevisionSnapshot;
    }
  | { ok: false; code: TeamTaskTransitionErrorCode };

const BLOCK_RESPONSIBLE_PARTY_MAX_LENGTH = 128;
const BLOCK_NEXT_ACTION_MAX_LENGTH = 1_000;
const REVISION_CRITERION_ID_MAX_LENGTH = 100;
const REVISION_CRITERION_ID_MAX_COUNT = 100;
const REVISION_EVIDENCE_REFERENCE_MAX_LENGTH = 500;
const REVISION_EVIDENCE_REFERENCE_MAX_COUNT = 100;
const REVISION_INSTRUCTION_MAX_LENGTH = 1_000;
const REVISION_INSTRUCTION_MAX_COUNT = 50;

const simpleTransitions: Partial<
  Record<TeamTaskState, Partial<Record<TeamTaskCommand['type'], TeamTaskState>>>
> = {
  draft: { publish: 'ready', cancel: 'cancelled' },
  ready: { assign: 'assigned', make_claimable: 'claimable', cancel: 'cancelled' },
  assigned: { accept_assignment: 'accepted_by_member', cancel: 'cancelled' },
  claimable: { claim: 'accepted_by_member', cancel: 'cancelled' },
  accepted_by_member: { start: 'in_progress', cancel: 'cancelled' },
  in_progress: { block: 'blocked', submit: 'submitted', cancel: 'cancelled' },
  blocked: { unblock: 'in_progress', cancel: 'cancelled' },
  submitted: { start_review: 'in_review' },
  in_review: {
    request_revision: 'revision_requested',
    accept: 'accepted',
    reject_final: 'rejected_final',
  },
  revision_requested: { resubmit: 'resubmitted' },
  resubmitted: { start_review: 'in_review' },
  accepted: { complete: 'completed' },
  completed: { archive: 'archived' },
  cancelled: { archive: 'archived' },
  rejected_final: { archive: 'archived' },
};

function reject(code: TeamTaskTransitionErrorCode): TeamTaskTransitionResult {
  return { ok: false, code };
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

function uniqueTrimmed(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
}

function validateBlock(
  command: Extract<TeamTaskCommand, { type: 'block' }>,
): TeamTaskTransitionResult {
  if (typeof command.responsibleParty !== 'string' || command.responsibleParty.trim() === '') {
    return reject('BLOCK_RESPONSIBLE_PARTY_REQUIRED');
  }
  const responsibleParty = command.responsibleParty.trim();
  if (responsibleParty.length > BLOCK_RESPONSIBLE_PARTY_MAX_LENGTH) {
    return reject('BLOCK_RESPONSIBLE_PARTY_TOO_LONG');
  }
  if (typeof command.nextAction !== 'string' || command.nextAction.trim() === '') {
    return reject('BLOCK_NEXT_ACTION_REQUIRED');
  }
  const nextAction = command.nextAction.trim();
  if (nextAction.length > BLOCK_NEXT_ACTION_MAX_LENGTH) {
    return reject('BLOCK_NEXT_ACTION_TOO_LONG');
  }
  if (!validTime(command.now)) return reject('BLOCK_REFERENCE_TIME_INVALID');
  if (!validTime(command.reviewAt)) return reject('BLOCK_REVIEW_AT_INVALID');
  if (Date.parse(command.reviewAt) <= Date.parse(command.now)) {
    return reject('BLOCK_REVIEW_AT_NOT_FUTURE');
  }
  if (typeof command.affectsDueDate !== 'boolean') {
    return reject('BLOCK_AFFECTS_DUE_DATE_REQUIRED');
  }
  return {
    ok: true,
    state: 'blocked',
    blocker: {
      responsibleParty,
      nextAction,
      reviewAt: command.reviewAt,
      affectsDueDate: command.affectsDueDate,
    },
  };
}

function validateSubmission(
  command: Extract<TeamTaskCommand, { type: 'submit' | 'resubmit' }>,
  state: 'submitted' | 'resubmitted',
): TeamTaskTransitionResult {
  if (!validTime(command.submittedAt)) return reject('SUBMITTED_AT_INVALID');
  if (!validTime(command.dueAt)) return reject('DUE_AT_INVALID');
  return {
    ok: true,
    state,
    submission: {
      submittedAt: command.submittedAt,
      dueAt: command.dueAt,
      submittedOnTime: Date.parse(command.submittedAt) <= Date.parse(command.dueAt),
    },
  };
}

function validateRevision(
  command: Extract<TeamTaskCommand, { type: 'request_revision' }>,
): TeamTaskTransitionResult {
  if (!Array.isArray(command.failedCriterionIds)) {
    return reject('REVISION_FAILED_CRITERIA_REQUIRED');
  }
  if (command.failedCriterionIds.length > REVISION_CRITERION_ID_MAX_COUNT) {
    return reject('REVISION_FAILED_CRITERIA_COUNT_EXCEEDED');
  }
  const failedCriterionIds = uniqueTrimmed(
    command.failedCriterionIds.filter((value): value is string => typeof value === 'string'),
  ).filter(Boolean);
  if (failedCriterionIds.length === 0) return reject('REVISION_FAILED_CRITERIA_REQUIRED');
  if (failedCriterionIds.some((value) => value.length > REVISION_CRITERION_ID_MAX_LENGTH)) {
    return reject('REVISION_FAILED_CRITERIA_TOO_LONG');
  }

  if (!Array.isArray(command.evidenceReferences)) return reject('REVISION_EVIDENCE_REQUIRED');
  if (command.evidenceReferences.length > REVISION_EVIDENCE_REFERENCE_MAX_COUNT) {
    return reject('REVISION_EVIDENCE_COUNT_EXCEEDED');
  }
  const evidenceReferences: TeamTaskEvidenceReference[] = [];
  const seenEvidence = new Set<string>();
  for (const item of command.evidenceReferences) {
    if (
      (item?.kind !== 'evidence' && item?.kind !== 'missing_evidence') ||
      typeof item.reference !== 'string' ||
      item.reference.trim() === ''
    ) {
      continue;
    }
    const reference = item.reference.trim();
    if (reference.length > REVISION_EVIDENCE_REFERENCE_MAX_LENGTH) {
      return reject('REVISION_EVIDENCE_TOO_LONG');
    }
    const key = `${item.kind}:${reference.toLocaleLowerCase('en-US')}`;
    if (seenEvidence.has(key)) continue;
    seenEvidence.add(key);
    evidenceReferences.push({ kind: item.kind, reference });
  }
  if (evidenceReferences.length === 0) return reject('REVISION_EVIDENCE_REQUIRED');

  if (!Array.isArray(command.revisionInstructions)) {
    return reject('REVISION_INSTRUCTIONS_REQUIRED');
  }
  if (command.revisionInstructions.length > REVISION_INSTRUCTION_MAX_COUNT) {
    return reject('REVISION_INSTRUCTIONS_COUNT_EXCEEDED');
  }
  const revisionInstructions = uniqueTrimmed(
    command.revisionInstructions.filter((value): value is string => typeof value === 'string'),
  ).filter(Boolean);
  if (revisionInstructions.length === 0) return reject('REVISION_INSTRUCTIONS_REQUIRED');
  if (revisionInstructions.some((value) => value.length > REVISION_INSTRUCTION_MAX_LENGTH)) {
    return reject('REVISION_INSTRUCTIONS_TOO_LONG');
  }

  if (!validTime(command.reviewAt)) return reject('REVISION_REFERENCE_TIME_INVALID');
  if (!validTime(command.newDeadline)) return reject('REVISION_DEADLINE_INVALID');
  if (Date.parse(command.newDeadline) <= Date.parse(command.reviewAt)) {
    return reject('REVISION_DEADLINE_NOT_FUTURE');
  }
  return {
    ok: true,
    state: 'revision_requested',
    revision: {
      failedCriterionIds,
      evidenceReferences,
      revisionInstructions,
      newDeadline: command.newDeadline,
    },
  };
}

export function transitionTeamTask(
  current: TeamTaskCurrent,
  command: TeamTaskCommand,
): TeamTaskTransitionResult {
  const target = simpleTransitions[current.state]?.[command.type];
  if (!target) return reject('INVALID_TRANSITION');

  if (command.type === 'reject_final') {
    if (current.appealOpen) return reject('APPEAL_OPEN');
    if (command.finalDecisionAuthorized !== true) return reject('FINAL_DECISION_REQUIRED');
  }
  if (command.type === 'archive' && current.appealOpen) return reject('APPEAL_OPEN');
  if (command.type === 'block') return validateBlock(command);
  if (command.type === 'submit') return validateSubmission(command, 'submitted');
  if (command.type === 'resubmit') return validateSubmission(command, 'resubmitted');
  if (command.type === 'request_revision') return validateRevision(command);

  return { ok: true, state: target };
}
