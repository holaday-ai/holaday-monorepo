import { createHash } from 'node:crypto';
import { isExternalId, newExternalId } from '@holaday/shared-types';
import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import { acceptanceContractVersions } from '../db/schema/acceptance-contract-versions.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { projectMembers } from '../db/schema/project-members.js';
import { projects } from '../db/schema/projects.js';
import { teamProjectPlanningEvents } from '../db/schema/team-project-planning-events.js';
import { teamWorkItemAssignments } from '../db/schema/team-work-item-assignments.js';
import { teamWorkItemEvents } from '../db/schema/team-work-item-events.js';
import { teamWorkItems } from '../db/schema/team-work-items.js';
import { users } from '../db/schema/users.js';
import type { OrganizationRole, ProjectRole } from '../organizations/organization-permissions.js';
import { type AcceptanceContractInput, validateAcceptanceContract } from './acceptance-contract.js';
import { isTeamTaskLifecycleEnabledFor } from './team-task-access.js';
import { decideTeamTaskPermission } from './team-task-permissions.js';
import { type TeamTaskState, transitionTeamTask } from './team-task-state-machine.js';

export type TeamTaskServiceErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INVALID_INPUT'
  | 'VERSION_CONFLICT';

export class TeamTaskServiceError extends Error {
  constructor(public readonly code: TeamTaskServiceErrorCode) {
    super(code);
    this.name = 'TeamTaskServiceError';
  }
}

export type TeamTaskAssignmentMode = 'direct' | 'first_come' | 'leader_select';
export type TeamTaskAssignmentRole = 'responsible' | 'collaborator';
export type TeamTaskAssignmentStatus = 'offered' | 'applied' | 'accepted' | 'declined' | 'removed';

export interface TeamTaskProjectAccessSnapshot {
  actorUserId: number;
  actorExternalId: string;
  actorOrganizationRole: OrganizationRole;
  actorOrganizationMembershipActive: boolean;
  actorProjectRole: ProjectRole;
  actorProjectMembershipActive: boolean;
  organizationId: number;
  organizationExternalId: string;
  organizationActive: boolean;
  organizationTeamProjectsEnabled: boolean;
  projectId: number;
  projectExternalId: string;
  projectOrganizationId: number | null;
}

export interface TeamTaskMemberSnapshot {
  organizationId: number;
  projectId: number;
  userId: number;
  userExternalId: string;
  organizationMemberExternalId: string;
  organizationMembershipActive: boolean;
  projectMembershipActive: boolean;
  projectRole: ProjectRole;
}

export interface TeamTaskOrganizationMemberSnapshot {
  organizationId: number;
  userId: number;
  userExternalId: string;
  organizationMemberExternalId: string;
  organizationMembershipActive: boolean;
}

export interface TeamTaskWorkItemRow {
  id: number;
  externalId: string;
  organizationId: number;
  organizationExternalId: string;
  projectId: number;
  projectExternalId: string;
  createdByUserId: number;
  title: string;
  description: string | null;
  assignmentMode: TeamTaskAssignmentMode;
  status: TeamTaskState;
  version: number;
  currentContractVersionId: number | null;
  dueAt: Date | null;
}

export interface TeamTaskContractRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  version: number;
  objective: string;
  deliverables: string[];
  criteria: { id: string; description: string }[];
  requiredEvidenceTypes: { type: string; description?: string }[];
  approverUserId: number;
  arbitratorUserId: number;
  dueAt: Date;
  maxRevisionRounds: number;
  versionNote: string | null;
  createdByUserId: number;
  confirmedByUserId: number | null;
  confirmedAt: Date | null;
}

export interface TeamTaskCurrentContractSnapshot {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  version: number;
  approverUserId: number;
  arbitratorUserId: number;
  confirmedByUserId: number | null;
  confirmedAt: Date | null;
}

export interface TeamTaskAssignmentRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  userId: number;
  organizationMemberExternalId: string;
  role: TeamTaskAssignmentRole;
  status: TeamTaskAssignmentStatus;
  offeredByUserId: number | null;
  respondedAt: Date | null;
}

export interface TeamTaskReceipt {
  command:
    | 'create_draft'
    | 'publish'
    | 'offer_assignment'
    | 'respond_assignment'
    | 'claim'
    | 'apply'
    | 'select_claim';
  eventId: string;
  workItemId: string;
  state: TeamTaskState;
  version: number;
  contractVersionId?: string;
  assignmentId?: string;
  assignmentStatus?: TeamTaskAssignmentStatus;
}

interface TeamTaskEventMetadata {
  requestHash: string;
  receipt: TeamTaskReceipt;
}

export interface TeamTaskEventRow {
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  actorUserId: number;
  eventType: string;
  fromState: TeamTaskState | null;
  toState: TeamTaskState | null;
  contractVersionId: number | null;
  idempotencyKey: string;
  metadata: unknown;
  occurredAt: Date;
}

type NewWorkItem = Omit<TeamTaskWorkItemRow, 'id'>;
type NewContract = Omit<TeamTaskContractRow, 'id'>;
type NewAssignment = Omit<TeamTaskAssignmentRow, 'id'>;

export interface TeamTaskTransaction {
  loadProjectAccess(
    actorExternalId: string,
    projectExternalId: string,
  ): Promise<TeamTaskProjectAccessSnapshot | null>;
  lockWorkItemAccess(
    actorExternalId: string,
    workItemExternalId: string,
  ): Promise<{ access: TeamTaskProjectAccessSnapshot; workItem: TeamTaskWorkItemRow } | null>;
  findEventByIdempotencyKey(
    organizationId: number,
    idempotencyKey: string,
  ): Promise<TeamTaskEventRow | null>;
  lockOrganizationIdempotencyScope(organizationId: number): Promise<boolean>;
  hasPlanningEventByIdempotencyKey(
    organizationId: number,
    idempotencyKey: string,
  ): Promise<boolean>;
  insertWorkItem(row: NewWorkItem): Promise<number>;
  updateWorkItem(
    workItemId: number,
    expectedVersion: number,
    update: Partial<
      Pick<TeamTaskWorkItemRow, 'status' | 'version' | 'currentContractVersionId' | 'dueAt'>
    >,
  ): Promise<boolean>;
  loadActiveMember(
    organizationId: number,
    projectId: number,
    memberExternalId: string,
  ): Promise<TeamTaskMemberSnapshot | null>;
  loadActiveOrganizationMember(
    organizationId: number,
    memberExternalId: string,
  ): Promise<TeamTaskOrganizationMemberSnapshot | null>;
  insertContract(row: NewContract): Promise<number>;
  lockCurrentContract(
    workItemId: number,
    contractVersionId: number,
  ): Promise<TeamTaskCurrentContractSnapshot | null>;
  confirmContract(
    contractId: number,
    workItemId: number,
    confirmedByUserId: number,
    confirmedAt: Date,
  ): Promise<boolean>;
  insertAssignment(row: NewAssignment): Promise<number>;
  loadAssignment(assignmentExternalId: string): Promise<TeamTaskAssignmentRow | null>;
  listAssignments(workItemId: number): Promise<TeamTaskAssignmentRow[]>;
  updateAssignment(
    assignmentId: number,
    expectedStatus: TeamTaskAssignmentStatus,
    update: Partial<Pick<TeamTaskAssignmentRow, 'status' | 'respondedAt'>>,
  ): Promise<boolean>;
  appendEvent(event: TeamTaskEventRow): Promise<void>;
}

