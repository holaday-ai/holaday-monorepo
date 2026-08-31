import { createHash } from 'node:crypto';
import { isExternalId, newExternalId } from '@holaday/shared-types';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { acceptanceContractVersions } from '../db/schema/acceptance-contract-versions.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { projectMembers } from '../db/schema/project-members.js';
import { projects } from '../db/schema/projects.js';
import { teamMilestones } from '../db/schema/team-milestones.js';
import { teamProjectPlanningEvents } from '../db/schema/team-project-planning-events.js';
import { teamWorkItemAppeals } from '../db/schema/team-work-item-appeals.js';
import { teamWorkItemAssignments } from '../db/schema/team-work-item-assignments.js';
import { teamWorkItemEvents } from '../db/schema/team-work-item-events.js';
import { teamWorkItemReviews } from '../db/schema/team-work-item-reviews.js';
import { teamWorkItemSubmissions } from '../db/schema/team-work-item-submissions.js';
import { teamWorkItems } from '../db/schema/team-work-items.js';
import { users } from '../db/schema/users.js';
import { isTeamTaskLifecycleEnabledFor } from './team-task-access.js';
import { hasUnresolvedTeamTaskAppeal } from './team-task-appeal-service.js';
import { decideTeamTaskPermission } from './team-task-permissions.js';
import {
  type TeamTaskAssignmentMode,
  type TeamTaskProjectAccessSnapshot,
  TeamTaskServiceError,
} from './team-task-service.js';
import { type TeamTaskState, transitionTeamTask } from './team-task-state-machine.js';

const contractApproverUsers = alias(users, 'team_task_contract_approver_users');
const contractArbitratorUsers = alias(users, 'team_task_contract_arbitrator_users');

