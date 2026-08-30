import { createHash } from 'node:crypto';
import { isExternalId, newExternalId } from '@holaday/shared-types';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import { acceptanceContractVersions } from '../db/schema/acceptance-contract-versions.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { projectMembers } from '../db/schema/project-members.js';
import { projects } from '../db/schema/projects.js';
import { teamMilestones } from '../db/schema/team-milestones.js';
import { teamProjectPlanningEvents } from '../db/schema/team-project-planning-events.js';
import { teamWorkItemAssignments } from '../db/schema/team-work-item-assignments.js';
import { teamWorkItemDependencies } from '../db/schema/team-work-item-dependencies.js';
import { teamWorkItemEvents } from '../db/schema/team-work-item-events.js';
import { teamWorkItems } from '../db/schema/team-work-items.js';
import { users } from '../db/schema/users.js';
import type { OrganizationRole, ProjectRole } from '../organizations/organization-permissions.js';
import {
  type AcceptanceContractInput,
  hasDenseArrayEntries,
  parseIsoUtcInstant,
  validateAcceptanceContract,
} from './acceptance-contract.js';
import { isTeamTaskLifecycleEnabledFor } from './team-task-access.js';
import { decideTeamTaskPermission } from './team-task-permissions.js';
import {
  type TeamTaskAssignmentRow,
  type TeamTaskEventRow,
  type TeamTaskMemberSnapshot,
  type TeamTaskOrganizationMemberSnapshot,
  type TeamTaskProjectAccessSnapshot,
  TeamTaskServiceError,
  type TeamTaskServiceErrorCode,
} from './team-task-service.js';
import {
  type TeamTaskBlockerSnapshot,
  type TeamTaskState,
  transitionTeamTask,
} from './team-task-state-machine.js';

export type TeamTaskPlanningServiceError = TeamTaskServiceError;

export type PlanningMilestoneStatus = 'open' | 'completed' | 'cancelled';

export interface PlanningMilestoneRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  createdByUserId: number;
  title: string;
  description: string | null;
  status: PlanningMilestoneStatus;
  version: number;
  sortOrder: number;
  dueAt: Date | null;
}

export interface PlanningMilestoneEventRow {
  externalId: string;
  organizationId: number;
  projectId: number;
  milestoneId: number | null;
  actorUserId: number;
  eventType: string;
  idempotencyKey: string;
  metadata: unknown;
  occurredAt: Date;
}

export interface PlanningWorkItemRow {
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
  blocker: TeamTaskBlockerSnapshot | null;
  milestoneId: number | null;
}

export interface PlanningDependencyRow {
  id: number;
  organizationId: number;
  projectId: number;
  workItemId: number;
  dependsOnWorkItemId: number;
  createdByUserId: number;
}

export interface PlanningContractRow {
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

type NewDependency = Omit<PlanningDependencyRow, 'id'>;
type NewContract = Omit<PlanningContractRow, 'id'>;
type NewMilestone = Omit<PlanningMilestoneRow, 'id'>;

export interface PlanningTransaction {
  loadProjectAccess(
    actorExternalId: string,
    projectExternalId: string,
  ): Promise<TeamTaskProjectAccessSnapshot | null>;
  lockWorkItemAccess(
    actorExternalId: string,
    workItemExternalId: string,
  ): Promise<{ access: TeamTaskProjectAccessSnapshot; workItem: PlanningWorkItemRow } | null>;
  lockWorkItemByExternalId(workItemExternalId: string): Promise<PlanningWorkItemRow | null>;
  findEventByIdempotencyKey(
    organizationId: number,
    idempotencyKey: string,
  ): Promise<TeamTaskEventRow | null>;
  lockOrganizationIdempotencyScope(organizationId: number): Promise<boolean>;
  lockMilestoneAccess(
    actorExternalId: string,
    milestoneExternalId: string,
  ): Promise<{
    access: TeamTaskProjectAccessSnapshot;
    milestone: PlanningMilestoneRow;
  } | null>;
  lockMilestoneByExternalId(milestoneExternalId: string): Promise<PlanningMilestoneRow | null>;
  findPlanningEventByIdempotencyKey(
    organizationId: number,
    idempotencyKey: string,
  ): Promise<PlanningMilestoneEventRow | null>;
  listMilestones(organizationId: number, projectId: number): Promise<PlanningMilestoneRow[]>;
  insertMilestone(row: NewMilestone): Promise<number>;
  updateMilestone(
    milestoneId: number,
    expectedVersion: number,
    update: Partial<
      Pick<
        PlanningMilestoneRow,
        'title' | 'description' | 'status' | 'version' | 'sortOrder' | 'dueAt'
      >
    >,
  ): Promise<boolean>;
  appendPlanningEvent(event: PlanningMilestoneEventRow): Promise<void>;
  listDependencies(organizationId: number, projectId: number): Promise<PlanningDependencyRow[]>;
  insertDependency(row: NewDependency): Promise<void>;
  listPrerequisites(workItemId: number): Promise<PlanningWorkItemRow[]>;
  listAssignments(workItemId: number): Promise<TeamTaskAssignmentRow[]>;
  loadActiveMember(
    organizationId: number,
    projectId: number,
    memberExternalId: string,
  ): Promise<TeamTaskMemberSnapshot | null>;
  loadActiveOrganizationMember(
    organizationId: number,
    memberExternalId: string,
  ): Promise<TeamTaskOrganizationMemberSnapshot | null>;
  lockContractById(workItemId: number, contractId: number): Promise<PlanningContractRow | null>;
  lockContractByExternalId(
    workItemId: number,
    contractExternalId: string,
  ): Promise<PlanningContractRow | null>;
  lockLatestContract(workItemId: number): Promise<PlanningContractRow | null>;
  insertContract(row: NewContract): Promise<number>;
  confirmContract(
    contractId: number,
    workItemId: number,
    userId: number,
    confirmedAt: Date,
  ): Promise<boolean>;
  hasContractDecision(workItemId: number, contractId: number): Promise<boolean>;
  updateWorkItem(
    workItemId: number,
    expectedVersion: number,
    update: Partial<
      Pick<
        PlanningWorkItemRow,
        'status' | 'version' | 'currentContractVersionId' | 'dueAt' | 'blocker' | 'milestoneId'
      >
    >,
  ): Promise<boolean>;
  appendEvent(event: TeamTaskEventRow): Promise<void>;
}

export interface PlanningRepository {
  transaction<T>(work: (tx: PlanningTransaction) => Promise<T>): Promise<T>;
}

export interface TeamTaskPlanningServiceDependencies {
  now: () => string;
  isLifecycleEnabled: (actorExternalId: string, organizationEnabled: boolean) => boolean;
  maxTraversalNodes: number;
  maxTraversalEdges: number;
  newId: (
    kind:
      | 'acceptanceContractVersion'
      | 'teamWorkItemEvent'
      | 'teamMilestone'
      | 'teamProjectPlanningEvent',
  ) => string;
}

export type PlanningReceipt =
  | {
      command: 'add_dependency';
      eventId: string;
      workItemId: string;
      state: TeamTaskState;
      version: number;
      dependsOnWorkItemId: string;
    }
  | {
      command: 'start' | 'start_with_override';
      eventId: string;
      workItemId: string;
      state: TeamTaskState;
      version: number;
      incompletePrerequisiteCount: number;
      overrideApplied: boolean;
    }
  | {
      command: 'block' | 'unblock';
      eventId: string;
      workItemId: string;
      state: TeamTaskState;
      version: number;
      blocker?: TeamTaskBlockerSnapshot;
    }
  | {
      command: 'create_contract_version' | 'confirm_contract_version' | 'reject_contract_version';
      eventId: string;
      workItemId: string;
      state: TeamTaskState;
      version: number;
      contractVersionId: string;
      contractVersion: number;
      currentContractVersionId: string;
      dueAt?: string;
      pendingLeadAction?: boolean;
    }
  | {
      command: 'assign_milestone';
      eventId: string;
      workItemId: string;
      state: TeamTaskState;
      version: number;
      milestoneId: string;
    };

export type MilestonePlanningReceipt =
  | {
      command: 'create_milestone' | 'update_milestone';
      eventId: string;
      projectId: string;
      milestoneId: string;
      milestoneVersion: number;
      title: string;
      status: PlanningMilestoneStatus;
      sortOrder: number;
    }
  | {
      command: 'reorder_milestones';
      eventId: string;
      projectId: string;
      milestones: Array<{ milestoneId: string; milestoneVersion: number; sortOrder: number }>;
    };

export type ContractPlanningReceipt = Extract<PlanningReceipt, { contractVersionId: string }>;
export type SingleMilestonePlanningReceipt = Extract<
  MilestonePlanningReceipt,
  { milestoneId: string }
>;

interface PlanningEventMetadata {
  requestHash: string;
  receipt: PlanningReceipt;
}

const defaultDependencies: TeamTaskPlanningServiceDependencies = {
  now: () => new Date().toISOString(),
  isLifecycleEnabled: isTeamTaskLifecycleEnabledFor,
  maxTraversalNodes: 500,
  maxTraversalEdges: 2_000,
  newId: (kind) => newExternalId(kind),
};

const MAX_PROJECT_MILESTONES = 100;
const DEPENDENCY_MUTABLE_STATES = new Set<TeamTaskState>([
  'draft',
  'ready',
  'assigned',
  'claimable',
  'accepted_by_member',
]);

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

function requireVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) return fail('INVALID_INPUT');
  return value as number;
}

function requireCreateVersion(value: unknown): void {
  if (value !== 0) fail('INVALID_INPUT');
}