export interface TeamTaskRepository {
  transaction<T>(work: (tx: TeamTaskTransaction) => Promise<T>): Promise<T>;
}

type IdKind =
  | 'teamWorkItem'
  | 'teamWorkItemAssignment'
  | 'acceptanceContractVersion'
  | 'teamWorkItemEvent';

export interface TeamTaskServiceDependencies {
  now: () => string;
  isLifecycleEnabled: (actorExternalId: string, organizationEnabled: boolean) => boolean;
  newId: (kind: IdKind) => string;
}

const assignmentModes = new Set<string>(['direct', 'first_come', 'leader_select']);
const assignmentRoles = new Set<string>(['responsible', 'collaborator']);
const assignmentStatuses = new Set<string>([
  'offered',
  'applied',
  'accepted',
  'declined',
  'removed',
]);
const responseTypes = new Set<string>(['accept', 'decline']);
const eventTypeByCommand: Record<TeamTaskReceipt['command'], string> = {
  create_draft: 'task_draft_created',
  publish: 'task_published',
  offer_assignment: 'assignment_offered',
  respond_assignment: 'assignment_responded',
  claim: 'task_claimed',
  apply: 'task_claim_applied',
  select_claim: 'task_claim_selected',
};

function fail(code: TeamTaskServiceErrorCode): never {
  throw new TeamTaskServiceError(code);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireString(
  value: unknown,
  maxLength: number,
  externalKind?: Parameters<typeof isExternalId>[1],
): string {
  if (typeof value !== 'string') return fail('INVALID_INPUT');
  const normalized = value.trim();
  if (normalized === '' || normalized.length > maxLength) return fail('INVALID_INPUT');
  if (externalKind && !isExternalId(normalized, externalKind)) return fail('INVALID_INPUT');
  return normalized;
}

function requireNullableString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, maxLength);
}

function requireVersion(value: unknown, create = false): number {
  if (!Number.isSafeInteger(value) || (create ? value !== 0 : (value as number) < 1)) {
    return fail('INVALID_INPUT');
  }
  return value as number;
}

function requireIdempotencyKey(value: unknown): string {
  const key = requireString(value, 64);
  if (/[^\u0021-\u007e]/u.test(key)) return fail('INVALID_INPUT');
  return key;
}

function stableJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail('INVALID_INPUT');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') return fail('INVALID_INPUT');
  if (seen.has(value)) return fail('INVALID_INPUT');
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!hasOwn(value, index)) return fail('INVALID_INPUT');
    }
    const serialized = `[${value.map((item) => stableJson(item, seen)).join(',')}]`;
    seen.delete(value);
    return serialized;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail('INVALID_INPUT');
  const record = value as Record<string, unknown>;
  const serialized = `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key], seen)}`)
    .join(',')}}`;
  seen.delete(value);
  return serialized;
}

function requestHash(command: string, value: unknown): string {
  return createHash('sha256')
    .update(`${command}:${stableJson(value)}`)
    .digest('hex');
}

function normalizeReceipt(value: unknown): TeamTaskReceipt | null {
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
    return null;
  }
  const command = value.command as TeamTaskReceipt['command'];
  const normalized: TeamTaskReceipt = {
    command,
    eventId: value.eventId,
    workItemId: value.workItemId,
    state: value.state,
    version: value.version as number,
  };
  if (value.contractVersionId !== undefined) {
    if (
      typeof value.contractVersionId !== 'string' ||
      !isExternalId(value.contractVersionId, 'acceptanceContractVersion')
    ) {
      return null;
    }
    normalized.contractVersionId = value.contractVersionId;
  }
  if (value.assignmentId !== undefined) {
    if (
      typeof value.assignmentId !== 'string' ||
      !isExternalId(value.assignmentId, 'teamWorkItemAssignment')
    ) {
      return null;
    }
    normalized.assignmentId = value.assignmentId;
  }
  if (value.assignmentStatus !== undefined) {
    if (
      typeof value.assignmentStatus !== 'string' ||
      !assignmentStatuses.has(value.assignmentStatus)
    ) {
      return null;
    }
    normalized.assignmentStatus = value.assignmentStatus as TeamTaskAssignmentStatus;
  }
  return normalized;
}

function readMetadata(value: unknown): TeamTaskEventMetadata | null {
  const receipt = isRecord(value) ? normalizeReceipt(value.receipt) : null;
  if (
    !isRecord(value) ||
    typeof value.requestHash !== 'string' ||
    value.requestHash.length !== 64 ||
    !receipt
  ) {
    return null;
  }
  return { requestHash: value.requestHash, receipt };
}

function replay(event: TeamTaskEventRow | null, expectedHash: string): TeamTaskReceipt | null {
  if (!event) return null;
  const metadata = readMetadata(event.metadata);
  if (
    !metadata ||
    metadata.requestHash !== expectedHash ||
    event.eventType !== eventTypeByCommand[metadata.receipt.command] ||
    event.toState !== metadata.receipt.state
  ) {
    return fail('CONFLICT');
  }
  return structuredClone(metadata.receipt);
}

function isDuplicateError(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.code === 'ER_DUP_ENTRY' ||
      error.errno === 1062 ||
      error.code === 'SQLITE_CONSTRAINT_UNIQUE')
  );
}

function isLockConflict(error: unknown): boolean {
  return (
    isRecord(error) && (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT')
  );
}

function assertAccess(
  access: TeamTaskProjectAccessSnapshot | null,
  actorExternalId: string,
  dependencies: TeamTaskServiceDependencies,
): TeamTaskProjectAccessSnapshot {
  if (
    !access ||
    access.actorExternalId !== actorExternalId ||
    !access.organizationActive ||
    !access.organizationTeamProjectsEnabled ||
    access.projectOrganizationId !== access.organizationId ||
    !access.actorOrganizationMembershipActive ||
    !access.actorProjectMembershipActive ||
    !dependencies.isLifecycleEnabled(actorExternalId, access.organizationTeamProjectsEnabled)
  ) {
    return fail('NOT_FOUND');
  }
  return access;
}

function permission(
  action: 'create' | 'publish' | 'assign' | 'claim',
  access: TeamTaskProjectAccessSnapshot,
): void {
  const decision = decideTeamTaskPermission(action, {
    actorOrganizationRole: access.actorOrganizationRole,
    actorOrganizationMembershipActive: access.actorOrganizationMembershipActive,
    actorProjectRole: access.actorProjectRole,
    actorProjectMembershipActive: access.actorProjectMembershipActive,
    actorIsCreator: false,
    actorIsResponsible: false,
    actorIsLatestReviewer: false,
    actorIsDesignatedApprover: false,
    actorIsDesignatedIndependentArbitrator: false,
  });
  if (!decision.allowed) fail('FORBIDDEN');
}

function requireMember(
  member: TeamTaskMemberSnapshot | null,
  organizationId: number,
  projectId: number,
): TeamTaskMemberSnapshot {
  if (
    !member ||
    member.organizationId !== organizationId ||
    member.projectId !== projectId ||
    !member.organizationMembershipActive ||
    !member.projectMembershipActive ||
    member.projectRole === 'viewer'
  ) {
    return fail('NOT_FOUND');
  }
  return member;
}

function requireOrganizationMember(
  member: TeamTaskOrganizationMemberSnapshot | null,
  organizationId: number,
): TeamTaskOrganizationMemberSnapshot {
  if (!member || member.organizationId !== organizationId || !member.organizationMembershipActive) {
    return fail('NOT_FOUND');
  }
  return member;
}

function ensureVersion(workItem: TeamTaskWorkItemRow, expectedVersion: number): void {
  if (workItem.version !== expectedVersion) fail('VERSION_CONFLICT');
}

async function lockInitialContract(
  tx: TeamTaskTransaction,
  workItem: TeamTaskWorkItemRow,
): Promise<TeamTaskCurrentContractSnapshot> {
  if (workItem.currentContractVersionId === null) return fail('CONFLICT');
  const contract = await tx.lockCurrentContract(workItem.id, workItem.currentContractVersionId);
  if (
    !contract ||
    contract.id !== workItem.currentContractVersionId ||
    contract.workItemId !== workItem.id ||
    contract.organizationId !== workItem.organizationId ||
    contract.projectId !== workItem.projectId
  ) {
    return fail('CONFLICT');
  }
  return contract;
}

async function confirmInitialContract(
  tx: TeamTaskTransaction,
  contract: TeamTaskCurrentContractSnapshot,
  responsibleUserId: number,
  confirmedAt: Date,
): Promise<void> {
  if (
    contract.version !== 1 ||
    responsibleUserId === contract.approverUserId ||
    responsibleUserId === contract.arbitratorUserId ||
    contract.confirmedByUserId !== null ||
    contract.confirmedAt !== null
  ) {
    return fail('CONFLICT');
  }
  if (
    !(await tx.confirmContract(contract.id, contract.workItemId, responsibleUserId, confirmedAt))
  ) {
    return fail('CONFLICT');
  }
}

const assignmentResponseStates = new Set<TeamTaskState>([
  'ready',
  'assigned',
  'claimable',
  'accepted_by_member',
  'in_progress',
]);

function transitionedState(
  workItem: TeamTaskWorkItemRow,
  command: Parameters<typeof transitionTeamTask>[1],
): TeamTaskState {
  const result = transitionTeamTask({ state: workItem.status, appealOpen: false }, command);
  if (!result.ok) {
    if (result.code === 'INVALID_CURRENT' || result.code === 'INVALID_COMMAND') {
      return fail('INVALID_INPUT');
    }
    return fail('CONFLICT');
  }
  return result.state;
}

function event(
  dependencies: TeamTaskServiceDependencies,
  input: {
    access: TeamTaskProjectAccessSnapshot;
    workItem: TeamTaskWorkItemRow;
    command: TeamTaskReceipt['command'];
    requestHash: string;
    receipt: TeamTaskReceipt;
    fromState: TeamTaskState | null;
    contractVersionId?: number | null;
    idempotencyKey: string;
  },
): TeamTaskEventRow {
  return {
    externalId: input.receipt.eventId,
    organizationId: input.access.organizationId,
    projectId: input.access.projectId,
    workItemId: input.workItem.id,
    actorUserId: input.access.actorUserId,
    eventType: eventTypeByCommand[input.command],
    fromState: input.fromState,
    toState: input.receipt.state,
    contractVersionId: input.contractVersionId ?? null,
    idempotencyKey: input.idempotencyKey,
    metadata: { requestHash: input.requestHash, receipt: structuredClone(input.receipt) },
    occurredAt: new Date(dependencies.now()),
  };
}

function receipt(
  dependencies: TeamTaskServiceDependencies,
  value: Omit<TeamTaskReceipt, 'eventId'>,
): TeamTaskReceipt {
  return { ...value, eventId: dependencies.newId('teamWorkItemEvent') };
}

const defaultDependencies: TeamTaskServiceDependencies = {
  now: () => new Date().toISOString(),
  isLifecycleEnabled: isTeamTaskLifecycleEnabledFor,
  newId: (kind) => newExternalId(kind),
};

export class TeamTaskService {
  constructor(
    private readonly repository: TeamTaskRepository,
    private readonly dependencies: TeamTaskServiceDependencies = defaultDependencies,
  ) {}

  private async runMutation(
    run: () => Promise<TeamTaskReceipt>,
    recover: () => Promise<TeamTaskReceipt | null>,
  ): Promise<TeamTaskReceipt> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof TeamTaskServiceError) throw error;
      if (isLockConflict(error)) return fail('CONFLICT');
      if (isDuplicateError(error)) {
        try {
          const recovered = await recover();
          if (recovered) return recovered;
          return fail('CONFLICT');
        } catch (recoveryError) {
          if (recoveryError instanceof TeamTaskServiceError) throw recoveryError;
          if (isLockConflict(recoveryError)) return fail('CONFLICT');
          throw recoveryError;
        }
      }
      throw error;
    }
  }

  async createDraft(input: unknown): Promise<TeamTaskReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const projectExternalId = requireString(input.projectExternalId, 32, 'project');
    const title = requireString(input.title, 255);
    const description = requireNullableString(input.description, 10_000);
    if (typeof input.assignmentMode !== 'string' || !assignmentModes.has(input.assignmentMode)) {
      return fail('INVALID_INPUT');
    }
    const assignmentMode = input.assignmentMode as TeamTaskAssignmentMode;
    requireVersion(input.expectedVersion, true);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('create_draft', {
      actorExternalId,
      projectExternalId,
      title,
      description,
      assignmentMode,
      expectedVersion: 0,
    });
    const execute = () =>
      this.repository.transaction(async (tx) => {
        const access = assertAccess(
          await tx.loadProjectAccess(actorExternalId, projectExternalId),
          actorExternalId,
          this.dependencies,
        );
        permission('create', access);
        if (!(await tx.lockOrganizationIdempotencyScope(access.organizationId))) {
          return fail('CONFLICT');
        }
        if (await tx.hasPlanningEventByIdempotencyKey(access.organizationId, idempotencyKey)) {
          return fail('CONFLICT');
        }
        const previous = replay(
          await tx.findEventByIdempotencyKey(access.organizationId, idempotencyKey),
          hash,
        );
        if (previous) return previous;
        const workItemExternalId = this.dependencies.newId('teamWorkItem');
        const workItemId = await tx.insertWorkItem({
          externalId: workItemExternalId,
          organizationId: access.organizationId,
          organizationExternalId: access.organizationExternalId,
          projectId: access.projectId,
          projectExternalId: access.projectExternalId,
          createdByUserId: access.actorUserId,
          title,
          description,
          assignmentMode,
          status: 'draft',
          version: 1,
          currentContractVersionId: null,
          dueAt: null,
        });
        const workItem: TeamTaskWorkItemRow = {
          id: workItemId,
          externalId: workItemExternalId,
          organizationId: access.organizationId,
          organizationExternalId: access.organizationExternalId,
          projectId: access.projectId,
          projectExternalId: access.projectExternalId,
          createdByUserId: access.actorUserId,
          title,
          description,
          assignmentMode,
          status: 'draft',
          version: 1,
          currentContractVersionId: null,
          dueAt: null,
        };
        const result = receipt(this.dependencies, {
          command: 'create_draft',
          workItemId: workItemExternalId,
          state: 'draft',
          version: 1,
        });
        await tx.appendEvent(
          event(this.dependencies, {
            access,
            workItem,
            command: 'create_draft',
            requestHash: hash,
            receipt: result,
            fromState: null,
            idempotencyKey,
          }),
        );
        return result;
      });
    const recover = () =>
      this.repository.transaction(async (tx) => {
        const access = assertAccess(
          await tx.loadProjectAccess(actorExternalId, projectExternalId),
          actorExternalId,
          this.dependencies,
        );
        if (!(await tx.lockOrganizationIdempotencyScope(access.organizationId))) {
          return fail('CONFLICT');
        }
        if (await tx.hasPlanningEventByIdempotencyKey(access.organizationId, idempotencyKey)) {
          return fail('CONFLICT');
        }
        return replay(
          await tx.findEventByIdempotencyKey(access.organizationId, idempotencyKey),
          hash,
        );
      });
    return this.runMutation(execute, recover);
  }

  async publish(input: unknown): Promise<TeamTaskReceipt> {
    if (!isRecord(input) || !hasOwn(input, 'contract')) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const workItemExternalId = requireString(input.workItemExternalId, 32, 'teamWorkItem');
    const expectedVersion = requireVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('publish', {
      actorExternalId,
      workItemExternalId,
      expectedVersion,
      contract: input.contract,
    });
    return this.withWorkItemMutation(
      actorExternalId,
      workItemExternalId,
      idempotencyKey,
      hash,
      async (tx, access, workItem) => {
        const validated = validateAcceptanceContract(input.contract as AcceptanceContractInput, {
          now: this.dependencies.now(),
        });
        if (!validated.ok) return fail('INVALID_INPUT');
        if (validated.contract.responsiblePersonId !== undefined) return fail('INVALID_INPUT');
        permission('publish', access);
        ensureVersion(workItem, expectedVersion);
        let state = transitionedState(workItem, { type: 'publish' });
        if (workItem.assignmentMode !== 'direct') {
          state = transitionedState({ ...workItem, status: state }, { type: 'make_claimable' });
        }
        const approver = requireMember(
          await tx.loadActiveMember(
            access.organizationId,
            access.projectId,
            validated.contract.approverId,
          ),
          access.organizationId,
          access.projectId,
        );
        const arbitrator = requireOrganizationMember(
          await tx.loadActiveOrganizationMember(
            access.organizationId,
            validated.contract.arbitratorId,
          ),
          access.organizationId,
        );
        const contractExternalId = this.dependencies.newId('acceptanceContractVersion');
        const dueAt = new Date(validated.contract.dueAt);
        const contractVersionId = await tx.insertContract({
          externalId: contractExternalId,
          organizationId: access.organizationId,
          projectId: access.projectId,
          workItemId: workItem.id,
          version: 1,
          objective: validated.contract.objective,
          deliverables: validated.contract.deliverables,
          criteria: validated.contract.criteria,
          requiredEvidenceTypes: validated.contract.requiredEvidenceTypes,
          approverUserId: approver.userId,
          arbitratorUserId: arbitrator.userId,
          dueAt,
          maxRevisionRounds: validated.contract.maxRevisionRounds,
          versionNote: null,
          createdByUserId: access.actorUserId,
          confirmedByUserId: null,
          confirmedAt: null,
        });
        const version = workItem.version + 1;
        if (
          !(await tx.updateWorkItem(workItem.id, workItem.version, {
            status: state,
            version,
            currentContractVersionId: contractVersionId,
            dueAt,
          }))
        ) {
          return fail('VERSION_CONFLICT');
        }
        const result = receipt(this.dependencies, {
          command: 'publish',
          workItemId: workItem.externalId,
          state,
          version,
          contractVersionId: contractExternalId,
        });
        await tx.appendEvent(
          event(this.dependencies, {
            access,
            workItem,
            command: 'publish',
            requestHash: hash,
            receipt: result,
            fromState: workItem.status,
            contractVersionId,
            idempotencyKey,
          }),
        );
        return result;
      },
    );
  }

  async offerAssignment(input: unknown): Promise<TeamTaskReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const workItemExternalId = requireString(input.workItemExternalId, 32, 'teamWorkItem');
    const targetMemberExternalId = requireString(
      input.targetMemberExternalId,
      32,
      'organizationMember',
    );
    if (typeof input.role !== 'string' || !assignmentRoles.has(input.role)) {
      return fail('INVALID_INPUT');
    }
    const role = input.role as TeamTaskAssignmentRole;
    const expectedVersion = requireVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('offer_assignment', {
      actorExternalId,
      workItemExternalId,
      targetMemberExternalId,
      role,
      expectedVersion,
    });
    return this.withWorkItemMutation(
      actorExternalId,
      workItemExternalId,
      idempotencyKey,
      hash,
      async (tx, access, workItem) => {
        permission('assign', access);
        ensureVersion(workItem, expectedVersion);
        if (role === 'responsible' && workItem.assignmentMode !== 'direct') return fail('CONFLICT');
        const member = requireMember(
          await tx.loadActiveMember(
            access.organizationId,
            access.projectId,
            targetMemberExternalId,
          ),
          access.organizationId,
          access.projectId,
        );
        const assignments = await tx.listAssignments(workItem.id);
        if (
          assignments.some(
            (assignment) =>
              assignment.userId === member.userId &&
              assignment.role === role &&
              (assignment.status === 'offered' ||
                assignment.status === 'applied' ||
                assignment.status === 'accepted'),
          ) ||
          (role === 'responsible' &&
            assignments.some(
              (assignment) =>
                assignment.role === 'responsible' &&
                (assignment.status === 'offered' || assignment.status === 'accepted'),
            ))
        ) {
          return fail('CONFLICT');
        }
        let state = workItem.status;
        if (role === 'responsible') {
          if (state === 'ready') state = transitionedState(workItem, { type: 'assign' });
          else if (state !== 'assigned') return fail('CONFLICT');
        } else if (
          !['ready', 'assigned', 'claimable', 'accepted_by_member', 'in_progress'].includes(state)
        ) {
          return fail('CONFLICT');
        }
        const assignmentExternalId = this.dependencies.newId('teamWorkItemAssignment');
        await tx.insertAssignment({
          externalId: assignmentExternalId,
          organizationId: access.organizationId,
          projectId: access.projectId,
          workItemId: workItem.id,
          userId: member.userId,
          organizationMemberExternalId: member.organizationMemberExternalId,
          role,
          status: 'offered',
          offeredByUserId: access.actorUserId,
          respondedAt: null,
        });
        const version = workItem.version + 1;
        if (!(await tx.updateWorkItem(workItem.id, workItem.version, { status: state, version }))) {
          return fail('VERSION_CONFLICT');
        }
        const result = receipt(this.dependencies, {
          command: 'offer_assignment',
          workItemId: workItem.externalId,
          state,
          version,
          assignmentId: assignmentExternalId,
          assignmentStatus: 'offered',
        });
        await tx.appendEvent(
          event(this.dependencies, {
            access,
            workItem,
            command: 'offer_assignment',
            requestHash: hash,
            receipt: result,
            fromState: workItem.status,
            idempotencyKey,
          }),
        );
        return result;
      },
    );
  }

  async respondToAssignment(input: unknown): Promise<TeamTaskReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const workItemExternalId = requireString(input.workItemExternalId, 32, 'teamWorkItem');
    const assignmentExternalId = requireString(
      input.assignmentExternalId,
      32,
      'teamWorkItemAssignment',
    );
    if (typeof input.response !== 'string' || !responseTypes.has(input.response)) {
      return fail('INVALID_INPUT');
    }
    const response = input.response as 'accept' | 'decline';
    const expectedVersion = requireVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('respond_assignment', {
      actorExternalId,
      workItemExternalId,
      assignmentExternalId,
      response,
      expectedVersion,
    });
    return this.withWorkItemMutation(
      actorExternalId,
      workItemExternalId,
      idempotencyKey,
      hash,
      async (tx, access, workItem) => {
        permission('claim', access);
        ensureVersion(workItem, expectedVersion);
        if (!assignmentResponseStates.has(workItem.status)) return fail('CONFLICT');
        const currentContract = await lockInitialContract(tx, workItem);
        const assignment = await tx.loadAssignment(assignmentExternalId);
        if (
          !assignment ||
          assignment.workItemId !== workItem.id ||
          assignment.status !== 'offered'
        ) {
          return fail('NOT_FOUND');
        }
        if (assignment.userId !== access.actorUserId) return fail('FORBIDDEN');
        const member = requireMember(
          await tx.loadActiveMember(
            access.organizationId,
            access.projectId,
            assignment.organizationMemberExternalId,
          ),
          access.organizationId,
          access.projectId,
        );
        if (member.userId !== access.actorUserId) return fail('FORBIDDEN');
        if (assignment.role === 'responsible' && workItem.status !== 'assigned') {
          return fail('CONFLICT');
        }
        let state = workItem.status;
        const status: TeamTaskAssignmentStatus = response === 'accept' ? 'accepted' : 'declined';
        const respondedAt = new Date(this.dependencies.now());
        if (response === 'accept' && assignment.role === 'responsible') {
          const assignments = await tx.listAssignments(workItem.id);
          if (
            assignments.some(
              (candidate) =>
                candidate.id !== assignment.id &&
                candidate.role === 'responsible' &&
                candidate.status === 'accepted',
            )
          ) {
            return fail('CONFLICT');
          }
          await confirmInitialContract(tx, currentContract, member.userId, respondedAt);
          state = transitionedState(workItem, { type: 'accept_assignment' });
        }
        if (
          !(await tx.updateAssignment(assignment.id, 'offered', {
            status,
            respondedAt,
          }))
        ) {
          return fail('CONFLICT');
        }
        const version = workItem.version + 1;
        if (!(await tx.updateWorkItem(workItem.id, workItem.version, { status: state, version }))) {
          return fail('VERSION_CONFLICT');
        }
        const result = receipt(this.dependencies, {
          command: 'respond_assignment',
          workItemId: workItem.externalId,
          state,
          version,
          assignmentId: assignment.externalId,
          assignmentStatus: status,
        });
        await tx.appendEvent(
          event(this.dependencies, {
            access,
            workItem,
            command: 'respond_assignment',
            requestHash: hash,
            receipt: result,
            fromState: workItem.status,
            idempotencyKey,
          }),
        );
        return result;
      },
    );
  }

  async claim(input: unknown): Promise<TeamTaskReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const workItemExternalId = requireString(input.workItemExternalId, 32, 'teamWorkItem');
    const memberExternalId = requireString(input.memberExternalId, 32, 'organizationMember');
    const expectedVersion = requireVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('claim', {
      actorExternalId,
      workItemExternalId,
      memberExternalId,
      expectedVersion,
    });
    return this.withWorkItemMutation(
      actorExternalId,
      workItemExternalId,
      idempotencyKey,
      hash,
      async (tx, access, workItem) => {
        permission('claim', access);
        if (workItem.version !== expectedVersion) {
          if (workItem.assignmentMode === 'first_come' && workItem.status !== 'claimable') {
            return fail('CONFLICT');
          }
          return fail('VERSION_CONFLICT');
        }
        if (workItem.status !== 'claimable') return fail('CONFLICT');
        const currentContract = await lockInitialContract(tx, workItem);
        const member = requireMember(
          await tx.loadActiveMember(access.organizationId, access.projectId, memberExternalId),
          access.organizationId,
          access.projectId,
        );
        if (member.userId !== access.actorUserId) return fail('FORBIDDEN');
        const assignments = await tx.listAssignments(workItem.id);
        if (
          assignments.some(
            (assignment) =>
              assignment.userId === member.userId &&
              assignment.role === 'responsible' &&
              (assignment.status === 'applied' || assignment.status === 'accepted'),
          )
        ) {
          return fail('CONFLICT');
        }
        const isFirstCome = workItem.assignmentMode === 'first_come';
        if (!isFirstCome && workItem.assignmentMode !== 'leader_select') return fail('CONFLICT');
        const state = isFirstCome
          ? transitionedState(workItem, { type: 'claim' })
          : workItem.status;
        const status: TeamTaskAssignmentStatus = isFirstCome ? 'accepted' : 'applied';
        const respondedAt = isFirstCome ? new Date(this.dependencies.now()) : null;
        if (isFirstCome) {
          await confirmInitialContract(tx, currentContract, member.userId, respondedAt as Date);
        }
        const assignmentExternalId = this.dependencies.newId('teamWorkItemAssignment');
        await tx.insertAssignment({
          externalId: assignmentExternalId,
          organizationId: access.organizationId,
          projectId: access.projectId,
          workItemId: workItem.id,
          userId: member.userId,
          organizationMemberExternalId: member.organizationMemberExternalId,
          role: 'responsible',
          status,
          offeredByUserId: null,
          respondedAt,
        });
        const version = workItem.version + 1;
        if (!(await tx.updateWorkItem(workItem.id, workItem.version, { status: state, version }))) {
          return fail('VERSION_CONFLICT');
        }
        const command = isFirstCome ? 'claim' : 'apply';
        const result = receipt(this.dependencies, {
          command,
          workItemId: workItem.externalId,
          state,
          version,
          assignmentId: assignmentExternalId,
          assignmentStatus: status,
        });
        await tx.appendEvent(
          event(this.dependencies, {
            access,
            workItem,
            command,
            requestHash: hash,
            receipt: result,
            fromState: workItem.status,
            idempotencyKey,
          }),
        );
        return result;
      },
    );
  }

  async selectClaim(input: unknown): Promise<TeamTaskReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const workItemExternalId = requireString(input.workItemExternalId, 32, 'teamWorkItem');
    const assignmentExternalId = requireString(
      input.assignmentExternalId,
      32,
      'teamWorkItemAssignment',
    );
    const expectedVersion = requireVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('select_claim', {
      actorExternalId,
      workItemExternalId,
      assignmentExternalId,
      expectedVersion,
    });
    return this.withWorkItemMutation(
      actorExternalId,
      workItemExternalId,
      idempotencyKey,
      hash,
      async (tx, access, workItem) => {
        permission('assign', access);
        ensureVersion(workItem, expectedVersion);
        if (workItem.assignmentMode !== 'leader_select' || workItem.status !== 'claimable') {
          return fail('CONFLICT');
        }
        const currentContract = await lockInitialContract(tx, workItem);
        const chosen = await tx.loadAssignment(assignmentExternalId);
        if (
          !chosen ||
          chosen.workItemId !== workItem.id ||
          chosen.role !== 'responsible' ||
          chosen.status !== 'applied'
        ) {
          return fail('NOT_FOUND');
        }
        const chosenMember = requireMember(
          await tx.loadActiveMember(
            access.organizationId,
            access.projectId,
            chosen.organizationMemberExternalId,
          ),
          access.organizationId,
          access.projectId,
        );
        const assignments = await tx.listAssignments(workItem.id);
        const respondedAt = new Date(this.dependencies.now());
        await confirmInitialContract(tx, currentContract, chosenMember.userId, respondedAt);
        for (const assignment of assignments) {
          if (assignment.role !== 'responsible' || assignment.status !== 'applied') continue;
          const status = assignment.id === chosen.id ? 'accepted' : 'declined';
          if (!(await tx.updateAssignment(assignment.id, 'applied', { status, respondedAt }))) {
            return fail('CONFLICT');
          }
        }
        const state = transitionedState(workItem, { type: 'claim' });
        const version = workItem.version + 1;
        if (!(await tx.updateWorkItem(workItem.id, workItem.version, { status: state, version }))) {
          return fail('VERSION_CONFLICT');
        }
        const result = receipt(this.dependencies, {
          command: 'select_claim',
          workItemId: workItem.externalId,
          state,
          version,
          assignmentId: chosen.externalId,
          assignmentStatus: 'accepted',
        });
        await tx.appendEvent(
          event(this.dependencies, {
            access,
            workItem,
            command: 'select_claim',
            requestHash: hash,
            receipt: result,
            fromState: workItem.status,
            idempotencyKey,
          }),
        );
        return result;
      },
    );
  }

  private async withWorkItemMutation(
    actorExternalId: string,
    workItemExternalId: string,
    idempotencyKey: string,
    hash: string,
    write: (
      tx: TeamTaskTransaction,
      access: TeamTaskProjectAccessSnapshot,
      workItem: TeamTaskWorkItemRow,
    ) => Promise<TeamTaskReceipt>,
  ): Promise<TeamTaskReceipt> {
    const execute = () =>
      this.repository.transaction(async (tx) => {
        const loaded = await tx.lockWorkItemAccess(actorExternalId, workItemExternalId);
        const access = assertAccess(loaded?.access ?? null, actorExternalId, this.dependencies);
        if (
          !loaded ||
          loaded.workItem.organizationId !== access.organizationId ||
          loaded.workItem.projectId !== access.projectId
        ) {
          return fail('NOT_FOUND');
        }
        if (!(await tx.lockOrganizationIdempotencyScope(access.organizationId))) {
          return fail('CONFLICT');
        }
        if (await tx.hasPlanningEventByIdempotencyKey(access.organizationId, idempotencyKey)) {
          return fail('CONFLICT');
        }
        const previous = replay(
          await tx.findEventByIdempotencyKey(access.organizationId, idempotencyKey),
          hash,
        );
        if (previous) return previous;
        return write(tx, access, loaded.workItem);
      });
    const recover = () =>
      this.repository.transaction(async (tx) => {
        const loaded = await tx.lockWorkItemAccess(actorExternalId, workItemExternalId);
        const access = assertAccess(loaded?.access ?? null, actorExternalId, this.dependencies);
        if (!(await tx.lockOrganizationIdempotencyScope(access.organizationId))) {
          return fail('CONFLICT');
        }
        if (await tx.hasPlanningEventByIdempotencyKey(access.organizationId, idempotencyKey)) {
          return fail('CONFLICT');
        }
        return replay(
          await tx.findEventByIdempotencyKey(access.organizationId, idempotencyKey),
          hash,
        );
      });
    return this.runMutation(execute, recover);
  }
}

type DrizzleExecutor = Pick<DB, 'select' | 'insert' | 'update'>;

class DrizzleTeamTaskTransaction implements TeamTaskTransaction {
  constructor(private readonly db: DrizzleExecutor) {}

  async loadProjectAccess(actorExternalId: string, projectExternalId: string) {
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
      })
      .from(projects)
      .innerJoin(users, eq(users.externalId, actorExternalId))
      .innerJoin(organizations, eq(organizations.id, projects.organizationId))
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
      .where(eq(projects.externalId, projectExternalId))
      .for('update')
      .limit(1);
    return normalizeAccess(row, actorExternalId, projectExternalId);
  }

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
        createdByUserId: teamWorkItems.createdByUserId,
        title: teamWorkItems.title,
        description: teamWorkItems.description,
        assignmentMode: teamWorkItems.assignmentMode,
        status: teamWorkItems.status,
        version: teamWorkItems.version,
        currentContractVersionId: teamWorkItems.currentContractVersionId,
        dueAt: teamWorkItems.dueAt,
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
    const access = normalizeAccess(row, actorExternalId, row?.projectExternalId ?? '');
    if (!row || !access || row.workItemExternalId !== workItemExternalId) return null;
    if (!assignmentModes.has(row.assignmentMode) || !isTeamTaskState(row.status)) return null;
    return {
      access,
      workItem: {
        id: row.workItemId,
        externalId: row.workItemExternalId,
        organizationId: row.organizationId,
        organizationExternalId: row.organizationExternalId,
        projectId: row.projectId,
        projectExternalId: row.projectExternalId,
        createdByUserId: row.createdByUserId,
        title: row.title,
        description: row.description,
        assignmentMode: row.assignmentMode as TeamTaskAssignmentMode,
        status: row.status,
        version: row.version,
        currentContractVersionId: row.currentContractVersionId,
        dueAt: row.dueAt,
      },
    };
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
    if (!row || !isNullableTeamTaskState(row.fromState) || !isNullableTeamTaskState(row.toState)) {
      return null;
    }
    return { ...row, fromState: row.fromState, toState: row.toState };
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

  async insertWorkItem(row: NewWorkItem) {
    const result = await this.db.insert(teamWorkItems).values({
      externalId: row.externalId,
      organizationId: row.organizationId,
      projectId: row.projectId,
      createdByUserId: row.createdByUserId,
      title: row.title,
      description: row.description,
      assignmentMode: row.assignmentMode,
      status: row.status,
      version: row.version,
      currentContractVersionId: row.currentContractVersionId,
      dueAt: row.dueAt,
    });
    return readInsertId(result);
  }

  async updateWorkItem(
    workItemId: number,
    expectedVersion: number,
    update: Partial<
      Pick<TeamTaskWorkItemRow, 'status' | 'version' | 'currentContractVersionId' | 'dueAt'>
    >,
  ) {
    const result = await this.db
      .update(teamWorkItems)
      .set(update)
      .where(and(eq(teamWorkItems.id, workItemId), eq(teamWorkItems.version, expectedVersion)));
    return readAffectedRows(result) === 1;
  }

  async loadActiveMember(organizationId: number, projectId: number, memberExternalId: string) {
    const [row] = await this.db
      .select({
        organizationId: organizationMembers.organizationId,
        projectId: projectMembers.projectId,
        userId: organizationMembers.userId,
        userExternalId: users.externalId,
        organizationMemberExternalId: organizationMembers.externalId,
        organizationMemberStatus: organizationMembers.status,
        projectMemberStatus: projectMembers.status,
        projectRole: projectMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .innerJoin(
        projectMembers,
        and(eq(projectMembers.userId, users.id), eq(projectMembers.projectId, projectId)),
      )
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.externalId, memberExternalId),
        ),
      )
      .for('update')
      .limit(1);
    if (!row || !isProjectRole(row.projectRole)) return null;
    return {
      organizationId: row.organizationId,
      projectId: row.projectId,
      userId: row.userId,
      userExternalId: row.userExternalId,
      organizationMemberExternalId: row.organizationMemberExternalId,
      organizationMembershipActive: row.organizationMemberStatus === 'active',
      projectMembershipActive: row.projectMemberStatus === 'active',
      projectRole: row.projectRole,
    };
  }

  async loadActiveOrganizationMember(organizationId: number, memberExternalId: string) {
    const [row] = await this.db
      .select({
        organizationId: organizationMembers.organizationId,
        userId: organizationMembers.userId,
        userExternalId: users.externalId,
        organizationMemberExternalId: organizationMembers.externalId,
        organizationMemberStatus: organizationMembers.status,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.externalId, memberExternalId),
        ),
      )
      .for('update')
      .limit(1);
    if (!row) return null;
    return {
      organizationId: row.organizationId,
      userId: row.userId,
      userExternalId: row.userExternalId,
      organizationMemberExternalId: row.organizationMemberExternalId,
      organizationMembershipActive: row.organizationMemberStatus === 'active',
    };
  }

  async insertContract(row: NewContract) {
    const result = await this.db.insert(acceptanceContractVersions).values({
      externalId: row.externalId,
      organizationId: row.organizationId,
      projectId: row.projectId,
      workItemId: row.workItemId,
      version: row.version,
      objective: row.objective,
      deliverablesJson: row.deliverables,
      criteriaJson: row.criteria,
      requiredEvidenceTypesJson: row.requiredEvidenceTypes,
      approverUserId: row.approverUserId,
      arbitratorUserId: row.arbitratorUserId,
      dueAt: row.dueAt,
      maxRevisionRounds: row.maxRevisionRounds,
      versionNote: row.versionNote,
      createdByUserId: row.createdByUserId,
      confirmedByUserId: row.confirmedByUserId,
      confirmedAt: row.confirmedAt,
    });
    return readInsertId(result);
  }

  async lockCurrentContract(workItemId: number, contractVersionId: number) {
    const [row] = await this.db
      .select({
        id: acceptanceContractVersions.id,
        externalId: acceptanceContractVersions.externalId,
        organizationId: acceptanceContractVersions.organizationId,
        projectId: acceptanceContractVersions.projectId,
        workItemId: acceptanceContractVersions.workItemId,
        version: acceptanceContractVersions.version,
        approverUserId: acceptanceContractVersions.approverUserId,
        arbitratorUserId: acceptanceContractVersions.arbitratorUserId,
        confirmedByUserId: acceptanceContractVersions.confirmedByUserId,
        confirmedAt: acceptanceContractVersions.confirmedAt,
      })
      .from(acceptanceContractVersions)
      .where(
        and(
          eq(acceptanceContractVersions.id, contractVersionId),
          eq(acceptanceContractVersions.workItemId, workItemId),
        ),
      )
      .for('update')
      .limit(1);
    return row ?? null;
  }

  async confirmContract(
    contractId: number,
    workItemId: number,
    confirmedByUserId: number,
    confirmedAt: Date,
  ) {
    const result = await this.db
      .update(acceptanceContractVersions)
      .set({ confirmedByUserId, confirmedAt })
      .where(
        and(
          eq(acceptanceContractVersions.id, contractId),
          eq(acceptanceContractVersions.workItemId, workItemId),
          isNull(acceptanceContractVersions.confirmedByUserId),
          isNull(acceptanceContractVersions.confirmedAt),
        ),
      );
    return readAffectedRows(result) === 1;
  }

  async insertAssignment(row: NewAssignment) {
    const result = await this.db.insert(teamWorkItemAssignments).values({
      externalId: row.externalId,
      organizationId: row.organizationId,
      projectId: row.projectId,
      workItemId: row.workItemId,
      userId: row.userId,
      role: row.role,
      status: row.status,
      offeredByUserId: row.offeredByUserId,
      respondedAt: row.respondedAt,
    });
    return readInsertId(result);
  }

  async loadAssignment(assignmentExternalId: string) {
    const [row] = await this.db
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
      .where(eq(teamWorkItemAssignments.externalId, assignmentExternalId))
      .for('update')
      .limit(1);
    return normalizeAssignment(row);
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
    return rows
      .map(normalizeAssignment)
      .filter((row): row is TeamTaskAssignmentRow => row !== null);
  }

  async updateAssignment(
    assignmentId: number,
    expectedStatus: TeamTaskAssignmentStatus,
    update: Partial<Pick<TeamTaskAssignmentRow, 'status' | 'respondedAt'>>,
  ) {
    const result = await this.db
      .update(teamWorkItemAssignments)
      .set(update)
      .where(
        and(
          eq(teamWorkItemAssignments.id, assignmentId),
          eq(teamWorkItemAssignments.status, expectedStatus),
        ),
      );
    return readAffectedRows(result) === 1;
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

function isOrganizationRole(value: unknown): value is OrganizationRole {
  return value === 'owner' || value === 'admin' || value === 'manager' || value === 'member';
}

function isProjectRole(value: unknown): value is ProjectRole {
  return value === 'lead' || value === 'member' || value === 'viewer';
}

function isTeamTaskState(value: unknown): value is TeamTaskState {
  return (
    typeof value === 'string' &&
    [
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
    ].includes(value)
  );
}

function isNullableTeamTaskState(value: unknown): value is TeamTaskState | null {
  return value === null || isTeamTaskState(value);
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
  projectExternalId: string,
): TeamTaskProjectAccessSnapshot | null {
  if (
    !row ||
    row.actorExternalId !== actorExternalId ||
    row.projectExternalId !== projectExternalId ||
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

function normalizeAssignment(
  row:
    | {
        id: number;
        externalId: string;
        organizationId: number;
        projectId: number;
        workItemId: number;
        userId: number;
        organizationMemberExternalId: string;
        role: string;
        status: string;
        offeredByUserId: number | null;
        respondedAt: Date | null;
      }
    | undefined,
): TeamTaskAssignmentRow | null {
  if (
    !row ||
    !assignmentRoles.has(row.role) ||
    !['offered', 'applied', 'accepted', 'declined', 'removed'].includes(row.status)
  ) {
    return null;
  }
  return {
    ...row,
    role: row.role as TeamTaskAssignmentRole,
    status: row.status as TeamTaskAssignmentStatus,
  };
}

export class DrizzleTeamTaskRepository implements TeamTaskRepository {
  constructor(private readonly db: DB) {}

  transaction<T>(work: (tx: TeamTaskTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleTeamTaskTransaction(tx)));
  }
}

export function createTeamTaskService(db: DB): TeamTaskService {
  return new TeamTaskService(new DrizzleTeamTaskRepository(db));
}
