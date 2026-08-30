export interface AcceptanceCriterionInput {
  id: string;
  description: string;
}

export interface RequiredEvidenceTypeInput {
  type: string;
  description?: string;
}

export interface AcceptanceContractInput {
  objective: string;
  deliverables: string[];
  criteria: AcceptanceCriterionInput[];
  requiredEvidenceTypes: RequiredEvidenceTypeInput[];
  approverId: string;
  arbitratorId: string;
  responsiblePersonId?: string;
  dueAt: string;
  maxRevisionRounds: number;
}

export interface NormalizedAcceptanceContract {
  objective: string;
  deliverables: string[];
  criteria: AcceptanceCriterionInput[];
  requiredEvidenceTypes: RequiredEvidenceTypeInput[];
  approverId: string;
  arbitratorId: string;
  responsiblePersonId?: string;
  dueAt: string;
  maxRevisionRounds: number;
}

export type AcceptanceContractErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CONTEXT'
  | 'REFERENCE_TIME_INVALID'
  | 'OBJECTIVE_REQUIRED'
  | 'OBJECTIVE_TOO_LONG'
  | 'DELIVERABLE_REQUIRED'
  | 'DELIVERABLE_INVALID'
  | 'DELIVERABLE_TOO_LONG'
  | 'DELIVERABLE_COUNT_EXCEEDED'
  | 'CRITERION_REQUIRED'
  | 'CRITERION_INVALID'
  | 'CRITERION_ID_REQUIRED'
  | 'CRITERION_ID_TOO_LONG'
  | 'CRITERION_DESCRIPTION_REQUIRED'
  | 'CRITERION_DESCRIPTION_TOO_LONG'
  | 'CRITERION_COUNT_EXCEEDED'
  | 'DUPLICATE_CRITERION_ID'
  | 'UNLIMITED_OBLIGATION'
  | 'EVIDENCE_TYPE_REQUIRED'
  | 'EVIDENCE_TYPE_TOO_LONG'
  | 'EVIDENCE_TYPE_COUNT_EXCEEDED'
  | 'DUPLICATE_EVIDENCE_TYPE'
  | 'EVIDENCE_DESCRIPTION_REQUIRED'
  | 'EVIDENCE_DESCRIPTION_TOO_LONG'
  | 'APPROVER_ID_REQUIRED'
  | 'APPROVER_ID_TOO_LONG'
  | 'ARBITRATOR_ID_REQUIRED'
  | 'ARBITRATOR_ID_TOO_LONG'
  | 'APPROVER_ARBITRATOR_CONFLICT'
  | 'RESPONSIBLE_PERSON_ID_INVALID'
  | 'RESPONSIBLE_PERSON_ID_TOO_LONG'
  | 'APPROVER_RESPONSIBLE_CONFLICT'
  | 'ARBITRATOR_RESPONSIBLE_CONFLICT'
  | 'DUE_AT_INVALID'
  | 'DUE_AT_NOT_FUTURE'
  | 'MAX_REVISION_ROUNDS_INVALID';

export type AcceptanceContractValidationResult =
  | { ok: true; contract: NormalizedAcceptanceContract }
  | { ok: false; code: AcceptanceContractErrorCode };

const OBJECTIVE_MAX_LENGTH = 2_000;
const DELIVERABLE_MAX_LENGTH = 500;
const DELIVERABLE_MAX_COUNT = 50;
const CRITERION_ID_MAX_LENGTH = 100;
const CRITERION_DESCRIPTION_MAX_LENGTH = 1_000;
const CRITERION_MAX_COUNT = 100;
const EVIDENCE_TYPE_MAX_LENGTH = 100;
const EVIDENCE_TYPE_MAX_COUNT = 50;
const EVIDENCE_DESCRIPTION_MAX_LENGTH = 500;
const ACTOR_ID_MAX_LENGTH = 128;
const UNLIMITED_OBLIGATION = /做\s*到\s*满\s*意\s*为\s*止/u;
const ISO_UTC_INSTANT_MAX_LENGTH = 24;
const ISO_UTC_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u;

