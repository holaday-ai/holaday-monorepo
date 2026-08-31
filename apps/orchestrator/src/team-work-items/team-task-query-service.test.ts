import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import * as schema from '../db/schema/index.js';
import {
  type TeamTaskListDisplayRow,
  type TeamTaskQueryRepository,
  type TeamTaskQueryRow,
  TeamTaskQueryService,
  type TeamTaskQueryTransaction,
  __teamTaskQueryInternals,
} from './team-task-query-service.js';
import { type TeamTaskProjectAccessSnapshot, TeamTaskServiceError } from './team-task-service.js';

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
  access: TeamTaskProjectAccessSnapshot = access;
  item: TeamTaskQueryRow = item;
  unresolved = false;
  event: Awaited<ReturnType<TeamTaskQueryTransaction['findArchiveEvent']>> = null;
  planningConflict = false;
  transactionError: unknown = null;
  failAppend = false;
  displayLoads = 0;

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
  async listOpenMilestones() {
    return [{ externalId: 'tml_Open111111111111111111', title: 'Open milestone' }];
  }
  async loadListDisplayRows(): Promise<TeamTaskListDisplayRow[]> {
    this.displayLoads += 1;
    return [
      {
        workItemId: 30,
        milestoneExternalId: 'tml_ReleaseM31111111111111',
        milestoneTitle: 'Release M3',
        assignments: [
          {
            assignmentExternalId: 'twa_Responsible111111111111',
            userExternalId: actorId,
            displayName: 'Project lead',
            role: 'responsible' as const,
            status: 'accepted' as const,
          },
          {
            assignmentExternalId: 'twa_Collaborator1111111111',
            userExternalId: 'usr_Collaborator111111111',
            displayName: 'Collaborator',
            role: 'collaborator' as const,
            status: 'accepted' as const,
          },
        ],
        submittedOnTime: true,
        latestSubmissionInternalId: 91,
        latestSubmissionExternalId: 'tsb_Submission111111111111',
        latestReviewExternalId: 'trv_Review11111111111111111',
      },
    ];
  }
  async loadDetailDisplay() {
    return {
      contract: {
        version: 2,
        objective: 'Ship a bounded report.',
        criteria: [{ id: 'criterion-output', description: 'Include three verified sections.' }],
        approverUserId: actorId,
        arbitratorUserId: 'usr_Arbitrator11111111111',
      },
      timeline: [
        {
          eventType: 'contract_confirmed',
          occurredAt: new Date('2026-08-30T08:00:00.000Z'),
        },
        {
          eventType: 'ai_contribution_recorded',
          occurredAt: new Date('2026-08-31T09:00:00.000Z'),
        },
      ],
    };
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
  it('scopes milestone display joins to the work item tenant lineage', () => {
    const db = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const query = __teamTaskQueryInternals.buildMilestoneDisplayQuery(db, 10, 20, [30, 31]).toSQL();
    const sql = query.sql.toLowerCase().replace(/\s+/g, ' ').trim();

    expect(sql).toContain('`team_milestones`.`id` = `team_work_items`.`milestone_id`');
    expect(sql).toContain(
      '`team_milestones`.`organization_id` = `team_work_items`.`organization_id`',
    );
    expect(sql).toContain('`team_milestones`.`project_id` = `team_work_items`.`project_id`');
    expect(sql).toContain('`team_work_items`.`organization_id` = ?');
    expect(sql).toContain('`team_work_items`.`project_id` = ?');
    expect(query.params).toEqual([10, 20, 30, 31]);
  });

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
    const { service: subject, repository } = service();
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
        responsibleUserId: actorId,
        responsibleDisplayName: 'Project lead',
        responsibleAssignmentId: 'twa_Responsible111111111111',
        responsibleAssignmentStatus: 'accepted',
        myPendingAssignmentId: null,
        myPendingAssignmentRole: null,
        myPendingAssignmentStatus: null,
        canSelectClaim: true,
        claimApplicants: [],
        collaboratorUserIds: ['usr_Collaborator111111111'],
        milestoneId: 'tml_ReleaseM31111111111111',
        milestone: 'Release M3',
        submittedOnTime: true,
        latestSubmissionId: 'tsb_Submission111111111111',
        latestReviewId: 'trv_Review11111111111111111',
        accepted: true,
        createdAt: '2026-08-30T00:00:00.000Z',
        updatedAt: '2026-08-31T00:00:00.000Z',
      },
    ]);
    expect(repository.displayLoads).toBe(1);
  });

  it('derives acceptance from the current canonical state rather than a historical review', async () => {
    const repository = new MemoryRepository();
    repository.item = { ...repository.item, status: 'revision_requested' };

    const [row] = await service(repository).service.list({ actorId, projectId });

    expect(row?.accepted).toBe(false);
  });

  it('keeps leader-select applicants separate from a selected responsible assignment', async () => {
    const repository = new MemoryRepository();
    repository.item = { ...repository.item, assignmentMode: 'leader_select', status: 'claimable' };
    repository.loadListDisplayRows = async () => [
      {
        workItemId: 30,
        milestoneExternalId: null,
        milestoneTitle: null,
        assignments: [
          {
            assignmentExternalId: 'twa_Applicant11111111111111',
            userExternalId: actorId,
            displayName: 'Applicant',
            role: 'responsible',
            status: 'applied',
          },
        ],
        submittedOnTime: null,
        latestSubmissionInternalId: null,
        latestSubmissionExternalId: null,
        latestReviewExternalId: null,
      },
    ];

    const [row] = await service(repository).service.list({ actorId, projectId });

    expect(row).toMatchObject({
      responsibleUserId: null,
      responsibleAssignmentId: null,
      myPendingAssignmentId: 'twa_Applicant11111111111111',
      myPendingAssignmentRole: 'responsible',
      myPendingAssignmentStatus: 'applied',
      canSelectClaim: true,
      claimApplicants: [
        {
          assignmentId: 'twa_Applicant11111111111111',
          userId: actorId,
          displayName: 'Applicant',
        },
      ],
    });
  });

  it('does not expose leader-select applicants to a viewer', async () => {
    const repository = new MemoryRepository();
    repository.access = { ...repository.access, actorProjectRole: 'viewer' };
    repository.item = { ...repository.item, assignmentMode: 'leader_select', status: 'claimable' };
    repository.loadListDisplayRows = async () => [
      {
        workItemId: 30,
        milestoneExternalId: null,
        milestoneTitle: null,
        assignments: [
          {
            assignmentExternalId: 'twa_Applicant11111111111111',
            userExternalId: 'usr_Applicant1111111111111',
            displayName: 'Applicant',
            role: 'responsible',
            status: 'applied',
          },
        ],
        submittedOnTime: null,
        latestSubmissionInternalId: null,
        latestSubmissionExternalId: null,
        latestReviewExternalId: null,
      },
    ];

    const [row] = await service(repository).service.list({ actorId, projectId });

    expect(row).toMatchObject({ canSelectClaim: false, claimApplicants: [] });
  });

  it('exposes claim selection capability to an organization manager on the project', async () => {
    const repository = new MemoryRepository();
    repository.access = {
      ...repository.access,
      actorProjectRole: 'member',
      actorOrganizationRole: 'manager',
    };
    repository.item = { ...repository.item, assignmentMode: 'leader_select', status: 'claimable' };
    repository.loadListDisplayRows = async () => [
      {
        workItemId: 30,
        milestoneExternalId: null,
        milestoneTitle: null,
        assignments: [
          {
            assignmentExternalId: 'twa_Applicant11111111111111',
            userExternalId: 'usr_Applicant1111111111111',
            displayName: 'Applicant',
            role: 'responsible',
            status: 'applied',
          },
        ],
        submittedOnTime: null,
        latestSubmissionInternalId: null,
        latestSubmissionExternalId: null,
        latestReviewExternalId: null,
      },
    ];

    const [row] = await service(repository).service.list({ actorId, projectId });

    expect(row).toMatchObject({
      canSelectClaim: true,
      claimApplicants: [{ assignmentId: 'twa_Applicant11111111111111' }],
    });
  });

  it('keeps acceptance unknown until a submitted task receives a canonical review outcome', async () => {
    const repository = new MemoryRepository();
    repository.item = { ...repository.item, status: 'submitted' };

    const [row] = await service(repository).service.list({ actorId, projectId });

    expect(row?.accepted).toBeNull();
  });

  it('returns bounded open milestone options behind the same project access boundary', async () => {
    await expect(service().service.planningOptions({ actorId, projectId })).resolves.toEqual({
      milestones: [{ id: 'tml_Open111111111111111111', title: 'Open milestone' }],
    });
  });

  it('returns a bounded current contract and normalized timeline without raw event metadata', async () => {
    const { service: subject } = service();

    await expect(subject.get({ actorId, projectId, workItemId })).resolves.toEqual({
      id: workItemId,
      projectId,
      title: 'Launch report',
      description: 'Prepare the bounded launch report.',
      assignmentMode: 'direct',
      state: 'completed',
      version: 4,
      dueAt: '2026-09-01T00:00:00.000Z',
      revisionRound: 1,
      responsibleUserId: actorId,
      responsibleDisplayName: 'Project lead',
      responsibleAssignmentId: 'twa_Responsible111111111111',
      responsibleAssignmentStatus: 'accepted',
      myPendingAssignmentId: null,
      myPendingAssignmentRole: null,
      myPendingAssignmentStatus: null,
      canSelectClaim: true,
      claimApplicants: [],
      collaboratorUserIds: ['usr_Collaborator111111111'],
      milestoneId: 'tml_ReleaseM31111111111111',
      milestone: 'Release M3',
      submittedOnTime: true,
      latestSubmissionId: 'tsb_Submission111111111111',
      latestReviewId: 'trv_Review11111111111111111',
      accepted: true,
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
      contract: {
        version: 2,
        objective: 'Ship a bounded report.',
        criteria: [{ id: 'criterion-output', description: 'Include three verified sections.' }],
        approverUserId: actorId,
        arbitratorUserId: 'usr_Arbitrator11111111111',
      },
      timeline: [
        {
          kind: 'contract',
          label: '验收契约已确认',
          at: '2026-08-30T08:00:00.000Z',
        },
        {
          kind: 'ai',
          label: 'AI 贡献已提交，等待人工确认',
          at: '2026-08-31T09:00:00.000Z',
        },
      ],
    });
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
