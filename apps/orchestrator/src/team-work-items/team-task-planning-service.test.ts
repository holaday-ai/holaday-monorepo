import { describe, expect, it } from 'vitest';
import type { AcceptanceContractInput } from './acceptance-contract.js';
import {
  type PlanningContractRow,
  type PlanningDependencyRow,
  type PlanningMilestoneEventRow,
  type PlanningMilestoneRow,
  type PlanningRepository,
  type PlanningTransaction,
  type PlanningWorkItemRow,
  TeamTaskPlanningService,
  type TeamTaskPlanningServiceError,
} from './team-task-planning-service.js';
import type {
  TeamTaskAssignmentRow,
  TeamTaskEventRow,
  TeamTaskMemberSnapshot,
  TeamTaskOrganizationMemberSnapshot,
  TeamTaskProjectAccessSnapshot,
} from './team-task-service.js';

const NOW = '2026-08-31T01:00:00.000Z';

const ids = {
  lead: 'usr_Lead11111111111111111',
  member: 'usr_Member222222222222222',
  otherMember: 'usr_Member333333333333333',
  approverUser: 'usr_Approver4444444444444',
  arbitratorUser: 'usr_Arbitrator55555555555',
  project: 'prj_Project11111111111111',
  foreignProject: 'prj_Project22222222222222',
  memberMembership: 'omem_111111111111111111111',
  otherMembership: 'omem_222222222222222222222',
  approverMembership: 'omem_333333333333333333333',
  arbitratorMembership: 'omem_444444444444444444444',
  target: 'twi_Target111111111111111',
  prerequisite: 'twi_Prereq222222222222222',
  secondPrerequisite: 'twi_Prereq333333333333333',
  foreignWorkItem: 'twi_Foreign44444444444444',
  contractV1: 'acv_Contract1111111111111',
  foreignContract: 'acv_Foreign22222222222222',
  milestone: 'tml_Milestone111111111111',
  secondMilestone: 'tml_Milestone222222222222',
  foreignMilestone: 'tml_Milestone333333333333',
} as const;

const contract = (overrides: Partial<AcceptanceContractInput> = {}): AcceptanceContractInput => ({
  objective: '交付新版研究报告',
  deliverables: ['新版 PDF 报告'],
  criteria: [{ id: 'criterion-1', description: '包含 12 个可核验来源' }],
  requiredEvidenceTypes: [{ type: 'report' }],
  approverId: ids.approverMembership,
  arbitratorId: ids.arbitratorMembership,
  dueAt: '2026-09-05T01:00:00.000Z',
  maxRevisionRounds: 2,
  ...overrides,
});

type State = {
  projects: Map<string, TeamTaskProjectAccessSnapshot>;
  workItems: Map<string, PlanningWorkItemRow>;
  dependencies: PlanningDependencyRow[];
  milestones: Map<string, PlanningMilestoneRow>;
  planningEvents: PlanningMilestoneEventRow[];
  assignments: TeamTaskAssignmentRow[];
  members: Map<string, TeamTaskMemberSnapshot>;
  contracts: PlanningContractRow[];
  events: TeamTaskEventRow[];
};

function cloneState(state: State): State {
  return {
    projects: new Map([...state.projects].map(([key, value]) => [key, structuredClone(value)])),
    workItems: new Map([...state.workItems].map(([key, value]) => [key, structuredClone(value)])),
    dependencies: structuredClone(state.dependencies),
    milestones: new Map([...state.milestones].map(([key, value]) => [key, structuredClone(value)])),
    planningEvents: structuredClone(state.planningEvents),
    assignments: structuredClone(state.assignments),
    members: new Map([...state.members].map(([key, value]) => [key, structuredClone(value)])),
    contracts: structuredClone(state.contracts),
    events: structuredClone(state.events),
  };
}

function access(
  actorExternalId: string,
  actorUserId: number,
  actorOrganizationRole: TeamTaskProjectAccessSnapshot['actorOrganizationRole'],
  actorProjectRole: TeamTaskProjectAccessSnapshot['actorProjectRole'],
  projectExternalId: string = ids.project,
  projectId = 20,
  organizationId = 10,
): TeamTaskProjectAccessSnapshot {
  return {
    actorUserId,
    actorExternalId,
    actorOrganizationRole,
    actorOrganizationMembershipActive: true,
    actorProjectRole,
    actorProjectMembershipActive: true,
    organizationId,
    organizationExternalId: `org_${String(organizationId).padStart(21, '1')}`,
    organizationActive: true,
    organizationTeamProjectsEnabled: true,
    projectId,
    projectExternalId,
    projectOrganizationId: organizationId,
  };
}

function workItem(
  id: number,
  externalId: string,
  status: PlanningWorkItemRow['status'],
  projectExternalId: string = ids.project,
  projectId = 20,
  organizationId = 10,
): PlanningWorkItemRow {
  return {
    id,
    externalId,
    organizationId,
    projectId,
    projectExternalId,
    createdByUserId: 1,
    status,
    version: 1,
    currentContractVersionId: 1,
    dueAt: new Date('2026-09-02T01:00:00.000Z'),
    blocker: null,
    milestoneId: null,
  };
}

class MemoryRepository implements PlanningRepository {
  state: State;
  private queue: Promise<void> = Promise.resolve();
  private nextDependencyId = 1;
  private nextContractId = 2;
  private nextMilestoneId = 3;