function requireUnsignedInteger(value: unknown, maximum = 1_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    return fail('INVALID_INPUT');
  }
  return value as number;
}

function requireNullableText(value: unknown, maxLength: number): string | null {
  if (value === null) return null;
  return requireString(value, maxLength);
}

function requireNullableDate(value: unknown): Date | null {
  if (value === null) return null;
  const parsed = parseIsoUtcInstant(value);
  if (!parsed) return fail('INVALID_INPUT');
  return new Date(parsed.epochMs);
}

function requireIdempotencyKey(value: unknown): string {
  const key = requireString(value, 64);
  if (/[^\u0021-\u007e]/u.test(key)) return fail('INVALID_INPUT');
  return key;
}

function requireOptionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, maxLength);
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

function requestHash(command: string, input: unknown): string {
  return createHash('sha256')
    .update(`${command}:${stableJson(input)}`)
    .digest('hex');
}

function assertAccess(
  access: TeamTaskProjectAccessSnapshot | null,
  actorExternalId: string,
  dependencies: TeamTaskPlanningServiceDependencies,
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

function requireManagement(access: TeamTaskProjectAccessSnapshot): void {
  const decision = decideTeamTaskPermission('edit_contract', {
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

function requireResponsiblePermission(
  access: TeamTaskProjectAccessSnapshot,
  actorIsResponsible: boolean,
): void {
  const decision = decideTeamTaskPermission('submit', {
    actorOrganizationRole: access.actorOrganizationRole,
    actorOrganizationMembershipActive: access.actorOrganizationMembershipActive,
    actorProjectRole: access.actorProjectRole,
    actorProjectMembershipActive: access.actorProjectMembershipActive,
    actorIsCreator: false,
    actorIsResponsible,
    actorIsLatestReviewer: false,
    actorIsDesignatedApprover: false,
    actorIsDesignatedIndependentArbitrator: false,
  });
  if (!decision.allowed) fail('FORBIDDEN');
}

const eventTypeByCommand: Record<PlanningReceipt['command'], string> = {
  add_dependency: 'dependency_added',
  start: 'task_started',
  start_with_override: 'task_started_with_dependency_override',
  block: 'task_blocked',
  unblock: 'task_unblocked',
  create_contract_version: 'contract_version_created',
  confirm_contract_version: 'contract_version_confirmed',
  reject_contract_version: 'contract_version_rejected',
  assign_milestone: 'milestone_assigned',
};

const milestoneEventTypeByCommand: Record<MilestonePlanningReceipt['command'], string> = {
  create_milestone: 'milestone_created',
  update_milestone: 'milestone_updated',
  reorder_milestones: 'milestones_reordered',
};

function normalizeReceipt(value: unknown): PlanningReceipt | null {
  if (
    !isRecord(value) ||
    typeof value.command !== 'string' ||
    !hasOwn(eventTypeByCommand, value.command) ||
    typeof value.eventId !== 'string' ||
    !isExternalId(value.eventId, 'teamWorkItemEvent') ||
    typeof value.workItemId !== 'string' ||
    !isExternalId(value.workItemId, 'teamWorkItem') ||
    typeof value.state !== 'string' ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1
  ) {
    return null;
  }
  const base = {
    eventId: value.eventId,
    workItemId: value.workItemId,
    state: value.state as TeamTaskState,
    version: value.version as number,
  };
  if (value.command === 'add_dependency') {
    if (
      typeof value.dependsOnWorkItemId !== 'string' ||
      !isExternalId(value.dependsOnWorkItemId, 'teamWorkItem')
    ) {
      return null;
    }
    return { command: 'add_dependency', ...base, dependsOnWorkItemId: value.dependsOnWorkItemId };
  }
  if (value.command === 'start' || value.command === 'start_with_override') {
    if (
      !Number.isSafeInteger(value.incompletePrerequisiteCount) ||
      (value.incompletePrerequisiteCount as number) < 0 ||
      typeof value.overrideApplied !== 'boolean'
    ) {
      return null;
    }
    return {
      command: value.command,
      ...base,
      incompletePrerequisiteCount: value.incompletePrerequisiteCount as number,
      overrideApplied: value.overrideApplied,
    };
  }
  if (value.command === 'block' || value.command === 'unblock') {
    if (value.blocker !== undefined) {
      if (
        !isRecord(value.blocker) ||
        typeof value.blocker.responsibleParty !== 'string' ||
        typeof value.blocker.nextAction !== 'string' ||
        typeof value.blocker.reviewAt !== 'string' ||
        typeof value.blocker.affectsDueDate !== 'boolean'
      ) {
        return null;
      }
      return {
        command: value.command,
        ...base,
        blocker: {
          responsibleParty: value.blocker.responsibleParty,
          nextAction: value.blocker.nextAction,
          reviewAt: value.blocker.reviewAt,
          affectsDueDate: value.blocker.affectsDueDate,
        },
      };
    }
    return { command: value.command, ...base };
  }
  if (
    value.command === 'create_contract_version' ||
    value.command === 'confirm_contract_version' ||
    value.command === 'reject_contract_version'
  ) {
    if (
      typeof value.contractVersionId !== 'string' ||
      !isExternalId(value.contractVersionId, 'acceptanceContractVersion') ||
      !Number.isSafeInteger(value.contractVersion) ||
      (value.contractVersion as number) < 1 ||
      typeof value.currentContractVersionId !== 'string' ||
      !isExternalId(value.currentContractVersionId, 'acceptanceContractVersion') ||
      (value.dueAt !== undefined && typeof value.dueAt !== 'string') ||
      (value.pendingLeadAction !== undefined && typeof value.pendingLeadAction !== 'boolean')
    ) {
      return null;
    }
    return {
      command: value.command,
      ...base,
      contractVersionId: value.contractVersionId,
      contractVersion: value.contractVersion as number,
      currentContractVersionId: value.currentContractVersionId,
      ...(value.dueAt === undefined ? {} : { dueAt: value.dueAt }),
      ...(value.pendingLeadAction === undefined
        ? {}
        : { pendingLeadAction: value.pendingLeadAction }),
    };
  }
  if (value.command === 'assign_milestone') {
    if (
      typeof value.milestoneId !== 'string' ||
      !isExternalId(value.milestoneId, 'teamMilestone')
    ) {
      return null;
    }
    return { command: 'assign_milestone', ...base, milestoneId: value.milestoneId };
  }
  return null;
}

function normalizeMilestoneReceipt(value: unknown): MilestonePlanningReceipt | null {
  if (
    !isRecord(value) ||
    typeof value.command !== 'string' ||
    !hasOwn(milestoneEventTypeByCommand, value.command) ||
    typeof value.eventId !== 'string' ||
    !isExternalId(value.eventId, 'teamProjectPlanningEvent') ||
    typeof value.projectId !== 'string' ||
    !isExternalId(value.projectId, 'project')
  ) {
    return null;
  }
  if (value.command === 'create_milestone' || value.command === 'update_milestone') {
    if (
      typeof value.milestoneId !== 'string' ||
      !isExternalId(value.milestoneId, 'teamMilestone') ||
      !Number.isSafeInteger(value.milestoneVersion) ||
      (value.milestoneVersion as number) < 1 ||
      typeof value.title !== 'string' ||
      !['open', 'completed', 'cancelled'].includes(value.status as string) ||
      !Number.isSafeInteger(value.sortOrder) ||
      (value.sortOrder as number) < 0
    ) {
      return null;
    }
    return {
      command: value.command,
      eventId: value.eventId,
      projectId: value.projectId,
      milestoneId: value.milestoneId,
      milestoneVersion: value.milestoneVersion as number,
      title: value.title,
      status: value.status as PlanningMilestoneStatus,
      sortOrder: value.sortOrder as number,
    };
  }
  if (!Array.isArray(value.milestones) || !hasDenseArrayEntries(value.milestones)) return null;
  const milestones: Array<{ milestoneId: string; milestoneVersion: number; sortOrder: number }> =
    [];
  for (const item of value.milestones) {
    if (
      !isRecord(item) ||
      typeof item.milestoneId !== 'string' ||
      !isExternalId(item.milestoneId, 'teamMilestone') ||
      !Number.isSafeInteger(item.milestoneVersion) ||
      (item.milestoneVersion as number) < 1 ||
      !Number.isSafeInteger(item.sortOrder) ||
      (item.sortOrder as number) < 0
    ) {
      return null;
    }
    milestones.push({
      milestoneId: item.milestoneId,
      milestoneVersion: item.milestoneVersion as number,
      sortOrder: item.sortOrder as number,
    });
  }
  return {
    command: 'reorder_milestones',
    eventId: value.eventId,
    projectId: value.projectId,
    milestones,
  };
}

function replayMilestone(
  event: PlanningMilestoneEventRow | null,
  expectedHash: string,
): MilestonePlanningReceipt | null {
  if (!event) return null;
  const metadata = isRecord(event.metadata) ? event.metadata : null;
  const receipt = metadata ? normalizeMilestoneReceipt(metadata.receipt) : null;
  if (
    !metadata ||
    metadata.requestHash !== expectedHash ||
    !receipt ||
    event.eventType !== milestoneEventTypeByCommand[receipt.command]
  ) {
    fail('CONFLICT');
  }
  return structuredClone(receipt);
}

function replay(event: TeamTaskEventRow | null, expectedHash: string): PlanningReceipt | null {
  if (!event) return null;
  const metadata = isRecord(event.metadata) ? event.metadata : null;
  const receipt = metadata ? normalizeReceipt(metadata.receipt) : null;
  if (
    !metadata ||
    typeof metadata.requestHash !== 'string' ||
    metadata.requestHash !== expectedHash ||
    !receipt ||
    event.eventType !== eventTypeByCommand[receipt.command] ||
    event.toState !== receipt.state
  ) {
    fail('CONFLICT');
  }
  return structuredClone(receipt);
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

function assertDependencyGraphAllowsEdge(
  dependencies: readonly PlanningDependencyRow[],
  workItemId: number,
  dependsOnWorkItemId: number,
  limits: Pick<TeamTaskPlanningServiceDependencies, 'maxTraversalNodes' | 'maxTraversalEdges'>,
): void {
  if (
    !Number.isSafeInteger(limits.maxTraversalNodes) ||
    limits.maxTraversalNodes < 1 ||
    !Number.isSafeInteger(limits.maxTraversalEdges) ||
    limits.maxTraversalEdges < 1
  ) {
    fail('CONFLICT');
  }
  if (dependencies.length + 1 > limits.maxTraversalEdges) fail('CONFLICT');
  const nodes = new Set<number>([workItemId, dependsOnWorkItemId]);
  const outgoing = new Map<number, number[]>();
  for (const edge of dependencies) {
    nodes.add(edge.workItemId);
    nodes.add(edge.dependsOnWorkItemId);
    const targets = outgoing.get(edge.workItemId) ?? [];
    targets.push(edge.dependsOnWorkItemId);
    outgoing.set(edge.workItemId, targets);
  }
  if (nodes.size > limits.maxTraversalNodes) fail('CONFLICT');

  const seen = new Set<number>();
  const queue = [dependsOnWorkItemId];
  let visitedEdges = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    if (seen.size > limits.maxTraversalNodes) fail('CONFLICT');
    if (current === workItemId) fail('CONFLICT');
    for (const next of outgoing.get(current) ?? []) {
      visitedEdges += 1;
      if (visitedEdges > limits.maxTraversalEdges) fail('CONFLICT');
      queue.push(next);
    }
  }
}

export class TeamTaskPlanningService {
  constructor(
    private readonly repository: PlanningRepository,
    private readonly dependencies: TeamTaskPlanningServiceDependencies = defaultDependencies,
  ) {}

  private async runMutation<T>(
    run: () => Promise<T>,
    recover: () => Promise<T | null>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof TeamTaskServiceError) throw error;
      if (isLockConflict(error)) return fail('CONFLICT');
      if (!isDuplicateError(error)) throw error;
      try {
        return (await recover()) ?? fail('CONFLICT');
      } catch (recoveryError) {
        if (recoveryError instanceof TeamTaskServiceError) throw recoveryError;
        if (isLockConflict(recoveryError)) return fail('CONFLICT');
        throw recoveryError;
      }
    }
  }

  private async replayWorkItemMutation(
    tx: PlanningTransaction,
    organizationId: number,
    idempotencyKey: string,
    hash: string,
  ): Promise<PlanningReceipt | null> {
    if (!(await tx.lockOrganizationIdempotencyScope(organizationId))) return fail('CONFLICT');
    if (await tx.findPlanningEventByIdempotencyKey(organizationId, idempotencyKey)) {
      return fail('CONFLICT');
    }
    return replay(await tx.findEventByIdempotencyKey(organizationId, idempotencyKey), hash);
  }

  private async replayMilestoneMutation(
    tx: PlanningTransaction,
    organizationId: number,
    idempotencyKey: string,
    hash: string,
  ): Promise<MilestonePlanningReceipt | null> {
    if (!(await tx.lockOrganizationIdempotencyScope(organizationId))) return fail('CONFLICT');
    if (await tx.findEventByIdempotencyKey(organizationId, idempotencyKey)) {
      return fail('CONFLICT');
    }
    return replayMilestone(
      await tx.findPlanningEventByIdempotencyKey(organizationId, idempotencyKey),
      hash,
    );
  }

  private async withWorkItemMutation(
    actorExternalId: string,
    workItemExternalId: string,
    idempotencyKey: string,
    hash: string,
    write: (
      tx: PlanningTransaction,
      access: TeamTaskProjectAccessSnapshot,
      workItem: PlanningWorkItemRow,
    ) => Promise<PlanningReceipt>,
  ): Promise<PlanningReceipt> {
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
        const previous = await this.replayWorkItemMutation(
          tx,
          access.organizationId,
          idempotencyKey,
          hash,
        );
        if (previous) return previous;
        return write(tx, access, loaded.workItem);
      });
    return this.runMutation(execute, () =>
      this.repository.transaction(async (tx) => {
        const loaded = await tx.lockWorkItemAccess(actorExternalId, workItemExternalId);
        const access = assertAccess(loaded?.access ?? null, actorExternalId, this.dependencies);
        return this.replayWorkItemMutation(tx, access.organizationId, idempotencyKey, hash);
      }),
    );
  }

  private async activeResponsible(
    tx: PlanningTransaction,
    access: TeamTaskProjectAccessSnapshot,
    workItem: PlanningWorkItemRow,
  ): Promise<TeamTaskMemberSnapshot> {
    const responsible = (await tx.listAssignments(workItem.id)).filter(
      (assignment) => assignment.role === 'responsible' && assignment.status === 'accepted',
    );
    if (responsible.length !== 1) return fail('CONFLICT');
    const assignment = responsible[0];
    if (!assignment) return fail('CONFLICT');
    const member = await tx.loadActiveMember(
      access.organizationId,
      access.projectId,
      assignment.organizationMemberExternalId,
    );
    if (
      !member ||
      member.organizationId !== access.organizationId ||
      member.projectId !== access.projectId ||
      member.userId !== assignment.userId ||
      !member.organizationMembershipActive ||
      !member.projectMembershipActive ||
      member.projectRole === 'viewer'
    ) {
      return fail('NOT_FOUND');
    }
    return member;
  }

  private async appendWorkItemEvent(
    tx: PlanningTransaction,
    input: {
      access: TeamTaskProjectAccessSnapshot;
      workItem: PlanningWorkItemRow;
      receipt: PlanningReceipt;
      requestHash: string;
      idempotencyKey: string;
      fromState: TeamTaskState;
      contractVersionId?: number | null;
      extraMetadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.appendEvent({
      externalId: input.receipt.eventId,
      organizationId: input.access.organizationId,
      projectId: input.access.projectId,
      workItemId: input.workItem.id,
      actorUserId: input.access.actorUserId,
      eventType: eventTypeByCommand[input.receipt.command],
      fromState: input.fromState,
      toState: input.receipt.state,
      contractVersionId: input.contractVersionId ?? null,
      idempotencyKey: input.idempotencyKey,
      metadata: {
        requestHash: input.requestHash,
        receipt: structuredClone(input.receipt),
        ...structuredClone(input.extraMetadata ?? {}),
      },
      occurredAt: new Date(this.dependencies.now()),
    });
  }

  private async appendPlanningEvent(
    tx: PlanningTransaction,
    input: {
      access: TeamTaskProjectAccessSnapshot;
      receipt: MilestonePlanningReceipt;
      requestHash: string;
      idempotencyKey: string;
      milestoneId: number | null;
    },
  ): Promise<void> {
    await tx.appendPlanningEvent({
      externalId: input.receipt.eventId,
      organizationId: input.access.organizationId,
      projectId: input.access.projectId,
      milestoneId: input.milestoneId,
      actorUserId: input.access.actorUserId,
      eventType: milestoneEventTypeByCommand[input.receipt.command],
      idempotencyKey: input.idempotencyKey,
      metadata: {
        requestHash: input.requestHash,
        receipt: structuredClone(input.receipt),
      },
      occurredAt: new Date(this.dependencies.now()),
    });
  }

  async createMilestone(input: unknown): Promise<SingleMilestonePlanningReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const projectExternalId = requireString(input.projectExternalId, 32, 'project');
    const title = requireString(input.title, 255);
    const description =
      input.description === undefined ? null : requireNullableText(input.description, 10_000);
    const dueAt = input.dueAt === undefined ? null : requireNullableDate(input.dueAt);
    const sortOrder = requireUnsignedInteger(input.sortOrder);
    requireCreateVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('create_milestone', {
      actorExternalId,
      projectExternalId,
      title,
      description,
      dueAt: dueAt?.toISOString() ?? null,
      sortOrder,
      expectedVersion: 0,
    });
    const execute = () =>
      this.repository.transaction(async (tx) => {
        const access = assertAccess(
          await tx.loadProjectAccess(actorExternalId, projectExternalId),
          actorExternalId,
          this.dependencies,
        );
        const previous = await this.replayMilestoneMutation(
          tx,
          access.organizationId,
          idempotencyKey,
          hash,
        );
        if (previous) return previous;
        requireManagement(access);
        const milestones = await tx.listMilestones(access.organizationId, access.projectId);
        if (milestones.length >= MAX_PROJECT_MILESTONES) return fail('CONFLICT');
        const milestoneExternalId = this.dependencies.newId('teamMilestone');
        const milestoneId = await tx.insertMilestone({
          externalId: milestoneExternalId,
          organizationId: access.organizationId,
          projectId: access.projectId,
          createdByUserId: access.actorUserId,
          title,
          description,
          status: 'open',
          version: 1,
          sortOrder,
          dueAt,
        });
        const receipt: MilestonePlanningReceipt = {
          command: 'create_milestone',
          eventId: this.dependencies.newId('teamProjectPlanningEvent'),
          projectId: access.projectExternalId,
          milestoneId: milestoneExternalId,
          milestoneVersion: 1,
          title,
          status: 'open',
          sortOrder,
        };
        await this.appendPlanningEvent(tx, {
          access,
          receipt,
          requestHash: hash,
          idempotencyKey,
          milestoneId,
        });
        return receipt;
      });
    const recover = () =>
      this.repository.transaction(async (tx) => {
        const access = assertAccess(
          await tx.loadProjectAccess(actorExternalId, projectExternalId),
          actorExternalId,
          this.dependencies,
        );
        return this.replayMilestoneMutation(tx, access.organizationId, idempotencyKey, hash);
      });
    return this.runMutation(execute, recover) as Promise<SingleMilestonePlanningReceipt>;
  }

  async updateMilestone(input: unknown): Promise<SingleMilestonePlanningReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const milestoneExternalId = requireString(input.milestoneExternalId, 32, 'teamMilestone');
    const expectedVersion = requireVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const update: Partial<
      Pick<PlanningMilestoneRow, 'title' | 'description' | 'status' | 'dueAt'>
    > = {};
    if (hasOwn(input, 'title')) update.title = requireString(input.title, 255);
    if (hasOwn(input, 'description')) {
      update.description = requireNullableText(input.description, 10_000);
    }
    if (hasOwn(input, 'status')) {
      if (!['open', 'completed', 'cancelled'].includes(input.status as string)) {
        return fail('INVALID_INPUT');
      }
      update.status = input.status as PlanningMilestoneStatus;
    }
    if (hasOwn(input, 'dueAt')) update.dueAt = requireNullableDate(input.dueAt);
    if (Object.keys(update).length === 0) return fail('INVALID_INPUT');
    const hash = requestHash('update_milestone', {
      actorExternalId,
      milestoneExternalId,
      expectedVersion,
      update: {
        ...update,
        ...(hasOwn(update, 'dueAt') ? { dueAt: update.dueAt?.toISOString() ?? null } : {}),
      },
    });
    const execute = () =>
      this.repository.transaction(async (tx) => {
        const loaded = await tx.lockMilestoneAccess(actorExternalId, milestoneExternalId);
        const access = assertAccess(loaded?.access ?? null, actorExternalId, this.dependencies);
        if (
          !loaded ||
          loaded.milestone.organizationId !== access.organizationId ||
          loaded.milestone.projectId !== access.projectId
        ) {
          return fail('NOT_FOUND');
        }
        const previous = await this.replayMilestoneMutation(
          tx,
          access.organizationId,
          idempotencyKey,
          hash,
        );
        if (previous) return previous;
        requireManagement(access);
        if (loaded.milestone.version !== expectedVersion) return fail('VERSION_CONFLICT');
        const version = loaded.milestone.version + 1;
        if (
          !(await tx.updateMilestone(loaded.milestone.id, loaded.milestone.version, {
            ...update,
            version,
          }))
        ) {
          return fail('VERSION_CONFLICT');
        }
        const receipt: MilestonePlanningReceipt = {
          command: 'update_milestone',
          eventId: this.dependencies.newId('teamProjectPlanningEvent'),
          projectId: access.projectExternalId,
          milestoneId: loaded.milestone.externalId,
          milestoneVersion: version,
          title: update.title ?? loaded.milestone.title,
          status: update.status ?? loaded.milestone.status,
          sortOrder: loaded.milestone.sortOrder,
        };
        await this.appendPlanningEvent(tx, {
          access,
          receipt,
          requestHash: hash,
          idempotencyKey,
          milestoneId: loaded.milestone.id,
        });
        return receipt;
      });
    const recover = () =>
      this.repository.transaction(async (tx) => {
        const loaded = await tx.lockMilestoneAccess(actorExternalId, milestoneExternalId);
        const access = assertAccess(loaded?.access ?? null, actorExternalId, this.dependencies);
        return this.replayMilestoneMutation(tx, access.organizationId, idempotencyKey, hash);
      });
    return this.runMutation(execute, recover) as Promise<SingleMilestonePlanningReceipt>;
  }

  async reorderMilestones(input: unknown): Promise<MilestonePlanningReceipt> {
    if (!isRecord(input) || !Array.isArray(input.milestones)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const projectExternalId = requireString(input.projectExternalId, 32, 'project');
    if (
      input.milestones.length === 0 ||
      input.milestones.length > 100 ||
      !hasDenseArrayEntries(input.milestones)
    ) {
      return fail('INVALID_INPUT');
    }
    const milestones = input.milestones.map((item) => {
      if (!isRecord(item)) return fail('INVALID_INPUT');
      return {
        milestoneExternalId: requireString(item.milestoneExternalId, 32, 'teamMilestone'),
        expectedVersion: requireVersion(item.expectedVersion),
        sortOrder: requireUnsignedInteger(item.sortOrder),
      };
    });
    if (
      new Set(milestones.map((item) => item.milestoneExternalId)).size !== milestones.length ||
      new Set(milestones.map((item) => item.sortOrder)).size !== milestones.length
    ) {
      return fail('INVALID_INPUT');
    }
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('reorder_milestones', {
      actorExternalId,
      projectExternalId,
      milestones,
    });
    const execute = () =>
      this.repository.transaction(async (tx) => {
        const access = assertAccess(
          await tx.loadProjectAccess(actorExternalId, projectExternalId),
          actorExternalId,
          this.dependencies,
        );
        const previous = await this.replayMilestoneMutation(
          tx,
          access.organizationId,
          idempotencyKey,
          hash,
        );
        if (previous) return previous;
        requireManagement(access);
        const projectMilestones = await tx.listMilestones(access.organizationId, access.projectId);
        const requestedIds = [...milestones]
          .map((item) => item.milestoneExternalId)
          .sort((left, right) => left.localeCompare(right));
        const projectIds = projectMilestones
          .map((item) => item.externalId)
          .sort((left, right) => left.localeCompare(right));
        if (
          requestedIds.length !== projectIds.length ||
          requestedIds.some((id, index) => id !== projectIds[index])
        ) {
          return fail('INVALID_INPUT');
        }
        const milestoneByExternalId = new Map(
          projectMilestones.map((milestone) => [milestone.externalId, milestone]),
        );
        const locked: Array<{ input: (typeof milestones)[number]; row: PlanningMilestoneRow }> = [];
        for (const item of milestones) {
          const row = milestoneByExternalId.get(item.milestoneExternalId);
          if (!row) return fail('INVALID_INPUT');
          if (row.version !== item.expectedVersion) return fail('VERSION_CONFLICT');
          locked.push({ input: item, row });
        }
        for (const item of locked) {
          if (
            !(await tx.updateMilestone(item.row.id, item.row.version, {
              version: item.row.version + 1,
              sortOrder: item.input.sortOrder,
            }))
          ) {
            return fail('VERSION_CONFLICT');
          }
        }
        const receipt: MilestonePlanningReceipt = {
          command: 'reorder_milestones',
          eventId: this.dependencies.newId('teamProjectPlanningEvent'),
          projectId: access.projectExternalId,
          milestones: locked
            .map((item) => ({
              milestoneId: item.row.externalId,
              milestoneVersion: item.row.version + 1,
              sortOrder: item.input.sortOrder,
            }))
            .sort((left, right) => left.sortOrder - right.sortOrder),
        };
        await this.appendPlanningEvent(tx, {
          access,
          receipt,
          requestHash: hash,
          idempotencyKey,
          milestoneId: null,
        });
        return receipt;
      });
    const recover = () =>
      this.repository.transaction(async (tx) => {
        const access = assertAccess(
          await tx.loadProjectAccess(actorExternalId, projectExternalId),
          actorExternalId,
          this.dependencies,
        );
        return this.replayMilestoneMutation(tx, access.organizationId, idempotencyKey, hash);
      });
    return this.runMutation(execute, recover);
  }

  async addDependency(input: unknown): Promise<PlanningReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const workItemExternalId = requireString(input.workItemExternalId, 32, 'teamWorkItem');
    const dependsOnWorkItemExternalId = requireString(
      input.dependsOnWorkItemExternalId,
      32,
      'teamWorkItem',
    );
    const expectedVersion = requireVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('add_dependency', {
      actorExternalId,
      workItemExternalId,
      dependsOnWorkItemExternalId,
      expectedVersion,
    });

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
        const previous = await this.replayWorkItemMutation(
          tx,
          access.organizationId,
          idempotencyKey,
          hash,
        );
        if (previous) return previous;
        requireManagement(access);
        if (loaded.workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
        if (!DEPENDENCY_MUTABLE_STATES.has(loaded.workItem.status)) return fail('CONFLICT');
        const prerequisite = await tx.lockWorkItemByExternalId(dependsOnWorkItemExternalId);
        if (
          !prerequisite ||
          prerequisite.organizationId !== access.organizationId ||
          prerequisite.projectId !== access.projectId
        ) {
          return fail('NOT_FOUND');
        }
        if (prerequisite.id === loaded.workItem.id) return fail('INVALID_INPUT');
        const dependencies = await tx.listDependencies(access.organizationId, access.projectId);
        if (
          dependencies.some(
            (edge) =>
              edge.workItemId === loaded.workItem.id &&
              edge.dependsOnWorkItemId === prerequisite.id,
          )
        ) {
          return fail('CONFLICT');
        }
        assertDependencyGraphAllowsEdge(
          dependencies,
          loaded.workItem.id,
          prerequisite.id,
          this.dependencies,
        );
        await tx.insertDependency({
          organizationId: access.organizationId,
          projectId: access.projectId,
          workItemId: loaded.workItem.id,
          dependsOnWorkItemId: prerequisite.id,
          createdByUserId: access.actorUserId,
        });
        const version = loaded.workItem.version + 1;
        if (!(await tx.updateWorkItem(loaded.workItem.id, loaded.workItem.version, { version }))) {
          return fail('VERSION_CONFLICT');
        }
        const receipt: PlanningReceipt = {
          command: 'add_dependency',
          eventId: this.dependencies.newId('teamWorkItemEvent'),
          workItemId: loaded.workItem.externalId,
          dependsOnWorkItemId: prerequisite.externalId,
          state: loaded.workItem.status,
          version,
        };
        const metadata: PlanningEventMetadata = { requestHash: hash, receipt };
        await tx.appendEvent({
          externalId: receipt.eventId,
          organizationId: access.organizationId,
          projectId: access.projectId,
          workItemId: loaded.workItem.id,
          actorUserId: access.actorUserId,
          eventType: 'dependency_added',
          fromState: loaded.workItem.status,
          toState: loaded.workItem.status,
          contractVersionId: null,
          idempotencyKey,
          metadata,
          occurredAt: new Date(this.dependencies.now()),
        });
        return receipt;
      });
    return this.runMutation(execute, () =>
      this.repository.transaction(async (tx) => {
        const loaded = await tx.lockWorkItemAccess(actorExternalId, workItemExternalId);
        const access = assertAccess(loaded?.access ?? null, actorExternalId, this.dependencies);
        return this.replayWorkItemMutation(tx, access.organizationId, idempotencyKey, hash);
      }),
    );
  }

  async assignMilestone(input: unknown): Promise<PlanningReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const workItemExternalId = requireString(input.workItemExternalId, 32, 'teamWorkItem');
    const milestoneExternalId = requireString(input.milestoneExternalId, 32, 'teamMilestone');
    const expectedVersion = requireVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('assign_milestone', {
      actorExternalId,
      workItemExternalId,
      milestoneExternalId,
      expectedVersion,
    });
    return this.withWorkItemMutation(
      actorExternalId,
      workItemExternalId,
      idempotencyKey,
      hash,
      async (tx, access, workItem) => {
        requireManagement(access);
        if (workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
        const milestone = await tx.lockMilestoneByExternalId(milestoneExternalId);
        if (
          !milestone ||
          milestone.organizationId !== access.organizationId ||
          milestone.projectId !== access.projectId
        ) {
          return fail('NOT_FOUND');
        }
        const version = workItem.version + 1;
        if (
          !(await tx.updateWorkItem(workItem.id, workItem.version, {
            version,
            milestoneId: milestone.id,
          }))
        ) {
          return fail('VERSION_CONFLICT');
        }
        const receipt: PlanningReceipt = {
          command: 'assign_milestone',
          eventId: this.dependencies.newId('teamWorkItemEvent'),
          workItemId: workItem.externalId,
          state: workItem.status,
          version,
          milestoneId: milestone.externalId,
        };
        await this.appendWorkItemEvent(tx, {
          access,
          workItem,
          receipt,
          requestHash: hash,
          idempotencyKey,
          fromState: workItem.status,
        });
        return receipt;
      },
    );
  }

  async start(input: unknown): Promise<PlanningReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const workItemExternalId = requireString(input.workItemExternalId, 32, 'teamWorkItem');
    const expectedVersion = requireVersion(input.expectedVersion);
    const overrideReason = requireOptionalString(input.overrideReason, 1_000);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('start', {
      actorExternalId,
      workItemExternalId,
      expectedVersion,
      overrideReason: overrideReason ?? null,
    });
    return this.withWorkItemMutation(
      actorExternalId,
      workItemExternalId,
      idempotencyKey,
      hash,
      async (tx, access, workItem) => {
        if (workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
        const prerequisites = await tx.listPrerequisites(workItem.id);
        if (
          prerequisites.some(
            (item) =>
              item.organizationId !== access.organizationId || item.projectId !== access.projectId,
          )
        ) {
          return fail('CONFLICT');
        }
        const incomplete = prerequisites.filter((item) => item.status !== 'completed');
        const responsible = await this.activeResponsible(tx, access, workItem);
        let command: Extract<
          PlanningReceipt,
          { command: 'start' | 'start_with_override' }
        >['command'];
        if (overrideReason !== undefined) {
          if (incomplete.length === 0) return fail('INVALID_INPUT');
          requireManagement(access);
          command = 'start_with_override';
        } else {
          if (incomplete.length > 0) return fail('CONFLICT');
          requireResponsiblePermission(access, responsible.userId === access.actorUserId);
          command = 'start';
        }
        const transition = transitionTeamTask(
          { state: workItem.status, appealOpen: false },
          { type: 'start' },
        );
        if (!transition.ok) return fail('CONFLICT');
        const version = workItem.version + 1;
        if (
          !(await tx.updateWorkItem(workItem.id, workItem.version, {
            status: transition.state,
            version,
          }))
        ) {
          return fail('VERSION_CONFLICT');
        }
        const receipt: PlanningReceipt = {
          command,
          eventId: this.dependencies.newId('teamWorkItemEvent'),
          workItemId: workItem.externalId,
          state: transition.state,
          version,
          incompletePrerequisiteCount: incomplete.length,
          overrideApplied: command === 'start_with_override',
        };
        await this.appendWorkItemEvent(tx, {
          access,
          workItem,
          receipt,
          requestHash: hash,
          idempotencyKey,
          fromState: workItem.status,
          ...(overrideReason === undefined ? {} : { extraMetadata: { overrideReason } }),
        });
        return receipt;
      },
    );
  }

  async block(input: unknown): Promise<PlanningReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const workItemExternalId = requireString(input.workItemExternalId, 32, 'teamWorkItem');
    const expectedVersion = requireVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('block', {
      actorExternalId,
      workItemExternalId,
      responsibleParty: input.responsibleParty,
      nextAction: input.nextAction,
      reviewAt: input.reviewAt,
      affectsDueDate: input.affectsDueDate,
      expectedVersion,
    });
    return this.withWorkItemMutation(
      actorExternalId,
      workItemExternalId,
      idempotencyKey,
      hash,
      async (tx, access, workItem) => {
        if (workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
        const responsible = await this.activeResponsible(tx, access, workItem);
        requireResponsiblePermission(access, responsible.userId === access.actorUserId);
        const transition = transitionTeamTask(
          { state: workItem.status, appealOpen: false },
          {
            type: 'block',
            responsibleParty: input.responsibleParty as string,
            nextAction: input.nextAction as string,
            reviewAt: input.reviewAt as string,
            affectsDueDate: input.affectsDueDate as boolean,
            now: this.dependencies.now(),
          },
        );
        if (!transition.ok) {
          return transition.code === 'INVALID_TRANSITION'
            ? fail('CONFLICT')
            : fail('INVALID_INPUT');
        }
        if (!transition.blocker) return fail('INVALID_INPUT');
        const version = workItem.version + 1;
        if (
          !(await tx.updateWorkItem(workItem.id, workItem.version, {
            status: transition.state,
            version,
            blocker: transition.blocker,
          }))
        ) {
          return fail('VERSION_CONFLICT');
        }
        const receipt: PlanningReceipt = {
          command: 'block',
          eventId: this.dependencies.newId('teamWorkItemEvent'),
          workItemId: workItem.externalId,
          state: transition.state,
          version,
          blocker: transition.blocker,
        };
        await this.appendWorkItemEvent(tx, {
          access,
          workItem,
          receipt,
          requestHash: hash,
          idempotencyKey,
          fromState: workItem.status,
          extraMetadata: {
            blocker: transition.blocker,
            executorAccountableForDelay: false,
          },
        });
        return receipt;
      },
    );
  }

  async unblock(input: unknown): Promise<PlanningReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const workItemExternalId = requireString(input.workItemExternalId, 32, 'teamWorkItem');
    const expectedVersion = requireVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('unblock', { actorExternalId, workItemExternalId, expectedVersion });
    return this.withWorkItemMutation(
      actorExternalId,
      workItemExternalId,
      idempotencyKey,
      hash,
      async (tx, access, workItem) => {
        if (workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
        const responsible = await this.activeResponsible(tx, access, workItem);
        requireResponsiblePermission(access, responsible.userId === access.actorUserId);
        const transition = transitionTeamTask(
          { state: workItem.status, appealOpen: false },
          { type: 'unblock' },
        );
        if (!transition.ok) return fail('CONFLICT');
        const version = workItem.version + 1;
        if (
          !(await tx.updateWorkItem(workItem.id, workItem.version, {
            status: transition.state,
            version,
            blocker: null,
          }))
        ) {
          return fail('VERSION_CONFLICT');
        }
        const receipt: PlanningReceipt = {
          command: 'unblock',
          eventId: this.dependencies.newId('teamWorkItemEvent'),
          workItemId: workItem.externalId,
          state: transition.state,
          version,
        };
        await this.appendWorkItemEvent(tx, {
          access,
          workItem,
          receipt,
          requestHash: hash,
          idempotencyKey,
          fromState: workItem.status,
        });
        return receipt;
      },
    );
  }

  async createContractVersion(input: unknown): Promise<ContractPlanningReceipt> {
    if (!isRecord(input) || !hasOwn(input, 'contract')) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const workItemExternalId = requireString(input.workItemExternalId, 32, 'teamWorkItem');
    const versionNote = requireString(input.versionNote, 1_000);
    const expectedVersion = requireVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash('create_contract_version', {
      actorExternalId,
      workItemExternalId,
      contract: input.contract,
      versionNote,
      expectedVersion,
    });
    return this.withWorkItemMutation(
      actorExternalId,
      workItemExternalId,
      idempotencyKey,
      hash,
      async (tx, access, workItem) => {
        requireManagement(access);
        if (workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
        if (!['accepted_by_member', 'in_progress', 'blocked'].includes(workItem.status)) {
          return fail('CONFLICT');
        }
        const responsible = await this.activeResponsible(tx, access, workItem);
        const validated = validateAcceptanceContract(input.contract as AcceptanceContractInput, {
          now: this.dependencies.now(),
        });
        if (!validated.ok || validated.contract.responsiblePersonId !== undefined) {
          return fail('INVALID_INPUT');
        }
        const approver = await tx.loadActiveMember(
          access.organizationId,
          access.projectId,
          validated.contract.approverId,
        );
        if (
          !approver ||
          approver.organizationId !== access.organizationId ||
          approver.projectId !== access.projectId ||
          !approver.organizationMembershipActive ||
          !approver.projectMembershipActive ||
          approver.projectRole === 'viewer'
        ) {
          return fail('NOT_FOUND');
        }
        const arbitrator = await tx.loadActiveOrganizationMember(
          access.organizationId,
          validated.contract.arbitratorId,
        );
        if (
          !arbitrator ||
          arbitrator.organizationId !== access.organizationId ||
          !arbitrator.organizationMembershipActive
        ) {
          return fail('NOT_FOUND');
        }
        if (approver.userId === responsible.userId || arbitrator.userId === responsible.userId) {
          return fail('CONFLICT');
        }
        if (workItem.currentContractVersionId === null) return fail('CONFLICT');
        const current = await tx.lockContractById(workItem.id, workItem.currentContractVersionId);
        if (
          !current ||
          current.organizationId !== access.organizationId ||
          current.projectId !== access.projectId ||
          current.workItemId !== workItem.id ||
          current.confirmedByUserId !== responsible.userId ||
          current.confirmedAt === null
        ) {
          return fail('CONFLICT');
        }
        const latest = await tx.lockLatestContract(workItem.id);
        if (
          !latest ||
          latest.organizationId !== access.organizationId ||
          latest.projectId !== access.projectId ||
          latest.version < current.version
        ) {
          return fail('CONFLICT');
        }
        if (latest.id !== current.id && !(await tx.hasContractDecision(workItem.id, latest.id))) {
          return fail('CONFLICT');
        }
        const contractExternalId = this.dependencies.newId('acceptanceContractVersion');
        const contractVersion = latest.version + 1;
        const contractId = await tx.insertContract({
          externalId: contractExternalId,
          organizationId: access.organizationId,
          projectId: access.projectId,
          workItemId: workItem.id,
          version: contractVersion,
          objective: validated.contract.objective,
          deliverables: validated.contract.deliverables,
          criteria: validated.contract.criteria,
          requiredEvidenceTypes: validated.contract.requiredEvidenceTypes,
          approverUserId: approver.userId,
          arbitratorUserId: arbitrator.userId,
          dueAt: new Date(validated.contract.dueAt),
          maxRevisionRounds: validated.contract.maxRevisionRounds,
          versionNote,
          createdByUserId: access.actorUserId,
          confirmedByUserId: null,
          confirmedAt: null,
        });
        const version = workItem.version + 1;
        if (!(await tx.updateWorkItem(workItem.id, workItem.version, { version }))) {
          return fail('VERSION_CONFLICT');
        }
        const receipt: PlanningReceipt = {
          command: 'create_contract_version',
          eventId: this.dependencies.newId('teamWorkItemEvent'),
          workItemId: workItem.externalId,
          state: workItem.status,
          version,
          contractVersionId: contractExternalId,
          contractVersion,
          currentContractVersionId: current.externalId,
        };
        await this.appendWorkItemEvent(tx, {
          access,
          workItem,
          receipt,
          requestHash: hash,
          idempotencyKey,
          fromState: workItem.status,
          contractVersionId: contractId,
        });
        return receipt;
      },
    ) as Promise<ContractPlanningReceipt>;
  }

  async confirmContractVersion(input: unknown): Promise<ContractPlanningReceipt> {
    return this.decideContractVersion(input, 'confirm_contract_version');
  }

  async rejectContractVersion(input: unknown): Promise<ContractPlanningReceipt> {
    return this.decideContractVersion(input, 'reject_contract_version');
  }

  private async decideContractVersion(
    input: unknown,
    command: 'confirm_contract_version' | 'reject_contract_version',
  ): Promise<ContractPlanningReceipt> {
    if (!isRecord(input)) return fail('INVALID_INPUT');
    const actorExternalId = requireString(input.actorExternalId, 32, 'user');
    const workItemExternalId = requireString(input.workItemExternalId, 32, 'teamWorkItem');
    const contractVersionExternalId = requireString(
      input.contractVersionExternalId,
      32,
      'acceptanceContractVersion',
    );
    const rejectionReason =
      command === 'reject_contract_version'
        ? requireString(input.rejectionReason, 1_000)
        : undefined;
    const expectedVersion = requireVersion(input.expectedVersion);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const hash = requestHash(command, {
      actorExternalId,
      workItemExternalId,
      contractVersionExternalId,
      rejectionReason: rejectionReason ?? null,
      expectedVersion,
    });
    return this.withWorkItemMutation(
      actorExternalId,
      workItemExternalId,
      idempotencyKey,
      hash,
      async (tx, access, workItem) => {
        if (workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
        const responsible = await this.activeResponsible(tx, access, workItem);
        requireResponsiblePermission(access, responsible.userId === access.actorUserId);
        if (workItem.currentContractVersionId === null) return fail('CONFLICT');
        const current = await tx.lockContractById(workItem.id, workItem.currentContractVersionId);
        const target = await tx.lockContractByExternalId(workItem.id, contractVersionExternalId);
        if (!target) return fail('NOT_FOUND');
        const latest = await tx.lockLatestContract(workItem.id);
        if (
          !current ||
          !latest ||
          current.organizationId !== access.organizationId ||
          current.projectId !== access.projectId ||
          target.organizationId !== access.organizationId ||
          target.projectId !== access.projectId ||
          latest.id !== target.id ||
          target.id === current.id ||
          target.version <= current.version ||
          target.confirmedByUserId !== null ||
          target.confirmedAt !== null ||
          current.confirmedByUserId !== responsible.userId ||
          current.confirmedAt === null ||
          (await tx.hasContractDecision(workItem.id, target.id))
        ) {
          return fail('CONFLICT');
        }
        const version = workItem.version + 1;
        let currentContractVersionId = current.externalId;
        let dueAt: string | undefined;
        if (command === 'confirm_contract_version') {
          const confirmedAt = new Date(this.dependencies.now());
          if (
            !(await tx.confirmContract(target.id, workItem.id, responsible.userId, confirmedAt))
          ) {
            return fail('CONFLICT');
          }
          if (
            !(await tx.updateWorkItem(workItem.id, workItem.version, {
              version,
              currentContractVersionId: target.id,
              dueAt: target.dueAt,
            }))
          ) {
            return fail('VERSION_CONFLICT');
          }
          currentContractVersionId = target.externalId;
          dueAt = target.dueAt.toISOString();
        } else if (!(await tx.updateWorkItem(workItem.id, workItem.version, { version }))) {
          return fail('VERSION_CONFLICT');
        }
        const receipt: PlanningReceipt = {
          command,
          eventId: this.dependencies.newId('teamWorkItemEvent'),
          workItemId: workItem.externalId,
          state: workItem.status,
          version,
          contractVersionId: target.externalId,
          contractVersion: target.version,
          currentContractVersionId,
          ...(dueAt === undefined ? {} : { dueAt }),
          ...(command === 'reject_contract_version' ? { pendingLeadAction: true } : {}),
        };
        await this.appendWorkItemEvent(tx, {
          access,
          workItem,
          receipt,
          requestHash: hash,
          idempotencyKey,
          fromState: workItem.status,
          contractVersionId: target.id,
          ...(command === 'reject_contract_version'
            ? { extraMetadata: { rejectionReason, pendingLeadAction: true } }
            : {}),
        });
        return receipt;
      },
    ) as Promise<ContractPlanningReceipt>;
  }
}

type DrizzleExecutor = Pick<DB, 'select' | 'insert' | 'update'>;

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

function isMilestoneStatus(value: unknown): value is PlanningMilestoneStatus {
  return value === 'open' || value === 'completed' || value === 'cancelled';
}

function normalizeBlocker(value: unknown): TeamTaskBlockerSnapshot | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.responsibleParty !== 'string' ||
    typeof value.nextAction !== 'string' ||
    typeof value.reviewAt !== 'string' ||
    typeof value.affectsDueDate !== 'boolean'
  ) {
    return null;
  }
  return {
    responsibleParty: value.responsibleParty,
    nextAction: value.nextAction,
    reviewAt: value.reviewAt,
    affectsDueDate: value.affectsDueDate,
  };
}

