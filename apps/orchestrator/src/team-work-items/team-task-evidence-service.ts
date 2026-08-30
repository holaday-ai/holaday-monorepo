import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { isExternalId, newExternalId } from '@holaday/shared-types';
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, or, sum } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import { acceptanceContractVersions } from '../db/schema/acceptance-contract-versions.js';
import { evidenceArtifacts } from '../db/schema/evidence-artifacts.js';
import { llmCalls } from '../db/schema/llm-calls.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { projectMembers } from '../db/schema/project-members.js';
import { projects } from '../db/schema/projects.js';
import { taskFiles } from '../db/schema/task-files.js';
import { tasks } from '../db/schema/tasks.js';
import { teamAiContributions } from '../db/schema/team-ai-contributions.js';
import { teamEvidenceBindings } from '../db/schema/team-evidence-bindings.js';
import { teamProjectPlanningEvents } from '../db/schema/team-project-planning-events.js';
import { teamWorkItemAppeals } from '../db/schema/team-work-item-appeals.js';
import { teamWorkItemAssignments } from '../db/schema/team-work-item-assignments.js';
import { teamWorkItemEvents } from '../db/schema/team-work-item-events.js';
import { teamWorkItemReviews } from '../db/schema/team-work-item-reviews.js';
import { teamWorkItemSubmissions } from '../db/schema/team-work-item-submissions.js';
import { teamWorkItems } from '../db/schema/team-work-items.js';
import { users } from '../db/schema/users.js';
import { isTeamTaskLifecycleEnabledFor } from './team-task-access.js';
import { decideTeamTaskPermission } from './team-task-permissions.js';
import type { TeamTaskEventRow, TeamTaskProjectAccessSnapshot } from './team-task-service.js';
import { TEAM_TASK_STATES, type TeamTaskState } from './team-task-state-machine.js';

export type TeamTaskEvidenceServiceErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INVALID_INPUT';

export class TeamTaskEvidenceServiceError extends Error {
  constructor(public readonly code: TeamTaskEvidenceServiceErrorCode) {
    super(code);
    this.name = 'TeamTaskEvidenceServiceError';
  }
}

export interface EvidenceWorkItemRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  status: TeamTaskState;
  version: number;
  currentContractVersionId: number | null;
}

export type EvidenceSourceRow =
  | {
      kind: 'evidenceArtifact';
      id: number;
      externalId: string;
      ownerUserId: number | null;
      taskId: number | null;
      taskProjectId: number | null;
      taskUserId: number | null;
      expiresAt: Date | null;
      ownerOrganizationMembershipActive: boolean;
      ownerProjectMembershipActive: boolean;
      ownerProjectRole: string | null;
    }
  | {
      kind: 'taskFile';
      id: number;
      externalId: string;
      ownerUserId: number;
      taskId: number | null;
      taskProjectId: number | null;
      taskUserId: number | null;
      status: string;
      expiresAt: Date | null;
      ownerOrganizationMembershipActive: boolean;
      ownerProjectMembershipActive: boolean;
      ownerProjectRole: string | null;
    };

export type TeamTaskEvidenceTargetKind = 'submission' | 'review' | 'appeal' | 'aiContribution';

export interface TeamTaskEvidenceTargetRow {
  kind: TeamTaskEvidenceTargetKind;
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
}

export interface EvidenceMetadata {
  evidenceType?: string;
  confidence?: 'observed' | 'verified' | 'user_supplied';
  relation?: 'supports' | 'contradicts' | 'context';
}

export interface EvidenceBindingRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  submissionId: number | null;
  reviewId: number | null;
  appealId: number | null;
  aiContributionId: number | null;
  evidenceArtifactId: number | null;
  taskFileId: number | null;
  sourceKind: 'evidenceArtifact' | 'taskFile' | 'controlledExternalRef';
  controlledExternalRef: string | null;
  metadata: EvidenceMetadata | null;
  boundByUserId: number;
  createdAt: Date;
}

export interface AiInputSourceSummary {
  sourceKinds: Array<'task_file' | 'evidence_artifact'>;
  sourceCount: number;
}

export interface AiUsageSnapshot {
  taskUnits: 1;
  opusUnits: 0 | 1;
  llmCallCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
}

export interface AiUnverifiedRisk {
  code: 'needs_fact_check' | 'missing_evidence' | 'stale_source' | 'scope_gap';
  severity: 'low' | 'medium' | 'high';
}

export type AiHumanConfirmationStatus = 'pending' | 'confirmed' | 'modified' | 'rejected';

export interface TeamAiContributionRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  contributedByUserId: number;
  executionTaskId: number;
  executionTaskExternalId: string;
  requestedScope: string;
  inputSourceSummary: AiInputSourceSummary;
  resultVersion: string;
  usageSnapshot: AiUsageSnapshot;
  humanConfirmationStatus: AiHumanConfirmationStatus;
  humanChangesSummary: string | null;
  unverifiedRisks: AiUnverifiedRisk[];
  createdAt: Date;
  confirmedAt: Date | null;
}

export interface AiExecutionTaskRow {
  id: number;
  externalId: string;
  projectId: number | null;
  userId: number;
  status: string;
  origin: string;
  result: unknown;
  completedAt: Date | null;
  opusUsed: boolean;
  ownerOrganizationMembershipActive: boolean;
  ownerProjectMembershipActive: boolean;
  ownerProjectRole: string | null;
}

export interface AiExecutionSnapshotRow {
  taskFileCount: number;
  evidenceArtifactCount: number;
  llmCallCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
}

export interface EvidencePreflightSnapshot {
  contract: {
    id: number;
    organizationId: number;
    projectId: number;
    workItemId: number;
    objective: unknown;
    deliverables: unknown;
    criteria: unknown;
    requiredEvidenceTypes: unknown;
    confirmedByUserId: number | null;
    confirmedAt: Date | null;
  } | null;
  evidenceBindings: Array<{ evidenceType: unknown; sourceValid: boolean }>;
}

export interface EvidencePreflightDto {
  workItemId: string;
  missingContractFields: string[];
  missingEvidenceTypes: string[];
  schemaValidation: { valid: boolean; issueCodes: string[] };
  recommendationSummary: { code: string; text: string };
}

export interface EvidencePackageBindingDto {
  id: string;
  source: {
    kind: EvidenceBindingRow['sourceKind'];
    sourceId?: string;
  };
  target: { kind: 'workItem' | TeamTaskEvidenceTargetKind; targetId?: string };
  metadata: EvidenceMetadata | null;
  createdAt: string;
}

export interface AiContributionDto {
  id: string;
  executionTaskId: string;
  requestedScope: string;
  inputSourceSummary: AiInputSourceSummary;
  resultVersion: string;
  usageSnapshot: AiUsageSnapshot;
  humanConfirmationStatus: AiHumanConfirmationStatus;
  humanChangesSummary: string | null;
  unverifiedRisks: AiUnverifiedRisk[];
  createdAt: string;
  confirmedAt: string | null;
}

export interface EvidencePackageDto {
  workItemId: string;
  evidenceBindings: EvidencePackageBindingDto[];
  aiContributions: AiContributionDto[];
}

export interface EvidenceAiTransaction {
  lockWorkItemAccess(
    actorExternalId: string,
    workItemExternalId: string,
  ): Promise<{
    access: TeamTaskProjectAccessSnapshot;
    workItem: EvidenceWorkItemRow;
    actorAcceptedAssignmentRole: 'responsible' | 'collaborator' | null;
  } | null>;
  lockOrganizationIdempotencyScope(organizationId: number): Promise<boolean>;
  hasPlanningEventByIdempotencyKey(
    organizationId: number,
    idempotencyKey: string,
  ): Promise<boolean>;
  findEventByIdempotencyKey(
    organizationId: number,
    idempotencyKey: string,
  ): Promise<TeamTaskEventRow | null>;
  lockEvidenceSource(
    kind: EvidenceSourceRow['kind'],
    sourceExternalId: string,
  ): Promise<EvidenceSourceRow | null>;
  hasSourceOwnerSharedWithWorkItem(input: {
    organizationId: number;
    projectId: number;
    workItemId: number;
    ownerUserId: number;
    sourceKind: EvidenceSourceRow['kind'];
    sourceId: number;
  }): Promise<boolean>;
  lockTarget(
    kind: TeamTaskEvidenceTargetKind,
    workItemId: number,
    externalId: string,
  ): Promise<TeamTaskEvidenceTargetRow | null>;
  findEquivalentBinding(
    input: Omit<EvidenceBindingRow, 'id' | 'externalId' | 'createdAt'>,
  ): Promise<EvidenceBindingRow | null>;
  insertEvidenceBinding(row: Omit<EvidenceBindingRow, 'id'>): Promise<number>;
  lockExecutionTask(externalId: string): Promise<AiExecutionTaskRow | null>;
  deriveAiExecutionSnapshot(
    taskId: number,
    taskOwnerUserId: number,
    at: Date,
  ): Promise<AiExecutionSnapshotRow>;
  findContributionByExecutionTask(executionTaskId: number): Promise<TeamAiContributionRow | null>;
  lockAiContribution(externalId: string): Promise<TeamAiContributionRow | null>;
  insertAiContribution(row: Omit<TeamAiContributionRow, 'id'>): Promise<number>;
  updateAiContribution(
    id: number,
    expectedStatus: 'pending',
    update: Pick<
      TeamAiContributionRow,
      'humanConfirmationStatus' | 'humanChangesSummary' | 'confirmedAt'
    >,
  ): Promise<boolean>;
  listEvidencePackage(workItemId: number): Promise<{
    bindings: EvidencePackageBindingDto[];
    contributions: AiContributionDto[];
  }>;
  loadPreflightSnapshot(workItemId: number): Promise<EvidencePreflightSnapshot>;
  appendEvent(event: TeamTaskEventRow): Promise<void>;
}

export interface TeamTaskEvidenceRepository {
  transaction<T>(work: (tx: EvidenceAiTransaction) => Promise<T>): Promise<T>;
}

export type TeamTaskEvidenceReceipt =
  | {
      command: 'bind_evidence';
      eventId: string;
      evidenceBindingId: string;
      workItemId: string;
      sourceKind: EvidenceBindingRow['sourceKind'];
      targetKind: 'workItem' | TeamTaskEvidenceTargetKind;
      targetId?: string;
      state: TeamTaskState;
      version: number;
    }
  | {
      command: 'record_ai_contribution';
      eventId: string;
      aiContributionId: string;
      workItemId: string;
      executionTaskId: string;
      humanConfirmationStatus: 'pending';
      state: TeamTaskState;
      version: number;
    }
  | {
      command: 'confirm_ai_contribution';
      eventId: string;
      aiContributionId: string;
      workItemId: string;
      humanConfirmationStatus: Exclude<AiHumanConfirmationStatus, 'pending'>;
      state: TeamTaskState;
      version: number;
    };

export interface TeamTaskEvidenceServiceDependencies {
  now: () => string;
  isLifecycleEnabled: (actorExternalId: string, organizationEnabled: boolean) => boolean;
  newId: (kind: 'teamEvidenceBinding' | 'teamAiContribution' | 'teamWorkItemEvent') => string;
}

const defaultDependencies: TeamTaskEvidenceServiceDependencies = {
  now: () => new Date().toISOString(),
  isLifecycleEnabled: isTeamTaskLifecycleEnabledFor,
  newId: (kind) => newExternalId(kind),
};

