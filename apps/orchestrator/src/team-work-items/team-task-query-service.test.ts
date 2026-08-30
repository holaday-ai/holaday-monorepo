import { describe, expect, it } from 'vitest';
import {
  type TeamTaskQueryRepository,
  type TeamTaskQueryRow,
  TeamTaskQueryService,
  type TeamTaskQueryTransaction,
  __teamTaskQueryInternals,
} from './team-task-query-service.js';
import { TeamTaskServiceError } from './team-task-service.js';

const actorId = 'usr_Actor1111111111111111';
const projectId = 'prj_Project11111111111111';
const otherProjectId = 'prj_Project22222222222222';
const workItemId = 'twi_Target111111111111111';
const eventId = 'twe_Event1111111111111111';

const access = {
  actorUserId: 7,
  actorExternalId: actorId,
  actorOrganizationRole: 'manager' as const,
  actorOrganizationMembershipActive: true,
  actorProjectRole: 'lead' as const,
  actorProjectMembershipActive: true,
  organizationId: 10,
  organizationExternalId: 'org_team',
  organizationActive: true,
  organizationTeamProjectsEnabled: true,
  projectId: 20,
  projectExternalId: projectId,
  projectOrganizationId: 10,
};

const item = {
  id: 30,
  externalId: workItemId,
  organizationId: 10,
  projectId: 20,
  createdByUserId: 7,
  currentContractVersionId: 40,
  title: 'Launch report',
  description: 'Prepare the bounded launch report.',
  assignmentMode: 'direct' as const,
  status: 'completed' as const,
  version: 4,
  dueAt: new Date('2026-09-01T00:00:00.000Z'),
  revisionRound: 1,
  createdAt: new Date('2026-08-30T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z'),
};

class MemoryRepository implements TeamTaskQueryRepository, TeamTaskQueryTransaction {
  access = access;
  item: TeamTaskQueryRow = item;
  unresolved = false;
  event: Awaited<ReturnType<TeamTaskQueryTransaction['findArchiveEvent']>> = null;
  planningConflict = false;
  transactionError: unknown = null;
  failAppend = false;

  transaction<T>(work: (tx: TeamTaskQueryTransaction) => Promise<T>) {
    if (this.transactionError) return Promise.reject(this.transactionError);
    const snapshot = { item: this.item, event: this.event };
    return work(this).catch((error) => {
      this.item = snapshot.item;
      this.event = snapshot.event;
      throw error;
    });
  }
  async loadProjectAccess() {
    return this.access;
  }
  async listWorkItems() {
    return [this.item];
  }
  async lockWorkItemAccess() {
    return { access: this.access, workItem: this.item };
  }
  async lockOrganizationIdempotencyScope() {
    return true;
  }
  async findArchiveEvent() {
    return this.event;
  }
  async hasPlanningEvent() {
    return this.planningConflict;
  }
  async lockUnresolvedAppeals() {
    return this.unresolved ? [{ status: 'appeal_open' as const }] : [];
  }
  async lockCurrentContractLineage() {
    return { id: 40, organizationId: 10, projectId: 20, workItemId: 30 };
  }
  async archiveWorkItem(_id: number, expectedVersion: number) {
    if (this.item.version !== expectedVersion) return false;
    this.item = { ...this.item, status: 'archived', version: expectedVersion + 1 };
    return true;
  }
  async appendArchiveEvent(event: NonNullable<MemoryRepository['event']>) {
    if (this.failAppend) throw new Error('event append failed');
    this.event = event;
  }
}

function service(repository = new MemoryRepository(), lifecycleEnabled = true) {
  return {
    repository,
    service: new TeamTaskQueryService(repository, {
      isLifecycleEnabled: (_actorId, organizationEnabled) =>
        lifecycleEnabled && organizationEnabled,
      newId: () => eventId,
      now: () => '2026-08-31T00:00:00.000Z',
    }),
  };
}