function normalizeAccessRow(
  row: Record<string, unknown> | undefined,
  actorExternalId: string,
  projectExternalId: string,
): TeamTaskProjectAccessSnapshot | null {
  if (
    !row ||
    row.actorExternalId !== actorExternalId ||
    row.projectExternalId !== projectExternalId ||
    !isOrganizationRole(row.actorOrganizationRole) ||
    !isProjectRole(row.actorProjectRole) ||
    typeof row.actorUserId !== 'number' ||
    typeof row.organizationId !== 'number' ||
    typeof row.organizationExternalId !== 'string' ||
    typeof row.organizationTeamProjectsEnabled !== 'boolean' ||
    typeof row.projectId !== 'number' ||
    (typeof row.projectOrganizationId !== 'number' && row.projectOrganizationId !== null)
  ) {
    return null;
  }
  return {
    actorUserId: row.actorUserId,
    actorExternalId,
    actorOrganizationRole: row.actorOrganizationRole,
    actorOrganizationMembershipActive: row.actorOrganizationMembershipStatus === 'active',
    actorProjectRole: row.actorProjectRole,
    actorProjectMembershipActive: row.actorProjectMembershipStatus === 'active',
    organizationId: row.organizationId,
    organizationExternalId: row.organizationExternalId,
    organizationActive: row.organizationStatus === 'active',
    organizationTeamProjectsEnabled: row.organizationTeamProjectsEnabled,
    projectId: row.projectId,
    projectExternalId,
    projectOrganizationId: row.projectOrganizationId,
  };
}