const eventTypeByCommand: Record<TeamTaskEvidenceReceipt['command'], string> = {
  bind_evidence: 'team_evidence_bound',
  record_ai_contribution: 'team_ai_contribution_recorded',
  confirm_ai_contribution: 'team_ai_contribution_confirmed',
};

function fail(code: TeamTaskEvidenceServiceErrorCode): never {
  throw new TeamTaskEvidenceServiceError(code);
}

function isDatabaseConflict(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.code === 'ER_DUP_ENTRY' ||
      error.errno === 1062 ||
      error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      error.code === 'ER_LOCK_DEADLOCK' ||
      error.code === 'ER_LOCK_WAIT_TIMEOUT' ||
      error.code === 'ER_CHECK_CONSTRAINT_VIOLATED' ||
      error.errno === 3819)
  );
}

function isDatabaseNotFound(error: unknown): boolean {
  return isRecord(error) && (error.code === 'ER_NO_REFERENCED_ROW_2' || error.errno === 1452);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function exactOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function text(
  value: unknown,
  maxLength: number,
  kind?: Parameters<typeof isExternalId>[1],
): string {
  if (typeof value !== 'string') return fail('INVALID_INPUT');
  const normalized = value.trim();
  const hasUnsafeControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
  if (normalized.length === 0 || normalized.length > maxLength || hasUnsafeControlCharacter) {
    return fail('INVALID_INPUT');
  }
  if (kind && !isExternalId(normalized, kind)) return fail('INVALID_INPUT');
  return normalized;
}

function idempotencyKey(value: unknown): string {
  const key = text(value, 64);
  if (/[^\u0021-\u007e]/u.test(key)) return fail('INVALID_INPUT');
  return key;
}

function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) return fail('INVALID_INPUT');
  return value as number;
}

function stableJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail('INVALID_INPUT');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || seen.has(value)) return fail('INVALID_INPUT');
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!hasOwn(value, index)) return fail('INVALID_INPUT');
    }
    const result = `[${value.map((item) => stableJson(item, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail('INVALID_INPUT');
  const record = value as Record<string, unknown>;
  const result = `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key], seen)}`)
    .join(',')}}`;
  seen.delete(value);
  return result;
}

function requestHash(command: string, value: unknown): string {
  return createHash('sha256')
    .update(`${command}:${stableJson(value)}`)
    .digest('hex');
}

function deriveAiFacts(task: AiExecutionTaskRow, snapshot: AiExecutionSnapshotRow) {
  const sourceKinds: AiInputSourceSummary['sourceKinds'] = [];
  if (snapshot.taskFileCount > 0) sourceKinds.push('task_file');
  if (snapshot.evidenceArtifactCount > 0) sourceKinds.push('evidence_artifact');
  const inputSourceSummary: AiInputSourceSummary = {
    sourceKinds,
    sourceCount: snapshot.taskFileCount + snapshot.evidenceArtifactCount,
  };
  if (task.completedAt === null) return fail('NOT_FOUND');
  const resultVersion = `rv_${createHash('sha256')
    .update(
      stableJson({
        taskExternalId: task.externalId,
        status: task.status,
        completedAt: task.completedAt.toISOString(),
        result: task.result,
      }),
    )
    .digest('hex')
    .slice(0, 32)}`;
  const usageSnapshot: AiUsageSnapshot = {
    taskUnits: 1,
    opusUnits: task.opusUsed ? 1 : 0,
    llmCallCount: snapshot.llmCallCount,
    inputTokens: snapshot.inputTokens,
    outputTokens: snapshot.outputTokens,
    cacheReadTokens: snapshot.cacheReadTokens,
    cacheWriteTokens: snapshot.cacheWriteTokens,
    latencyMs: snapshot.latencyMs,
  };
  const unverifiedRisks: AiUnverifiedRisk[] =
    inputSourceSummary.sourceCount === 0
      ? [{ code: 'missing_evidence', severity: 'high' }]
      : [{ code: 'needs_fact_check', severity: 'medium' }];
  return { inputSourceSummary, resultVersion, usageSnapshot, unverifiedRisks };
}

function preflightDto(
  workItem: EvidenceWorkItemRow,
  snapshot: EvidencePreflightSnapshot,
): EvidencePreflightDto {
  const missingContractFields: string[] = [];
  const issueCodes: string[] = [];
  const persistedContract = snapshot.contract;
  const contract =
    workItem.currentContractVersionId !== null &&
    persistedContract !== null &&
    persistedContract.id === workItem.currentContractVersionId &&
    persistedContract.organizationId === workItem.organizationId &&
    persistedContract.projectId === workItem.projectId &&
    persistedContract.workItemId === workItem.id &&
    persistedContract.confirmedByUserId !== null &&
    persistedContract.confirmedAt !== null
      ? persistedContract
      : null;
  const hasObjective = typeof contract?.objective === 'string' && contract.objective.trim() !== '';
  const hasDeliverables =
    Array.isArray(contract?.deliverables) &&
    contract.deliverables.length > 0 &&
    contract.deliverables.every((value) => typeof value === 'string' && value.trim() !== '');
  const hasCriteria =
    Array.isArray(contract?.criteria) &&
    contract.criteria.length > 0 &&
    contract.criteria.every(
      (value) =>
        isRecord(value) &&
        typeof value.id === 'string' &&
        value.id.trim() !== '' &&
        typeof value.description === 'string' &&
        value.description.trim() !== '',
    );
  const requiredEvidenceTypes =
    Array.isArray(contract?.requiredEvidenceTypes) &&
    contract.requiredEvidenceTypes.length > 0 &&
    contract.requiredEvidenceTypes.every(
      (value) => isRecord(value) && normalizedEvidenceType(value.type) !== null,
    )
      ? contract.requiredEvidenceTypes.map((value) =>
          normalizedEvidenceType((value as { type: unknown }).type),
        )
      : null;
  if (!contract) {
    issueCodes.push('CONFIRMED_CONTRACT_MISSING');
  }
  if (!hasObjective) missingContractFields.push('objective');
  if (!hasDeliverables) missingContractFields.push('deliverables');
  if (!hasCriteria) missingContractFields.push('criteria');
  if (!requiredEvidenceTypes) missingContractFields.push('requiredEvidenceTypes');
  if (missingContractFields.length > 0) issueCodes.push('CONTRACT_SCHEMA_INVALID');
  const validEvidenceBindings = snapshot.evidenceBindings.filter((binding) => binding.sourceValid);
  const normalizedPresentTypes = validEvidenceBindings
    .map((binding) => binding.evidenceType)
    .map(normalizedEvidenceType)
    .filter((value): value is string => value !== null);
  const presentTypes = new Set(normalizedPresentTypes);
  if (normalizedPresentTypes.length !== validEvidenceBindings.length)
    issueCodes.push('EVIDENCE_METADATA_INVALID');
  const missingEvidenceTypes = (requiredEvidenceTypes ?? [])
    .filter((type): type is string => type !== null)
    .filter((type) => !presentTypes.has(type))
    .sort((left, right) => left.localeCompare(right, 'en-US'));
  if (missingEvidenceTypes.length > 0) issueCodes.push('REQUIRED_EVIDENCE_MISSING');
  missingContractFields.sort((left, right) => left.localeCompare(right, 'en-US'));
  issueCodes.sort((left, right) => left.localeCompare(right, 'en-US'));
  const valid = issueCodes.length === 0;
  const recommendationSummary = valid
    ? { code: 'READY_FOR_HUMAN_REVIEW', text: '合同字段与必需证据类型已齐备，请进行人工复核。' }
    : missingContractFields.length > 0
      ? { code: 'COMPLETE_CONTRACT', text: '先补齐并确认验收合同，再检查证据。' }
      : { code: 'ADD_REQUIRED_EVIDENCE', text: '补齐合同要求的证据类型后再提交人工复核。' };
  return {
    workItemId: workItem.externalId,
    missingContractFields,
    missingEvidenceTypes,
    schemaValidation: { valid, issueCodes },
    recommendationSummary,
  };
}

function assertAccess(
  loaded: Awaited<ReturnType<EvidenceAiTransaction['lockWorkItemAccess']>>,
  actorExternalId: string,
  workItemExternalId: string,
  dependencies: TeamTaskEvidenceServiceDependencies,
) {
  const access = loaded?.access;
  const workItem = loaded?.workItem;
  if (
    !access ||
    !workItem ||
    access.actorExternalId !== actorExternalId ||
    workItem.externalId !== workItemExternalId ||
    !access.organizationActive ||
    !access.organizationTeamProjectsEnabled ||
    access.projectOrganizationId !== access.organizationId ||
    !access.actorOrganizationMembershipActive ||
    !access.actorProjectMembershipActive ||
    workItem.organizationId !== access.organizationId ||
    workItem.projectId !== access.projectId ||
    !dependencies.isLifecycleEnabled(actorExternalId, access.organizationTeamProjectsEnabled)
  ) {
    return fail('NOT_FOUND');
  }
  return { access, workItem, actorAcceptedAssignmentRole: loaded.actorAcceptedAssignmentRole };
}

function permit(
  action:
    | 'bind_evidence'
    | 'record_ai_contribution'
    | 'confirm_ai_contribution'
    | 'read_evidence_package',
  access: TeamTaskProjectAccessSnapshot,
  actorAcceptedAssignmentRole: 'responsible' | 'collaborator' | null,
): void {
  const decision = decideTeamTaskPermission(action, {
    actorOrganizationRole: access.actorOrganizationRole,
    actorOrganizationMembershipActive: access.actorOrganizationMembershipActive,
    actorProjectRole: access.actorProjectRole,
    actorProjectMembershipActive: access.actorProjectMembershipActive,
    actorIsCreator: false,
    actorIsResponsible: actorAcceptedAssignmentRole === 'responsible',
    actorIsCollaborator: actorAcceptedAssignmentRole === 'collaborator',
    actorIsLatestReviewer: false,
    actorIsDesignatedApprover: false,
    actorIsDesignatedIndependentArbitrator: false,
  });
  if (!decision.allowed) fail('FORBIDDEN');
}

function evidenceSource(
  value: unknown,
):
  | { kind: 'evidenceArtifact'; sourceExternalId: string }
  | { kind: 'taskFile'; sourceExternalId: string }
  | { kind: 'controlledExternalRef'; controlledExternalRef: string } {
  if (!isRecord(value) || typeof value.kind !== 'string') return fail('INVALID_INPUT');
  if (value.kind === 'evidenceArtifact') {
    if (!exactKeys(value, ['kind', 'evidenceArtifactId'])) return fail('INVALID_INPUT');
    return {
      kind: 'evidenceArtifact',
      sourceExternalId: text(value.evidenceArtifactId, 32, 'evidenceArtifact'),
    };
  }
  if (value.kind === 'taskFile') {
    if (!exactKeys(value, ['kind', 'taskFileId'])) return fail('INVALID_INPUT');
    return { kind: 'taskFile', sourceExternalId: text(value.taskFileId, 32, 'file') };
  }
  if (value.kind === 'controlledExternalRef') {
    if (!exactKeys(value, ['kind', 'url'])) return fail('INVALID_INPUT');
    return { kind: 'controlledExternalRef', controlledExternalRef: controlledHttpsUrl(value.url) };
  }
  return fail('INVALID_INPUT');
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function controlledHttpsUrl(value: unknown): string {
  const raw = text(value, 512);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail('INVALID_INPUT');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== '' ||
    parsed.search !== '' ||
    (parsed.port !== '' && parsed.port !== '443') ||
    parsed.hostname === ''
  ) {
    return fail('INVALID_INPUT');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  const ipKind = isIP(hostname);
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    !hostname.includes('.') ||
    (ipKind === 4 && isPrivateIpv4(hostname)) ||
    ipKind === 6
  ) {
    return fail('INVALID_INPUT');
  }
  const canonical = parsed.toString();
  if (canonical.length > 512) return fail('INVALID_INPUT');
  return canonical;
}