describe('TeamTaskQueryService', () => {
  it('rebuilds only an exact bounded archive receipt and rejects metadata pollution', () => {
    const valid = {
      command: 'archive',
      eventId,
      workItemId,
      state: 'archived',
      version: 5,
    };
    expect(__teamTaskQueryInternals.parseArchiveReceipt(valid, eventId, workItemId)).toEqual(valid);
    expect(
      __teamTaskQueryInternals.parseArchiveReceipt(
        { ...valid, internalId: 30 },
        eventId,
        workItemId,
      ),
    ).toBeNull();
    expect(
      __teamTaskQueryInternals.parseArchiveReceipt(
        { ...valid, eventId: 'twe_Event2222222222222222' },
        eventId,
        workItemId,
      ),
    ).toBeNull();
  });

  it('lists only sanitized project task DTOs after both rollout gates and active membership', async () => {
    const { service: subject } = service();
    await expect(subject.list({ actorId, projectId })).resolves.toEqual([
      {
        id: workItemId,
        projectId,
        title: 'Launch report',
        description: 'Prepare the bounded launch report.',
        assignmentMode: 'direct',
        state: 'completed',
        version: 4,
        dueAt: '2026-09-01T00:00:00.000Z',
        revisionRound: 1,
        createdAt: '2026-08-30T00:00:00.000Z',
        updatedAt: '2026-08-31T00:00:00.000Z',
      },
    ]);
  });

  it('hides a resource when projectId does not match the work-item lineage', async () => {
    const { service: subject } = service();
    await expect(
      subject.get({ actorId, projectId: otherProjectId, workItemId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    ['organization persistence gate', { organizationTeamProjectsEnabled: false }, true],
    ['organization membership', { actorOrganizationMembershipActive: false }, true],
    ['project membership', { actorProjectMembershipActive: false }, true],
    ['organization state', { organizationActive: false }, true],
    ['nested user lifecycle gate', {}, false],
  ])('fails closed before data for inactive %s', async (_name, accessPatch, lifecycleEnabled) => {
    const repository = new MemoryRepository();
    repository.access = { ...access, ...accessPatch };
    const { service: subject } = service(repository, lifecycleEnabled);
    await expect(subject.list({ actorId, projectId })).rejects.toBeInstanceOf(TeamTaskServiceError);
  });

  it('archives terminal work only after the persisted unresolved-appeal overlay is clear', async () => {
    const { service: subject, repository } = service();
    repository.unresolved = true;
    await expect(
      subject.archive({
        actorId,
        projectId,
        workItemId,
        expectedVersion: 4,
        idempotencyKey: '01J6TK66M8H4V3E6XKNB4RM1GP',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.item.status).toBe('completed');
  });

  it('archives once and replays the actor-bound receipt without a second write', async () => {
    const { service: subject, repository } = service();
    const input = {
      actorId,
      projectId,
      workItemId,
      expectedVersion: 4,
      idempotencyKey: '01J6TK66M8H4V3E6XKNB4RM1GP',
    };
    const first = await subject.archive(input);
    await expect(subject.archive(input)).resolves.toEqual(first);
    expect(repository.item).toMatchObject({ status: 'archived', version: 5 });
    expect(repository.event).toMatchObject({ contractVersionId: 40 });
  });

  it('rolls back the archived state when the immutable event append fails', async () => {
    const { service: subject, repository } = service();
    repository.failAppend = true;
    await expect(
      subject.archive({
        actorId,
        projectId,
        workItemId,
        expectedVersion: 4,
        idempotencyKey: '01J6TK66M8H4V3E6XKNB4RM1GP',
      }),
    ).rejects.toThrow('event append failed');
    expect(repository.item).toMatchObject({ status: 'completed', version: 4 });
    expect(repository.event).toBeNull();
  });

  it('requires contract lineage for completed/rejected work and permits cancelled pre-contract work', async () => {
    const completed = new MemoryRepository();
    completed.item = { ...completed.item, currentContractVersionId: null };
    await expect(
      service(completed).service.archive({
        actorId,
        projectId,
        workItemId,
        expectedVersion: 4,
        idempotencyKey: '01J6TK66M8H4V3E6XKNB4RM1GP',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const cancelled = new MemoryRepository();
    cancelled.item = {
      ...cancelled.item,
      status: 'cancelled',
      currentContractVersionId: null,
    };
    await expect(
      service(cancelled).service.archive({
        actorId,
        projectId,
        workItemId,
        expectedVersion: 4,
        idempotencyKey: '01J6TK66M8H4V3E6XKNB4RM1GP',
      }),
    ).resolves.toMatchObject({ state: 'archived', version: 5 });
    expect(cancelled.event).toMatchObject({ fromState: 'cancelled', contractVersionId: null });
  });

  it('maps deadlocks and lock timeouts to bounded domain conflicts', async () => {
    const { service: subject, repository } = service();
    repository.transactionError = { code: 'ER_LOCK_WAIT_TIMEOUT', message: 'raw database detail' };
    await expect(subject.list({ actorId, projectId })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