  constructor() {
    const target = workItem(1, ids.target, 'accepted_by_member');
    const prerequisite = workItem(2, ids.prerequisite, 'completed');
    const secondPrerequisite = workItem(3, ids.secondPrerequisite, 'completed');
    const foreign = workItem(4, ids.foreignWorkItem, 'completed', ids.foreignProject, 30, 11);
    const leader = access(ids.lead, 1, 'owner', 'lead');
    const responsible = access(ids.member, 2, 'member', 'member');
    const otherMember = access(ids.otherMember, 3, 'member', 'member');
    this.state = {
      projects: new Map([
        [`${ids.lead}:${ids.project}`, leader],
        [`${ids.member}:${ids.project}`, responsible],
        [`${ids.otherMember}:${ids.project}`, otherMember],
        [`${ids.approverUser}:${ids.project}`, access(ids.approverUser, 4, 'member', 'lead')],
      ]),
      workItems: new Map([
        [ids.target, target],
        [ids.prerequisite, prerequisite],
        [ids.secondPrerequisite, secondPrerequisite],
        [ids.foreignWorkItem, foreign],
      ]),
      dependencies: [],
      milestones: new Map([
        [
          ids.milestone,
          {
            id: 1,
            externalId: ids.milestone,
            organizationId: 10,
            projectId: 20,
            createdByUserId: 1,
            title: '研究阶段',
            description: '完成资料收集',
            status: 'open',
            version: 1,
            sortOrder: 0,
            dueAt: new Date('2026-09-03T01:00:00.000Z'),
          },
        ],
        [
          ids.secondMilestone,
          {
            id: 2,
            externalId: ids.secondMilestone,
            organizationId: 10,
            projectId: 20,
            createdByUserId: 1,
            title: '交付阶段',
            description: null,
            status: 'open',
            version: 1,
            sortOrder: 1,
            dueAt: null,
          },
        ],
        [
          ids.foreignMilestone,
          {
            id: 30,
            externalId: ids.foreignMilestone,
            organizationId: 11,
            projectId: 30,
            createdByUserId: 9,
            title: '外部里程碑',
            description: null,
            status: 'open',
            version: 1,
            sortOrder: 0,
            dueAt: null,
          },
        ],
      ]),
      planningEvents: [],
      assignments: [
        {
          id: 1,
          externalId: 'twa_Assignment111111111111',
          organizationId: 10,
          projectId: 20,
          workItemId: 1,
          userId: 2,
          organizationMemberExternalId: ids.memberMembership,
          role: 'responsible',
          status: 'accepted',
          offeredByUserId: 1,
          respondedAt: new Date(NOW),
        },
      ],
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
          ids.otherMembership,
          {
            organizationId: 10,
            projectId: 20,
            userId: 3,
            userExternalId: ids.otherMember,
            organizationMemberExternalId: ids.otherMembership,
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
            projectMembershipActive: false,
            projectRole: 'member',
          },
        ],
      ]),
      contracts: [
        {
          id: 1,
          externalId: ids.contractV1,
          organizationId: 10,
          projectId: 20,
          workItemId: 1,
          version: 1,
          objective: '原始目标',
          deliverables: ['原始报告'],
          criteria: [{ id: 'criterion-1', description: '包含 10 个来源' }],
          requiredEvidenceTypes: [{ type: 'report' }],
          approverUserId: 4,
          arbitratorUserId: 5,
          dueAt: new Date('2026-09-02T01:00:00.000Z'),
          maxRevisionRounds: 2,
          versionNote: null,
          createdByUserId: 1,
          confirmedByUserId: 2,
          confirmedAt: new Date(NOW),
        },
      ],
      events: [],
    };
  }

  async transaction<T>(work: (tx: PlanningTransaction) => Promise<T>): Promise<T> {
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

  private tx(): PlanningTransaction {
    return {
      loadProjectAccess: async (actorExternalId, projectExternalId) =>
        structuredClone(this.state.projects.get(`${actorExternalId}:${projectExternalId}`) ?? null),
      lockWorkItemAccess: async (actorExternalId, workItemExternalId) => {
        const item = this.state.workItems.get(workItemExternalId);
        if (!item) return null;
        const project = this.state.projects.get(`${actorExternalId}:${item.projectExternalId}`);
        return project
          ? { access: structuredClone(project), workItem: structuredClone(item) }
          : null;
      },
      lockWorkItemByExternalId: async (workItemExternalId) =>
        structuredClone(this.state.workItems.get(workItemExternalId) ?? null),
      findEventByIdempotencyKey: async (organizationId, idempotencyKey) =>
        structuredClone(
          this.state.events.find(
            (event) =>
              event.organizationId === organizationId && event.idempotencyKey === idempotencyKey,
          ) ?? null,
        ),
      lockOrganizationIdempotencyScope: async (organizationId) => organizationId === 10,
      lockMilestoneAccess: async (actorExternalId, milestoneExternalId) => {
        const milestone = this.state.milestones.get(milestoneExternalId);
        if (!milestone) return null;
        const project = [...this.state.projects.values()].find(
          (candidate) =>
            candidate.actorExternalId === actorExternalId &&
            candidate.projectId === milestone.projectId &&
            candidate.organizationId === milestone.organizationId,
        );
        return project
          ? { access: structuredClone(project), milestone: structuredClone(milestone) }
          : null;
      },
      lockMilestoneByExternalId: async (milestoneExternalId) =>
        structuredClone(this.state.milestones.get(milestoneExternalId) ?? null),
      findPlanningEventByIdempotencyKey: async (organizationId, idempotencyKey) =>
        structuredClone(
          this.state.planningEvents.find(
            (event) =>
              event.organizationId === organizationId && event.idempotencyKey === idempotencyKey,
          ) ?? null,
        ),
      listMilestones: async (organizationId, projectId) =>
        structuredClone(
          [...this.state.milestones.values()]
            .filter(
              (milestone) =>
                milestone.organizationId === organizationId && milestone.projectId === projectId,
            )
            .sort((left, right) => left.externalId.localeCompare(right.externalId)),
        ),
      insertMilestone: async (row) => {
        const id = this.nextMilestoneId++;
        this.state.milestones.set(row.externalId, { ...structuredClone(row), id });
        return id;
      },
      updateMilestone: async (milestoneId, expectedVersion, update) => {
        const entry = [...this.state.milestones.entries()].find(
          ([, milestone]) => milestone.id === milestoneId,
        );
        if (!entry || entry[1].version !== expectedVersion) return false;
        this.state.milestones.set(entry[0], { ...entry[1], ...structuredClone(update) });
        return true;
      },
      appendPlanningEvent: async (event) => {
        if (
          this.state.planningEvents.some(
            (existing) =>
              existing.organizationId === event.organizationId &&
              existing.idempotencyKey === event.idempotencyKey,
          )
        ) {
          const error = new Error('duplicate planning idempotency') as Error & { code: string };
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        this.state.planningEvents.push(structuredClone(event));
      },
      listDependencies: async (organizationId, projectId) =>
        structuredClone(
          this.state.dependencies.filter(
            (edge) => edge.organizationId === organizationId && edge.projectId === projectId,
          ),
        ),
      insertDependency: async (row) => {
        if (
          this.state.dependencies.some(
            (edge) =>
              edge.workItemId === row.workItemId &&
              edge.dependsOnWorkItemId === row.dependsOnWorkItemId,
          )
        ) {
          const error = new Error('duplicate edge') as Error & { code: string };
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        this.state.dependencies.push({ ...structuredClone(row), id: this.nextDependencyId++ });
      },
      listPrerequisites: async (workItemId) => {
        const prerequisiteIds = this.state.dependencies
          .filter((edge) => edge.workItemId === workItemId)
          .map((edge) => edge.dependsOnWorkItemId);
        return structuredClone(
          [...this.state.workItems.values()].filter((item) => prerequisiteIds.includes(item.id)),
        );
      },
      listAssignments: async (workItemId) =>
        structuredClone(
          this.state.assignments.filter((assignment) => assignment.workItemId === workItemId),
        ),
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
          organizationId,
          userId: member.userId,
          userExternalId: member.userExternalId,
          organizationMemberExternalId: member.organizationMemberExternalId,
          organizationMembershipActive: true,
        };
      },
      lockContractById: async (workItemId, contractId) =>
        structuredClone(
          this.state.contracts.find(
            (item) => item.workItemId === workItemId && item.id === contractId,
          ) ?? null,
        ),
      lockContractByExternalId: async (workItemId, contractExternalId) =>
        structuredClone(
          this.state.contracts.find(
            (item) => item.workItemId === workItemId && item.externalId === contractExternalId,
          ) ?? null,
        ),
      lockLatestContract: async (workItemId) =>
        structuredClone(
          this.state.contracts
            .filter((item) => item.workItemId === workItemId)
            .sort((left, right) => right.version - left.version)[0] ?? null,
        ),
      insertContract: async (row) => {
        const id = this.nextContractId++;
        this.state.contracts.push({ ...structuredClone(row), id });
        return id;
      },
      confirmContract: async (contractId, workItemId, userId, confirmedAt) => {
        const item = this.state.contracts.find(
          (candidate) => candidate.id === contractId && candidate.workItemId === workItemId,
        );
        if (!item || item.confirmedByUserId !== null || item.confirmedAt !== null) return false;
        item.confirmedByUserId = userId;
        item.confirmedAt = structuredClone(confirmedAt);
        return true;
      },
      hasContractDecision: async (workItemId, contractId) =>
        this.state.events.some(
          (event) =>
            event.workItemId === workItemId &&
            event.contractVersionId === contractId &&
            (event.eventType === 'contract_version_confirmed' ||
              event.eventType === 'contract_version_rejected'),
        ),
      updateWorkItem: async (workItemId, expectedVersion, update) => {
        const entry = [...this.state.workItems.entries()].find(
          ([, item]) => item.id === workItemId,
        );
        if (!entry || entry[1].version !== expectedVersion) return false;
        this.state.workItems.set(entry[0], { ...entry[1], ...structuredClone(update) });
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
          const error = new Error('duplicate idempotency') as Error & { code: string };
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        this.state.events.push(structuredClone(event));
      },
    };
  }
}

