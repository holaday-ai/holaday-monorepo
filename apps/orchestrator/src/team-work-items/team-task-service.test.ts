import { describe, expect, it } from 'vitest';
import type { AcceptanceContractInput } from './acceptance-contract.js';
import {
  type TeamTaskAssignmentRow,
  type TeamTaskContractRow,
  type TeamTaskEventRow,
  type TeamTaskMemberSnapshot,
  type TeamTaskOrganizationMemberSnapshot,
  type TeamTaskProjectAccessSnapshot,
  type TeamTaskRepository,
  TeamTaskService,
  type TeamTaskServiceError,
  type TeamTaskTransaction,
  type TeamTaskWorkItemRow,
} from './team-task-service.js';

const NOW = '2026-08-31T01:00:00.000Z';

const contract = (overrides: Partial<AcceptanceContractInput> = {}): AcceptanceContractInput => ({
  objective: '完成客户研究报告',
  deliverables: ['PDF 报告'],
  criteria: [{ id: 'criterion-1', description: '包含 10 个可核验来源' }],
  requiredEvidenceTypes: [{ type: 'report' }],
  approverId: 'omem_333333333333333333333',
  arbitratorId: 'omem_444444444444444444444',
  dueAt: '2026-09-02T01:00:00.000Z',
  maxRevisionRounds: 2,
  ...overrides,
});

const ids = {
  actor: 'usr_Actor1111111111111111',
  member: 'usr_Member222222222222222',
  secondMember: 'usr_Member333333333333333',
  approverUser: 'usr_Approver4444444444444',
  arbitratorUser: 'usr_Arbitrator55555555555',
  project: 'prj_Project11111111111111',
  personalProject: 'prj_222222222222222222222',
  hiddenProject: 'prj_333333333333333333333',
  memberMembership: 'omem_111111111111111111111',
  secondMembership: 'omem_222222222222222222222',
  approverMembership: 'omem_333333333333333333333',
  arbitratorMembership: 'omem_444444444444444444444',
} as const;

type State = {
  projects: Map<string, TeamTaskProjectAccessSnapshot>;
  members: Map<string, TeamTaskMemberSnapshot>;
  workItems: Map<string, TeamTaskWorkItemRow>;
  assignments: Map<string, TeamTaskAssignmentRow>;
  contracts: TeamTaskContractRow[];
  events: TeamTaskEventRow[];
};

function cloneState(state: State): State {
  return {
    projects: new Map([...state.projects].map(([key, value]) => [key, structuredClone(value)])),
    members: new Map([...state.members].map(([key, value]) => [key, structuredClone(value)])),
    workItems: new Map([...state.workItems].map(([key, value]) => [key, structuredClone(value)])),
    assignments: new Map(
      [...state.assignments].map(([key, value]) => [key, structuredClone(value)]),
    ),
    contracts: structuredClone(state.contracts),
    events: structuredClone(state.events),
  };
}

class MemoryRepository implements TeamTaskRepository {
  state: State;
  private queue: Promise<void> = Promise.resolve();
  private nextWorkItemId = 1;
  private nextContractId = 1;
  private nextAssignmentId = 1;

