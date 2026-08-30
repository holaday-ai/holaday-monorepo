import { createHash } from 'node:crypto';
import { isExternalId, newExternalId } from '@holaday/shared-types';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { acceptanceContractVersions } from '../db/schema/acceptance-contract-versions.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { projectMembers } from '../db/schema/project-members.js';
import { projects } from '../db/schema/projects.js';
import { teamProjectPlanningEvents } from '../db/schema/team-project-planning-events.js';
import { teamWorkItemAppeals } from '../db/schema/team-work-item-appeals.js';
import { teamWorkItemEvents } from '../db/schema/team-work-item-events.js';
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
  createdAt: string;
  updatedAt: string;
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

function dto(row: TeamTaskQueryRow, projectId: string): TeamTaskDto {
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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

export const __teamTaskQueryInternals = { parseArchiveReceipt };

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
        return (await tx.listWorkItems(access.organizationId, access.projectId)).map((row) =>
          dto(row, projectId),
        );
      }),
    );
  }

  async get(input: unknown): Promise<TeamTaskDto> {
    if (!record(input)) return fail('INVALID_INPUT');
    const actorId = external(input.actorId, 'user');
    const projectId = external(input.projectId, 'project');
    const workItemId = external(input.workItemId, 'teamWorkItem');
    return this.run(() =>
      this.repository.transaction(async (tx) => {
        const loaded = await tx.lockWorkItemAccess(actorId, workItemId);
        const access = assertAccess(loaded?.access ?? null, actorId, this.dependencies);
        if (!loaded || access.projectExternalId !== projectId) return fail('NOT_FOUND');
        return dto(loaded.workItem, projectId);
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

export class DrizzleTeamTaskQueryRepository implements TeamTaskQueryRepository {
  constructor(private readonly db: DB) {}
  transaction<T>(work: (tx: TeamTaskQueryTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleQueryTransaction(tx)));
  }
}

export function createTeamTaskQueryService(db: DB): TeamTaskQueryService {
  return new TeamTaskQueryService(new DrizzleTeamTaskQueryRepository(db));
}