function createHarness(
  dependencyOverrides: Partial<{
    maxTraversalNodes: number;
    maxTraversalEdges: number;
  }> = {},
) {
  const repository = new MemoryRepository();
  const counters = new Map<string, number>();
  const service = new TeamTaskPlanningService(repository, {
    now: () => NOW,
    isLifecycleEnabled: () => true,
    maxTraversalNodes: 8,
    maxTraversalEdges: 16,
    ...dependencyOverrides,
    newId: (kind) => {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      const prefix = {
        acceptanceContractVersion: 'acv',
        teamWorkItemEvent: 'twe',
        teamMilestone: 'tml',
        teamProjectPlanningEvent: 'tpe',
      }[kind];
      return `${prefix}_${String(next).padStart(21, '1')}`;
    },
  });
  return { repository, service };
}

async function expectCode(promise: Promise<unknown>, code: TeamTaskPlanningServiceError['code']) {
  await expect(promise).rejects.toMatchObject({ name: 'TeamTaskServiceError', code });
}

describe('TeamTaskPlanningService', () => {
  it('adds a same-project dependency once and replays the original actor-bound receipt', async () => {
    const { repository, service } = createHarness();
    const input = {
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      dependsOnWorkItemExternalId: ids.prerequisite,
      expectedVersion: 1,
      idempotencyKey: 'dependency-1',
    };
    const first = await service.addDependency(input);
    const replayed = await service.addDependency(input);
    expect(replayed).toEqual(first);
    expect(first).toMatchObject({
      command: 'add_dependency',
      workItemId: ids.target,
      dependsOnWorkItemId: ids.prerequisite,
      state: 'accepted_by_member',
      version: 2,
    });
    expect(repository.state.dependencies).toHaveLength(1);
    expect(repository.state.events).toHaveLength(1);
    expect(repository.state.events[0]?.actorUserId).toBe(1);
    expect(JSON.stringify(first)).not.toContain('actorUserId');
  });

  it('hides foreign prerequisites and rejects self or duplicate edges without partial writes', async () => {
    const { repository, service } = createHarness();
    const base = {
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      expectedVersion: 1,
    };
    await expectCode(
      service.addDependency({
        ...base,
        dependsOnWorkItemExternalId: ids.foreignWorkItem,
        idempotencyKey: 'foreign-dependency',
      }),
      'NOT_FOUND',
    );
    await expectCode(
      service.addDependency({
        ...base,
        dependsOnWorkItemExternalId: ids.target,
        idempotencyKey: 'self-dependency',
      }),
      'INVALID_INPUT',
    );
    await service.addDependency({
      ...base,
      dependsOnWorkItemExternalId: ids.prerequisite,
      idempotencyKey: 'first-edge',
    });
    await expectCode(
      service.addDependency({
        ...base,
        expectedVersion: 2,
        dependsOnWorkItemExternalId: ids.prerequisite,
        idempotencyKey: 'duplicate-edge',
      }),
      'CONFLICT',
    );
    expect(repository.state.dependencies).toHaveLength(1);
    expect(repository.state.events).toHaveLength(1);
  });

  it('rejects an edge that closes a dependency cycle', async () => {
    const { repository, service } = createHarness();
    await service.addDependency({
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      dependsOnWorkItemExternalId: ids.prerequisite,
      expectedVersion: 1,
      idempotencyKey: 'cycle-first',
    });
    await expectCode(
      service.addDependency({
        actorExternalId: ids.lead,
        workItemExternalId: ids.prerequisite,
        dependsOnWorkItemExternalId: ids.target,
        expectedVersion: 1,
        idempotencyKey: 'cycle-close',
      }),
      'CONFLICT',
    );
    expect(repository.state.dependencies).toHaveLength(1);
    expect(repository.state.events).toHaveLength(1);
  });

  it('fails closed when dependency traversal exceeds its node or edge budget', async () => {
    const nodeBound = createHarness({ maxTraversalNodes: 1 });
    nodeBound.repository.state.dependencies.push({
      id: 90,
      organizationId: 10,
      projectId: 20,
      workItemId: 1,
      dependsOnWorkItemId: 2,
      createdByUserId: 1,
    });
    await expectCode(
      nodeBound.service.addDependency({
        actorExternalId: ids.lead,
        workItemExternalId: ids.prerequisite,
        dependsOnWorkItemExternalId: ids.secondPrerequisite,
        expectedVersion: 1,
        idempotencyKey: 'node-bound',
      }),
      'CONFLICT',
    );

    const edgeBound = createHarness({ maxTraversalEdges: 0 });
    await expectCode(
      edgeBound.service.addDependency({
        actorExternalId: ids.lead,
        workItemExternalId: ids.target,
        dependsOnWorkItemExternalId: ids.prerequisite,
        expectedVersion: 1,
        idempotencyKey: 'edge-bound',
      }),
      'CONFLICT',
    );
    expect(nodeBound.repository.state.events).toHaveLength(0);
    expect(edgeBound.repository.state.events).toHaveLength(0);
  });

  it('binds dependency idempotency to actor and payload and rejects stale/concurrent losers', async () => {
    const { repository, service } = createHarness();
    const input = {
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      dependsOnWorkItemExternalId: ids.prerequisite,
      expectedVersion: 1,
      idempotencyKey: 'actor-bound-dependency',
    };
    await service.addDependency(input);
    await expectCode(
      service.addDependency({ ...input, actorExternalId: ids.approverUser }),
      'CONFLICT',
    );
    await expectCode(
      service.addDependency({ ...input, dependsOnWorkItemExternalId: ids.secondPrerequisite }),
      'CONFLICT',
    );
    await expectCode(
      service.addDependency({
        ...input,
        expectedVersion: 1,
        idempotencyKey: 'stale-dependency',
        dependsOnWorkItemExternalId: ids.secondPrerequisite,
      }),
      'VERSION_CONFLICT',
    );

    const concurrent = createHarness();
    const results = await Promise.allSettled([
      concurrent.service.addDependency({ ...input, idempotencyKey: 'concurrent-a' }),
      concurrent.service.addDependency({ ...input, idempotencyKey: 'concurrent-b' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'VERSION_CONFLICT' },
    });
    expect(concurrent.repository.state.dependencies).toHaveLength(1);
    expect(concurrent.repository.state.events).toHaveLength(1);
    expect(repository.state.dependencies).toHaveLength(1);
  });

  it('rejects malformed dependency input and viewer mutations before writes', async () => {
    const { repository, service } = createHarness();
    await expectCode(service.addDependency(null), 'INVALID_INPUT');
    const memberAccess = repository.state.projects.get(`${ids.otherMember}:${ids.project}`);
    expect(memberAccess).toBeDefined();
    if (!memberAccess) throw new Error('missing fixture');
    memberAccess.actorProjectRole = 'viewer';
    await expectCode(
      service.addDependency({
        actorExternalId: ids.otherMember,
        workItemExternalId: ids.target,
        dependsOnWorkItemExternalId: ids.prerequisite,
        expectedVersion: 1,
        idempotencyKey: 'viewer-dependency',
      }),
      'FORBIDDEN',
    );
    expect(repository.state.dependencies).toHaveLength(0);
  });

  it('starts only for the active responsible after every prerequisite is completed', async () => {
    const { repository, service } = createHarness();
    repository.state.dependencies.push({
      id: 1,
      organizationId: 10,
      projectId: 20,
      workItemId: 1,
      dependsOnWorkItemId: 2,
      createdByUserId: 1,
    });
    const input = {
      actorExternalId: ids.member,
      workItemExternalId: ids.target,
      expectedVersion: 1,
      idempotencyKey: 'start-complete',
    };
    const first = await service.start(input);
    expect(await service.start(input)).toEqual(first);
    expect(first).toMatchObject({
      command: 'start',
      workItemId: ids.target,
      state: 'in_progress',
      version: 2,
      incompletePrerequisiteCount: 0,
    });
    expect(repository.state.workItems.get(ids.target)).toMatchObject({
      status: 'in_progress',
      version: 2,
    });
    expect(repository.state.events).toHaveLength(1);
  });

  it('blocks start on unfinished prerequisites unless a lead records a bounded explicit override', async () => {
    const { repository, service } = createHarness();
    const prerequisite = repository.state.workItems.get(ids.prerequisite);
    expect(prerequisite).toBeDefined();
    if (!prerequisite) throw new Error('missing fixture');
    prerequisite.status = 'in_progress';
    repository.state.dependencies.push({
      id: 1,
      organizationId: 10,
      projectId: 20,
      workItemId: 1,
      dependsOnWorkItemId: 2,
      createdByUserId: 1,
    });
    await expectCode(
      service.start({
        actorExternalId: ids.member,
        workItemExternalId: ids.target,
        expectedVersion: 1,
        idempotencyKey: 'start-blocked',
      }),
      'CONFLICT',
    );
    await expectCode(
      service.start({
        actorExternalId: ids.member,
        workItemExternalId: ids.target,
        expectedVersion: 1,
        overrideReason: '客户批准先行启动',
        idempotencyKey: 'member-override',
      }),
      'FORBIDDEN',
    );
    await expectCode(
      service.start({
        actorExternalId: ids.lead,
        workItemExternalId: ids.target,
        expectedVersion: 1,
        overrideReason: 'x'.repeat(1_001),
        idempotencyKey: 'long-override',
      }),
      'INVALID_INPUT',
    );
    const overridden = await service.start({
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      expectedVersion: 1,
      overrideReason: ' 客户批准先行启动 ',
      idempotencyKey: 'lead-override',
    });
    expect(overridden).toMatchObject({
      command: 'start_with_override',
      state: 'in_progress',
      version: 2,
      incompletePrerequisiteCount: 1,
      overrideApplied: true,
    });
    expect(repository.state.events[0]).toMatchObject({
      eventType: 'task_started_with_dependency_override',
      actorUserId: 1,
      metadata: { overrideReason: '客户批准先行启动' },
    });
  });

  it('re-checks responsible membership and gives one deterministic concurrent start winner', async () => {
    const inactive = createHarness();
    const membership = inactive.repository.state.members.get(ids.memberMembership);
    expect(membership).toBeDefined();
    if (!membership) throw new Error('missing fixture');
    membership.projectMembershipActive = false;
    await expectCode(
      inactive.service.start({
        actorExternalId: ids.member,
        workItemExternalId: ids.target,
        expectedVersion: 1,
        idempotencyKey: 'inactive-start',
      }),
      'NOT_FOUND',
    );

    const inactiveOverride = createHarness();
    const inactiveOverrideMembership = inactiveOverride.repository.state.members.get(
      ids.memberMembership,
    );
    const inactiveOverridePrerequisite = inactiveOverride.repository.state.workItems.get(
      ids.prerequisite,
    );
    expect(inactiveOverrideMembership).toBeDefined();
    expect(inactiveOverridePrerequisite).toBeDefined();
    if (!inactiveOverrideMembership || !inactiveOverridePrerequisite) {
      throw new Error('missing inactive override fixture');
    }
    inactiveOverrideMembership.projectMembershipActive = false;
    inactiveOverridePrerequisite.status = 'in_progress';
    inactiveOverride.repository.state.dependencies.push({
      id: 1,
      organizationId: 10,
      projectId: 20,
      workItemId: 1,
      dependsOnWorkItemId: 2,
      createdByUserId: 1,
    });
    await expectCode(
      inactiveOverride.service.start({
        actorExternalId: ids.lead,
        workItemExternalId: ids.target,
        expectedVersion: 1,
        overrideReason: '负责人失活时不能越过校验',
        idempotencyKey: 'inactive-responsible-override',
      }),
      'NOT_FOUND',
    );

    const nonResponsible = createHarness();
    await expectCode(
      nonResponsible.service.start({
        actorExternalId: ids.otherMember,
        workItemExternalId: ids.target,
        expectedVersion: 1,
        idempotencyKey: 'non-responsible-normal-start',
      }),
      'FORBIDDEN',
    );

    const concurrent = createHarness();
    const base = {
      actorExternalId: ids.member,
      workItemExternalId: ids.target,
      expectedVersion: 1,
    };
    const results = await Promise.allSettled([
      concurrent.service.start({ ...base, idempotencyKey: 'start-a' }),
      concurrent.service.start({ ...base, idempotencyKey: 'start-b' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'VERSION_CONFLICT' },
    });
    expect(concurrent.repository.state.events).toHaveLength(1);
  });

  it('records and clears a structured blocker without silently changing the deadline', async () => {
    const { repository, service } = createHarness();
    const target = repository.state.workItems.get(ids.target);
    expect(target).toBeDefined();
    if (!target) throw new Error('missing fixture');
    target.status = 'in_progress';
    const originalDueAt = structuredClone(target.dueAt);
    const blockInput = {
      actorExternalId: ids.member,
      workItemExternalId: ids.target,
      responsibleParty: ' external:客户 ',
      nextAction: ' 等待客户补齐素材 ',
      reviewAt: '2026-09-01T01:00:00.000Z',
      affectsDueDate: true,
      expectedVersion: 1,
      idempotencyKey: 'block-external',
    };
    const blocked = await service.block(blockInput);
    expect(await service.block(blockInput)).toEqual(blocked);
    expect(blocked).toMatchObject({ command: 'block', state: 'blocked', version: 2 });
    expect(repository.state.workItems.get(ids.target)).toMatchObject({
      status: 'blocked',
      version: 2,
      dueAt: originalDueAt,
      blocker: {
        responsibleParty: 'external:客户',
        nextAction: '等待客户补齐素材',
        reviewAt: '2026-09-01T01:00:00.000Z',
        affectsDueDate: true,
      },
    });
    expect(repository.state.events[0]?.metadata).toMatchObject({
      blocker: {
        responsibleParty: 'external:客户',
        affectsDueDate: true,
      },
      executorAccountableForDelay: false,
    });

    const unblocked = await service.unblock({
      actorExternalId: ids.member,
      workItemExternalId: ids.target,
      expectedVersion: 2,
      idempotencyKey: 'unblock-external',
    });
    expect(unblocked).toMatchObject({ command: 'unblock', state: 'in_progress', version: 3 });
    expect(repository.state.workItems.get(ids.target)).toMatchObject({
      status: 'in_progress',
      version: 3,
      blocker: null,
      dueAt: originalDueAt,
    });
    expect(repository.state.events).toHaveLength(2);
  });

  it('rejects malformed blockers, unauthorized actors, stale versions, and concurrent losers', async () => {
    const { repository, service } = createHarness();
    const target = repository.state.workItems.get(ids.target);
    expect(target).toBeDefined();
    if (!target) throw new Error('missing fixture');
    target.status = 'in_progress';
    const base = {
      actorExternalId: ids.member,
      workItemExternalId: ids.target,
      responsibleParty: '客户',
      nextAction: '等待材料',
      reviewAt: '2026-09-01T01:00:00.000Z',
      affectsDueDate: false,
      expectedVersion: 1,
    };
    await expectCode(
      service.block({ ...base, nextAction: '', idempotencyKey: 'invalid-block' }),
      'INVALID_INPUT',
    );
    await expectCode(
      service.block({
        ...base,
        actorExternalId: ids.otherMember,
        idempotencyKey: 'unauthorized-block',
      }),
      'FORBIDDEN',
    );
    const results = await Promise.allSettled([
      service.block({ ...base, idempotencyKey: 'block-a' }),
      service.block({ ...base, idempotencyKey: 'block-b' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'VERSION_CONFLICT' },
    });
    expect(repository.state.events).toHaveLength(1);
  });

  it('creates immutable contract v2 while keeping confirmed v1 current', async () => {
    const { repository, service } = createHarness();
    const original = structuredClone(repository.state.contracts[0]);
    const input = {
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      contract: contract(),
      versionNote: ' 客户增加区域对比范围 ',
      expectedVersion: 1,
      idempotencyKey: 'contract-v2',
    };
    const created = await service.createContractVersion(input);
    expect(await service.createContractVersion(input)).toEqual(created);
    expect(created).toMatchObject({
      command: 'create_contract_version',
      workItemId: ids.target,
      state: 'accepted_by_member',
      version: 2,
      contractVersion: 2,
      currentContractVersionId: ids.contractV1,
    });
    expect(repository.state.contracts[0]).toEqual(original);
    expect(repository.state.contracts[1]).toMatchObject({
      version: 2,
      objective: '交付新版研究报告',
      versionNote: '客户增加区域对比范围',
      confirmedByUserId: null,
      confirmedAt: null,
    });
    expect(repository.state.workItems.get(ids.target)).toMatchObject({
      version: 2,
      currentContractVersionId: 1,
      dueAt: new Date('2026-09-02T01:00:00.000Z'),
    });
    expect(repository.state.events).toHaveLength(1);
  });

  it('blocks a second proposal while the latest contract version is still pending', async () => {
    const { repository, service } = createHarness();
    await service.createContractVersion({
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      contract: contract(),
      versionNote: '第一份待确认提案',
      expectedVersion: 1,
      idempotencyKey: 'pending-v2',
    });
    await expectCode(
      service.createContractVersion({
        actorExternalId: ids.lead,
        workItemExternalId: ids.target,
        contract: contract({ dueAt: '2026-09-06T01:00:00.000Z' }),
        versionNote: '不能覆盖待确认提案',
        expectedVersion: 2,
        idempotencyKey: 'pending-v3-forbidden',
      }),
      'CONFLICT',
    );
    expect(repository.state.contracts.map((item) => item.version)).toEqual([1, 2]);
  });

  it('rejects invalid contract changes, conflicts, inactive members, and terminal edits atomically', async () => {
    const { repository, service } = createHarness();
    const base = {
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      versionNote: '范围变更',
      expectedVersion: 1,
    };
    await expectCode(
      service.createContractVersion({
        ...base,
        contract: contract({ criteria: [] }),
        idempotencyKey: 'invalid-contract-change',
      }),
      'INVALID_INPUT',
    );
    await expectCode(
      service.createContractVersion({
        ...base,
        contract: contract({ responsiblePersonId: ids.memberMembership }),
        idempotencyKey: 'responsible-in-contract',
      }),
      'INVALID_INPUT',
    );
    await expectCode(
      service.createContractVersion({
        ...base,
        contract: contract({ approverId: ids.memberMembership }),
        idempotencyKey: 'responsible-approver-conflict',
      }),
      'CONFLICT',
    );
    const approver = repository.state.members.get(ids.approverMembership);
    expect(approver).toBeDefined();
    if (!approver) throw new Error('missing fixture');
    approver.projectMembershipActive = false;
    await expectCode(
      service.createContractVersion({
        ...base,
        contract: contract(),
        idempotencyKey: 'inactive-approver',
      }),
      'NOT_FOUND',
    );
    approver.projectMembershipActive = true;
    const target = repository.state.workItems.get(ids.target);
    expect(target).toBeDefined();
    if (!target) throw new Error('missing fixture');
    target.status = 'submitted';
    await expectCode(
      service.createContractVersion({
        ...base,
        contract: contract(),
        idempotencyKey: 'terminal-contract-change',
      }),
      'CONFLICT',
    );
    expect(repository.state.contracts).toHaveLength(1);
    expect(repository.state.events).toHaveLength(0);
  });

  it('lets only the active responsible confirm v2 and atomically switches pointer and deadline', async () => {
    const { repository, service } = createHarness();
    const created = await service.createContractVersion({
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      contract: contract(),
      versionNote: '范围变更',
      expectedVersion: 1,
      idempotencyKey: 'create-for-confirm',
    });
    const input = {
      actorExternalId: ids.member,
      workItemExternalId: ids.target,
      contractVersionExternalId: created.contractVersionId,
      expectedVersion: 2,
      idempotencyKey: 'confirm-v2',
    };
    const confirmed = await service.confirmContractVersion(input);
    expect(await service.confirmContractVersion(input)).toEqual(confirmed);
    expect(confirmed).toMatchObject({
      command: 'confirm_contract_version',
      state: 'accepted_by_member',
      version: 3,
      contractVersion: 2,
      currentContractVersionId: created.contractVersionId,
      dueAt: '2026-09-05T01:00:00.000Z',
    });
    expect(repository.state.workItems.get(ids.target)).toMatchObject({
      version: 3,
      currentContractVersionId: 2,
      dueAt: new Date('2026-09-05T01:00:00.000Z'),
    });
    expect(repository.state.contracts[1]).toMatchObject({
      confirmedByUserId: 2,
      confirmedAt: new Date(NOW),
    });
    expect(repository.state.events.at(-1)).toMatchObject({
      eventType: 'contract_version_confirmed',
      actorUserId: 2,
      contractVersionId: 2,
    });
  });

  it('records a bounded rejection as a lead-pending event while v1 remains current', async () => {
    const { repository, service } = createHarness();
    const created = await service.createContractVersion({
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      contract: contract(),
      versionNote: '范围变更',
      expectedVersion: 1,
      idempotencyKey: 'create-for-reject',
    });
    const input = {
      actorExternalId: ids.member,
      workItemExternalId: ids.target,
      contractVersionExternalId: created.contractVersionId,
      rejectionReason: ' 新增范围超出当前排期 ',
      expectedVersion: 2,
      idempotencyKey: 'reject-v2',
    };
    const rejected = await service.rejectContractVersion(input);
    expect(await service.rejectContractVersion(input)).toEqual(rejected);
    expect(rejected).toMatchObject({
      command: 'reject_contract_version',
      state: 'accepted_by_member',
      version: 3,
      contractVersion: 2,
      currentContractVersionId: ids.contractV1,
      pendingLeadAction: true,
    });
    expect(repository.state.workItems.get(ids.target)).toMatchObject({
      version: 3,
      currentContractVersionId: 1,
      dueAt: new Date('2026-09-02T01:00:00.000Z'),
    });
    expect(repository.state.contracts[1]).toMatchObject({
      confirmedByUserId: null,
      confirmedAt: null,
    });
    expect(repository.state.events.at(-1)).toMatchObject({
      eventType: 'contract_version_rejected',
      metadata: {
        rejectionReason: '新增范围超出当前排期',
        pendingLeadAction: true,
      },
    });
    await expectCode(
      service.rejectContractVersion({
        ...input,
        expectedVersion: 3,
        idempotencyKey: 'reject-v2-again',
      }),
      'CONFLICT',
    );
  });

  it('uses the latest immutable contract number after a rejected proposal', async () => {
    const { repository, service } = createHarness();
    const first = await service.createContractVersion({
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      contract: contract(),
      versionNote: '第一次变更',
      expectedVersion: 1,
      idempotencyKey: 'create-v2-latest',
    });
    await service.rejectContractVersion({
      actorExternalId: ids.member,
      workItemExternalId: ids.target,
      contractVersionExternalId: first.contractVersionId,
      rejectionReason: '排期不足',
      expectedVersion: 2,
      idempotencyKey: 'reject-v2-latest',
    });
    const next = await service.createContractVersion({
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      contract: contract({ dueAt: '2026-09-06T01:00:00.000Z' }),
      versionNote: '调整后的第二次变更',
      expectedVersion: 3,
      idempotencyKey: 'create-v3-latest',
    });
    expect(next).toMatchObject({ contractVersion: 3, version: 4 });
    expect(repository.state.contracts.map((item) => item.version)).toEqual([1, 2, 3]);
  });

  it('rejects non-responsible, inactive, malformed, stale, and competing contract decisions', async () => {
    const setup = async () => {
      const harness = createHarness();
      const created = await harness.service.createContractVersion({
        actorExternalId: ids.lead,
        workItemExternalId: ids.target,
        contract: contract(),
        versionNote: '范围变更',
        expectedVersion: 1,
        idempotencyKey: 'decision-create',
      });
      return { ...harness, created };
    };

    const unauthorized = await setup();
    await expectCode(
      unauthorized.service.confirmContractVersion({
        actorExternalId: ids.otherMember,
        workItemExternalId: ids.target,
        contractVersionExternalId: unauthorized.created.contractVersionId,
        expectedVersion: 2,
        idempotencyKey: 'other-confirm',
      }),
      'FORBIDDEN',
    );

    const inactive = await setup();
    const membership = inactive.repository.state.members.get(ids.memberMembership);
    expect(membership).toBeDefined();
    if (!membership) throw new Error('missing fixture');
    membership.organizationMembershipActive = false;
    await expectCode(
      inactive.service.confirmContractVersion({
        actorExternalId: ids.member,
        workItemExternalId: ids.target,
        contractVersionExternalId: inactive.created.contractVersionId,
        expectedVersion: 2,
        idempotencyKey: 'inactive-confirm',
      }),
      'NOT_FOUND',
    );

    const malformed = await setup();
    await expectCode(
      malformed.service.rejectContractVersion({
        actorExternalId: ids.member,
        workItemExternalId: ids.target,
        contractVersionExternalId: malformed.created.contractVersionId,
        rejectionReason: '',
        expectedVersion: 2,
        idempotencyKey: 'empty-rejection',
      }),
      'INVALID_INPUT',
    );
    await expectCode(
      malformed.service.confirmContractVersion({
        actorExternalId: ids.member,
        workItemExternalId: ids.target,
        contractVersionExternalId: malformed.created.contractVersionId,
        expectedVersion: 1,
        idempotencyKey: 'stale-confirm',
      }),
      'VERSION_CONFLICT',
    );

    const concurrent = await setup();
    const results = await Promise.allSettled([
      concurrent.service.confirmContractVersion({
        actorExternalId: ids.member,
        workItemExternalId: ids.target,
        contractVersionExternalId: concurrent.created.contractVersionId,
        expectedVersion: 2,
        idempotencyKey: 'decision-confirm',
      }),
      concurrent.service.rejectContractVersion({
        actorExternalId: ids.member,
        workItemExternalId: ids.target,
        contractVersionExternalId: concurrent.created.contractVersionId,
        rejectionReason: '不同意范围变更',
        expectedVersion: 2,
        idempotencyKey: 'decision-reject',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'VERSION_CONFLICT' },
    });
    expect(
      concurrent.repository.state.events.filter((event) =>
        ['contract_version_confirmed', 'contract_version_rejected'].includes(event.eventType),
      ),
    ).toHaveLength(1);
  });

  it('hides a foreign contract substitution as not found', async () => {
    const { repository, service } = createHarness();
    const currentContract = repository.state.contracts[0];
    expect(currentContract).toBeDefined();
    if (!currentContract) throw new Error('missing current contract fixture');
    repository.state.contracts.push({
      ...structuredClone(currentContract),
      id: 99,
      externalId: ids.foreignContract,
      organizationId: 11,
      projectId: 30,
      workItemId: 4,
      version: 2,
      confirmedByUserId: null,
      confirmedAt: null,
    });
    await expectCode(
      service.confirmContractVersion({
        actorExternalId: ids.member,
        workItemExternalId: ids.target,
        contractVersionExternalId: ids.foreignContract,
        expectedVersion: 1,
        idempotencyKey: 'foreign-contract-substitution',
      }),
      'NOT_FOUND',
    );
  });

  it('creates a project milestone with a durable project-level idempotent receipt', async () => {
    const { repository, service } = createHarness();
    const input = {
      actorExternalId: ids.lead,
      projectExternalId: ids.project,
      title: ' 原型验收 ',
      description: ' 完成内部评审 ',
      dueAt: '2026-09-04T01:00:00.000Z',
      sortOrder: 2,
      expectedVersion: 0,
      idempotencyKey: 'milestone-create',
    };
    const created = await service.createMilestone(input);
    expect(await service.createMilestone(input)).toEqual(created);
    expect(created).toMatchObject({
      command: 'create_milestone',
      projectId: ids.project,
      milestoneVersion: 1,
      title: '原型验收',
      sortOrder: 2,
    });
    expect(repository.state.milestones.get(created.milestoneId)).toMatchObject({
      title: '原型验收',
      description: '完成内部评审',
      status: 'open',
      version: 1,
      sortOrder: 2,
      dueAt: new Date('2026-09-04T01:00:00.000Z'),
    });
    expect(repository.state.planningEvents).toHaveLength(1);
    expect(repository.state.planningEvents[0]).toMatchObject({
      eventType: 'milestone_created',
      actorUserId: 1,
    });
  });

  it('updates a same-tenant milestone with optimistic concurrency and hidden foreign IDs', async () => {
    const { repository, service } = createHarness();
    const updated = await service.updateMilestone({
      actorExternalId: ids.lead,
      milestoneExternalId: ids.milestone,
      title: '研究验收',
      description: null,
      status: 'completed',
      dueAt: null,
      expectedVersion: 1,
      idempotencyKey: 'milestone-update',
    });
    expect(updated).toMatchObject({
      command: 'update_milestone',
      milestoneId: ids.milestone,
      milestoneVersion: 2,
      status: 'completed',
    });
    expect(repository.state.milestones.get(ids.milestone)).toMatchObject({
      title: '研究验收',
      description: null,
      status: 'completed',
      version: 2,
      dueAt: null,
    });
    await expectCode(
      service.updateMilestone({
        actorExternalId: ids.lead,
        milestoneExternalId: ids.milestone,
        title: '陈旧修改',
        expectedVersion: 1,
        idempotencyKey: 'milestone-stale',
      }),
      'VERSION_CONFLICT',
    );
    await expectCode(
      service.updateMilestone({
        actorExternalId: ids.lead,
        milestoneExternalId: ids.foreignMilestone,
        title: '越权修改',
        expectedVersion: 1,
        idempotencyKey: 'milestone-foreign',
      }),
      'NOT_FOUND',
    );
  });

  it('reorders distinct milestones atomically and gives concurrent requests one winner', async () => {
    const { repository, service } = createHarness();
    const input = {
      actorExternalId: ids.lead,
      projectExternalId: ids.project,
      milestones: [
        { milestoneExternalId: ids.milestone, expectedVersion: 1, sortOrder: 1 },
        { milestoneExternalId: ids.secondMilestone, expectedVersion: 1, sortOrder: 0 },
      ],
    };
    const results = await Promise.allSettled([
      service.reorderMilestones({ ...input, idempotencyKey: 'reorder-a' }),
      service.reorderMilestones({ ...input, idempotencyKey: 'reorder-b' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'VERSION_CONFLICT' },
    });
    expect(repository.state.milestones.get(ids.milestone)).toMatchObject({
      version: 2,
      sortOrder: 1,
    });
    expect(repository.state.milestones.get(ids.secondMilestone)).toMatchObject({
      version: 2,
      sortOrder: 0,
    });
    expect(repository.state.planningEvents).toHaveLength(1);
  });

  it('rejects malformed, duplicate, foreign, and actor-reused milestone reorder payloads', async () => {
    const { repository, service } = createHarness();
    const base = {
      actorExternalId: ids.lead,
      projectExternalId: ids.project,
      idempotencyKey: 'reorder-invalid',
    };
    await expectCode(service.reorderMilestones({ ...base, milestones: [] }), 'INVALID_INPUT');
    await expectCode(
      service.reorderMilestones({
        ...base,
        idempotencyKey: 'reorder-duplicate',
        milestones: [
          { milestoneExternalId: ids.milestone, expectedVersion: 1, sortOrder: 0 },
          { milestoneExternalId: ids.milestone, expectedVersion: 1, sortOrder: 1 },
        ],
      }),
      'INVALID_INPUT',
    );
    await expectCode(
      service.reorderMilestones({
        ...base,
        idempotencyKey: 'reorder-foreign',
        milestones: [
          { milestoneExternalId: ids.foreignMilestone, expectedVersion: 1, sortOrder: 0 },
        ],
      }),
      'INVALID_INPUT',
    );
    await expectCode(
      service.reorderMilestones({
        ...base,
        idempotencyKey: 'reorder-partial',
        milestones: [{ milestoneExternalId: ids.milestone, expectedVersion: 1, sortOrder: 0 }],
      }),
      'INVALID_INPUT',
    );
    const valid = {
      ...base,
      idempotencyKey: 'reorder-actor-bound',
      milestones: [
        { milestoneExternalId: ids.milestone, expectedVersion: 1, sortOrder: 0 },
        { milestoneExternalId: ids.secondMilestone, expectedVersion: 1, sortOrder: 1 },
      ],
    };
    await service.reorderMilestones(valid);
    await expectCode(
      service.reorderMilestones({ ...valid, actorExternalId: ids.approverUser }),
      'CONFLICT',
    );
    expect(repository.state.planningEvents).toHaveLength(1);
  });

  it('attaches only a same-project milestone to a work item', async () => {
    const { repository, service } = createHarness();
    const attached = await service.assignMilestone({
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      milestoneExternalId: ids.milestone,
      expectedVersion: 1,
      idempotencyKey: 'attach-milestone',
    });
    expect(attached).toMatchObject({
      command: 'assign_milestone',
      workItemId: ids.target,
      milestoneId: ids.milestone,
      version: 2,
    });
    expect(repository.state.workItems.get(ids.target)).toMatchObject({
      milestoneId: 1,
      version: 2,
    });
    await expectCode(
      service.assignMilestone({
        actorExternalId: ids.lead,
        workItemExternalId: ids.prerequisite,
        milestoneExternalId: ids.foreignMilestone,
        expectedVersion: 1,
        idempotencyKey: 'attach-foreign-milestone',
      }),
      'NOT_FOUND',
    );
  });

  it('treats work-item and planning events as one organization idempotency namespace', async () => {
    const workFirst = createHarness();
    await workFirst.service.assignMilestone({
      actorExternalId: ids.lead,
      workItemExternalId: ids.target,
      milestoneExternalId: ids.milestone,
      expectedVersion: 1,
      idempotencyKey: 'cross-family-work-first',
    });
    await expectCode(
      workFirst.service.updateMilestone({
        actorExternalId: ids.lead,
        milestoneExternalId: ids.milestone,
        title: '不能复用工作项键',
        expectedVersion: 1,
        idempotencyKey: 'cross-family-work-first',
      }),
      'CONFLICT',
    );

    const planningFirst = createHarness();
    await planningFirst.service.updateMilestone({
      actorExternalId: ids.lead,
      milestoneExternalId: ids.milestone,
      title: '规划先占用键',
      expectedVersion: 1,
      idempotencyKey: 'cross-family-planning-first',
    });
    await expectCode(
      planningFirst.service.assignMilestone({
        actorExternalId: ids.lead,
        workItemExternalId: ids.target,
        milestoneExternalId: ids.milestone,
        expectedVersion: 1,
        idempotencyKey: 'cross-family-planning-first',
      }),
      'CONFLICT',
    );
  });

  it('allows only one concurrent winner across work-item and planning event families', async () => {
    const { repository, service } = createHarness();
    const results = await Promise.allSettled([
      service.block({
        actorExternalId: ids.member,
        workItemExternalId: ids.target,
        responsibleParty: '外部客户',
        nextAction: '等待确认',
        reviewAt: '2026-09-01T01:00:00.000Z',
        affectsDueDate: false,
        expectedVersion: 1,
        idempotencyKey: 'concurrent-cross-family',
      }),
      service.updateMilestone({
        actorExternalId: ids.lead,
        milestoneExternalId: ids.milestone,
        title: '并发规划修改',
        expectedVersion: 1,
        idempotencyKey: 'concurrent-cross-family',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'CONFLICT' },
    });
    expect(repository.state.events.length + repository.state.planningEvents.length).toBe(1);
  });

  it.each(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'])(
    'maps %s after transaction rollback to a stable conflict',
    async (code) => {
      const { repository, service } = createHarness();
      repository.transaction = async () => {
        const error = new Error('raw database lock error') as Error & { code: string };
        error.code = code;
        throw error;
      };
      await expectCode(
        service.updateMilestone({
          actorExternalId: ids.lead,
          milestoneExternalId: ids.milestone,
          title: '锁错误归一化',
          expectedVersion: 1,
          idempotencyKey: `planning-lock-${code}`,
        }),
        'CONFLICT',
      );
    },
  );

  it('does not leak a deadlock raised by duplicate recovery', async () => {
    const { repository, service } = createHarness();
    let attempt = 0;
    repository.transaction = async () => {
      attempt += 1;
      const error = new Error('raw database error') as Error & { code: string };
      error.code = attempt === 1 ? 'ER_DUP_ENTRY' : 'ER_LOCK_DEADLOCK';
      throw error;
    };
    await expectCode(
      service.updateMilestone({
        actorExternalId: ids.lead,
        milestoneExternalId: ids.milestone,
        title: '恢复阶段锁错误',
        expectedVersion: 1,
        idempotencyKey: 'planning-recovery-deadlock',
      }),
      'CONFLICT',
    );
  });

  it('normalizes duplicate-recovery lock errors for dependency mutations too', async () => {
    const { repository, service } = createHarness();
    let attempt = 0;
    repository.transaction = async () => {
      attempt += 1;
      const error = new Error('raw database error') as Error & { code: string };
      error.code = attempt === 1 ? 'ER_DUP_ENTRY' : 'ER_LOCK_WAIT_TIMEOUT';
      throw error;
    };
    await expectCode(
      service.addDependency({
        actorExternalId: ids.lead,
        workItemExternalId: ids.target,
        dependsOnWorkItemExternalId: ids.prerequisite,
        expectedVersion: 1,
        idempotencyKey: 'dependency-recovery-timeout',
      }),
      'CONFLICT',
    );
  });
});