export interface ParsedIsoUtcInstant {
  canonical: string;
  epochMs: number;
}

export function parseIsoUtcInstant(value: unknown): ParsedIsoUtcInstant | null {
  if (typeof value !== 'string' || value.length > ISO_UTC_INSTANT_MAX_LENGTH) return null;
  const match = ISO_UTC_INSTANT_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = ''] = match;
  const canonical = `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, '0')}Z`;
  const epochMs = Date.parse(canonical);
  if (!Number.isFinite(epochMs) || new Date(epochMs).toISOString() !== canonical) return null;
  return { canonical, epochMs };
}

function reject(code: AcceptanceContractErrorCode): AcceptanceContractValidationResult {
  return { ok: false, code };
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateAcceptanceContract(
  input: AcceptanceContractInput,
  context: { now: string },
): AcceptanceContractValidationResult {
  if (!isRecord(input)) return reject('INVALID_INPUT');
  if (!isRecord(context)) return reject('INVALID_CONTEXT');
  const referenceTime = parseIsoUtcInstant(context.now);
  if (!referenceTime) return reject('REFERENCE_TIME_INVALID');

  if (typeof input.objective !== 'string' || input.objective.trim() === '') {
    return reject('OBJECTIVE_REQUIRED');
  }
  const objective = input.objective.trim();
  if (objective.length > OBJECTIVE_MAX_LENGTH) return reject('OBJECTIVE_TOO_LONG');

  if (!Array.isArray(input.deliverables) || input.deliverables.length === 0) {
    return reject('DELIVERABLE_REQUIRED');
  }
  if (input.deliverables.length > DELIVERABLE_MAX_COUNT) {
    return reject('DELIVERABLE_COUNT_EXCEEDED');
  }
  if (input.deliverables.some((value) => typeof value !== 'string')) {
    return reject('DELIVERABLE_INVALID');
  }
  const deliverables = input.deliverables.map((value) => value.trim());
  if (deliverables.some((value) => value === '')) return reject('DELIVERABLE_REQUIRED');
  if (deliverables.some((value) => value.length > DELIVERABLE_MAX_LENGTH)) {
    return reject('DELIVERABLE_TOO_LONG');
  }

  if (!Array.isArray(input.criteria) || input.criteria.length === 0) {
    return reject('CRITERION_REQUIRED');
  }
  if (input.criteria.length > CRITERION_MAX_COUNT) return reject('CRITERION_COUNT_EXCEEDED');
  const criteria: AcceptanceCriterionInput[] = [];
  const criterionKeys = new Set<string>();
  for (const criterion of input.criteria) {
    if (!isRecord(criterion)) return reject('CRITERION_INVALID');
    if (typeof criterion.id !== 'string' || criterion.id.trim() === '') {
      return reject('CRITERION_ID_REQUIRED');
    }
    const id = criterion.id.trim();
    if (id.length > CRITERION_ID_MAX_LENGTH) return reject('CRITERION_ID_TOO_LONG');
    const idKey = id.toLocaleLowerCase('en-US');
    if (criterionKeys.has(idKey)) return reject('DUPLICATE_CRITERION_ID');
    criterionKeys.add(idKey);
    if (typeof criterion.description !== 'string' || criterion.description.trim() === '') {
      return reject('CRITERION_DESCRIPTION_REQUIRED');
    }
    const description = criterion.description.trim();
    if (description.length > CRITERION_DESCRIPTION_MAX_LENGTH) {
      return reject('CRITERION_DESCRIPTION_TOO_LONG');
    }
    criteria.push({ id, description });
  }

  if (!Array.isArray(input.requiredEvidenceTypes) || input.requiredEvidenceTypes.length === 0) {
    return reject('EVIDENCE_TYPE_REQUIRED');
  }
  if (input.requiredEvidenceTypes.length > EVIDENCE_TYPE_MAX_COUNT) {
    return reject('EVIDENCE_TYPE_COUNT_EXCEEDED');
  }
  const requiredEvidenceTypes: RequiredEvidenceTypeInput[] = [];
  const evidenceTypeKeys = new Set<string>();
  for (const evidenceType of input.requiredEvidenceTypes) {
    if (!isRecord(evidenceType)) return reject('EVIDENCE_TYPE_REQUIRED');
    if (typeof evidenceType.type !== 'string' || evidenceType.type.trim() === '') {
      return reject('EVIDENCE_TYPE_REQUIRED');
    }
    const type = evidenceType.type.trim();
    if (type.length > EVIDENCE_TYPE_MAX_LENGTH) return reject('EVIDENCE_TYPE_TOO_LONG');
    const typeKey = type.toLocaleLowerCase('en-US');
    if (evidenceTypeKeys.has(typeKey)) return reject('DUPLICATE_EVIDENCE_TYPE');
    evidenceTypeKeys.add(typeKey);
    if (
      evidenceType.description !== undefined &&
      (typeof evidenceType.description !== 'string' || evidenceType.description.trim() === '')
    ) {
      return reject('EVIDENCE_DESCRIPTION_REQUIRED');
    }
    const description = evidenceType.description?.trim();
    if (description && description.length > EVIDENCE_DESCRIPTION_MAX_LENGTH) {
      return reject('EVIDENCE_DESCRIPTION_TOO_LONG');
    }
    requiredEvidenceTypes.push(description === undefined ? { type } : { type, description });
  }

  const contractProse = [
    objective,
    ...deliverables,
    ...criteria.flatMap((criterion) => [criterion.id, criterion.description]),
    ...requiredEvidenceTypes.flatMap((evidenceType) =>
      evidenceType.description === undefined ? [] : [evidenceType.description],
    ),
  ];
  if (contractProse.some((value) => UNLIMITED_OBLIGATION.test(value))) {
    return reject('UNLIMITED_OBLIGATION');
  }

  if (typeof input.approverId !== 'string' || input.approverId.trim() === '') {
    return reject('APPROVER_ID_REQUIRED');
  }
  const approverId = input.approverId.trim();
  if (approverId.length > ACTOR_ID_MAX_LENGTH) return reject('APPROVER_ID_TOO_LONG');
  if (typeof input.arbitratorId !== 'string' || input.arbitratorId.trim() === '') {
    return reject('ARBITRATOR_ID_REQUIRED');
  }
  const arbitratorId = input.arbitratorId.trim();
  if (arbitratorId.length > ACTOR_ID_MAX_LENGTH) return reject('ARBITRATOR_ID_TOO_LONG');
  if (approverId === arbitratorId) return reject('APPROVER_ARBITRATOR_CONFLICT');
  if (input.responsiblePersonId !== undefined && typeof input.responsiblePersonId !== 'string') {
    return reject('RESPONSIBLE_PERSON_ID_INVALID');
  }
  const responsiblePersonId = input.responsiblePersonId?.trim();
  if (responsiblePersonId && responsiblePersonId.length > ACTOR_ID_MAX_LENGTH) {
    return reject('RESPONSIBLE_PERSON_ID_TOO_LONG');
  }
  if (responsiblePersonId && approverId === responsiblePersonId) {
    return reject('APPROVER_RESPONSIBLE_CONFLICT');
  }
  if (responsiblePersonId && arbitratorId === responsiblePersonId) {
    return reject('ARBITRATOR_RESPONSIBLE_CONFLICT');
  }

  const dueAt = parseIsoUtcInstant(input.dueAt);
  if (!dueAt) return reject('DUE_AT_INVALID');
  if (dueAt.epochMs <= referenceTime.epochMs) return reject('DUE_AT_NOT_FUTURE');
  if (
    !Number.isInteger(input.maxRevisionRounds) ||
    input.maxRevisionRounds < 0 ||
    input.maxRevisionRounds > 2
  ) {
    return reject('MAX_REVISION_ROUNDS_INVALID');
  }

  return {
    ok: true,
    contract: {
      objective,
      deliverables,
      criteria,
      requiredEvidenceTypes,
      approverId,
      arbitratorId,
      ...(responsiblePersonId ? { responsiblePersonId } : {}),
      dueAt: dueAt.canonical,
      maxRevisionRounds: input.maxRevisionRounds,
    },
  };
}