function evidenceTarget(
  value: unknown,
): { kind: TeamTaskEvidenceTargetKind; externalId: string } | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !exactKeys(value, ['kind', 'id']) || typeof value.kind !== 'string') {
    return fail('INVALID_INPUT');
  }
  const kinds: Record<TeamTaskEvidenceTargetKind, Parameters<typeof isExternalId>[1]> = {
    submission: 'teamSubmission',
    review: 'teamReview',
    appeal: 'teamAppeal',
    aiContribution: 'teamAiContribution',
  };
  if (!hasOwn(kinds, value.kind)) return fail('INVALID_INPUT');
  const kind = value.kind as TeamTaskEvidenceTargetKind;
  return { kind, externalId: text(value.id, 32, kinds[kind]) };
}

function normalizedEvidenceType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 100) return null;
  if (
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    return null;
  }
  return normalized;
}

function metadata(value: unknown): EvidenceMetadata | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return fail('INVALID_INPUT');
  const keys = Object.keys(value);
  if (keys.some((key) => !['evidenceType', 'confidence', 'relation'].includes(key))) {
    return fail('INVALID_INPUT');
  }
  const result: EvidenceMetadata = {};
  if (value.evidenceType !== undefined) {
    const evidenceType = normalizedEvidenceType(value.evidenceType);
    if (evidenceType === null) return fail('INVALID_INPUT');
    result.evidenceType = evidenceType;
  }
  if (value.confidence !== undefined) {
    if (!['observed', 'verified', 'user_supplied'].includes(String(value.confidence))) {
      return fail('INVALID_INPUT');
    }
    result.confidence = value.confidence as EvidenceMetadata['confidence'];
  }
  if (value.relation !== undefined) {
    if (!['supports', 'contradicts', 'context'].includes(String(value.relation))) {
      return fail('INVALID_INPUT');
    }
    result.relation = value.relation as EvidenceMetadata['relation'];
  }
  return result;
}

function aiInputSourceSummary(value: unknown): AiInputSourceSummary {
  if (!isRecord(value) || !exactKeys(value, ['sourceKinds', 'sourceCount'])) {
    return fail('INVALID_INPUT');
  }
  const allowed = new Set(['task_file', 'evidence_artifact']);
  if (
    !Array.isArray(value.sourceKinds) ||
    value.sourceKinds.length > 2 ||
    value.sourceKinds.some((kind) => typeof kind !== 'string' || !allowed.has(kind)) ||
    new Set(value.sourceKinds).size !== value.sourceKinds.length ||
    !Number.isSafeInteger(value.sourceCount) ||
    (value.sourceCount as number) < 0 ||
    (value.sourceCount as number) > 1_000
  ) {
    return fail('INVALID_INPUT');
  }
  return {
    sourceKinds: [...value.sourceKinds] as AiInputSourceSummary['sourceKinds'],
    sourceCount: value.sourceCount as number,
  };
}

function aiUsageSnapshot(value: unknown): AiUsageSnapshot {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'taskUnits',
      'opusUnits',
      'llmCallCount',
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'latencyMs',
    ])
  ) {
    return fail('INVALID_INPUT');
  }
  for (const key of [
    'llmCallCount',
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'latencyMs',
  ] as const) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0)
      return fail('INVALID_INPUT');
  }
  if (value.taskUnits !== 1 || (value.opusUnits !== 0 && value.opusUnits !== 1)) {
    return fail('INVALID_INPUT');
  }
  return {
    taskUnits: 1,
    opusUnits: value.opusUnits,
    llmCallCount: value.llmCallCount as number,
    inputTokens: value.inputTokens as number,
    outputTokens: value.outputTokens as number,
    cacheReadTokens: value.cacheReadTokens as number,
    cacheWriteTokens: value.cacheWriteTokens as number,
    latencyMs: value.latencyMs as number,
  };
}

function aiRisks(value: unknown): AiUnverifiedRisk[] {
  if (!Array.isArray(value) || value.length > 20) return fail('INVALID_INPUT');
  const codes = new Set(['needs_fact_check', 'missing_evidence', 'stale_source', 'scope_gap']);
  const severities = new Set(['low', 'medium', 'high']);
  return value.map((risk) => {
    if (
      !isRecord(risk) ||
      !exactKeys(risk, ['code', 'severity']) ||
      typeof risk.code !== 'string' ||
      !codes.has(risk.code) ||
      typeof risk.severity !== 'string' ||
      !severities.has(risk.severity)
    ) {
      return fail('INVALID_INPUT');
    }
    return risk as unknown as AiUnverifiedRisk;
  });
}

function isReceipt(value: unknown): value is TeamTaskEvidenceReceipt {
  if (
    !isRecord(value) ||
    typeof value.command !== 'string' ||
    !hasOwn(eventTypeByCommand, value.command) ||
    typeof value.eventId !== 'string' ||
    !isExternalId(value.eventId, 'teamWorkItemEvent') ||
    typeof value.workItemId !== 'string' ||
    !isExternalId(value.workItemId, 'teamWorkItem') ||
    !isTeamTaskState(value.state) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1
  ) {
    return false;
  }
  if (value.command === 'bind_evidence') {
    if (
      typeof value.evidenceBindingId !== 'string' ||
      !isExternalId(value.evidenceBindingId, 'teamEvidenceBinding') ||
      !['evidenceArtifact', 'taskFile', 'controlledExternalRef'].includes(
        String(value.sourceKind),
      ) ||
      !['workItem', 'submission', 'review', 'appeal', 'aiContribution'].includes(
        String(value.targetKind),
      )
    ) {
      return false;
    }
    if (value.targetKind === 'workItem') {
      return (
        value.targetId === undefined &&
        exactKeys(value, [
          'command',
          'eventId',
          'evidenceBindingId',
          'workItemId',
          'sourceKind',
          'targetKind',
          'state',
          'version',
        ])
      );
    }
    const targetKinds = {
      submission: 'teamSubmission',
      review: 'teamReview',
      appeal: 'teamAppeal',
      aiContribution: 'teamAiContribution',
    } as const;
    const targetKind = value.targetKind as keyof typeof targetKinds;
    return (
      exactKeys(value, [
        'command',
        'eventId',
        'evidenceBindingId',
        'workItemId',
        'sourceKind',
        'targetKind',
        'targetId',
        'state',
        'version',
      ]) &&
      typeof value.targetId === 'string' &&
      isExternalId(value.targetId, targetKinds[targetKind])
    );
  }
  if (value.command === 'record_ai_contribution') {
    return (
      exactKeys(value, [
        'command',
        'eventId',
        'aiContributionId',
        'workItemId',
        'executionTaskId',
        'humanConfirmationStatus',
        'state',
        'version',
      ]) &&
      typeof value.aiContributionId === 'string' &&
      isExternalId(value.aiContributionId, 'teamAiContribution') &&
      typeof value.executionTaskId === 'string' &&
      isExternalId(value.executionTaskId, 'task') &&
      value.humanConfirmationStatus === 'pending'
    );
  }
  return (
    exactKeys(value, [
      'command',
      'eventId',
      'aiContributionId',
      'workItemId',
      'humanConfirmationStatus',
      'state',
      'version',
    ]) &&
    typeof value.aiContributionId === 'string' &&
    isExternalId(value.aiContributionId, 'teamAiContribution') &&
    ['confirmed', 'modified', 'rejected'].includes(String(value.humanConfirmationStatus))
  );
}

function replay(
  event: TeamTaskEventRow | null,
  expectedHash: string,
  context: {
    organizationId: number;
    projectId: number;
    workItemId: number;
    actorUserId: number;
  },
): TeamTaskEvidenceReceipt | null {
  if (!event) return null;
  const eventMetadata = isRecord(event.metadata) ? event.metadata : null;
  const receipt = eventMetadata?.receipt;
  if (
    !eventMetadata ||
    typeof eventMetadata.requestHash !== 'string' ||
    eventMetadata.requestHash !== expectedHash ||
    !isReceipt(receipt) ||
    event.eventType !== eventTypeByCommand[receipt.command] ||
    event.externalId !== receipt.eventId ||
    event.toState !== receipt.state ||
    event.organizationId !== context.organizationId ||
    event.projectId !== context.projectId ||
    event.workItemId !== context.workItemId ||
    event.actorUserId !== context.actorUserId
  ) {
    return fail('CONFLICT');
  }
  return structuredClone(receipt);
}

function event(
  dependencies: TeamTaskEvidenceServiceDependencies,
  access: TeamTaskProjectAccessSnapshot,
  workItem: EvidenceWorkItemRow,
  idempotency: string,
  hash: string,
  receipt: TeamTaskEvidenceReceipt,
): TeamTaskEventRow {
  return {
    externalId: receipt.eventId,
    organizationId: access.organizationId,
    projectId: access.projectId,
    workItemId: workItem.id,
    actorUserId: access.actorUserId,
    eventType: eventTypeByCommand[receipt.command],
    fromState: workItem.status,
    toState: workItem.status,
    contractVersionId: null,
    idempotencyKey: idempotency,
    metadata: { requestHash: hash, receipt: structuredClone(receipt) },
    occurredAt: new Date(dependencies.now()),
  };
}

function safeIsoDate(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length > 32) return fail('CONFLICT');
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    return fail('CONFLICT');
  }
  return value;
}