  constructor() {
    const access: TeamTaskProjectAccessSnapshot = {
      actorUserId: 1,
      actorExternalId: ids.actor,
      actorOrganizationRole: 'owner',
      actorOrganizationMembershipActive: true,
      actorProjectRole: 'lead',
      actorProjectMembershipActive: true,
      organizationId: 10,
      organizationExternalId: 'org_Organization1111111111',
      organizationActive: true,
      organizationTeamProjectsEnabled: true,
      projectId: 20,
      projectExternalId: ids.project,
      projectOrganizationId: 10,
    };
    this.state = {
      projects: new Map([
        [`${ids.actor}:${ids.project}`, access],
        [
          `${ids.actor}:${ids.personalProject}`,
          {
            ...access,
            projectId: 21,
            projectExternalId: ids.personalProject,
            projectOrganizationId: null,
          },
        ],
        [
          `${ids.member}:${ids.project}`,
          {
            ...access,
            actorUserId: 2,
            actorExternalId: ids.member,
            actorOrganizationRole: 'member',
            actorProjectRole: 'member',
          },
        ],
        [
          `${ids.secondMember}:${ids.project}`,
          {
            ...access,
            actorUserId: 3,
            actorExternalId: ids.secondMember,
            actorOrganizationRole: 'member',
            actorProjectRole: 'member',
          },
        ],
        [
          `${ids.approverUser}:${ids.project}`,
          {
            ...access,
            actorUserId: 4,
            actorExternalId: ids.approverUser,
            actorOrganizationRole: 'member',
            actorProjectRole: 'lead',
          },
        ],
        [
          `${ids.arbitratorUser}:${ids.project}`,
          {
            ...access,
            actorUserId: 5,
            actorExternalId: ids.arbitratorUser,
            actorOrganizationRole: 'member',
            actorProjectRole: 'member',
          },
        ],
      ]),
      members: new Map([
        [
          ids.memberMembership,
          {
            organizationId: 10,
            projectId: 20,
            userId: 2,
            userExternalId: ids.member,
            organizationMemberExternalId: ids.memberMembership,
            organizationMembershipActive: true,
            projectMembershipActive: true,
            projectRole: 'member',
          },
        ],
        [
          ids.secondMembership,
          {
            organizationId: 10,
            projectId: 20,
            userId: 3,
            userExternalId: ids.secondMember,
            organizationMemberExternalId: ids.secondMembership,
            organizationMembershipActive: true,
            projectMembershipActive: true,
            projectRole: 'member',
          },
        ],
        [
          ids.approverMembership,
          {
            organizationId: 10,
            projectId: 20,
            userId: 4,
            userExternalId: ids.approverUser,
            organizationMemberExternalId: ids.approverMembership,
            organizationMembershipActive: true,
            projectMembershipActive: true,
            projectRole: 'lead',
          },
        ],
        [
          ids.arbitratorMembership,
          {
            organizationId: 10,
            projectId: 20,
            userId: 5,
            userExternalId: ids.arbitratorUser,
            organizationMemberExternalId: ids.arbitratorMembership,
            organizationMembershipActive: true,
            projectMembershipActive: true,
            projectRole: 'member',
          },
        ],
      ]),
      workItems: new Map(),
      assignments: new Map(),
      contracts: [],
      events: [],
    };
  }

  async transaction<T>(work: (tx: TeamTaskTransaction) => Promise<T>): Promise<T> {
    let release = () => {};
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const before = cloneState(this.state);
    try {
      return await work(this.tx());
    } catch (error) {
      this.state = before;
      throw error;
    } finally {
      release();
    }
  }