export interface TeamTaskQueryRow {
  id: number;
  externalId: string;
  organizationId: number;
  projectId: number;
  createdByUserId: number;
  currentContractVersionId: number | null;
  title: string;
  description: string | null;
  assignmentMode: TeamTaskAssignmentMode;
  status: TeamTaskState;
  version: number;
  dueAt: Date | null;
  revisionRound: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamTaskDto {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  assignmentMode: TeamTaskAssignmentMode;
  state: TeamTaskState;
  version: number;
  dueAt: string | null;
  revisionRound: number;
  responsibleUserId: string | null;
  responsibleDisplayName: string | null;
  responsibleAssignmentId: string | null;
  responsibleAssignmentStatus: 'offered' | 'applied' | 'accepted' | null;
  myPendingAssignmentId: string | null;
  myPendingAssignmentRole: 'responsible' | 'collaborator' | null;
  myPendingAssignmentStatus: 'offered' | 'applied' | null;
  canSelectClaim: boolean;
  claimApplicants: Array<{ assignmentId: string; userId: string; displayName: string | null }>;
  collaboratorUserIds: string[];
  milestoneId: string | null;
  milestone: string | null;
  submittedOnTime: boolean | null;
  latestSubmissionId: string | null;
  latestReviewId: string | null;
  accepted: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamTaskListDisplayRow {
  workItemId: number;
  milestoneExternalId: string | null;
  milestoneTitle: string | null;
  assignments: Array<{
    assignmentExternalId: string;
    userExternalId: string;
    displayName: string | null;
    role: 'responsible' | 'collaborator';
    status: 'offered' | 'applied' | 'accepted';
  }>;
  submittedOnTime: boolean | null;
  latestSubmissionInternalId: number | null;
  latestSubmissionExternalId: string | null;
  latestReviewExternalId: string | null;
}

export interface TeamTaskDetailDisplay {
  contract: {
    version: number;
    objective: string;
    criteria: Array<{ id: string; description: string }>;
    approverUserId: string;
    arbitratorUserId: string;
  } | null;
  timeline: Array<{ eventType: string; occurredAt: Date }>;
}

export interface TeamTaskDetailDto extends TeamTaskDto {
  contract: TeamTaskDetailDisplay['contract'];
  timeline: Array<{
    kind: 'contract' | 'assignment' | 'block' | 'submission' | 'review' | 'appeal' | 'ai';
    label: string;
    at: string;
  }>;
}

export interface TeamTaskPlanningOptionsDto {
  milestones: Array<{ id: string; title: string }>;
}

export interface ArchiveReceipt {
  command: 'archive';
  eventId: string;
  workItemId: string;
  state: 'archived';
  version: number;
}

export interface ArchiveEventRow {
  externalId: string;
  organizationId: number;
  projectId: number;
  workItemId: number;
  actorUserId: number;
  eventType: 'task_archived';
  fromState: 'completed' | 'cancelled' | 'rejected_final';
  contractVersionId: number | null;
  idempotencyKey: string;
  requestHash: string;
  receipt: ArchiveReceipt;
  occurredAt: Date;
}

export interface TeamTaskQueryTransaction {
  loadProjectAccess(
    actorId: string,
    projectId: string,
  ): Promise<TeamTaskProjectAccessSnapshot | null>;
  listWorkItems(organizationId: number, projectId: number): Promise<TeamTaskQueryRow[]>;
  listOpenMilestones(
    organizationId: number,
    projectId: number,
  ): Promise<Array<{ externalId: string; title: string }>>;
  loadListDisplayRows(
    organizationId: number,
    projectId: number,
    workItemIds: number[],
  ): Promise<TeamTaskListDisplayRow[]>;
  loadDetailDisplay(
    organizationId: number,
    projectId: number,
    workItemId: number,
    currentContractVersionId: number | null,
  ): Promise<TeamTaskDetailDisplay>;
  lockWorkItemAccess(
    actorId: string,
    workItemId: string,
  ): Promise<{ access: TeamTaskProjectAccessSnapshot; workItem: TeamTaskQueryRow } | null>;
  lockOrganizationIdempotencyScope(organizationId: number): Promise<boolean>;
  findArchiveEvent(organizationId: number, idempotencyKey: string): Promise<ArchiveEventRow | null>;
  hasPlanningEvent(organizationId: number, idempotencyKey: string): Promise<boolean>;
  lockUnresolvedAppeals(
    workItemId: number,
  ): Promise<Array<{ status: 'appeal_open' | 'appeal_reviewing' }>>;
  lockCurrentContractLineage(contractVersionId: number): Promise<{
    id: number;
    organizationId: number;
    projectId: number;
    workItemId: number;
  } | null>;
  archiveWorkItem(workItemId: number, expectedVersion: number): Promise<boolean>;
  appendArchiveEvent(event: ArchiveEventRow): Promise<void>;
}

export interface TeamTaskQueryRepository {
  transaction<T>(work: (tx: TeamTaskQueryTransaction) => Promise<T>): Promise<T>;
}

interface Dependencies {
  now: () => string;
  newId: () => string;
  isLifecycleEnabled: (actorId: string, organizationEnabled: boolean) => boolean;
}

const defaults: Dependencies = {
  now: () => new Date().toISOString(),
  newId: () => newExternalId('teamWorkItemEvent'),
  isLifecycleEnabled: isTeamTaskLifecycleEnabledFor,
};

function fail(code: ConstructorParameters<typeof TeamTaskServiceError>[0]): never {
  throw new TeamTaskServiceError(code);
}

function external(value: unknown, kind: Parameters<typeof isExternalId>[1]): string {
  if (typeof value !== 'string' || !isExternalId(value, kind)) fail('INVALID_INPUT');
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDatabaseConflict(error: unknown): boolean {
  return (
    record(error) &&
    (error.code === 'ER_LOCK_DEADLOCK' ||
      error.code === 'ER_LOCK_WAIT_TIMEOUT' ||
      error.code === 'ER_DUP_ENTRY' ||
      error.errno === 1062)
  );
}

function assertAccess(
  access: TeamTaskProjectAccessSnapshot | null,
  actorId: string,
  dependencies: Dependencies,
): TeamTaskProjectAccessSnapshot {
  if (
    !access ||
    access.actorExternalId !== actorId ||
    !access.organizationActive ||
    !access.organizationTeamProjectsEnabled ||
    !access.actorOrganizationMembershipActive ||
    !access.actorProjectMembershipActive ||
    access.projectOrganizationId !== access.organizationId ||
    !dependencies.isLifecycleEnabled(actorId, access.organizationTeamProjectsEnabled)
  ) {
    return fail('NOT_FOUND');
  }
  return access;
}

const EMPTY_DISPLAY: TeamTaskListDisplayRow = {
  workItemId: 0,
  milestoneExternalId: null,
  milestoneTitle: null,
  assignments: [],
  submittedOnTime: null,
  latestSubmissionInternalId: null,
  latestSubmissionExternalId: null,
  latestReviewExternalId: null,
};

function buildMilestoneDisplayQuery(
  db: Pick<DB, 'select'>,
  organizationId: number,
  projectId: number,
  workItemIds: number[],
) {
  return db
    .select({
      workItemId: teamWorkItems.id,
      milestoneExternalId: teamMilestones.externalId,
      milestoneTitle: teamMilestones.title,
    })
    .from(teamWorkItems)
    .leftJoin(
      teamMilestones,
      and(
        eq(teamMilestones.id, teamWorkItems.milestoneId),
        eq(teamMilestones.organizationId, teamWorkItems.organizationId),
        eq(teamMilestones.projectId, teamWorkItems.projectId),
      ),
    )
    .where(
      and(
        eq(teamWorkItems.organizationId, organizationId),
        eq(teamWorkItems.projectId, projectId),
        inArray(teamWorkItems.id, workItemIds),
      ),
    );
}

function dto(
  row: TeamTaskQueryRow,
  projectId: string,
  actorId: string,
  canSelectClaim: boolean,
  display: TeamTaskListDisplayRow = EMPTY_DISPLAY,
): TeamTaskDto {
  const responsible =
    display.assignments.find(
      (assignment) => assignment.role === 'responsible' && assignment.status === 'accepted',
    ) ??
    display.assignments.find(
      (assignment) => assignment.role === 'responsible' && assignment.status === 'offered',
    );
  const myPendingAssignment = display.assignments.find(
    (assignment) =>
      assignment.userExternalId === actorId &&
      (assignment.status === 'offered' || assignment.status === 'applied'),
  );
  return {
    id: row.externalId,
    projectId,
    title: row.title,
    description: row.description,
    assignmentMode: row.assignmentMode,
    state: row.status,
    version: row.version,
    dueAt: row.dueAt?.toISOString() ?? null,
    revisionRound: row.revisionRound,
    responsibleUserId: responsible?.userExternalId ?? null,
    responsibleDisplayName: responsible?.displayName ?? null,
    responsibleAssignmentId: responsible?.assignmentExternalId ?? null,
    responsibleAssignmentStatus: responsible?.status ?? null,
    myPendingAssignmentId: myPendingAssignment?.assignmentExternalId ?? null,
    myPendingAssignmentRole: myPendingAssignment?.role ?? null,
    myPendingAssignmentStatus:
      myPendingAssignment?.status === 'offered' || myPendingAssignment?.status === 'applied'
        ? myPendingAssignment.status
        : null,
    canSelectClaim,
    claimApplicants: canSelectClaim
      ? display.assignments
          .filter(
            (assignment) => assignment.role === 'responsible' && assignment.status === 'applied',
          )
          .map((assignment) => ({
            assignmentId: assignment.assignmentExternalId,
            userId: assignment.userExternalId,
            displayName: assignment.displayName,
          }))
      : [],
    collaboratorUserIds: display.assignments
      .filter(
        (assignment) => assignment.role === 'collaborator' && assignment.status === 'accepted',
      )
      .map((assignment) => assignment.userExternalId),
    milestoneId: display.milestoneExternalId,
    milestone: display.milestoneTitle,
    submittedOnTime: display.submittedOnTime,
    latestSubmissionId: display.latestSubmissionExternalId,
    latestReviewId: display.latestReviewExternalId,
    accepted:
      row.status === 'accepted' || row.status === 'completed'
        ? true
        : row.status === 'revision_requested' || row.status === 'rejected_final'
          ? false
          : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function timelineDto(
  row: TeamTaskDetailDisplay['timeline'][number],
): TeamTaskDetailDto['timeline'][number] | null {
  const event = timelineEvent(row.eventType);
  return event ? { ...event, at: row.occurredAt.toISOString() } : null;
}

function timelineEvent(
  eventType: string,
): Omit<TeamTaskDetailDto['timeline'][number], 'at'> | null {
  if (eventType.includes('contract')) return { kind: 'contract', label: '验收契约已确认' };
  if (eventType.includes('assignment') || eventType.includes('claim'))
    return { kind: 'assignment', label: '任务指派已更新' };
  if (eventType.includes('unblock')) return { kind: 'block', label: '任务阻塞已解除' };
  if (eventType.includes('block')) return { kind: 'block', label: '任务已标记阻塞' };
  if (eventType.includes('submit')) return { kind: 'submission', label: '任务版本已提交' };
  if (
    eventType.includes('review') ||
    eventType.includes('accepted') ||
    eventType.includes('revision')
  )
    return { kind: 'review', label: '验收结果已更新' };
  if (eventType.includes('appeal') || eventType.includes('arbitr'))
    return { kind: 'appeal', label: '申诉或仲裁状态已更新' };
  if (eventType.includes('ai_contribution'))
    return { kind: 'ai', label: 'AI 贡献已提交，等待人工确认' };
  return null;
}

function requestHash(input: object): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function parseArchiveReceipt(
  value: unknown,
  eventId: string,
  workItemId: string,
): ArchiveReceipt | null {
  const keys = record(value) ? Object.keys(value).sort() : [];
  if (
    !record(value) ||
    !isExternalId(eventId, 'teamWorkItemEvent') ||
    !isExternalId(workItemId, 'teamWorkItem') ||
    keys.join(',') !== 'command,eventId,state,version,workItemId' ||
    value.command !== 'archive' ||
    value.eventId !== eventId ||
    value.workItemId !== workItemId ||
    value.state !== 'archived' ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 2
  ) {
    return null;
  }
  return {
    command: 'archive',
    eventId,
    workItemId,
    state: 'archived',
    version: value.version as number,
  };
}

export const __teamTaskQueryInternals = { parseArchiveReceipt, buildMilestoneDisplayQuery };

export class TeamTaskQueryService {
  private readonly dependencies: Dependencies;

  constructor(
    private readonly repository: TeamTaskQueryRepository,
    dependencies: Partial<Dependencies> = {},
  ) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof TeamTaskServiceError) throw error;
      if (isDatabaseConflict(error)) return fail('CONFLICT');
      throw error;
    }
  }

  async list(input: unknown): Promise<TeamTaskDto[]> {
    if (!record(input)) return fail('INVALID_INPUT');
    const actorId = external(input.actorId, 'user');
    const projectId = external(input.projectId, 'project');
    return this.run(() =>
      this.repository.transaction(async (tx) => {
        const access = assertAccess(
          await tx.loadProjectAccess(actorId, projectId),
          actorId,
          this.dependencies,
        );
        const rows = await tx.listWorkItems(access.organizationId, access.projectId);
        const displayRows = await tx.loadListDisplayRows(
          access.organizationId,
          access.projectId,
          rows.map((row) => row.id),
        );
        const displayByWorkItem = new Map(displayRows.map((row) => [row.workItemId, row]));
        const canSelectClaim =
          access.actorProjectRole !== 'viewer' &&
          (access.actorProjectRole === 'lead' ||
            access.actorOrganizationRole === 'owner' ||
            access.actorOrganizationRole === 'admin' ||
            access.actorOrganizationRole === 'manager');
        return rows.map((row) =>
          dto(row, projectId, actorId, canSelectClaim, displayByWorkItem.get(row.id)),
        );
      }),
    );
  }

  async get(input: unknown): Promise<TeamTaskDetailDto> {
    if (!record(input)) return fail('INVALID_INPUT');
    const actorId = external(input.actorId, 'user');
    const projectId = external(input.projectId, 'project');
    const workItemId = external(input.workItemId, 'teamWorkItem');
    return this.run(() =>
      this.repository.transaction(async (tx) => {
        const loaded = await tx.lockWorkItemAccess(actorId, workItemId);
        const access = assertAccess(loaded?.access ?? null, actorId, this.dependencies);
        if (!loaded || access.projectExternalId !== projectId) return fail('NOT_FOUND');
        const [display] = await tx.loadListDisplayRows(access.organizationId, access.projectId, [
          loaded.workItem.id,
        ]);
        const detail = await tx.loadDetailDisplay(
          access.organizationId,
          access.projectId,
          loaded.workItem.id,
          loaded.workItem.currentContractVersionId,
        );
        return {
          ...dto(
            loaded.workItem,
            projectId,
            actorId,
            access.actorProjectRole !== 'viewer' &&
              (access.actorProjectRole === 'lead' ||
                access.actorOrganizationRole === 'owner' ||
                access.actorOrganizationRole === 'admin' ||
                access.actorOrganizationRole === 'manager'),
            display,
          ),
          contract: detail.contract,
          timeline: detail.timeline.flatMap((row) => {
            const normalized = timelineDto(row);
            return normalized ? [normalized] : [];
          }),
        } satisfies TeamTaskDetailDto;
      }),
    );
  }

  async planningOptions(input: unknown): Promise<TeamTaskPlanningOptionsDto> {
    if (!record(input)) return fail('INVALID_INPUT');
    const actorId = external(input.actorId, 'user');
    const projectId = external(input.projectId, 'project');
    return this.run(() =>
      this.repository.transaction(async (tx) => {
        const access = assertAccess(
          await tx.loadProjectAccess(actorId, projectId),
          actorId,
          this.dependencies,
        );
        const milestones = await tx.listOpenMilestones(access.organizationId, access.projectId);
        return {
          milestones: milestones.slice(0, 100).map((milestone) => ({
            id: milestone.externalId,
            title: milestone.title.slice(0, 255),
          })),
        };
      }),
    );
  }

  async archive(input: unknown): Promise<ArchiveReceipt> {
    if (!record(input)) return fail('INVALID_INPUT');
    const actorId = external(input.actorId, 'user');
    const projectId = external(input.projectId, 'project');
    const workItemId = external(input.workItemId, 'teamWorkItem');
    if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) {
      return fail('INVALID_INPUT');
    }
    const expectedVersion = input.expectedVersion as number;
    if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length > 64) {
      return fail('INVALID_INPUT');
    }
    const idempotencyKey = input.idempotencyKey;
    const hash = requestHash({ actorId, projectId, workItemId, expectedVersion });
    return this.run(() =>
      this.repository.transaction(async (tx) => {
        const loaded = await tx.lockWorkItemAccess(actorId, workItemId);
        const access = assertAccess(loaded?.access ?? null, actorId, this.dependencies);
        if (!loaded || access.projectExternalId !== projectId) return fail('NOT_FOUND');
        if (!(await tx.lockOrganizationIdempotencyScope(access.organizationId)))
          return fail('CONFLICT');
        if (await tx.hasPlanningEvent(access.organizationId, idempotencyKey))
          return fail('CONFLICT');
        const previous = await tx.findArchiveEvent(access.organizationId, idempotencyKey);
        if (previous) {
          if (
            previous.requestHash !== hash ||
            previous.actorUserId !== access.actorUserId ||
            previous.workItemId !== loaded.workItem.id
          ) {
            return fail('CONFLICT');
          }
          return previous.receipt;
        }
        if (loaded.workItem.version !== expectedVersion) return fail('VERSION_CONFLICT');
        const permission = decideTeamTaskPermission('archive', {
          actorOrganizationRole: access.actorOrganizationRole,
          actorOrganizationMembershipActive: access.actorOrganizationMembershipActive,
          actorProjectRole: access.actorProjectRole,
          actorProjectMembershipActive: access.actorProjectMembershipActive,
          actorIsCreator: loaded.workItem.createdByUserId === access.actorUserId,
          actorIsResponsible: false,
          actorIsLatestReviewer: false,
          actorIsDesignatedApprover: false,
          actorIsDesignatedIndependentArbitrator: false,
        });
        if (!permission.allowed) return fail('FORBIDDEN');
        const appeals = await tx.lockUnresolvedAppeals(loaded.workItem.id);
        if (hasUnresolvedTeamTaskAppeal(appeals)) return fail('CONFLICT');
        let contractVersionId: number | null = null;
        if (loaded.workItem.currentContractVersionId !== null) {
          const contract = await tx.lockCurrentContractLineage(
            loaded.workItem.currentContractVersionId,
          );
          if (
            !contract ||
            contract.organizationId !== access.organizationId ||
            contract.projectId !== access.projectId ||
            contract.workItemId !== loaded.workItem.id
          ) {
            return fail('NOT_FOUND');
          }
          contractVersionId = contract.id;
        } else if (loaded.workItem.status !== 'cancelled') {
          return fail('CONFLICT');
        }
        const transition = transitionTeamTask(
          { state: loaded.workItem.status, appealOpen: false },
          { type: 'archive' },
        );
        if (!transition.ok) return fail('CONFLICT');
        if (!(await tx.archiveWorkItem(loaded.workItem.id, expectedVersion))) {
          return fail('VERSION_CONFLICT');
        }
        const receipt: ArchiveReceipt = {
          command: 'archive',
          eventId: this.dependencies.newId(),
          workItemId,
          state: 'archived',
          version: expectedVersion + 1,
        };
        await tx.appendArchiveEvent({
          externalId: receipt.eventId,
          organizationId: access.organizationId,
          projectId: access.projectId,
          workItemId: loaded.workItem.id,
          actorUserId: access.actorUserId,
          eventType: 'task_archived',
          fromState: loaded.workItem.status as ArchiveEventRow['fromState'],
          contractVersionId,
          idempotencyKey,
          requestHash: hash,
          receipt,
          occurredAt: new Date(this.dependencies.now()),
        });
        return receipt;
      }),
    );
  }
}