function sanitizeEvidencePackage(result: {
  bindings: EvidencePackageBindingDto[];
  contributions: AiContributionDto[];
}): { bindings: EvidencePackageBindingDto[]; contributions: AiContributionDto[] } {
  const bindings = result.bindings.map((binding): EvidencePackageBindingDto => {
    if (!isRecord(binding) || !isExternalId(binding.id, 'teamEvidenceBinding')) {
      return fail('CONFLICT');
    }
    if (!isRecord(binding.source) || typeof binding.source.kind !== 'string') {
      return fail('CONFLICT');
    }
    const sourceKind = binding.source.kind;
    let source: EvidencePackageBindingDto['source'];
    if (sourceKind === 'evidenceArtifact') {
      if (
        !exactKeys(binding.source, ['kind', 'sourceId']) ||
        typeof binding.source.sourceId !== 'string' ||
        !isExternalId(binding.source.sourceId, 'evidenceArtifact')
      ) {
        return fail('CONFLICT');
      }
      source = { kind: sourceKind, sourceId: binding.source.sourceId };
    } else if (sourceKind === 'taskFile') {
      if (
        !exactKeys(binding.source, ['kind', 'sourceId']) ||
        typeof binding.source.sourceId !== 'string' ||
        !isExternalId(binding.source.sourceId, 'file')
      ) {
        return fail('CONFLICT');
      }
      source = { kind: sourceKind, sourceId: binding.source.sourceId };
    } else if (sourceKind === 'controlledExternalRef') {
      if (!exactKeys(binding.source, ['kind'])) return fail('CONFLICT');
      source = { kind: sourceKind };
    } else {
      return fail('CONFLICT');
    }
    if (!isRecord(binding.target) || typeof binding.target.kind !== 'string') {
      return fail('CONFLICT');
    }
    let target: EvidencePackageBindingDto['target'];
    if (binding.target.kind === 'workItem') {
      if (!exactKeys(binding.target, ['kind'])) return fail('CONFLICT');
      target = { kind: 'workItem' };
    } else {
      const targetKinds = {
        submission: 'teamSubmission',
        review: 'teamReview',
        appeal: 'teamAppeal',
        aiContribution: 'teamAiContribution',
      } as const;
      if (
        !hasOwn(targetKinds, binding.target.kind) ||
        !exactKeys(binding.target, ['kind', 'targetId']) ||
        typeof binding.target.targetId !== 'string'
      ) {
        return fail('CONFLICT');
      }
      const targetKind = binding.target.kind as keyof typeof targetKinds;
      if (!isExternalId(binding.target.targetId, targetKinds[targetKind])) {
        return fail('CONFLICT');
      }
      target = { kind: targetKind, targetId: binding.target.targetId };
    }
    return {
      id: binding.id,
      source,
      target,
      metadata: metadata(binding.metadata),
      createdAt: safeIsoDate(binding.createdAt) as string,
    };
  });
  bindings.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt, 'en-US') || left.id.localeCompare(right.id),
  );

  const contributions = result.contributions.map((contribution): AiContributionDto => {
    if (
      !isRecord(contribution) ||
      !isExternalId(contribution.id, 'teamAiContribution') ||
      !isExternalId(contribution.executionTaskId, 'task') ||
      !['pending', 'confirmed', 'modified', 'rejected'].includes(
        contribution.humanConfirmationStatus,
      )
    ) {
      return fail('CONFLICT');
    }
    const requestedScope = text(contribution.requestedScope, 2_000);
    const resultVersion = text(contribution.resultVersion, 64);
    const humanChangesSummary =
      contribution.humanChangesSummary === null
        ? null
        : text(contribution.humanChangesSummary, 1_000);
    return {
      id: contribution.id,
      executionTaskId: contribution.executionTaskId,
      requestedScope,
      inputSourceSummary: aiInputSourceSummary(contribution.inputSourceSummary),
      resultVersion,
      usageSnapshot: aiUsageSnapshot(contribution.usageSnapshot),
      humanConfirmationStatus: contribution.humanConfirmationStatus,
      humanChangesSummary,
      unverifiedRisks: aiRisks(contribution.unverifiedRisks),
      createdAt: safeIsoDate(contribution.createdAt) as string,
      confirmedAt: safeIsoDate(contribution.confirmedAt, true),
    };
  });
  contributions.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt, 'en-US') || left.id.localeCompare(right.id),
  );
  return { bindings, contributions };
}

export class TeamTaskEvidenceService {
  constructor(
    private readonly repository: TeamTaskEvidenceRepository,
    private readonly dependencies: TeamTaskEvidenceServiceDependencies = defaultDependencies,
  ) {}

  private async runTransaction<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof TeamTaskEvidenceServiceError) throw error;
      if (isDatabaseNotFound(error)) return fail('NOT_FOUND');
      if (isDatabaseConflict(error)) return fail('CONFLICT');
      throw error;
    }
  }

  async bindEvidence(input: unknown): Promise<TeamTaskEvidenceReceipt> {
    if (
      !isRecord(input) ||
      !exactOptionalKeys(
        input,
        ['actorExternalId', 'workItemExternalId', 'expectedVersion', 'idempotencyKey', 'source'],
        ['target', 'metadata'],
      )
    ) {
      return fail('INVALID_INPUT');
    }
    const actorExternalId = text(input.actorExternalId, 32, 'user');
    const workItemExternalId = text(input.workItemExternalId, 32, 'teamWorkItem');
    const idempotency = idempotencyKey(input.idempotencyKey);
    const requiredVersion = expectedVersion(input.expectedVersion);
    const source = evidenceSource(input.source);
    const target = evidenceTarget(input.target);
    const safeMetadata = metadata(input.metadata);
    const hash = requestHash('bind_evidence', {
      actorExternalId,
      workItemExternalId,
      source,
      target,
      metadata: safeMetadata,
      expectedVersion: requiredVersion,
    });
    return this.runTransaction(() =>
      this.repository.transaction(async (tx) => {
        const loaded = assertAccess(
          await tx.lockWorkItemAccess(actorExternalId, workItemExternalId),
          actorExternalId,
          workItemExternalId,
          this.dependencies,
        );
        const { access, workItem } = loaded;
        permit('bind_evidence', access, loaded.actorAcceptedAssignmentRole);
        if (!(await tx.lockOrganizationIdempotencyScope(access.organizationId))) fail('CONFLICT');
        if (await tx.hasPlanningEventByIdempotencyKey(access.organizationId, idempotency)) {
          fail('CONFLICT');
        }
        const previous = replay(
          await tx.findEventByIdempotencyKey(access.organizationId, idempotency),
          hash,
          {
            organizationId: access.organizationId,
            projectId: access.projectId,
            workItemId: workItem.id,
            actorUserId: access.actorUserId,
          },
        );
        if (previous) return previous;
        if (workItem.version !== requiredVersion) fail('CONFLICT');

        let evidenceArtifactId: number | null = null;
        let taskFileId: number | null = null;
        let controlledExternalRef: string | null = null;
        if (source.kind === 'controlledExternalRef') {
          controlledExternalRef = source.controlledExternalRef;
        } else {
          const row = await tx.lockEvidenceSource(source.kind, source.sourceExternalId);
          if (
            !row ||
            row.ownerUserId === null ||
            row.taskId === null ||
            row.taskProjectId !== access.projectId ||
            row.taskUserId !== row.ownerUserId ||
            !row.ownerOrganizationMembershipActive ||
            !row.ownerProjectMembershipActive ||
            row.ownerProjectRole === 'viewer' ||
            (row.expiresAt !== null &&
              row.expiresAt.getTime() <= new Date(this.dependencies.now()).getTime()) ||
            (row.kind === 'taskFile' && row.status !== 'active')
          ) {
            fail('NOT_FOUND');
          }
          if (
            row.ownerUserId !== access.actorUserId &&
            !(await tx.hasSourceOwnerSharedWithWorkItem({
              organizationId: access.organizationId,
              projectId: access.projectId,
              workItemId: workItem.id,
              ownerUserId: row.ownerUserId,
              sourceKind: row.kind,
              sourceId: row.id,
            }))
          ) {
            fail('NOT_FOUND');
          }
          if (row.kind === 'evidenceArtifact') evidenceArtifactId = row.id;
          else taskFileId = row.id;
        }

        let targetRow: TeamTaskEvidenceTargetRow | null = null;
        if (target) {
          targetRow = await tx.lockTarget(target.kind, workItem.id, target.externalId);
          if (
            !targetRow ||
            targetRow.kind !== target.kind ||
            targetRow.externalId !== target.externalId ||
            targetRow.organizationId !== access.organizationId ||
            targetRow.projectId !== access.projectId ||
            targetRow.workItemId !== workItem.id
          ) {
            fail('NOT_FOUND');
          }
        }

        const newRow: Omit<EvidenceBindingRow, 'id'> = {
          externalId: this.dependencies.newId('teamEvidenceBinding'),
          organizationId: access.organizationId,
          projectId: access.projectId,
          workItemId: workItem.id,
          submissionId: targetRow?.kind === 'submission' ? targetRow.id : null,
          reviewId: targetRow?.kind === 'review' ? targetRow.id : null,
          appealId: targetRow?.kind === 'appeal' ? targetRow.id : null,
          aiContributionId: targetRow?.kind === 'aiContribution' ? targetRow.id : null,
          evidenceArtifactId,
          taskFileId,
          sourceKind: source.kind,
          controlledExternalRef,
          metadata: safeMetadata,
          boundByUserId: access.actorUserId,
          createdAt: new Date(this.dependencies.now()),
        };
        if (
          await tx.findEquivalentBinding({
            ...newRow,
            boundByUserId: newRow.boundByUserId,
          })
        ) {
          fail('CONFLICT');
        }
        await tx.insertEvidenceBinding(newRow);
        const receipt: TeamTaskEvidenceReceipt = {
          command: 'bind_evidence',
          eventId: this.dependencies.newId('teamWorkItemEvent'),
          evidenceBindingId: newRow.externalId,
          workItemId: workItem.externalId,
          sourceKind: source.kind,
          targetKind: target?.kind ?? 'workItem',
          ...(target ? { targetId: target.externalId } : {}),
          state: workItem.status,
          version: workItem.version,
        };
        await tx.appendEvent(
          event(this.dependencies, access, workItem, idempotency, hash, receipt),
        );
        return receipt;
      }),
    );
  }

  async recordAiContribution(input: unknown): Promise<TeamTaskEvidenceReceipt> {
    if (
      !isRecord(input) ||
      !exactOptionalKeys(
        input,
        [
          'actorExternalId',
          'workItemExternalId',
          'executionTaskId',
          'requestedScope',
          'expectedVersion',
          'idempotencyKey',
        ],
        [],
      )
    ) {
      return fail('INVALID_INPUT');
    }
    const actorExternalId = text(input.actorExternalId, 32, 'user');
    const workItemExternalId = text(input.workItemExternalId, 32, 'teamWorkItem');
    const executionTaskExternalId = text(input.executionTaskId, 32, 'task');
    const requestedScope = text(input.requestedScope, 2_000);
    const idempotency = idempotencyKey(input.idempotencyKey);
    const requiredVersion = expectedVersion(input.expectedVersion);
    const hash = requestHash('record_ai_contribution', {
      actorExternalId,
      workItemExternalId,
      executionTaskExternalId,
      requestedScope,
      expectedVersion: requiredVersion,
    });
    return this.runTransaction(() =>
      this.repository.transaction(async (tx) => {
        const loaded = assertAccess(
          await tx.lockWorkItemAccess(actorExternalId, workItemExternalId),
          actorExternalId,
          workItemExternalId,
          this.dependencies,
        );
        const { access, workItem } = loaded;
        permit('record_ai_contribution', access, loaded.actorAcceptedAssignmentRole);
        if (!(await tx.lockOrganizationIdempotencyScope(access.organizationId))) fail('CONFLICT');
        if (await tx.hasPlanningEventByIdempotencyKey(access.organizationId, idempotency)) {
          fail('CONFLICT');
        }
        const previous = replay(
          await tx.findEventByIdempotencyKey(access.organizationId, idempotency),
          hash,
          {
            organizationId: access.organizationId,
            projectId: access.projectId,
            workItemId: workItem.id,
            actorUserId: access.actorUserId,
          },
        );
        if (previous) return previous;
        if (workItem.version !== requiredVersion) fail('CONFLICT');
        const executionTask = await tx.lockExecutionTask(executionTaskExternalId);
        if (
          !executionTask ||
          executionTask.externalId !== executionTaskExternalId ||
          executionTask.projectId !== access.projectId ||
          executionTask.userId !== access.actorUserId ||
          executionTask.origin !== 'user' ||
          !['completed', 'partial_success'].includes(executionTask.status) ||
          !executionTask.ownerOrganizationMembershipActive ||
          !executionTask.ownerProjectMembershipActive ||
          executionTask.ownerProjectRole === 'viewer'
        ) {
          fail('NOT_FOUND');
        }
        const derived = deriveAiFacts(
          executionTask,
          await tx.deriveAiExecutionSnapshot(
            executionTask.id,
            executionTask.userId,
            new Date(this.dependencies.now()),
          ),
        );
        if (await tx.findContributionByExecutionTask(executionTask.id)) fail('CONFLICT');
        const newRow: Omit<TeamAiContributionRow, 'id'> = {
          externalId: this.dependencies.newId('teamAiContribution'),
          organizationId: access.organizationId,
          projectId: access.projectId,
          workItemId: workItem.id,
          contributedByUserId: access.actorUserId,
          executionTaskId: executionTask.id,
          executionTaskExternalId,
          requestedScope,
          inputSourceSummary: derived.inputSourceSummary,
          resultVersion: derived.resultVersion,
          usageSnapshot: derived.usageSnapshot,
          humanConfirmationStatus: 'pending',
          humanChangesSummary: null,
          unverifiedRisks: derived.unverifiedRisks,
          createdAt: new Date(this.dependencies.now()),
          confirmedAt: null,
        };
        await tx.insertAiContribution(newRow);
        const receipt: TeamTaskEvidenceReceipt = {
          command: 'record_ai_contribution',
          eventId: this.dependencies.newId('teamWorkItemEvent'),
          aiContributionId: newRow.externalId,
          workItemId: workItem.externalId,
          executionTaskId: executionTaskExternalId,
          humanConfirmationStatus: 'pending',
          state: workItem.status,
          version: workItem.version,
        };
        await tx.appendEvent(
          event(this.dependencies, access, workItem, idempotency, hash, receipt),
        );
        return receipt;
      }),
    );
  }

  async confirmAiContribution(input: unknown): Promise<TeamTaskEvidenceReceipt> {
    if (
      !isRecord(input) ||
      !exactOptionalKeys(
        input,
        [
          'actorExternalId',
          'workItemExternalId',
          'aiContributionId',
          'status',
          'expectedVersion',
          'idempotencyKey',
        ],
        ['humanChangesSummary'],
      )
    ) {
      return fail('INVALID_INPUT');
    }
    const actorExternalId = text(input.actorExternalId, 32, 'user');
    const workItemExternalId = text(input.workItemExternalId, 32, 'teamWorkItem');
    const aiContributionExternalId = text(input.aiContributionId, 32, 'teamAiContribution');
    if (!['confirmed', 'modified', 'rejected'].includes(String(input.status))) {
      return fail('INVALID_INPUT');
    }
    const status = input.status as Exclude<AiHumanConfirmationStatus, 'pending'>;
    const humanChangesSummary =
      input.humanChangesSummary === null || input.humanChangesSummary === undefined
        ? null
        : text(input.humanChangesSummary, 1_000);
    if ((status === 'modified') !== (humanChangesSummary !== null)) return fail('INVALID_INPUT');
    const idempotency = idempotencyKey(input.idempotencyKey);
    const requiredVersion = expectedVersion(input.expectedVersion);
    const hash = requestHash('confirm_ai_contribution', {
      actorExternalId,
      workItemExternalId,
      aiContributionExternalId,
      status,
      humanChangesSummary,
      expectedVersion: requiredVersion,
    });
    return this.runTransaction(() =>
      this.repository.transaction(async (tx) => {
        const loaded = assertAccess(
          await tx.lockWorkItemAccess(actorExternalId, workItemExternalId),
          actorExternalId,
          workItemExternalId,
          this.dependencies,
        );
        const { access, workItem } = loaded;
        permit('confirm_ai_contribution', access, loaded.actorAcceptedAssignmentRole);
        if (!(await tx.lockOrganizationIdempotencyScope(access.organizationId))) fail('CONFLICT');
        if (await tx.hasPlanningEventByIdempotencyKey(access.organizationId, idempotency)) {
          fail('CONFLICT');
        }
        const previous = replay(
          await tx.findEventByIdempotencyKey(access.organizationId, idempotency),
          hash,
          {
            organizationId: access.organizationId,
            projectId: access.projectId,
            workItemId: workItem.id,
            actorUserId: access.actorUserId,
          },
        );
        if (previous) return previous;
        if (workItem.version !== requiredVersion) fail('CONFLICT');
        const contribution = await tx.lockAiContribution(aiContributionExternalId);
        if (
          !contribution ||
          contribution.externalId !== aiContributionExternalId ||
          contribution.organizationId !== access.organizationId ||
          contribution.projectId !== access.projectId ||
          contribution.workItemId !== workItem.id ||
          contribution.contributedByUserId !== access.actorUserId
        ) {
          fail('NOT_FOUND');
        }
        if (contribution.humanConfirmationStatus !== 'pending') fail('CONFLICT');
        const confirmedAt = new Date(this.dependencies.now());
        if (
          !(await tx.updateAiContribution(contribution.id, 'pending', {
            humanConfirmationStatus: status,
            humanChangesSummary,
            confirmedAt,
          }))
        ) {
          fail('CONFLICT');
        }
        const receipt: TeamTaskEvidenceReceipt = {
          command: 'confirm_ai_contribution',
          eventId: this.dependencies.newId('teamWorkItemEvent'),
          aiContributionId: contribution.externalId,
          workItemId: workItem.externalId,
          humanConfirmationStatus: status,
          state: workItem.status,
          version: workItem.version,
        };
        await tx.appendEvent(
          event(this.dependencies, access, workItem, idempotency, hash, receipt),
        );
        return receipt;
      }),
    );
  }

  async getEvidencePackage(input: unknown): Promise<EvidencePackageDto> {
    if (!isRecord(input) || !exactKeys(input, ['actorExternalId', 'workItemExternalId'])) {
      return fail('INVALID_INPUT');
    }
    const actorExternalId = text(input.actorExternalId, 32, 'user');
    const workItemExternalId = text(input.workItemExternalId, 32, 'teamWorkItem');
    return this.runTransaction(() =>
      this.repository.transaction(async (tx) => {
        const loaded = assertAccess(
          await tx.lockWorkItemAccess(actorExternalId, workItemExternalId),
          actorExternalId,
          workItemExternalId,
          this.dependencies,
        );
        const { access, workItem } = loaded;
        permit('read_evidence_package', access, loaded.actorAcceptedAssignmentRole);
        const result = sanitizeEvidencePackage(await tx.listEvidencePackage(workItem.id));
        return {
          workItemId: workItem.externalId,
          evidenceBindings: result.bindings,
          aiContributions: result.contributions,
        };
      }),
    );
  }

  async preflight(input: unknown): Promise<EvidencePreflightDto> {
    if (!isRecord(input) || !exactKeys(input, ['actorExternalId', 'workItemExternalId'])) {
      return fail('INVALID_INPUT');
    }
    const actorExternalId = text(input.actorExternalId, 32, 'user');
    const workItemExternalId = text(input.workItemExternalId, 32, 'teamWorkItem');
    return this.runTransaction(() =>
      this.repository.transaction(async (tx) => {
        const loaded = assertAccess(
          await tx.lockWorkItemAccess(actorExternalId, workItemExternalId),
          actorExternalId,
          workItemExternalId,
          this.dependencies,
        );
        permit('read_evidence_package', loaded.access, loaded.actorAcceptedAssignmentRole);
        return preflightDto(loaded.workItem, await tx.loadPreflightSnapshot(loaded.workItem.id));
      }),
    );
  }
}