function normalizeWorkItem(row: Record<string, unknown> | undefined): PlanningWorkItemRow | null {
  const blocker = normalizeBlocker(row?.blockerJson);
  if (
    !row ||
    typeof row.id !== 'number' ||
    typeof row.externalId !== 'string' ||
    typeof row.organizationId !== 'number' ||
    typeof row.projectId !== 'number' ||
    typeof row.projectExternalId !== 'string' ||
    typeof row.createdByUserId !== 'number' ||
    !isTeamTaskState(row.status) ||
    typeof row.version !== 'number' ||
    (typeof row.currentContractVersionId !== 'number' && row.currentContractVersionId !== null) ||
    (row.dueAt !== null && !(row.dueAt instanceof Date)) ||
    (row.milestoneId !== null && typeof row.milestoneId !== 'number') ||
    (row.blockerJson !== null && blocker === null)
  ) {
    return null;
  }
  return {
    id: row.id,
    externalId: row.externalId,
    organizationId: row.organizationId,
    projectId: row.projectId,
    projectExternalId: row.projectExternalId,
    createdByUserId: row.createdByUserId,
    status: row.status,
    version: row.version,
    currentContractVersionId: row.currentContractVersionId,
    dueAt: row.dueAt,
    blocker,
    milestoneId: row.milestoneId,
  };
}