type Executor = Pick<DB, 'select' | 'update' | 'insert'>;

class DrizzleQueryTransaction implements TeamTaskQueryTransaction {
  constructor(private readonly db: Executor) {}

  private accessSelect(actorId: string) {
    return this.db
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
      .innerJoin(users, eq(users.externalId, actorId))
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
      );
  }

  private normalizeAccess(
    row: Record<string, unknown> | undefined,
  ): TeamTaskProjectAccessSnapshot | null {
    if (!row) return null;
    const organizationRole = row.actorOrganizationRole;
    const projectRole = row.actorProjectRole;
    if (
      organizationRole !== 'owner' &&
      organizationRole !== 'admin' &&
      organizationRole !== 'manager' &&
      organizationRole !== 'member'
    )
      return null;
    if (projectRole !== 'lead' && projectRole !== 'member' && projectRole !== 'viewer') return null;
    return {
      actorUserId: row.actorUserId as number,
      actorExternalId: row.actorExternalId as string,
      actorOrganizationRole: organizationRole,
      actorOrganizationMembershipActive: row.actorOrganizationMembershipStatus === 'active',
      actorProjectRole: projectRole,
      actorProjectMembershipActive: row.actorProjectMembershipStatus === 'active',
      organizationId: row.organizationId as number,
      organizationExternalId: row.organizationExternalId as string,
      organizationActive: row.organizationStatus === 'active',
      organizationTeamProjectsEnabled: row.organizationTeamProjectsEnabled === true,
      projectId: row.projectId as number,
      projectExternalId: row.projectExternalId as string,
      projectOrganizationId: row.projectOrganizationId as number | null,
    };
  }

  async loadProjectAccess(actorId: string, projectId: string) {
    const [row] = await this.accessSelect(actorId)
      .where(eq(projects.externalId, projectId))
      .limit(1);
    return this.normalizeAccess(row);
  }

  private itemSelect() {
    return {
      id: teamWorkItems.id,
      externalId: teamWorkItems.externalId,
      organizationId: teamWorkItems.organizationId,
      projectId: teamWorkItems.projectId,
      createdByUserId: teamWorkItems.createdByUserId,
      currentContractVersionId: teamWorkItems.currentContractVersionId,
      title: teamWorkItems.title,
      description: teamWorkItems.description,
      assignmentMode: teamWorkItems.assignmentMode,
      status: teamWorkItems.status,
      version: teamWorkItems.version,
      dueAt: teamWorkItems.dueAt,
      revisionRound: teamWorkItems.revisionRound,
      createdAt: teamWorkItems.createdAt,
      updatedAt: teamWorkItems.updatedAt,
    };
  }

  private normalizeItem(row: Record<string, unknown>): TeamTaskQueryRow {
    const modes = new Set(['direct', 'first_come', 'leader_select']);
    const states = new Set([
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
    if (!modes.has(String(row.assignmentMode)) || !states.has(String(row.status))) {
      return fail('CONFLICT');
    }
    return row as unknown as TeamTaskQueryRow;
  }

  async listWorkItems(organizationId: number, projectId: number) {
    const rows = await this.db
      .select(this.itemSelect())
      .from(teamWorkItems)
      .where(
        and(
          eq(teamWorkItems.organizationId, organizationId),
          eq(teamWorkItems.projectId, projectId),
        ),
      )
      .orderBy(asc(teamWorkItems.createdAt), asc(teamWorkItems.id));
    return rows.map((row) => this.normalizeItem(row));
  }

  async listOpenMilestones(organizationId: number, projectId: number) {
    return this.db
      .select({ externalId: teamMilestones.externalId, title: teamMilestones.title })
      .from(teamMilestones)
      .where(
        and(
          eq(teamMilestones.organizationId, organizationId),
          eq(teamMilestones.projectId, projectId),
          eq(teamMilestones.status, 'open'),
        ),
      )
      .orderBy(asc(teamMilestones.sortOrder), asc(teamMilestones.id))
      .limit(100);
  }

  async loadListDisplayRows(
    organizationId: number,
    projectId: number,
    workItemIds: number[],
  ): Promise<TeamTaskListDisplayRow[]> {
    if (workItemIds.length === 0) return [];
    // A transaction may be backed by one MySQL connection. Keep these fixed-count
    // batch reads sequential instead of issuing concurrent commands on that connection.
    const assignmentRows = await this.db
      .select({
        workItemId: teamWorkItemAssignments.workItemId,
        assignmentExternalId: teamWorkItemAssignments.externalId,
        userExternalId: users.externalId,
        displayName: users.displayName,
        role: teamWorkItemAssignments.role,
        status: teamWorkItemAssignments.status,
      })
      .from(teamWorkItemAssignments)
      .innerJoin(users, eq(users.id, teamWorkItemAssignments.userId))
      .where(
        and(
          eq(teamWorkItemAssignments.organizationId, organizationId),
          eq(teamWorkItemAssignments.projectId, projectId),
          inArray(teamWorkItemAssignments.workItemId, workItemIds),
          inArray(teamWorkItemAssignments.status, ['offered', 'applied', 'accepted']),
        ),
      )
      .orderBy(asc(teamWorkItemAssignments.id));
    const milestoneRows = await buildMilestoneDisplayQuery(
      this.db,
      organizationId,
      projectId,
      workItemIds,
    );
    const submissionRows = await this.db
      .select({
        id: teamWorkItemSubmissions.id,
        workItemId: teamWorkItemSubmissions.workItemId,
        externalId: teamWorkItemSubmissions.externalId,
        submittedOnTime: teamWorkItemSubmissions.submittedOnTime,
        submissionVersion: teamWorkItemSubmissions.submissionVersion,
      })
      .from(teamWorkItemSubmissions)
      .where(
        and(
          eq(teamWorkItemSubmissions.organizationId, organizationId),
          eq(teamWorkItemSubmissions.projectId, projectId),
          inArray(teamWorkItemSubmissions.workItemId, workItemIds),
        ),
      )
      .orderBy(desc(teamWorkItemSubmissions.submissionVersion));
    const reviewRows = await this.db
      .select({
        workItemId: teamWorkItemReviews.workItemId,
        submissionId: teamWorkItemReviews.submissionId,
        externalId: teamWorkItemReviews.externalId,
        reviewAttempt: teamWorkItemReviews.reviewAttempt,
      })
      .from(teamWorkItemReviews)
      .where(
        and(
          eq(teamWorkItemReviews.organizationId, organizationId),
          eq(teamWorkItemReviews.projectId, projectId),
          inArray(teamWorkItemReviews.workItemId, workItemIds),
        ),
      )
      .orderBy(desc(teamWorkItemReviews.reviewAttempt), desc(teamWorkItemReviews.id));

    const byId = new Map<number, TeamTaskListDisplayRow>();
    for (const workItemId of workItemIds) {
      byId.set(workItemId, { ...EMPTY_DISPLAY, workItemId, assignments: [] });
    }
    for (const row of assignmentRows) {
      if (
        (row.role !== 'responsible' && row.role !== 'collaborator') ||
        (row.status !== 'offered' && row.status !== 'applied' && row.status !== 'accepted')
      )
        continue;
      byId.get(row.workItemId)?.assignments.push({
        assignmentExternalId: row.assignmentExternalId,
        userExternalId: row.userExternalId,
        displayName: row.displayName,
        role: row.role,
        status: row.status,
      });
    }
    for (const row of milestoneRows) {
      const display = byId.get(row.workItemId);
      if (display) {
        display.milestoneExternalId = row.milestoneExternalId;
        display.milestoneTitle = row.milestoneTitle;
      }
    }
    const seenSubmission = new Set<number>();
    for (const row of submissionRows) {
      if (seenSubmission.has(row.workItemId)) continue;
      seenSubmission.add(row.workItemId);
      const display = byId.get(row.workItemId);
      if (display) {
        display.submittedOnTime = row.submittedOnTime === true;
        display.latestSubmissionInternalId = row.id;
        display.latestSubmissionExternalId = row.externalId;
      }
    }
    const seenReview = new Set<number>();
    for (const row of reviewRows) {
      if (seenReview.has(row.workItemId)) continue;
      const display = byId.get(row.workItemId);
      if (!display || display.latestSubmissionInternalId !== row.submissionId) continue;
      seenReview.add(row.workItemId);
      display.latestReviewExternalId = row.externalId;
    }
    return workItemIds.flatMap((id) => {
      const display = byId.get(id);
      return display ? [display] : [];
    });
  }

  async loadDetailDisplay(
    organizationId: number,
    projectId: number,
    workItemId: number,
    currentContractVersionId: number | null,
  ): Promise<TeamTaskDetailDisplay> {
    const contracts = currentContractVersionId
      ? await this.db
          .select({
            version: acceptanceContractVersions.version,
            objective: acceptanceContractVersions.objective,
            criteria: acceptanceContractVersions.criteriaJson,
            approverUserId: contractApproverUsers.externalId,
            arbitratorUserId: contractArbitratorUsers.externalId,
          })
          .from(acceptanceContractVersions)
          .innerJoin(
            contractApproverUsers,
            eq(contractApproverUsers.id, acceptanceContractVersions.approverUserId),
          )
          .innerJoin(
            contractArbitratorUsers,
            eq(contractArbitratorUsers.id, acceptanceContractVersions.arbitratorUserId),
          )
          .where(
            and(
              eq(acceptanceContractVersions.id, currentContractVersionId),
              eq(acceptanceContractVersions.organizationId, organizationId),
              eq(acceptanceContractVersions.projectId, projectId),
              eq(acceptanceContractVersions.workItemId, workItemId),
            ),
          )
          .limit(1)
      : [];
    const timeline = await this.db
      .select({
        eventType: teamWorkItemEvents.eventType,
        occurredAt: teamWorkItemEvents.occurredAt,
      })
      .from(teamWorkItemEvents)
      .where(
        and(
          eq(teamWorkItemEvents.organizationId, organizationId),
          eq(teamWorkItemEvents.projectId, projectId),
          eq(teamWorkItemEvents.workItemId, workItemId),
        ),
      )
      .orderBy(asc(teamWorkItemEvents.occurredAt), asc(teamWorkItemEvents.id))
      .limit(200);
    const current = contracts[0];
    return {
      contract: current
        ? {
            version: current.version,
            objective: current.objective.slice(0, 4_000),
            criteria: normalizeDisplayCriteria(current.criteria),
            approverUserId: current.approverUserId,
            arbitratorUserId: current.arbitratorUserId,
          }
        : null,
      timeline,
    };
  }

  async lockWorkItemAccess(actorId: string, workItemId: string) {
    const [item] = await this.db
      .select(this.itemSelect())
      .from(teamWorkItems)
      .where(eq(teamWorkItems.externalId, workItemId))
      .for('update')
      .limit(1);
    if (!item) return null;
    const [row] = await this.accessSelect(actorId).where(eq(projects.id, item.projectId)).limit(1);
    const access = this.normalizeAccess(row);
    return access ? { access, workItem: this.normalizeItem(item) } : null;
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

  async findArchiveEvent(organizationId: number, idempotencyKey: string) {
    const [row] = await this.db
      .select({
        externalId: teamWorkItemEvents.externalId,
        organizationId: teamWorkItemEvents.organizationId,
        projectId: teamWorkItemEvents.projectId,
        workItemId: teamWorkItemEvents.workItemId,
        actorUserId: teamWorkItemEvents.actorUserId,
        eventType: teamWorkItemEvents.eventType,
        fromState: teamWorkItemEvents.fromState,
        contractVersionId: teamWorkItemEvents.contractVersionId,
        workItemExternalId: teamWorkItems.externalId,
        idempotencyKey: teamWorkItemEvents.idempotencyKey,
        metadata: teamWorkItemEvents.metadataJson,
        occurredAt: teamWorkItemEvents.occurredAt,
      })
      .from(teamWorkItemEvents)
      .innerJoin(teamWorkItems, eq(teamWorkItems.id, teamWorkItemEvents.workItemId))
      .where(
        and(
          eq(teamWorkItemEvents.organizationId, organizationId),
          eq(teamWorkItemEvents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (
      !record(row.metadata) ||
      row.eventType !== 'task_archived' ||
      (row.fromState !== 'completed' &&
        row.fromState !== 'cancelled' &&
        row.fromState !== 'rejected_final')
    ) {
      return fail('CONFLICT');
    }
    const requestHash = row.metadata.requestHash;
    const receipt = parseArchiveReceipt(
      row.metadata.receipt,
      row.externalId,
      row.workItemExternalId,
    );
    if (typeof requestHash !== 'string' || !receipt) {
      return fail('CONFLICT');
    }
    return {
      ...row,
      eventType: 'task_archived' as const,
      fromState: row.fromState as ArchiveEventRow['fromState'],
      requestHash,
      receipt: receipt as unknown as ArchiveReceipt,
    };
  }

  async hasPlanningEvent(organizationId: number, idempotencyKey: string) {
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

  async lockUnresolvedAppeals(workItemId: number) {
    return this.db
      .select({ status: teamWorkItemAppeals.status })
      .from(teamWorkItemAppeals)
      .where(
        and(
          eq(teamWorkItemAppeals.workItemId, workItemId),
          inArray(teamWorkItemAppeals.status, ['appeal_open', 'appeal_reviewing']),
        ),
      )
      .for('update') as Promise<Array<{ status: 'appeal_open' | 'appeal_reviewing' }>>;
  }

  async lockCurrentContractLineage(contractVersionId: number) {
    const [row] = await this.db
      .select({
        id: acceptanceContractVersions.id,
        organizationId: acceptanceContractVersions.organizationId,
        projectId: acceptanceContractVersions.projectId,
        workItemId: acceptanceContractVersions.workItemId,
      })
      .from(acceptanceContractVersions)
      .where(eq(acceptanceContractVersions.id, contractVersionId))
      .for('update')
      .limit(1);
    return row ?? null;
  }

  async archiveWorkItem(workItemId: number, expectedVersion: number) {
    const result = await this.db
      .update(teamWorkItems)
      .set({ status: 'archived', version: expectedVersion + 1 })
      .where(and(eq(teamWorkItems.id, workItemId), eq(teamWorkItems.version, expectedVersion)));
    return readAffectedRows(result) === 1;
  }

  async appendArchiveEvent(event: ArchiveEventRow) {
    await this.db.insert(teamWorkItemEvents).values({
      externalId: event.externalId,
      organizationId: event.organizationId,
      projectId: event.projectId,
      workItemId: event.workItemId,
      actorUserId: event.actorUserId,
      eventType: event.eventType,
      fromState: event.fromState,
      toState: 'archived',
      contractVersionId: event.contractVersionId,
      idempotencyKey: event.idempotencyKey,
      metadataJson: { requestHash: event.requestHash, receipt: event.receipt },
      occurredAt: event.occurredAt,
    });
  }
}

function normalizeDisplayCriteria(value: unknown): Array<{ id: string; description: string }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    if (!record(entry)) return [];
    const id = typeof entry.id === 'string' ? entry.id.trim().slice(0, 100) : '';
    const description =
      typeof entry.description === 'string' ? entry.description.trim().slice(0, 1_000) : '';
    return id && description ? [{ id, description }] : [];
  });
}

export class DrizzleTeamTaskQueryRepository implements TeamTaskQueryRepository {
  constructor(private readonly db: DB) {}
  transaction<T>(work: (tx: TeamTaskQueryTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleQueryTransaction(tx)));
  }
}

export function createTeamTaskQueryService(db: DB): TeamTaskQueryService {
  return new TeamTaskQueryService(new DrizzleTeamTaskQueryRepository(db));
}