type DrizzleExecutor = Pick<DB, 'select' | 'insert' | 'update'>;

const sourceOrganizationMembers = alias(organizationMembers, 'evidence_source_org_members');
const sourceProjectMembers = alias(projectMembers, 'evidence_source_project_members');
const executionOrganizationMembers = alias(organizationMembers, 'ai_execution_org_members');
const executionProjectMembers = alias(projectMembers, 'ai_execution_project_members');
const readArtifactTasks = alias(tasks, 'team_evidence_artifact_tasks');
const readTaskFileTasks = alias(tasks, 'team_evidence_file_tasks');

interface BoundEvidenceSourceFacts {
  sourceKind: string;
  bindingOrganizationId: number;
  bindingProjectId: number;
  bindingWorkItemId: number;
  lineageWorkItemId: number | null;
  lineageOrganizationId: number | null;
  lineageProjectId: number | null;
  evidenceArtifactId: number | null;
  taskFileId: number | null;
  controlledExternalRef: string | null;
  artifactExternalId: string | null;
  artifactOwnerUserId: number | null;
  artifactTaskId: number | null;
  artifactTaskProjectId: number | null;
  artifactTaskUserId: number | null;
  artifactExpiresAt: Date | null;
  taskFileExternalId: string | null;
  taskFileOwnerUserId: number | null;
  taskFileTaskId: number | null;
  taskFileTaskProjectId: number | null;
  taskFileTaskUserId: number | null;
  taskFileStatus: string | null;
  taskFileExpiresAt: Date | null;
}

function hasValidBoundEvidenceSource(row: BoundEvidenceSourceFacts, at: Date): boolean {
  if (
    row.lineageWorkItemId !== row.bindingWorkItemId ||
    row.lineageOrganizationId !== row.bindingOrganizationId ||
    row.lineageProjectId !== row.bindingProjectId
  ) {
    return false;
  }
  const physicalSourceCount = [
    row.evidenceArtifactId,
    row.taskFileId,
    row.controlledExternalRef,
  ].filter((value) => value !== null).length;
  if (physicalSourceCount !== 1) return false;
  if (row.sourceKind === 'controlledExternalRef') {
    if (
      row.controlledExternalRef === null ||
      row.evidenceArtifactId !== null ||
      row.taskFileId !== null
    ) {
      return false;
    }
    try {
      return controlledHttpsUrl(row.controlledExternalRef) === row.controlledExternalRef;
    } catch {
      return false;
    }
  }
  if (row.sourceKind === 'evidenceArtifact') {
    return (
      row.evidenceArtifactId !== null &&
      row.taskFileId === null &&
      row.controlledExternalRef === null &&
      row.artifactExternalId !== null &&
      isExternalId(row.artifactExternalId, 'evidenceArtifact') &&
      row.artifactOwnerUserId !== null &&
      row.artifactTaskId !== null &&
      row.artifactTaskProjectId === row.bindingProjectId &&
      row.artifactTaskUserId === row.artifactOwnerUserId &&
      (row.artifactExpiresAt === null || row.artifactExpiresAt.getTime() > at.getTime())
    );
  }
  if (row.sourceKind === 'taskFile') {
    return (
      row.taskFileId !== null &&
      row.evidenceArtifactId === null &&
      row.controlledExternalRef === null &&
      row.taskFileExternalId !== null &&
      isExternalId(row.taskFileExternalId, 'file') &&
      row.taskFileOwnerUserId !== null &&
      row.taskFileTaskId !== null &&
      row.taskFileTaskProjectId === row.bindingProjectId &&
      row.taskFileTaskUserId === row.taskFileOwnerUserId &&
      row.taskFileStatus === 'active' &&
      (row.taskFileExpiresAt === null || row.taskFileExpiresAt.getTime() > at.getTime())
    );
  }
  return false;
}

const teamTaskStates = new Set<TeamTaskState>(TEAM_TASK_STATES);

function isTeamTaskState(value: unknown): value is TeamTaskState {
  return typeof value === 'string' && teamTaskStates.has(value as TeamTaskState);
}

function isNullableTeamTaskState(value: unknown): value is TeamTaskState | null {
  return value === null || isTeamTaskState(value);
}

function isOrganizationRole(
  value: unknown,
): value is TeamTaskProjectAccessSnapshot['actorOrganizationRole'] {
  return value === 'owner' || value === 'admin' || value === 'manager' || value === 'member';
}

function isProjectRole(value: unknown): value is TeamTaskProjectAccessSnapshot['actorProjectRole'] {
  return value === 'lead' || value === 'member' || value === 'viewer';
}