  private tx(): TeamTaskTransaction {
    return {
      loadProjectAccess: async (actorExternalId, projectExternalId) =>
        structuredClone(this.state.projects.get(`${actorExternalId}:${projectExternalId}`) ?? null),
      lockWorkItemAccess: async (actorExternalId, workItemExternalId) => {
        const item = this.state.workItems.get(workItemExternalId);
        if (!item) return null;
        const access = this.state.projects.get(`${actorExternalId}:${item.projectExternalId}`);
        return access ? { access: structuredClone(access), workItem: structuredClone(item) } : null;
      },
      findEventByIdempotencyKey: async (organizationId, idempotencyKey) =>
        structuredClone(
          this.state.events.find(
            (event) =>
              event.organizationId === organizationId && event.idempotencyKey === idempotencyKey,
          ) ?? null,
        ),
      insertWorkItem: async (row) => {
        const id = this.nextWorkItemId++;
        this.state.workItems.set(row.externalId, { ...structuredClone(row), id });
        return id;
      },
      updateWorkItem: async (workItemId, expectedVersion, update) => {
        const entry = [...this.state.workItems.entries()].find(
          ([, item]) => item.id === workItemId,
        );
        if (!entry || entry[1].version !== expectedVersion) return false;
        this.state.workItems.set(entry[0], { ...entry[1], ...structuredClone(update) });
        return true;
      },
      loadActiveMember: async (organizationId, projectId, memberExternalId) => {
        const member = this.state.members.get(memberExternalId);
        if (
          !member ||
          member.organizationId !== organizationId ||
          member.projectId !== projectId ||
          !member.organizationMembershipActive ||
          !member.projectMembershipActive
        ) {
          return null;
        }
        return structuredClone(member);
      },
      loadActiveOrganizationMember: async (
        organizationId,
        memberExternalId,
      ): Promise<TeamTaskOrganizationMemberSnapshot | null> => {
        const member = this.state.members.get(memberExternalId);
        if (
          !member ||
          member.organizationId !== organizationId ||
          !member.organizationMembershipActive
        ) {
          return null;
        }
        return {
          organizationId: member.organizationId,
          userId: member.userId,
          userExternalId: member.userExternalId,
          organizationMemberExternalId: member.organizationMemberExternalId,
          organizationMembershipActive: member.organizationMembershipActive,
        };
      },
      insertContract: async (row) => {
        const id = this.nextContractId++;
        this.state.contracts.push({ ...structuredClone(row), id });
        return id;
      },
      lockCurrentContract: async (workItemId, contractVersionId) =>
        structuredClone(
          this.state.contracts.find(
            (item) => item.workItemId === workItemId && item.id === contractVersionId,
          ) ?? null,
        ),
      confirmContract: async (contractId, workItemId, confirmedByUserId, confirmedAt) => {
        const target = this.state.contracts.find(
          (item) => item.id === contractId && item.workItemId === workItemId,
        );
        if (!target || target.confirmedByUserId !== null || target.confirmedAt !== null) {
          return false;
        }
        target.confirmedByUserId = confirmedByUserId;
        target.confirmedAt = structuredClone(confirmedAt);
        return true;
      },
      insertAssignment: async (row) => {
        if (
          row.role === 'responsible' &&
          row.status === 'accepted' &&
          [...this.state.assignments.values()].some(
            (assignment) =>
              assignment.workItemId === row.workItemId &&
              assignment.role === 'responsible' &&
              assignment.status === 'accepted',
          )
        ) {
          const error = new Error('duplicate responsible') as Error & { code: string };
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        const id = this.nextAssignmentId++;
        this.state.assignments.set(row.externalId, { ...structuredClone(row), id });
        return id;
      },
      loadAssignment: async (assignmentExternalId) =>
        structuredClone(this.state.assignments.get(assignmentExternalId) ?? null),
      listAssignments: async (workItemId) =>
        structuredClone(
          [...this.state.assignments.values()].filter(
            (assignment) => assignment.workItemId === workItemId,
          ),
        ),
      updateAssignment: async (assignmentId, expectedStatus, update) => {
        const entry = [...this.state.assignments.entries()].find(
          ([, assignment]) => assignment.id === assignmentId,
        );
        if (!entry || entry[1].status !== expectedStatus) return false;
        this.state.assignments.set(entry[0], { ...entry[1], ...structuredClone(update) });
        return true;
      },
      appendEvent: async (event) => {
        if (
          this.state.events.some(
            (existing) =>
              existing.organizationId === event.organizationId &&
              existing.idempotencyKey === event.idempotencyKey,
          )
        ) {
          const error = new Error('duplicate idempotency key') as Error & { code: string };
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        this.state.events.push(structuredClone(event));
      },
    };
  }
}

function createHarness(now: () => string = () => NOW) {
  const repository = new MemoryRepository();
  const counters = new Map<string, number>();
  const service = new TeamTaskService(repository, {
    now,
    isLifecycleEnabled: () => true,
    newId: (kind) => {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      const prefix = {
        teamWorkItem: 'twi',
        teamWorkItemAssignment: 'twa',
        acceptanceContractVersion: 'acv',
        teamWorkItemEvent: 'twe',
      }[kind];
      return `${prefix}_${String(next).padStart(21, '1')}`;
    },
  });
  return { repository, service };
}

async function expectCode(promise: Promise<unknown>, code: TeamTaskServiceError['code']) {
  await expect(promise).rejects.toMatchObject({ name: 'TeamTaskServiceError', code });
}

function present<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  if (value === null || value === undefined) throw new Error('expected fixture value');
  return value;
}

function receiptAssignmentId(value: { assignmentId?: string }): string {
  return present(value.assignmentId);
}

async function createDraft(
  service: TeamTaskService,
  assignmentMode: 'direct' | 'first_come' | 'leader_select' = 'direct',
) {
  return service.createDraft({
    actorExternalId: ids.actor,
    projectExternalId: ids.project,
    title: '研究任务',
    description: '完成研究',
    assignmentMode,
    expectedVersion: 0,
    idempotencyKey: `create-${assignmentMode}`,
  });
}

async function publish(service: TeamTaskService, workItemExternalId: string, key = 'publish-1') {
  return service.publish({
    actorExternalId: ids.actor,
    workItemExternalId,
    contract: contract(),
    expectedVersion: 1,
    idempotencyKey: key,
  });
}

describe('TeamTaskService', () => {
  it('hides personal, cross-tenant, inactive, and unreadable projects when creating drafts', async () => {
    const { repository, service } = createHarness();
    const base = {
      actorExternalId: ids.actor,
      title: '任务',
      description: null,
      assignmentMode: 'direct' as const,
      expectedVersion: 0,
      idempotencyKey: 'hidden-project',
    };
    await expectCode(
      service.createDraft({ ...base, projectExternalId: ids.personalProject }),
      'NOT_FOUND',
    );
    await expectCode(
      service.createDraft({ ...base, projectExternalId: ids.hiddenProject }),
      'NOT_FOUND',
    );
    const access = present(repository.state.projects.get(`${ids.actor}:${ids.project}`));
    access.organizationActive = false;
    await expectCode(service.createDraft({ ...base, projectExternalId: ids.project }), 'NOT_FOUND');
    expect(repository.state.workItems.size).toBe(0);
  });

  it('requires expectedVersion zero, bounded valid inputs, and the nested lifecycle gate', async () => {
    const { repository } = createHarness();
    const disabled = new TeamTaskService(repository, {
      now: () => NOW,
      isLifecycleEnabled: () => false,
      newId: () => 'twi_111111111111111111111',
    });
    await expectCode(
      disabled.createDraft({
        actorExternalId: ids.actor,
        projectExternalId: ids.project,
        title: '任务',
        description: null,
        assignmentMode: 'direct',
        expectedVersion: 0,
        idempotencyKey: 'disabled',
      }),
      'NOT_FOUND',
    );
    const { service } = createHarness();
    await expectCode(
      service.createDraft({
        actorExternalId: ids.actor,
        projectExternalId: ids.project,
        title: '',
        description: null,
        assignmentMode: 'direct',
        expectedVersion: 1,
        idempotencyKey: '',
      }),
      'INVALID_INPUT',
    );
    await expectCode(
      service.createDraft({
        actorExternalId: ids.actor,
        projectExternalId: ids.project,
        title: '任务',
        description: null,
        assignmentMode: 'invalid' as 'direct',
        expectedVersion: 0,
        idempotencyKey: 'invalid-mode',
      }),
      'INVALID_INPUT',
    );
  });

  it('uses only the trusted actor context and returns an immutable idempotent draft receipt', async () => {
    const { repository, service } = createHarness();
    const input = {
      actorExternalId: ids.actor,
      projectExternalId: ids.project,
      title: ' 研究任务 ',
      description: ' 描述 ',
      assignmentMode: 'direct' as const,
      expectedVersion: 0,
      idempotencyKey: 'draft-idempotent',
      actorUserId: 999,
    };
    const first = await service.createDraft(input);
    const second = await service.createDraft(input);
    expect(second).toEqual(first);
    expect(repository.state.events).toHaveLength(1);
    expect(repository.state.events[0]?.actorUserId).toBe(1);
    expect(JSON.stringify(first)).not.toContain('actorUserId');
    await expectCode(service.createDraft({ ...input, title: '另一个任务' }), 'CONFLICT');
    expect(repository.state.workItems.size).toBe(1);
  });

  it('publishes a complete contract atomically and rejects invalid contracts without partial writes', async () => {
    const { repository, service } = createHarness();
    const draft = await createDraft(service);
    const beforeEvents = repository.state.events.length;
    await expectCode(
      service.publish({
        actorExternalId: ids.actor,
        workItemExternalId: draft.workItemId,
        contract: contract({ criteria: [] }),
        expectedVersion: 1,
        idempotencyKey: 'publish-invalid',
      }),
      'INVALID_INPUT',
    );
    expect(repository.state.contracts).toHaveLength(0);
    expect(repository.state.events).toHaveLength(beforeEvents);
    expect(repository.state.workItems.get(draft.workItemId)?.status).toBe('draft');

    const receipt = await publish(service, draft.workItemId);
    expect(receipt).toMatchObject({ command: 'publish', state: 'ready', version: 2 });
    expect(repository.state.contracts).toHaveLength(1);
    expect(repository.state.contracts[0]).toMatchObject({
      version: 1,
      approverUserId: 4,
      arbitratorUserId: 5,
    });
    expect(repository.state.workItems.get(draft.workItemId)).toMatchObject({
      status: 'ready',
      version: 2,
      dueAt: new Date('2026-09-02T01:00:00.000Z'),
    });
    expect(repository.state.events).toHaveLength(beforeEvents + 1);
    expect(await publish(service, draft.workItemId)).toEqual(receipt);
    expect(repository.state.events).toHaveLength(beforeEvents + 1);
  });

  it('replays a published receipt before revalidating a contract whose due date has since elapsed', async () => {
    let currentTime = NOW;
    const { repository, service } = createHarness(() => currentTime);
    const draft = await createDraft(service);
    const first = await publish(service, draft.workItemId, 'publish-across-time');
    currentTime = '2026-09-03T01:00:00.000Z';
    const replayed = await publish(service, draft.workItemId, 'publish-across-time');
    expect(replayed).toEqual(first);
    expect(repository.state.contracts).toHaveLength(1);
    expect(
      repository.state.events.filter((item) => item.eventType === 'task_published'),
    ).toHaveLength(1);
  });

  it('allows the independent arbitrator to be an active organization member outside the project', async () => {
    const { repository, service } = createHarness();
    present(repository.state.members.get(ids.arbitratorMembership)).projectMembershipActive = false;
    const draft = await createDraft(service);
    const published = await publish(service, draft.workItemId, 'org-arbitrator');
    expect(published).toMatchObject({ state: 'ready', version: 2 });
    expect(repository.state.contracts[0]).toMatchObject({ arbitratorUserId: 5 });
  });

  it('rejects responsiblePersonId at publish because assignment owns responsible selection', async () => {
    const { repository, service } = createHarness();
    const draft = await createDraft(service);
    await expectCode(
      service.publish({
        actorExternalId: ids.actor,
        workItemExternalId: draft.workItemId,
        contract: contract({ responsiblePersonId: ids.memberMembership }),
        expectedVersion: 1,
        idempotencyKey: 'publish-with-responsible',
      }),
      'INVALID_INPUT',
    );
    expect(repository.state.contracts).toHaveLength(0);
    expect(repository.state.workItems.get(draft.workItemId)?.status).toBe('draft');
  });

  it('returns VERSION_CONFLICT for a new mutation key with a stale version', async () => {
    const { service } = createHarness();
    const draft = await createDraft(service);
    await publish(service, draft.workItemId);
    await expectCode(
      service.offerAssignment({
        actorExternalId: ids.actor,
        workItemExternalId: draft.workItemId,
        targetMemberExternalId: ids.memberMembership,
        role: 'responsible',
        expectedVersion: 1,
        idempotencyKey: 'stale-offer',
      }),
      'VERSION_CONFLICT',
    );
  });

  it('supports direct responsible offer, decline, re-offer, and acceptance with membership re-check', async () => {
    const { repository, service } = createHarness();
    const draft = await createDraft(service);
    await publish(service, draft.workItemId);
    const offer = await service.offerAssignment({
      actorExternalId: ids.actor,
      workItemExternalId: draft.workItemId,
      targetMemberExternalId: ids.memberMembership,
      role: 'responsible',
      expectedVersion: 2,
      idempotencyKey: 'offer-1',
    });
    expect(offer).toMatchObject({ state: 'assigned', assignmentStatus: 'offered', version: 3 });
    const declined = await service.respondToAssignment({
      actorExternalId: ids.member,
      workItemExternalId: draft.workItemId,
      assignmentExternalId: receiptAssignmentId(offer),
      response: 'decline',
      expectedVersion: 3,
      idempotencyKey: 'decline-1',
    });
    expect(declined).toMatchObject({ state: 'assigned', assignmentStatus: 'declined', version: 4 });

    const secondOffer = await service.offerAssignment({
      actorExternalId: ids.actor,
      workItemExternalId: draft.workItemId,
      targetMemberExternalId: ids.memberMembership,
      role: 'responsible',
      expectedVersion: 4,
      idempotencyKey: 'offer-2',
    });
    present(repository.state.members.get(ids.memberMembership)).projectMembershipActive = false;
    await expectCode(
      service.respondToAssignment({
        actorExternalId: ids.member,
        workItemExternalId: draft.workItemId,
        assignmentExternalId: receiptAssignmentId(secondOffer),
        response: 'accept',
        expectedVersion: 5,
        idempotencyKey: 'accept-inactive',
      }),
      'NOT_FOUND',
    );
    present(repository.state.members.get(ids.memberMembership)).projectMembershipActive = true;
    const accepted = await service.respondToAssignment({
      actorExternalId: ids.member,
      workItemExternalId: draft.workItemId,
      assignmentExternalId: receiptAssignmentId(secondOffer),
      response: 'accept',
      expectedVersion: 5,
      idempotencyKey: 'accept-active',
    });
    expect(accepted).toMatchObject({
      state: 'accepted_by_member',
      assignmentStatus: 'accepted',
      version: 6,
    });
    expect(repository.state.contracts[0]).toMatchObject({
      confirmedByUserId: 2,
      confirmedAt: new Date(NOW),
    });
  });

  it('rejects direct acceptance when the proposed responsible is the frozen approver', async () => {
    const { repository, service } = createHarness();
    const draft = await createDraft(service);
    await publish(service, draft.workItemId);
    const offer = await service.offerAssignment({
      actorExternalId: ids.actor,
      workItemExternalId: draft.workItemId,
      targetMemberExternalId: ids.approverMembership,
      role: 'responsible',
      expectedVersion: 2,
      idempotencyKey: 'offer-approver',
    });
    await expectCode(
      service.respondToAssignment({
        actorExternalId: ids.approverUser,
        workItemExternalId: draft.workItemId,
        assignmentExternalId: receiptAssignmentId(offer),
        response: 'accept',
        expectedVersion: 3,
        idempotencyKey: 'accept-approver',
      }),
      'CONFLICT',
    );
    expect(repository.state.assignments.get(receiptAssignmentId(offer))?.status).toBe('offered');
    expect(repository.state.contracts[0]).toMatchObject({ confirmedByUserId: null });
  });

  it('rejects first-come acquisition when the proposed responsible is the frozen arbitrator', async () => {
    const { repository, service } = createHarness();
    const draft = await createDraft(service, 'first_come');
    await publish(service, draft.workItemId);
    await expectCode(
      service.claim({
        actorExternalId: ids.arbitratorUser,
        workItemExternalId: draft.workItemId,
        memberExternalId: ids.arbitratorMembership,
        expectedVersion: 2,
        idempotencyKey: 'claim-arbitrator',
      }),
      'CONFLICT',
    );
    expect(repository.state.assignments.size).toBe(0);
    expect(repository.state.contracts[0]).toMatchObject({ confirmedByUserId: null });
  });

  it.each([
    {
      caseName: 'missing current contract pointer',
      mutate: (item: TeamTaskWorkItemRow, _contract: TeamTaskContractRow) => {
        item.currentContractVersionId = null;
      },
    },
    {
      caseName: 'stale current contract pointer',
      mutate: (item: TeamTaskWorkItemRow, _contract: TeamTaskContractRow) => {
        item.currentContractVersionId = 999;
      },
    },
    {
      caseName: 'an inconsistently pre-confirmed contract',
      mutate: (_item: TeamTaskWorkItemRow, frozen: TeamTaskContractRow) => {
        frozen.confirmedByUserId = 3;
        frozen.confirmedAt = new Date(NOW);
      },
    },
  ])('rejects responsible acceptance with $caseName', async ({ mutate }) => {
    const { repository, service } = createHarness();
    const draft = await createDraft(service);
    await publish(service, draft.workItemId);
    const offer = await service.offerAssignment({
      actorExternalId: ids.actor,
      workItemExternalId: draft.workItemId,
      targetMemberExternalId: ids.memberMembership,
      role: 'responsible',
      expectedVersion: 2,
      idempotencyKey: 'offer-invalid-contract',
    });
    mutate(
      present(repository.state.workItems.get(draft.workItemId)),
      present(repository.state.contracts[0]),
    );
    await expectCode(
      service.respondToAssignment({
        actorExternalId: ids.member,
        workItemExternalId: draft.workItemId,
        assignmentExternalId: receiptAssignmentId(offer),
        response: 'accept',
        expectedVersion: 3,
        idempotencyKey: 'accept-invalid-contract',
      }),
      'CONFLICT',
    );
    expect(repository.state.assignments.get(receiptAssignmentId(offer))?.status).toBe('offered');
  });

  it('supports collaborator offers without changing the responsible state', async () => {
    const { service } = createHarness();
    const draft = await createDraft(service);
    await publish(service, draft.workItemId);
    const offer = await service.offerAssignment({
      actorExternalId: ids.actor,
      workItemExternalId: draft.workItemId,
      targetMemberExternalId: ids.memberMembership,
      role: 'collaborator',
      expectedVersion: 2,
      idempotencyKey: 'collaborator-offer',
    });
    expect(offer).toMatchObject({ state: 'ready', assignmentStatus: 'offered', version: 3 });
    const accepted = await service.respondToAssignment({
      actorExternalId: ids.member,
      workItemExternalId: draft.workItemId,
      assignmentExternalId: receiptAssignmentId(offer),
      response: 'accept',
      expectedVersion: 3,
      idempotencyKey: 'collaborator-accept',
    });
    expect(accepted).toMatchObject({ state: 'ready', assignmentStatus: 'accepted', version: 4 });
  });

  it('lets exactly one eligible member win a concurrent first-come claim', async () => {
    const { repository, service } = createHarness();
    const draft = await createDraft(service, 'first_come');
    const published = await publish(service, draft.workItemId);
    expect(published).toMatchObject({ state: 'claimable', version: 2 });
    const results = await Promise.allSettled([
      service.claim({
        actorExternalId: ids.member,
        workItemExternalId: draft.workItemId,
        memberExternalId: ids.memberMembership,
        expectedVersion: 2,
        idempotencyKey: 'claim-a',
      }),
      service.claim({
        actorExternalId: ids.secondMember,
        workItemExternalId: draft.workItemId,
        memberExternalId: ids.secondMembership,
        expectedVersion: 2,
        idempotencyKey: 'claim-b',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure).toMatchObject({ reason: { code: 'CONFLICT' } });
    const accepted = [...repository.state.assignments.values()].filter(
      (assignment) => assignment.role === 'responsible' && assignment.status === 'accepted',
    );
    expect(accepted).toHaveLength(1);
    expect(
      repository.state.events.filter((event) => event.eventType === 'task_claimed'),
    ).toHaveLength(1);
    const winner = present(accepted[0]);
    expect(repository.state.contracts[0]).toMatchObject({
      confirmedByUserId: winner.userId,
      confirmedAt: new Date(NOW),
    });
  });

  it('records leader-select applications and lets an authorized lead choose exactly one', async () => {
    const { repository, service } = createHarness();
    const draft = await createDraft(service, 'leader_select');
    await publish(service, draft.workItemId);
    const first = await service.claim({
      actorExternalId: ids.member,
      workItemExternalId: draft.workItemId,
      memberExternalId: ids.memberMembership,
      expectedVersion: 2,
      idempotencyKey: 'apply-a',
    });
    const second = await service.claim({
      actorExternalId: ids.secondMember,
      workItemExternalId: draft.workItemId,
      memberExternalId: ids.secondMembership,
      expectedVersion: 3,
      idempotencyKey: 'apply-b',
    });
    expect(first).toMatchObject({ state: 'claimable', assignmentStatus: 'applied', version: 3 });
    expect(second).toMatchObject({ state: 'claimable', assignmentStatus: 'applied', version: 4 });
    const selected = await service.selectClaim({
      actorExternalId: ids.actor,
      workItemExternalId: draft.workItemId,
      assignmentExternalId: receiptAssignmentId(second),
      expectedVersion: 4,
      idempotencyKey: 'select-b',
    });
    expect(selected).toMatchObject({
      state: 'accepted_by_member',
      assignmentStatus: 'accepted',
      version: 5,
    });
    expect(repository.state.assignments.get(receiptAssignmentId(first))?.status).toBe('declined');
    expect(repository.state.assignments.get(receiptAssignmentId(second))?.status).toBe('accepted');
    expect(repository.state.contracts[0]).toMatchObject({
      confirmedByUserId: 3,
      confirmedAt: new Date(NOW),
    });
  });

  it.each([
    'submitted',
    'in_review',
    'revision_requested',
    'resubmitted',
    'accepted',
    'completed',
    'cancelled',
    'rejected_final',
    'archived',
  ] as const)('rejects a fresh collaborator response while the task is %s', async (status) => {
    const { repository, service } = createHarness();
    const draft = await createDraft(service);
    await publish(service, draft.workItemId);
    const offer = await service.offerAssignment({
      actorExternalId: ids.actor,
      workItemExternalId: draft.workItemId,
      targetMemberExternalId: ids.memberMembership,
      role: 'collaborator',
      expectedVersion: 2,
      idempotencyKey: `offer-${status}`,
    });
    const item = present(repository.state.workItems.get(draft.workItemId));
    item.status = status;
    await expectCode(
      service.respondToAssignment({
        actorExternalId: ids.member,
        workItemExternalId: draft.workItemId,
        assignmentExternalId: receiptAssignmentId(offer),
        response: 'accept',
        expectedVersion: 3,
        idempotencyKey: `respond-${status}`,
      }),
      'CONFLICT',
    );
    expect(repository.state.assignments.get(receiptAssignmentId(offer))?.status).toBe('offered');
  });

  it('binds idempotency replay to the authenticated actor', async () => {
    const { repository, service } = createHarness();
    const draft = await createDraft(service, 'first_come');
    await publish(service, draft.workItemId);
    const first = await service.claim({
      actorExternalId: ids.member,
      workItemExternalId: draft.workItemId,
      memberExternalId: ids.memberMembership,
      expectedVersion: 2,
      idempotencyKey: 'actor-bound-claim',
    });
    await expectCode(
      service.claim({
        actorExternalId: ids.secondMember,
        workItemExternalId: draft.workItemId,
        memberExternalId: ids.memberMembership,
        expectedVersion: 2,
        idempotencyKey: 'actor-bound-claim',
      }),
      'CONFLICT',
    );
    expect(
      await service.claim({
        actorExternalId: ids.member,
        workItemExternalId: draft.workItemId,
        memberExternalId: ids.memberMembership,
        expectedVersion: 2,
        idempotencyKey: 'actor-bound-claim',
      }),
    ).toEqual(first);
    expect(
      repository.state.events.filter((event) => event.eventType === 'task_claimed'),
    ).toHaveLength(1);
  });

  it('rejects claims by viewers, mismatched member IDs, and inactive targets', async () => {
    const { repository, service } = createHarness();
    const draft = await createDraft(service, 'first_come');
    await publish(service, draft.workItemId);
    present(repository.state.projects.get(`${ids.member}:${ids.project}`)).actorProjectRole =
      'viewer';
    await expectCode(
      service.claim({
        actorExternalId: ids.member,
        workItemExternalId: draft.workItemId,
        memberExternalId: ids.memberMembership,
        expectedVersion: 2,
        idempotencyKey: 'viewer-claim',
      }),
      'FORBIDDEN',
    );
    present(repository.state.projects.get(`${ids.member}:${ids.project}`)).actorProjectRole =
      'member';
    await expectCode(
      service.claim({
        actorExternalId: ids.member,
        workItemExternalId: draft.workItemId,
        memberExternalId: ids.secondMembership,
        expectedVersion: 2,
        idempotencyKey: 'mismatch-claim',
      }),
      'FORBIDDEN',
    );
    present(repository.state.members.get(ids.memberMembership)).organizationMembershipActive =
      false;
    await expectCode(
      service.claim({
        actorExternalId: ids.member,
        workItemExternalId: draft.workItemId,
        memberExternalId: ids.memberMembership,
        expectedVersion: 2,
        idempotencyKey: 'inactive-claim',
      }),
      'NOT_FOUND',
    );
  });

  it('maps malformed runtime input and repository uniqueness failures to stable domain errors', async () => {
    const { repository, service } = createHarness();
    await expectCode(service.createDraft(null as never), 'INVALID_INPUT');
    const draft = await createDraft(service, 'first_come');
    await publish(service, draft.workItemId);
    const original = repository.transaction.bind(repository);
    repository.transaction = async (work) =>
      original(async (tx) =>
        work({
          ...tx,
          insertAssignment: async () => {
            const error = new Error('duplicate') as Error & { code: string };
            error.code = 'ER_DUP_ENTRY';
            throw error;
          },
        }),
      );
    await expectCode(
      service.claim({
        actorExternalId: ids.member,
        workItemExternalId: draft.workItemId,
        memberExternalId: ids.memberMembership,
        expectedVersion: 2,
        idempotencyKey: 'duplicate-claim',
      }),
      'CONFLICT',
    );
  });
});