function normalizeMilestone(row: Record<string, unknown> | undefined): PlanningMilestoneRow | null {
  if (
    !row ||
    typeof row.id !== 'number' ||
    typeof row.externalId !== 'string' ||
    typeof row.organizationId !== 'number' ||
    typeof row.projectId !== 'number' ||
    typeof row.createdByUserId !== 'number' ||
    typeof row.title !== 'string' ||
    (typeof row.description !== 'string' && row.description !== null) ||
    !isMilestoneStatus(row.status) ||
    typeof row.version !== 'number' ||
    typeof row.sortOrder !== 'number' ||
    (row.dueAt !== null && !(row.dueAt instanceof Date))
  ) {
    return null;
  }
  return row as unknown as PlanningMilestoneRow;
}

class DrizzlePlanningTransaction implements PlanningTransaction {
  constructor(private readonly db: DrizzleExecutor) {}

  private accessSelection() {
    return {
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
    };
  }

  async loadProjectAccess(actorExternalId: string, projectExternalId: string) {
    const [row] = await this.db
      .select(this.accessSelection())
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
    return normalizeAccessRow(row, actorExternalId, projectExternalId);
  }

  async lockWorkItemAccess(actorExternalId: string, workItemExternalId: string) {
    const [row] = await this.db
      .select({
        ...this.accessSelection(),
        workItemId: teamWorkItems.id,
        workItemExternalId: teamWorkItems.externalId,
        workItemCreatedByUserId: teamWorkItems.createdByUserId,
        workItemStatus: teamWorkItems.status,
        workItemVersion: teamWorkItems.version,
        currentContractVersionId: teamWorkItems.currentContractVersionId,
        dueAt: teamWorkItems.dueAt,
        blockerJson: teamWorkItems.blockerJson,
        milestoneId: teamWorkItems.milestoneId,
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
    const access = normalizeAccessRow(row, actorExternalId, row?.projectExternalId ?? '');
    const workItem = normalizeWorkItem(
      row
        ? {
            id: row.workItemId,
            externalId: row.workItemExternalId,
            organizationId: row.organizationId,
            projectId: row.projectId,
            projectExternalId: row.projectExternalId,
            createdByUserId: row.workItemCreatedByUserId,
            status: row.workItemStatus,
            version: row.workItemVersion,
            currentContractVersionId: row.currentContractVersionId,
            dueAt: row.dueAt,
            blockerJson: row.blockerJson,
            milestoneId: row.milestoneId,
          }
        : undefined,
    );
    return access && workItem ? { access, workItem } : null;
  }

  async lockWorkItemByExternalId(workItemExternalId: string) {
    const [row] = await this.db
      .select({
        id: teamWorkItems.id,
        externalId: teamWorkItems.externalId,
        organizationId: teamWorkItems.organizationId,
        projectId: teamWorkItems.projectId,
        projectExternalId: projects.externalId,
        createdByUserId: teamWorkItems.createdByUserId,
        status: teamWorkItems.status,
        version: teamWorkItems.version,
        currentContractVersionId: teamWorkItems.currentContractVersionId,
        dueAt: teamWorkItems.dueAt,
        blockerJson: teamWorkItems.blockerJson,
        milestoneId: teamWorkItems.milestoneId,
      })
      .from(teamWorkItems)
      .innerJoin(projects, eq(projects.id, teamWorkItems.projectId))
      .where(eq(teamWorkItems.externalId, workItemExternalId))
      .for('update')
      .limit(1);
    return normalizeWorkItem(row);
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
      (row.fromState !== null && !isTeamTaskState(row.fromState)) ||
      (row.toState !== null && !isTeamTaskState(row.toState))
    ) {
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

  async lockMilestoneAccess(actorExternalId: string, milestoneExternalId: string) {
    const [row] = await this.db
      .select({
        ...this.accessSelection(),
        milestoneRowId: teamMilestones.id,
        milestoneExternalId: teamMilestones.externalId,
        milestoneCreatedByUserId: teamMilestones.createdByUserId,
        milestoneTitle: teamMilestones.title,
        milestoneDescription: teamMilestones.description,
        milestoneStatus: teamMilestones.status,
        milestoneVersion: teamMilestones.version,
        milestoneSortOrder: teamMilestones.sortOrder,
        milestoneDueAt: teamMilestones.dueAt,
      })
      .from(teamMilestones)
      .innerJoin(projects, eq(projects.id, teamMilestones.projectId))
      .innerJoin(organizations, eq(organizations.id, teamMilestones.organizationId))
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
      .where(eq(teamMilestones.externalId, milestoneExternalId))
      .for('update')
      .limit(1);
    const access = normalizeAccessRow(row, actorExternalId, row?.projectExternalId ?? '');
    const milestone = normalizeMilestone(
      row
        ? {
            id: row.milestoneRowId,
            externalId: row.milestoneExternalId,
            organizationId: row.organizationId,
            projectId: row.projectId,
            createdByUserId: row.milestoneCreatedByUserId,
            title: row.milestoneTitle,
            description: row.milestoneDescription,
            status: row.milestoneStatus,
            version: row.milestoneVersion,
            sortOrder: row.milestoneSortOrder,
            dueAt: row.milestoneDueAt,
          }
        : undefined,
    );
    return access && milestone ? { access, milestone } : null;
  }

  async lockMilestoneByExternalId(milestoneExternalId: string) {
    const [row] = await this.db
      .select({
        id: teamMilestones.id,
        externalId: teamMilestones.externalId,
        organizationId: teamMilestones.organizationId,
        projectId: teamMilestones.projectId,
        createdByUserId: teamMilestones.createdByUserId,
        title: teamMilestones.title,
        description: teamMilestones.description,
        status: teamMilestones.status,
        version: teamMilestones.version,
        sortOrder: teamMilestones.sortOrder,
        dueAt: teamMilestones.dueAt,
      })
      .from(teamMilestones)
      .where(eq(teamMilestones.externalId, milestoneExternalId))
      .for('update')
      .limit(1);
    return normalizeMilestone(row);
  }

  async findPlanningEventByIdempotencyKey(organizationId: number, idempotencyKey: string) {
    const [row] = await this.db
      .select({
        externalId: teamProjectPlanningEvents.externalId,
        organizationId: teamProjectPlanningEvents.organizationId,
        projectId: teamProjectPlanningEvents.projectId,
        milestoneId: teamProjectPlanningEvents.milestoneId,
        actorUserId: teamProjectPlanningEvents.actorUserId,
        eventType: teamProjectPlanningEvents.eventType,
        idempotencyKey: teamProjectPlanningEvents.idempotencyKey,
        metadata: teamProjectPlanningEvents.metadataJson,
        occurredAt: teamProjectPlanningEvents.occurredAt,
      })
      .from(teamProjectPlanningEvents)
      .where(
        and(
          eq(teamProjectPlanningEvents.organizationId, organizationId),
          eq(teamProjectPlanningEvents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async listMilestones(organizationId: number, projectId: number) {
    const rows = await this.db
      .select({
        id: teamMilestones.id,
        externalId: teamMilestones.externalId,
        organizationId: teamMilestones.organizationId,
        projectId: teamMilestones.projectId,
        createdByUserId: teamMilestones.createdByUserId,
        title: teamMilestones.title,
        description: teamMilestones.description,
        status: teamMilestones.status,
        version: teamMilestones.version,
        sortOrder: teamMilestones.sortOrder,
        dueAt: teamMilestones.dueAt,
      })
      .from(teamMilestones)
      .where(
        and(
          eq(teamMilestones.organizationId, organizationId),
          eq(teamMilestones.projectId, projectId),
        ),
      )
      .orderBy(teamMilestones.externalId)
      .for('update');
    return rows.map(normalizeMilestone).filter((row): row is PlanningMilestoneRow => row !== null);
  }

  async insertMilestone(row: NewMilestone) {
    return readInsertId(
      await this.db.insert(teamMilestones).values({
        externalId: row.externalId,
        organizationId: row.organizationId,
        projectId: row.projectId,
        createdByUserId: row.createdByUserId,
        title: row.title,
        description: row.description,
        status: row.status,
        version: row.version,
        sortOrder: row.sortOrder,
        dueAt: row.dueAt,
      }),
    );
  }

  async updateMilestone(
    milestoneId: number,
    expectedVersion: number,
    update: Partial<
      Pick<
        PlanningMilestoneRow,
        'title' | 'description' | 'status' | 'version' | 'sortOrder' | 'dueAt'
      >
    >,
  ) {
    return (
      readAffectedRows(
        await this.db
          .update(teamMilestones)
          .set(update)
          .where(
            and(eq(teamMilestones.id, milestoneId), eq(teamMilestones.version, expectedVersion)),
          ),
      ) === 1
    );
  }

  async appendPlanningEvent(row: PlanningMilestoneEventRow) {
    await this.db.insert(teamProjectPlanningEvents).values({
      externalId: row.externalId,
      organizationId: row.organizationId,
      projectId: row.projectId,
      milestoneId: row.milestoneId,
      actorUserId: row.actorUserId,
      eventType: row.eventType,
      idempotencyKey: row.idempotencyKey,
      metadataJson: row.metadata,
      occurredAt: row.occurredAt,
    });
  }

  async listDependencies(organizationId: number, projectId: number) {
    return this.db
      .select({
        id: teamWorkItemDependencies.id,
        organizationId: teamWorkItemDependencies.organizationId,
        projectId: teamWorkItemDependencies.projectId,
        workItemId: teamWorkItemDependencies.workItemId,
        dependsOnWorkItemId: teamWorkItemDependencies.dependsOnWorkItemId,
        createdByUserId: teamWorkItemDependencies.createdByUserId,
      })
      .from(teamWorkItemDependencies)
      .where(
        and(
          eq(teamWorkItemDependencies.organizationId, organizationId),
          eq(teamWorkItemDependencies.projectId, projectId),
        ),
      )
      .for('update');
  }

  async insertDependency(row: NewDependency) {
    await this.db.insert(teamWorkItemDependencies).values(row);
  }

  async listPrerequisites(workItemId: number) {
    const rows = await this.db
      .select({
        id: teamWorkItems.id,
        externalId: teamWorkItems.externalId,
        organizationId: teamWorkItems.organizationId,
        projectId: teamWorkItems.projectId,
        projectExternalId: projects.externalId,
        createdByUserId: teamWorkItems.createdByUserId,
        status: teamWorkItems.status,
        version: teamWorkItems.version,
        currentContractVersionId: teamWorkItems.currentContractVersionId,
        dueAt: teamWorkItems.dueAt,
        blockerJson: teamWorkItems.blockerJson,
        milestoneId: teamWorkItems.milestoneId,
      })
      .from(teamWorkItemDependencies)
      .innerJoin(teamWorkItems, eq(teamWorkItems.id, teamWorkItemDependencies.dependsOnWorkItemId))
      .innerJoin(projects, eq(projects.id, teamWorkItems.projectId))
      .where(eq(teamWorkItemDependencies.workItemId, workItemId))
      .for('update');
    return rows.map(normalizeWorkItem).filter((row): row is PlanningWorkItemRow => row !== null);
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
    return rows.flatMap((row) => {
      if (
        !['responsible', 'collaborator'].includes(row.role) ||
        !['offered', 'applied', 'accepted', 'declined', 'removed'].includes(row.status)
      ) {
        return [];
      }
      return [
        {
          ...row,
          role: row.role as TeamTaskAssignmentRow['role'],
          status: row.status as TeamTaskAssignmentRow['status'],
        },
      ];
    });
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
    return row
      ? {
          organizationId: row.organizationId,
          userId: row.userId,
          userExternalId: row.userExternalId,
          organizationMemberExternalId: row.organizationMemberExternalId,
          organizationMembershipActive: row.organizationMemberStatus === 'active',
        }
      : null;
  }

  private contractSelection() {
    return {
      id: acceptanceContractVersions.id,
      externalId: acceptanceContractVersions.externalId,
      organizationId: acceptanceContractVersions.organizationId,
      projectId: acceptanceContractVersions.projectId,
      workItemId: acceptanceContractVersions.workItemId,
      version: acceptanceContractVersions.version,
      objective: acceptanceContractVersions.objective,
      deliverables: acceptanceContractVersions.deliverablesJson,
      criteria: acceptanceContractVersions.criteriaJson,
      requiredEvidenceTypes: acceptanceContractVersions.requiredEvidenceTypesJson,
      approverUserId: acceptanceContractVersions.approverUserId,
      arbitratorUserId: acceptanceContractVersions.arbitratorUserId,
      dueAt: acceptanceContractVersions.dueAt,
      maxRevisionRounds: acceptanceContractVersions.maxRevisionRounds,
      versionNote: acceptanceContractVersions.versionNote,
      createdByUserId: acceptanceContractVersions.createdByUserId,
      confirmedByUserId: acceptanceContractVersions.confirmedByUserId,
      confirmedAt: acceptanceContractVersions.confirmedAt,
    };
  }

  private normalizeContract(row: Record<string, unknown> | undefined): PlanningContractRow | null {
    if (
      !row ||
      typeof row.id !== 'number' ||
      typeof row.externalId !== 'string' ||
      typeof row.organizationId !== 'number' ||
      typeof row.projectId !== 'number' ||
      typeof row.workItemId !== 'number' ||
      typeof row.version !== 'number' ||
      typeof row.objective !== 'string' ||
      !Array.isArray(row.deliverables) ||
      !Array.isArray(row.criteria) ||
      !Array.isArray(row.requiredEvidenceTypes) ||
      typeof row.approverUserId !== 'number' ||
      typeof row.arbitratorUserId !== 'number' ||
      !(row.dueAt instanceof Date) ||
      typeof row.maxRevisionRounds !== 'number' ||
      (typeof row.versionNote !== 'string' && row.versionNote !== null) ||
      typeof row.createdByUserId !== 'number' ||
      (typeof row.confirmedByUserId !== 'number' && row.confirmedByUserId !== null) ||
      (row.confirmedAt !== null && !(row.confirmedAt instanceof Date))
    ) {
      return null;
    }
    return row as unknown as PlanningContractRow;
  }

  async lockContractById(workItemId: number, contractId: number) {
    const [row] = await this.db
      .select(this.contractSelection())
      .from(acceptanceContractVersions)
      .where(
        and(
          eq(acceptanceContractVersions.workItemId, workItemId),
          eq(acceptanceContractVersions.id, contractId),
        ),
      )
      .for('update')
      .limit(1);
    return this.normalizeContract(row);
  }

  async lockContractByExternalId(workItemId: number, contractExternalId: string) {
    const [row] = await this.db
      .select(this.contractSelection())
      .from(acceptanceContractVersions)
      .where(
        and(
          eq(acceptanceContractVersions.workItemId, workItemId),
          eq(acceptanceContractVersions.externalId, contractExternalId),
        ),
      )
      .for('update')
      .limit(1);
    return this.normalizeContract(row);
  }

  async lockLatestContract(workItemId: number) {
    const [row] = await this.db
      .select(this.contractSelection())
      .from(acceptanceContractVersions)
      .where(eq(acceptanceContractVersions.workItemId, workItemId))
      .orderBy(desc(acceptanceContractVersions.version))
      .for('update')
      .limit(1);
    return this.normalizeContract(row);
  }

  async insertContract(row: NewContract) {
    return readInsertId(
      await this.db.insert(acceptanceContractVersions).values({
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
      }),
    );
  }

  async confirmContract(contractId: number, workItemId: number, userId: number, confirmedAt: Date) {
    return (
      readAffectedRows(
        await this.db
          .update(acceptanceContractVersions)
          .set({ confirmedByUserId: userId, confirmedAt })
          .where(
            and(
              eq(acceptanceContractVersions.id, contractId),
              eq(acceptanceContractVersions.workItemId, workItemId),
              isNull(acceptanceContractVersions.confirmedByUserId),
            ),
          ),
      ) === 1
    );
  }

  async hasContractDecision(workItemId: number, contractId: number) {
    const [row] = await this.db
      .select({ id: teamWorkItemEvents.id })
      .from(teamWorkItemEvents)
      .where(
        and(
          eq(teamWorkItemEvents.workItemId, workItemId),
          eq(teamWorkItemEvents.contractVersionId, contractId),
          inArray(teamWorkItemEvents.eventType, [
            'contract_version_confirmed',
            'contract_version_rejected',
          ]),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async updateWorkItem(
    workItemId: number,
    expectedVersion: number,
    update: Partial<
      Pick<
        PlanningWorkItemRow,
        'status' | 'version' | 'currentContractVersionId' | 'dueAt' | 'blocker' | 'milestoneId'
      >
    >,
  ) {
    const values: Record<string, unknown> = { ...update };
    if (hasOwn(values, 'blocker')) {
      values.blockerJson = values.blocker;
      values.blocker = undefined;
    }
    return (
      readAffectedRows(
        await this.db
          .update(teamWorkItems)
          .set(values)
          .where(and(eq(teamWorkItems.id, workItemId), eq(teamWorkItems.version, expectedVersion))),
      ) === 1
    );
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

export class DrizzlePlanningRepository implements PlanningRepository {
  constructor(private readonly db: DB) {}

  transaction<T>(work: (tx: PlanningTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzlePlanningTransaction(tx)));
  }
}

export function createTeamTaskPlanningService(db: DB): TeamTaskPlanningService {
  return new TeamTaskPlanningService(new DrizzlePlanningRepository(db));
}