function normalizeAccess(
  row:
    | {
        actorUserId: number;
        actorExternalId: string;
        actorOrganizationRole: string;
        actorOrganizationMembershipStatus: string;
        actorProjectRole: string;
        actorProjectMembershipStatus: string;
        organizationId: number;
        organizationExternalId: string;
        organizationStatus: string;
        organizationTeamProjectsEnabled: boolean;
        projectId: number;
        projectExternalId: string;
        projectOrganizationId: number | null;
      }
    | undefined,
  actorExternalId: string,
): TeamTaskProjectAccessSnapshot | null {
  if (
    !row ||
    row.actorExternalId !== actorExternalId ||
    !isOrganizationRole(row.actorOrganizationRole) ||
    !isProjectRole(row.actorProjectRole)
  ) {
    return null;
  }
  return {
    actorUserId: row.actorUserId,
    actorExternalId: row.actorExternalId,
    actorOrganizationRole: row.actorOrganizationRole,
    actorOrganizationMembershipActive: row.actorOrganizationMembershipStatus === 'active',
    actorProjectRole: row.actorProjectRole,
    actorProjectMembershipActive: row.actorProjectMembershipStatus === 'active',
    organizationId: row.organizationId,
    organizationExternalId: row.organizationExternalId,
    organizationActive: row.organizationStatus === 'active',
    organizationTeamProjectsEnabled: row.organizationTeamProjectsEnabled,
    projectId: row.projectId,
    projectExternalId: row.projectExternalId,
    projectOrganizationId: row.projectOrganizationId,
  };
}

function normalizeAiContributionRow(row: {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  contributedByUserId: number;
  executionTaskId: number;
  executionTaskExternalId: string;
  requestedScope: string;
  inputSourceSummary: unknown;
  resultVersion: string;
  usageSnapshot: unknown;
  humanConfirmationStatus: string;
  humanChangesSummary: string | null;
  unverifiedRisks: unknown;
  createdAt: Date;
  confirmedAt: Date | null;
}): TeamAiContributionRow | null {
  if (
    !isExternalId(row.externalId, 'teamAiContribution') ||
    !isExternalId(row.executionTaskExternalId, 'task') ||
    !['pending', 'confirmed', 'modified', 'rejected'].includes(row.humanConfirmationStatus)
  ) {
    return null;
  }
  try {
    return {
      ...row,
      inputSourceSummary: aiInputSourceSummary(row.inputSourceSummary),
      usageSnapshot: aiUsageSnapshot(row.usageSnapshot),
      humanConfirmationStatus: row.humanConfirmationStatus as AiHumanConfirmationStatus,
      unverifiedRisks: aiRisks(row.unverifiedRisks),
    };
  } catch {
    return null;
  }
}

function dbNonNegativeInteger(value: unknown): number {
  const numeric = typeof value === 'string' && value !== '' ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || (numeric as number) < 0) return fail('CONFLICT');
  return numeric as number;
}

class DrizzleEvidenceAiTransaction implements EvidenceAiTransaction {
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
        workItemOrganizationId: teamWorkItems.organizationId,
        workItemProjectId: teamWorkItems.projectId,
        workItemStatus: teamWorkItems.status,
        workItemVersion: teamWorkItems.version,
        workItemCurrentContractVersionId: teamWorkItems.currentContractVersionId,
        actorAssignmentRole: teamWorkItemAssignments.role,
        actorAssignmentStatus: teamWorkItemAssignments.status,
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
      .leftJoin(
        teamWorkItemAssignments,
        and(
          eq(teamWorkItemAssignments.workItemId, teamWorkItems.id),
          eq(teamWorkItemAssignments.organizationId, organizations.id),
          eq(teamWorkItemAssignments.projectId, projects.id),
          eq(teamWorkItemAssignments.userId, users.id),
          eq(teamWorkItemAssignments.status, 'accepted'),
          inArray(teamWorkItemAssignments.role, ['responsible', 'collaborator']),
        ),
      )
      .where(eq(teamWorkItems.externalId, workItemExternalId))
      .for('update')
      .limit(1);
    const access = normalizeAccess(row, actorExternalId);
    if (
      !row ||
      !access ||
      row.workItemExternalId !== workItemExternalId ||
      !isTeamTaskState(row.workItemStatus)
    ) {
      return null;
    }
    const actorAcceptedAssignmentRole: 'responsible' | 'collaborator' | null =
      row.actorAssignmentStatus === 'accepted' &&
      (row.actorAssignmentRole === 'responsible' || row.actorAssignmentRole === 'collaborator')
        ? row.actorAssignmentRole
        : null;
    return {
      access,
      actorAcceptedAssignmentRole,
      workItem: {
        id: row.workItemId,
        externalId: row.workItemExternalId,
        organizationId: row.workItemOrganizationId,
        projectId: row.workItemProjectId,
        status: row.workItemStatus,
        version: row.workItemVersion,
        currentContractVersionId: row.workItemCurrentContractVersionId,
      },
    };
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

  async hasPlanningEventByIdempotencyKey(organizationId: number, idempotencyKeyValue: string) {
    const [row] = await this.db
      .select({ id: teamProjectPlanningEvents.id })
      .from(teamProjectPlanningEvents)
      .where(
        and(
          eq(teamProjectPlanningEvents.organizationId, organizationId),
          eq(teamProjectPlanningEvents.idempotencyKey, idempotencyKeyValue),
        ),
      )
      .for('update')
      .limit(1);
    return row !== undefined;
  }

  async findEventByIdempotencyKey(organizationId: number, idempotencyKeyValue: string) {
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
          eq(teamWorkItemEvents.idempotencyKey, idempotencyKeyValue),
        ),
      )
      .limit(1);
    if (!row || !isNullableTeamTaskState(row.fromState) || !isNullableTeamTaskState(row.toState)) {
      return null;
    }
    return { ...row, fromState: row.fromState, toState: row.toState };
  }

  async lockEvidenceSource(kind: EvidenceSourceRow['kind'], sourceExternalId: string) {
    if (kind === 'evidenceArtifact') {
      const [row] = await this.db
        .select({
          id: evidenceArtifacts.id,
          externalId: evidenceArtifacts.externalId,
          ownerUserId: evidenceArtifacts.ownerUserId,
          taskId: evidenceArtifacts.taskId,
          taskProjectId: tasks.projectId,
          taskUserId: tasks.userId,
          expiresAt: evidenceArtifacts.expiresAt,
          ownerOrganizationMembershipStatus: sourceOrganizationMembers.status,
          ownerProjectMembershipStatus: sourceProjectMembers.status,
          ownerProjectRole: sourceProjectMembers.role,
        })
        .from(evidenceArtifacts)
        .leftJoin(tasks, eq(tasks.id, evidenceArtifacts.taskId))
        .leftJoin(projects, eq(projects.id, tasks.projectId))
        .leftJoin(
          sourceOrganizationMembers,
          and(
            eq(sourceOrganizationMembers.organizationId, projects.organizationId),
            eq(sourceOrganizationMembers.userId, evidenceArtifacts.ownerUserId),
          ),
        )
        .leftJoin(
          sourceProjectMembers,
          and(
            eq(sourceProjectMembers.projectId, projects.id),
            eq(sourceProjectMembers.userId, evidenceArtifacts.ownerUserId),
          ),
        )
        .where(eq(evidenceArtifacts.externalId, sourceExternalId))
        .for('update')
        .limit(1);
      return row
        ? ({
            kind,
            id: row.id,
            externalId: row.externalId,
            ownerUserId: row.ownerUserId,
            taskId: row.taskId,
            taskProjectId: row.taskProjectId,
            taskUserId: row.taskUserId,
            expiresAt: row.expiresAt,
            ownerOrganizationMembershipActive: row.ownerOrganizationMembershipStatus === 'active',
            ownerProjectMembershipActive: row.ownerProjectMembershipStatus === 'active',
            ownerProjectRole: row.ownerProjectRole,
          } satisfies EvidenceSourceRow)
        : null;
    }
    const [row] = await this.db
      .select({
        id: taskFiles.id,
        externalId: taskFiles.externalId,
        ownerUserId: taskFiles.userId,
        taskId: taskFiles.taskId,
        taskProjectId: tasks.projectId,
        taskUserId: tasks.userId,
        status: taskFiles.status,
        expiresAt: taskFiles.expiresAt,
        ownerOrganizationMembershipStatus: sourceOrganizationMembers.status,
        ownerProjectMembershipStatus: sourceProjectMembers.status,
        ownerProjectRole: sourceProjectMembers.role,
      })
      .from(taskFiles)
      .leftJoin(tasks, eq(tasks.id, taskFiles.taskId))
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(
        sourceOrganizationMembers,
        and(
          eq(sourceOrganizationMembers.organizationId, projects.organizationId),
          eq(sourceOrganizationMembers.userId, taskFiles.userId),
        ),
      )
      .leftJoin(
        sourceProjectMembers,
        and(
          eq(sourceProjectMembers.projectId, projects.id),
          eq(sourceProjectMembers.userId, taskFiles.userId),
        ),
      )
      .where(eq(taskFiles.externalId, sourceExternalId))
      .for('update')
      .limit(1);
    return row
      ? ({
          kind,
          id: row.id,
          externalId: row.externalId,
          ownerUserId: row.ownerUserId,
          taskId: row.taskId,
          taskProjectId: row.taskProjectId,
          taskUserId: row.taskUserId,
          status: row.status,
          expiresAt: row.expiresAt,
          ownerOrganizationMembershipActive: row.ownerOrganizationMembershipStatus === 'active',
          ownerProjectMembershipActive: row.ownerProjectMembershipStatus === 'active',
          ownerProjectRole: row.ownerProjectRole,
        } satisfies EvidenceSourceRow)
      : null;
  }

  async hasSourceOwnerSharedWithWorkItem(input: {
    organizationId: number;
    projectId: number;
    workItemId: number;
    ownerUserId: number;
    sourceKind: EvidenceSourceRow['kind'];
    sourceId: number;
  }) {
    const sourceCondition =
      input.sourceKind === 'evidenceArtifact'
        ? eq(teamEvidenceBindings.evidenceArtifactId, input.sourceId)
        : eq(teamEvidenceBindings.taskFileId, input.sourceId);
    const [row] = await this.db
      .select({ id: teamEvidenceBindings.id })
      .from(teamEvidenceBindings)
      .where(
        and(
          eq(teamEvidenceBindings.organizationId, input.organizationId),
          eq(teamEvidenceBindings.projectId, input.projectId),
          eq(teamEvidenceBindings.workItemId, input.workItemId),
          eq(teamEvidenceBindings.boundByUserId, input.ownerUserId),
          eq(teamEvidenceBindings.sourceKind, input.sourceKind),
          sourceCondition,
        ),
      )
      .for('update')
      .limit(1);
    return row !== undefined;
  }

  async lockTarget(kind: TeamTaskEvidenceTargetKind, workItemId: number, externalId: string) {
    if (kind === 'submission') {
      const [row] = await this.db
        .select({
          id: teamWorkItemSubmissions.id,
          externalId: teamWorkItemSubmissions.externalId,
          organizationId: teamWorkItemSubmissions.organizationId,
          projectId: teamWorkItemSubmissions.projectId,
          workItemId: teamWorkItemSubmissions.workItemId,
        })
        .from(teamWorkItemSubmissions)
        .where(
          and(
            eq(teamWorkItemSubmissions.externalId, externalId),
            eq(teamWorkItemSubmissions.workItemId, workItemId),
          ),
        )
        .for('update')
        .limit(1);
      return row ? { kind, ...row } : null;
    }
    if (kind === 'review') {
      const [row] = await this.db
        .select({
          id: teamWorkItemReviews.id,
          externalId: teamWorkItemReviews.externalId,
          organizationId: teamWorkItemReviews.organizationId,
          projectId: teamWorkItemReviews.projectId,
          workItemId: teamWorkItemReviews.workItemId,
        })
        .from(teamWorkItemReviews)
        .where(
          and(
            eq(teamWorkItemReviews.externalId, externalId),
            eq(teamWorkItemReviews.workItemId, workItemId),
          ),
        )
        .for('update')
        .limit(1);
      return row ? { kind, ...row } : null;
    }
    if (kind === 'appeal') {
      const [row] = await this.db
        .select({
          id: teamWorkItemAppeals.id,
          externalId: teamWorkItemAppeals.externalId,
          organizationId: teamWorkItemAppeals.organizationId,
          projectId: teamWorkItemAppeals.projectId,
          workItemId: teamWorkItemAppeals.workItemId,
        })
        .from(teamWorkItemAppeals)
        .where(
          and(
            eq(teamWorkItemAppeals.externalId, externalId),
            eq(teamWorkItemAppeals.workItemId, workItemId),
          ),
        )
        .for('update')
        .limit(1);
      return row ? { kind, ...row } : null;
    }
    const [row] = await this.db
      .select({
        id: teamAiContributions.id,
        externalId: teamAiContributions.externalId,
        organizationId: teamAiContributions.organizationId,
        projectId: teamAiContributions.projectId,
        workItemId: teamAiContributions.workItemId,
      })
      .from(teamAiContributions)
      .where(
        and(
          eq(teamAiContributions.externalId, externalId),
          eq(teamAiContributions.workItemId, workItemId),
        ),
      )
      .for('update')
      .limit(1);
    return row ? { kind, ...row } : null;
  }

  async findEquivalentBinding(input: Omit<EvidenceBindingRow, 'id' | 'externalId' | 'createdAt'>) {
    const [row] = await this.db
      .select({
        id: teamEvidenceBindings.id,
        externalId: teamEvidenceBindings.externalId,
        createdAt: teamEvidenceBindings.createdAt,
      })
      .from(teamEvidenceBindings)
      .where(
        and(
          eq(teamEvidenceBindings.organizationId, input.organizationId),
          eq(teamEvidenceBindings.projectId, input.projectId),
          eq(teamEvidenceBindings.workItemId, input.workItemId),
          input.submissionId === null
            ? isNull(teamEvidenceBindings.submissionId)
            : eq(teamEvidenceBindings.submissionId, input.submissionId),
          input.reviewId === null
            ? isNull(teamEvidenceBindings.reviewId)
            : eq(teamEvidenceBindings.reviewId, input.reviewId),
          input.appealId === null
            ? isNull(teamEvidenceBindings.appealId)
            : eq(teamEvidenceBindings.appealId, input.appealId),
          input.aiContributionId === null
            ? isNull(teamEvidenceBindings.aiContributionId)
            : eq(teamEvidenceBindings.aiContributionId, input.aiContributionId),
          input.evidenceArtifactId === null
            ? isNull(teamEvidenceBindings.evidenceArtifactId)
            : eq(teamEvidenceBindings.evidenceArtifactId, input.evidenceArtifactId),
          input.taskFileId === null
            ? isNull(teamEvidenceBindings.taskFileId)
            : eq(teamEvidenceBindings.taskFileId, input.taskFileId),
          input.controlledExternalRef === null
            ? isNull(teamEvidenceBindings.controlledExternalRef)
            : eq(teamEvidenceBindings.controlledExternalRef, input.controlledExternalRef),
        ),
      )
      .limit(1);
    return row ? { ...input, ...row } : null;
  }

  async insertEvidenceBinding(row: Omit<EvidenceBindingRow, 'id'>) {
    const result = await this.db.insert(teamEvidenceBindings).values({
      externalId: row.externalId,
      organizationId: row.organizationId,
      projectId: row.projectId,
      workItemId: row.workItemId,
      submissionId: row.submissionId,
      reviewId: row.reviewId,
      appealId: row.appealId,
      aiContributionId: row.aiContributionId,
      evidenceArtifactId: row.evidenceArtifactId,
      taskFileId: row.taskFileId,
      sourceKind: row.sourceKind,
      controlledExternalRef: row.controlledExternalRef,
      metadataJson: row.metadata,
      boundByUserId: row.boundByUserId,
      createdAt: row.createdAt,
    });
    return readInsertId(result);
  }

  async lockExecutionTask(externalId: string) {
    const [row] = await this.db
      .select({
        id: tasks.id,
        externalId: tasks.externalId,
        projectId: tasks.projectId,
        userId: tasks.userId,
        status: tasks.status,
        origin: tasks.origin,
        result: tasks.result,
        completedAt: tasks.completedAt,
        opusUsed: tasks.opusUsed,
        ownerOrganizationMembershipStatus: executionOrganizationMembers.status,
        ownerProjectMembershipStatus: executionProjectMembers.status,
        ownerProjectRole: executionProjectMembers.role,
      })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(
        executionOrganizationMembers,
        and(
          eq(executionOrganizationMembers.organizationId, projects.organizationId),
          eq(executionOrganizationMembers.userId, tasks.userId),
        ),
      )
      .leftJoin(
        executionProjectMembers,
        and(
          eq(executionProjectMembers.projectId, projects.id),
          eq(executionProjectMembers.userId, tasks.userId),
        ),
      )
      .where(eq(tasks.externalId, externalId))
      .for('update')
      .limit(1);
    return row
      ? {
          id: row.id,
          externalId: row.externalId,
          projectId: row.projectId,
          userId: row.userId,
          status: row.status,
          origin: row.origin,
          result: row.result,
          completedAt: row.completedAt,
          opusUsed: row.opusUsed,
          ownerOrganizationMembershipActive: row.ownerOrganizationMembershipStatus === 'active',
          ownerProjectMembershipActive: row.ownerProjectMembershipStatus === 'active',
          ownerProjectRole: row.ownerProjectRole,
        }
      : null;
  }

  async deriveAiExecutionSnapshot(
    taskId: number,
    taskOwnerUserId: number,
    at: Date,
  ): Promise<AiExecutionSnapshotRow> {
    const [fileRow] = await this.db
      .select({ value: count(taskFiles.id) })
      .from(taskFiles)
      .where(
        and(
          eq(taskFiles.taskId, taskId),
          eq(taskFiles.userId, taskOwnerUserId),
          eq(taskFiles.kind, 'input'),
          eq(taskFiles.status, 'active'),
          or(isNull(taskFiles.expiresAt), gt(taskFiles.expiresAt, at)),
        ),
      );
    const [artifactRow] = await this.db
      .select({ value: count(evidenceArtifacts.id) })
      .from(evidenceArtifacts)
      .where(
        and(
          eq(evidenceArtifacts.taskId, taskId),
          eq(evidenceArtifacts.ownerUserId, taskOwnerUserId),
          eq(evidenceArtifacts.purpose, 'task_evidence'),
          or(isNull(evidenceArtifacts.expiresAt), gt(evidenceArtifacts.expiresAt, at)),
        ),
      );
    const [usageRow] = await this.db
      .select({
        llmCallCount: count(llmCalls.id),
        inputTokens: sum(llmCalls.promptTokens),
        outputTokens: sum(llmCalls.completionTokens),
        cacheReadTokens: sum(llmCalls.cacheReadTokens),
        cacheWriteTokens: sum(llmCalls.cacheWriteTokens),
        latencyMs: sum(llmCalls.latencyMs),
      })
      .from(llmCalls)
      .where(eq(llmCalls.taskId, taskId));
    return {
      taskFileCount: dbNonNegativeInteger(fileRow?.value ?? 0),
      evidenceArtifactCount: dbNonNegativeInteger(artifactRow?.value ?? 0),
      llmCallCount: dbNonNegativeInteger(usageRow?.llmCallCount ?? 0),
      inputTokens: dbNonNegativeInteger(usageRow?.inputTokens ?? 0),
      outputTokens: dbNonNegativeInteger(usageRow?.outputTokens ?? 0),
      cacheReadTokens: dbNonNegativeInteger(usageRow?.cacheReadTokens ?? 0),
      cacheWriteTokens: dbNonNegativeInteger(usageRow?.cacheWriteTokens ?? 0),
      latencyMs: dbNonNegativeInteger(usageRow?.latencyMs ?? 0),
    };
  }

  private aiContributionSelection() {
    return {
      id: teamAiContributions.id,
      externalId: teamAiContributions.externalId,
      organizationId: teamAiContributions.organizationId,
      projectId: teamAiContributions.projectId,
      workItemId: teamAiContributions.workItemId,
      contributedByUserId: teamAiContributions.contributedByUserId,
      executionTaskId: teamAiContributions.executionTaskId,
      executionTaskExternalId: tasks.externalId,
      requestedScope: teamAiContributions.requestedScope,
      inputSourceSummary: teamAiContributions.inputSourceSummaryJson,
      resultVersion: teamAiContributions.resultVersion,
      usageSnapshot: teamAiContributions.usageSnapshotJson,
      humanConfirmationStatus: teamAiContributions.humanConfirmationStatus,
      humanChangesSummary: teamAiContributions.humanChangesSummary,
      unverifiedRisks: teamAiContributions.unverifiedRisksJson,
      createdAt: teamAiContributions.createdAt,
      confirmedAt: teamAiContributions.confirmedAt,
    };
  }

  async findContributionByExecutionTask(executionTaskId: number) {
    const [row] = await this.db
      .select(this.aiContributionSelection())
      .from(teamAiContributions)
      .innerJoin(tasks, eq(tasks.id, teamAiContributions.executionTaskId))
      .where(eq(teamAiContributions.executionTaskId, executionTaskId))
      .limit(1);
    return row ? normalizeAiContributionRow(row) : null;
  }

  async lockAiContribution(externalId: string) {
    const [row] = await this.db
      .select(this.aiContributionSelection())
      .from(teamAiContributions)
      .innerJoin(tasks, eq(tasks.id, teamAiContributions.executionTaskId))
      .where(eq(teamAiContributions.externalId, externalId))
      .for('update')
      .limit(1);
    return row ? normalizeAiContributionRow(row) : null;
  }

  async insertAiContribution(row: Omit<TeamAiContributionRow, 'id'>) {
    const result = await this.db.insert(teamAiContributions).values({
      externalId: row.externalId,
      organizationId: row.organizationId,
      projectId: row.projectId,
      workItemId: row.workItemId,
      contributedByUserId: row.contributedByUserId,
      executionTaskId: row.executionTaskId,
      requestedScope: row.requestedScope,
      inputSourceSummaryJson: row.inputSourceSummary,
      resultVersion: row.resultVersion,
      usageSnapshotJson: row.usageSnapshot,
      humanConfirmationStatus: row.humanConfirmationStatus,
      humanChangesSummary: row.humanChangesSummary,
      unverifiedRisksJson: row.unverifiedRisks,
      createdAt: row.createdAt,
      confirmedAt: row.confirmedAt,
    });
    return readInsertId(result);
  }

  async updateAiContribution(
    id: number,
    expectedStatus: 'pending',
    update: Pick<
      TeamAiContributionRow,
      'humanConfirmationStatus' | 'humanChangesSummary' | 'confirmedAt'
    >,
  ) {
    const result = await this.db
      .update(teamAiContributions)
      .set({
        humanConfirmationStatus: update.humanConfirmationStatus,
        humanChangesSummary: update.humanChangesSummary,
        confirmedAt: update.confirmedAt,
      })
      .where(
        and(
          eq(teamAiContributions.id, id),
          eq(teamAiContributions.humanConfirmationStatus, expectedStatus),
        ),
      );
    return readAffectedRows(result) === 1;
  }

  async listEvidencePackage(workItemId: number) {
    const bindingRows = await this.db
      .select({
        externalId: teamEvidenceBindings.externalId,
        bindingOrganizationId: teamEvidenceBindings.organizationId,
        bindingProjectId: teamEvidenceBindings.projectId,
        bindingWorkItemId: teamEvidenceBindings.workItemId,
        lineageWorkItemId: teamWorkItems.id,
        lineageOrganizationId: teamWorkItems.organizationId,
        lineageProjectId: teamWorkItems.projectId,
        sourceKind: teamEvidenceBindings.sourceKind,
        evidenceArtifactId: teamEvidenceBindings.evidenceArtifactId,
        taskFileId: teamEvidenceBindings.taskFileId,
        controlledExternalRef: teamEvidenceBindings.controlledExternalRef,
        artifactExternalId: evidenceArtifacts.externalId,
        artifactOwnerUserId: evidenceArtifacts.ownerUserId,
        artifactTaskId: evidenceArtifacts.taskId,
        artifactTaskProjectId: readArtifactTasks.projectId,
        artifactTaskUserId: readArtifactTasks.userId,
        artifactExpiresAt: evidenceArtifacts.expiresAt,
        taskFileExternalId: taskFiles.externalId,
        taskFileOwnerUserId: taskFiles.userId,
        taskFileTaskId: taskFiles.taskId,
        taskFileTaskProjectId: readTaskFileTasks.projectId,
        taskFileTaskUserId: readTaskFileTasks.userId,
        taskFileStatus: taskFiles.status,
        taskFileExpiresAt: taskFiles.expiresAt,
        submissionId: teamEvidenceBindings.submissionId,
        reviewId: teamEvidenceBindings.reviewId,
        appealId: teamEvidenceBindings.appealId,
        aiContributionId: teamEvidenceBindings.aiContributionId,
        submissionExternalId: teamWorkItemSubmissions.externalId,
        reviewExternalId: teamWorkItemReviews.externalId,
        appealExternalId: teamWorkItemAppeals.externalId,
        aiContributionExternalId: teamAiContributions.externalId,
        metadata: teamEvidenceBindings.metadataJson,
        createdAt: teamEvidenceBindings.createdAt,
      })
      .from(teamEvidenceBindings)
      .leftJoin(teamWorkItems, eq(teamWorkItems.id, teamEvidenceBindings.workItemId))
      .leftJoin(
        evidenceArtifacts,
        eq(evidenceArtifacts.id, teamEvidenceBindings.evidenceArtifactId),
      )
      .leftJoin(taskFiles, eq(taskFiles.id, teamEvidenceBindings.taskFileId))
      .leftJoin(readArtifactTasks, eq(readArtifactTasks.id, evidenceArtifacts.taskId))
      .leftJoin(readTaskFileTasks, eq(readTaskFileTasks.id, taskFiles.taskId))
      .leftJoin(
        teamWorkItemSubmissions,
        eq(teamWorkItemSubmissions.id, teamEvidenceBindings.submissionId),
      )
      .leftJoin(teamWorkItemReviews, eq(teamWorkItemReviews.id, teamEvidenceBindings.reviewId))
      .leftJoin(teamWorkItemAppeals, eq(teamWorkItemAppeals.id, teamEvidenceBindings.appealId))
      .leftJoin(
        teamAiContributions,
        eq(teamAiContributions.id, teamEvidenceBindings.aiContributionId),
      )
      .where(eq(teamEvidenceBindings.workItemId, workItemId))
      .orderBy(asc(teamEvidenceBindings.createdAt), asc(teamEvidenceBindings.externalId));

    const at = new Date();
    const bindings = bindingRows.map((row): EvidencePackageBindingDto => {
      if (
        !isExternalId(row.externalId, 'teamEvidenceBinding') ||
        !hasValidBoundEvidenceSource(row, at)
      ) {
        return fail('CONFLICT');
      }
      const sourceKind = row.sourceKind as EvidenceBindingRow['sourceKind'];
      const sourceId =
        sourceKind === 'evidenceArtifact'
          ? row.artifactExternalId
          : sourceKind === 'taskFile'
            ? row.taskFileExternalId
            : undefined;
      const physicalTargetCount = [
        row.submissionId,
        row.reviewId,
        row.appealId,
        row.aiContributionId,
      ].filter((value) => value !== null).length;
      if (physicalTargetCount > 1) return fail('CONFLICT');
      const targets = [
        row.submissionExternalId
          ? ({ kind: 'submission', id: row.submissionExternalId } as const)
          : null,
        row.reviewExternalId ? ({ kind: 'review', id: row.reviewExternalId } as const) : null,
        row.appealExternalId ? ({ kind: 'appeal', id: row.appealExternalId } as const) : null,
        row.aiContributionExternalId
          ? ({ kind: 'aiContribution', id: row.aiContributionExternalId } as const)
          : null,
      ].filter((target): target is NonNullable<typeof target> => target !== null);
      if (targets.length !== physicalTargetCount) return fail('CONFLICT');
      const target = targets[0];
      if (target) {
        const targetKinds = {
          submission: 'teamSubmission',
          review: 'teamReview',
          appeal: 'teamAppeal',
          aiContribution: 'teamAiContribution',
        } as const;
        if (!isExternalId(target.id, targetKinds[target.kind])) return fail('CONFLICT');
      }
      const safeMetadata = metadata(row.metadata);
      return {
        id: row.externalId,
        source: { kind: sourceKind, ...(sourceId ? { sourceId } : {}) },
        target:
          target === undefined ? { kind: 'workItem' } : { kind: target.kind, targetId: target.id },
        metadata: safeMetadata,
        createdAt: row.createdAt.toISOString(),
      };
    });

    const contributionRows = await this.db
      .select(this.aiContributionSelection())
      .from(teamAiContributions)
      .innerJoin(tasks, eq(tasks.id, teamAiContributions.executionTaskId))
      .where(eq(teamAiContributions.workItemId, workItemId))
      .orderBy(asc(teamAiContributions.createdAt), asc(teamAiContributions.externalId));
    const contributions = contributionRows.map((row): AiContributionDto => {
      const normalized = normalizeAiContributionRow(row);
      if (!normalized) return fail('CONFLICT');
      return {
        id: normalized.externalId,
        executionTaskId: normalized.executionTaskExternalId,
        requestedScope: normalized.requestedScope,
        inputSourceSummary: structuredClone(normalized.inputSourceSummary),
        resultVersion: normalized.resultVersion,
        usageSnapshot: structuredClone(normalized.usageSnapshot),
        humanConfirmationStatus: normalized.humanConfirmationStatus,
        humanChangesSummary: normalized.humanChangesSummary,
        unverifiedRisks: structuredClone(normalized.unverifiedRisks),
        createdAt: normalized.createdAt.toISOString(),
        confirmedAt: normalized.confirmedAt?.toISOString() ?? null,
      };
    });
    return { bindings, contributions };
  }

  async loadPreflightSnapshot(workItemId: number): Promise<EvidencePreflightSnapshot> {
    const [contract] = await this.db
      .select({
        id: acceptanceContractVersions.id,
        organizationId: acceptanceContractVersions.organizationId,
        projectId: acceptanceContractVersions.projectId,
        workItemId: acceptanceContractVersions.workItemId,
        objective: acceptanceContractVersions.objective,
        deliverables: acceptanceContractVersions.deliverablesJson,
        criteria: acceptanceContractVersions.criteriaJson,
        requiredEvidenceTypes: acceptanceContractVersions.requiredEvidenceTypesJson,
        confirmedByUserId: acceptanceContractVersions.confirmedByUserId,
        confirmedAt: acceptanceContractVersions.confirmedAt,
      })
      .from(teamWorkItems)
      .innerJoin(
        acceptanceContractVersions,
        and(
          eq(acceptanceContractVersions.id, teamWorkItems.currentContractVersionId),
          eq(acceptanceContractVersions.workItemId, teamWorkItems.id),
          eq(acceptanceContractVersions.organizationId, teamWorkItems.organizationId),
          eq(acceptanceContractVersions.projectId, teamWorkItems.projectId),
          isNotNull(acceptanceContractVersions.confirmedByUserId),
          isNotNull(acceptanceContractVersions.confirmedAt),
        ),
      )
      .where(eq(teamWorkItems.id, workItemId))
      .limit(1);
    const evidenceRows = await this.db
      .select({
        bindingOrganizationId: teamEvidenceBindings.organizationId,
        bindingProjectId: teamEvidenceBindings.projectId,
        bindingWorkItemId: teamEvidenceBindings.workItemId,
        lineageWorkItemId: teamWorkItems.id,
        lineageOrganizationId: teamWorkItems.organizationId,
        lineageProjectId: teamWorkItems.projectId,
        sourceKind: teamEvidenceBindings.sourceKind,
        evidenceArtifactId: teamEvidenceBindings.evidenceArtifactId,
        taskFileId: teamEvidenceBindings.taskFileId,
        controlledExternalRef: teamEvidenceBindings.controlledExternalRef,
        artifactExternalId: evidenceArtifacts.externalId,
        artifactOwnerUserId: evidenceArtifacts.ownerUserId,
        artifactTaskId: evidenceArtifacts.taskId,
        artifactTaskProjectId: readArtifactTasks.projectId,
        artifactTaskUserId: readArtifactTasks.userId,
        artifactExpiresAt: evidenceArtifacts.expiresAt,
        taskFileExternalId: taskFiles.externalId,
        taskFileOwnerUserId: taskFiles.userId,
        taskFileTaskId: taskFiles.taskId,
        taskFileTaskProjectId: readTaskFileTasks.projectId,
        taskFileTaskUserId: readTaskFileTasks.userId,
        taskFileStatus: taskFiles.status,
        taskFileExpiresAt: taskFiles.expiresAt,
        metadata: teamEvidenceBindings.metadataJson,
      })
      .from(teamEvidenceBindings)
      .leftJoin(teamWorkItems, eq(teamWorkItems.id, teamEvidenceBindings.workItemId))
      .leftJoin(
        evidenceArtifacts,
        eq(evidenceArtifacts.id, teamEvidenceBindings.evidenceArtifactId),
      )
      .leftJoin(taskFiles, eq(taskFiles.id, teamEvidenceBindings.taskFileId))
      .leftJoin(readArtifactTasks, eq(readArtifactTasks.id, evidenceArtifacts.taskId))
      .leftJoin(readTaskFileTasks, eq(readTaskFileTasks.id, taskFiles.taskId))
      .where(eq(teamEvidenceBindings.workItemId, workItemId))
      .orderBy(asc(teamEvidenceBindings.createdAt), asc(teamEvidenceBindings.externalId));
    const at = new Date();
    return {
      contract: contract ?? null,
      evidenceBindings: evidenceRows.map((row) => ({
        evidenceType: isRecord(row.metadata) ? row.metadata.evidenceType : undefined,
        sourceValid: hasValidBoundEvidenceSource(row, at),
      })),
    };
  }

  async appendEvent(row: TeamTaskEventRow) {
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

export class DrizzleTeamTaskEvidenceRepository implements TeamTaskEvidenceRepository {
  constructor(private readonly db: DB) {}

  transaction<T>(work: (tx: EvidenceAiTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleEvidenceAiTransaction(tx)));
  }
}

export function createTeamTaskEvidenceService(db: DB): TeamTaskEvidenceService {
  return new TeamTaskEvidenceService(new DrizzleTeamTaskEvidenceRepository(db));
}
