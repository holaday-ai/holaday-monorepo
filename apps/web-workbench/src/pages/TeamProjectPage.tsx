import { useAppShellContext } from '@/components/AppShell';
import { TeamTaskWorkbench } from '@/components/projects/TeamTaskWorkbench';
import type {
  CreateTeamTaskInput,
  ReviewTeamTaskInput,
  TeamTaskExecutionInput,
} from '@/components/projects/TeamTaskWorkbench';
import { classifyHiddenWorkspaceError } from '@/components/projects/team-workspace-error';
import { Button } from '@/components/ui/button';
import { normalizeProjectRows } from '@/lib/project-page-state';
import { type TeamTaskWorkbenchRow, applyTaskLoadResult } from '@/lib/team-task-workbench-state';
import { type AppRouter, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader, PageLoadingPanel } from '@/pages/PageShell';
import type { UiProject } from '@/types/task';
import type { inferRouterClient } from '@trpc/client';
import { FolderKanban, RefreshCw } from 'lucide-react';
import * as React from 'react';
import { useParams } from 'react-router-dom';

type ProjectMemberRole = 'lead' | 'member' | 'viewer';

interface UiProjectMember {
  readonly projectMemberId: string;
  readonly organizationMemberId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly role: ProjectMemberRole;
}

interface ProjectDetailState {
  readonly projectId: string;
  readonly project: UiProject | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly notFound: boolean;
}

interface ProjectMembersState {
  readonly projectId: string;
  readonly rows: readonly UiProjectMember[];
  readonly loading: boolean;
  readonly error: string | null;
}

interface ProjectTasksState {
  readonly requestId: number;
  readonly rows: readonly TeamTaskWorkbenchRow[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly stale: boolean;
}

interface PendingTaskCreation {
  readonly inputKey: string;
  readonly draftKey: string;
  readonly publishKey: string;
  readonly milestoneKey: string | null;
  readonly dependencyKeys: readonly string[];
  readonly assignmentKeys: readonly string[];
  workItemId: string | null;
  version: number;
  published: boolean;
  milestoneDone: boolean;
  dependencyIndex: number;
  assignmentIndex: number;
}

const PROJECT_ROLE_LABEL: Record<ProjectMemberRole, string> = {
  lead: '项目负责人',
  member: '项目成员',
  viewer: '仅查看',
};

type Task13ProjectDetailClient = Pick<inferRouterClient<AppRouter>, 'projects' | 'teamTasks'>;

// Detail procedures stay coupled to AppRouter while local normalization rebuilds UI rows.
const task13ProjectDetailClient: Task13ProjectDetailClient = trpc;

/**
 * Team project detail consumes only locally normalized API rows. Both detail
 * requests begin together, while their loading and stale/error states settle
 * independently so a slow roster never holds back an available overview.
 */
export function TeamProjectPage(): JSX.Element {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const { me } = useAppShellContext();
  const projectId = typeof routeProjectId === 'string' ? routeProjectId.trim() : '';
  const teamProjectsEnabled = me?.teamProjectsEnabled === true;
  const teamTaskLifecycleEnabled = me?.teamTaskLifecycleEnabled === true;
  const requestRef = React.useRef(0);
  const mountedRef = React.useRef(false);
  const pendingTaskCreationRef = React.useRef<PendingTaskCreation | null>(null);
  const [detail, setDetail] = React.useState<ProjectDetailState>(() =>
    initialProjectDetailState(projectId, teamProjectsEnabled),
  );
  const [members, setMembers] = React.useState<ProjectMembersState>(() =>
    initialProjectMembersState(projectId, teamProjectsEnabled),
  );
  const [tasks, setTasks] = React.useState<ProjectTasksState>(() =>
    initialProjectTasksState(projectId, teamProjectsEnabled && teamTaskLifecycleEnabled),
  );
  const [milestoneOptions, setMilestoneOptions] = React.useState<
    Array<{ id: string; title: string }>
  >([]);

  const refresh = React.useCallback(() => {
    if (!teamProjectsEnabled || !projectId) {
      setDetail({
        projectId,
        project: null,
        loading: false,
        error: null,
        notFound: true,
      });
      setMembers({ projectId, rows: [], loading: false, error: null });
      setTasks({
        requestId: requestRef.current,
        rows: [],
        loading: false,
        error: null,
        stale: false,
      });
      setMilestoneOptions([]);
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setDetail((current) => ({
      projectId,
      project: current.projectId === projectId ? current.project : null,
      loading: true,
      error: null,
      notFound: false,
    }));
    setMembers((current) => ({
      projectId,
      rows: current.projectId === projectId ? current.rows : [],
      loading: true,
      error: null,
    }));
    setTasks((current) => ({
      requestId,
      rows: current.rows,
      loading: teamTaskLifecycleEnabled,
      error: null,
      stale: false,
    }));

    const projectRequest = task13ProjectDetailClient.projects.get.query({ projectId });
    const memberRequest = task13ProjectDetailClient.projects.members.query({ projectId });
    const taskRequest = teamTaskLifecycleEnabled
      ? task13ProjectDetailClient.teamTasks.list.query({ projectId })
      : null;
    const planningOptionsRequest = teamTaskLifecycleEnabled
      ? task13ProjectDetailClient.teamTasks.planningOptions.query({ projectId })
      : null;
    const invalidateHiddenDetail = (): void => {
      if (!mountedRef.current || requestRef.current !== requestId) return;
      requestRef.current = requestId + 1;
      setDetail({
        projectId,
        project: null,
        loading: false,
        error: null,
        notFound: true,
      });
      setMembers({ projectId, rows: [], loading: false, error: null });
      setTasks({ requestId: requestId + 1, rows: [], loading: false, error: null, stale: false });
      setMilestoneOptions([]);
    };

    void projectRequest.then(
      (response) => {
        if (!mountedRef.current || requestRef.current !== requestId) return;
        const project = normalizeTeamProject(response, projectId);
        if (!project) {
          invalidateHiddenDetail();
          return;
        }
        setDetail({ projectId, project, loading: false, error: null, notFound: false });
      },
      (error: unknown) => {
        if (!mountedRef.current || requestRef.current !== requestId) return;
        if (classifyHiddenWorkspaceError(error)) {
          invalidateHiddenDetail();
          return;
        }
        setDetail((current) => {
          const staleProject = current.projectId === projectId ? current.project : null;
          return {
            projectId,
            project: staleProject,
            loading: false,
            error: staleProject ? '项目概览更新失败，当前保留上次结果' : '项目详情暂时无法加载',
            notFound: false,
          };
        });
      },
    );

    void memberRequest.then(
      (response) => {
        if (!mountedRef.current || requestRef.current !== requestId) return;
        setMembers({
          projectId,
          rows: normalizeProjectMemberRows(response, projectId),
          loading: false,
          error: null,
        });
      },
      (error: unknown) => {
        if (!mountedRef.current || requestRef.current !== requestId) return;
        if (classifyHiddenWorkspaceError(error)) {
          invalidateHiddenDetail();
          return;
        }
        setMembers((current) => {
          const staleRows = current.projectId === projectId ? current.rows : [];
          return {
            projectId,
            rows: staleRows,
            loading: false,
            error:
              staleRows.length > 0 ? '成员列表更新失败，当前保留上次结果' : '项目成员暂时无法加载',
          };
        });
      },
    );
    if (taskRequest) {
      void taskRequest.then(
        (response) => {
          if (!mountedRef.current || requestRef.current !== requestId) return;
          setTasks((current) => ({
            ...applyTaskLoadResult(current, {
              requestId,
              rows: normalizeTeamTaskRows(response, projectId),
            }),
            stale: false,
          }));
        },
        (error: unknown) => {
          if (!mountedRef.current || requestRef.current !== requestId) return;
          setTasks((current) => ({
            requestId,
            rows: current.rows,
            loading: false,
            error: classifyHiddenWorkspaceError(error)
              ? '团队任务对当前成员不可见'
              : '团队任务暂时无法加载',
            stale: current.rows.length > 0,
          }));
        },
      );
    }
    if (planningOptionsRequest) {
      void planningOptionsRequest.then(
        (response) => {
          if (!mountedRef.current || requestRef.current !== requestId) return;
          setMilestoneOptions(normalizeMilestoneOptions(response));
        },
        () => {
          if (!mountedRef.current || requestRef.current !== requestId) return;
          setMilestoneOptions([]);
        },
      );
    }
  }, [projectId, teamProjectsEnabled, teamTaskLifecycleEnabled]);

  const loadTaskDetail = React.useCallback(
    async (workItemId: string): Promise<TeamTaskWorkbenchRow> => {
      const response = await task13ProjectDetailClient.teamTasks.get.query({
        projectId,
        workItemId,
      });
      const detail = normalizeTeamTaskRows([response], projectId)[0];
      if (!detail) throw new Error('任务详情返回了无效数据');
      return detail;
    },
    [projectId],
  );

  const createTask = React.useCallback(
    async (input: CreateTeamTaskInput): Promise<void> => {
      const inputKey = JSON.stringify(input);
      const assignments = [
        ...(input.responsibleOrganizationMemberId
          ? [{ id: input.responsibleOrganizationMemberId, role: 'responsible' as const }]
          : []),
        ...input.collaboratorOrganizationMemberIds.map((id) => ({
          id,
          role: 'collaborator' as const,
        })),
      ];
      let pending = pendingTaskCreationRef.current;
      if (!pending || pending.inputKey !== inputKey) {
        pending = {
          inputKey,
          draftKey: newIdempotencyKey(),
          publishKey: newIdempotencyKey(),
          milestoneKey: input.milestoneId ? newIdempotencyKey() : null,
          dependencyKeys: input.dependencyIds.map(() => newIdempotencyKey()),
          assignmentKeys: assignments.map(() => newIdempotencyKey()),
          workItemId: null,
          version: 0,
          published: false,
          milestoneDone: false,
          dependencyIndex: 0,
          assignmentIndex: 0,
        };
        pendingTaskCreationRef.current = pending;
      }
      try {
        if (!pending.workItemId) {
          const draft = mutationReceipt(
            await task13ProjectDetailClient.teamTasks.createDraft.mutate({
              projectId,
              title: input.title,
              description: input.objective,
              assignmentMode: input.assignmentMode,
              expectedVersion: 0,
              idempotencyKey: pending.draftKey,
            }),
          );
          pending.workItemId = draft.workItemId;
          pending.version = draft.version;
        }
        const workItemId = pending.workItemId;
        if (!pending.published) {
          const published = mutationReceipt(
            await task13ProjectDetailClient.teamTasks.publish.mutate({
              projectId,
              workItemId,
              expectedVersion: pending.version,
              idempotencyKey: pending.publishKey,
              contract: {
                objective: input.objective,
                deliverables: [input.deliverable],
                criteria: [{ id: 'criterion-1', description: input.criterion }],
                requiredEvidenceTypes: [
                  { type: 'task_evidence', description: input.evidenceDescription },
                ],
                approverId: input.approverId,
                arbitratorId: input.arbitratorId,
                dueAt: input.dueAt,
                maxRevisionRounds: 2,
              },
            }),
          );
          pending.version = published.version;
          pending.published = true;
        }
        if (input.milestoneId && !pending.milestoneDone && pending.milestoneKey) {
          pending.version = mutationReceipt(
            await task13ProjectDetailClient.teamTasks.assignMilestone.mutate({
              projectId,
              workItemId,
              milestoneId: input.milestoneId,
              expectedVersion: pending.version,
              idempotencyKey: pending.milestoneKey,
            }),
          ).version;
          pending.milestoneDone = true;
        }
        while (pending.dependencyIndex < input.dependencyIds.length) {
          const index = pending.dependencyIndex;
          pending.version = mutationReceipt(
            await task13ProjectDetailClient.teamTasks.addDependency.mutate({
              projectId,
              workItemId,
              dependsOnWorkItemId: input.dependencyIds[index] as string,
              expectedVersion: pending.version,
              idempotencyKey: pending.dependencyKeys[index] as string,
            }),
          ).version;
          pending.dependencyIndex += 1;
        }
        while (pending.assignmentIndex < assignments.length) {
          const index = pending.assignmentIndex;
          const assignment = assignments[index];
          if (!assignment) break;
          pending.version = mutationReceipt(
            await task13ProjectDetailClient.teamTasks.assign.mutate({
              projectId,
              workItemId,
              targetMemberId: assignment.id,
              role: assignment.role,
              expectedVersion: pending.version,
              idempotencyKey: pending.assignmentKeys[index] as string,
            }),
          ).version;
          pending.assignmentIndex += 1;
        }
        pendingTaskCreationRef.current = null;
        refresh();
      } catch (error) {
        const message = presentTaskMutationError(error).message;
        refresh();
        throw new Error(
          `创建尚未完成；系统已保留本次续跑状态。请点击“继续完成配置”，不要重复新建。${message}`,
        );
      }
    },
    [projectId, refresh],
  );

  const reviewTask = React.useCallback(
    async (input: ReviewTeamTaskInput): Promise<void> => {
      const submissionId = input.task.latestSubmissionId;
      if (!submissionId) throw new Error('提交记录尚未同步，请刷新后重试');
      try {
        await task13ProjectDetailClient.teamTasks.review.mutate({
          projectId,
          workItemId: input.task.id,
          submissionId,
          expectedVersion: input.task.version,
          idempotencyKey: newIdempotencyKey(),
          decision: input.decision,
          ...(input.decision === 'request_revision'
            ? {
                failedCriterionIds: [...input.failedCriterionIds],
                evidenceReferences: [
                  { kind: 'missing_evidence' as const, reference: input.evidenceReference },
                ],
                revisionInstructions: [input.revisionInstructions],
                newDeadline: new Date(input.newDeadline).toISOString(),
              }
            : {
                rationale:
                  input.decision === 'escalate_arbitration'
                    ? '普通返工已达上限，验收人将争议移交独立仲裁。'
                    : '验收人已确认全部标准与证据。',
              }),
        });
        refresh();
      } catch (error) {
        throw presentTaskMutationError(error);
      }
    },
    [projectId, refresh],
  );

  const executeTaskAction = React.useCallback(
    async (input: TeamTaskExecutionInput): Promise<void> => {
      const base = {
        projectId,
        workItemId: input.task.id,
        expectedVersion: input.task.version,
        idempotencyKey: newIdempotencyKey(),
      };
      try {
        switch (input.type) {
          case 'claim':
            await task13ProjectDetailClient.teamTasks.claim.mutate({
              ...base,
              memberId: input.memberId,
            });
            break;
          case 'accept_assignment':
            await task13ProjectDetailClient.teamTasks.acceptAssignment.mutate({
              ...base,
              assignmentId: input.assignmentId,
            });
            break;
          case 'select_claim':
            await task13ProjectDetailClient.teamTasks.selectClaim.mutate({
              ...base,
              assignmentId: input.assignmentId,
            });
            break;
          case 'start':
            await task13ProjectDetailClient.teamTasks.start.mutate(base);
            break;
          case 'block':
            await task13ProjectDetailClient.teamTasks.block.mutate({
              ...base,
              responsibleParty: input.responsibleParty,
              nextAction: input.nextAction,
              reviewAt: input.reviewAt,
              affectsDueDate: input.affectsDueDate,
            });
            break;
          case 'unblock':
            await task13ProjectDetailClient.teamTasks.unblock.mutate(base);
            break;
          case 'submit':
            await task13ProjectDetailClient.teamTasks.submit.mutate({
              ...base,
              summary: input.summary,
              deliverables: [input.deliverable],
            });
            break;
          case 'appeal': {
            const submissionId = input.task.latestSubmissionId;
            const reviewId = input.task.latestReviewId;
            if (!submissionId || !reviewId) {
              throw new Error('评审记录尚未同步，请刷新任务详情后重试');
            }
            await task13ProjectDetailClient.teamTasks.appeal.mutate({
              ...base,
              submissionId,
              reviewId,
              disputeType: 'criterion_application',
              grounds: input.grounds,
            });
            break;
          }
          case 'close':
            await task13ProjectDetailClient.teamTasks.close.mutate(base);
            break;
          case 'archive':
            await task13ProjectDetailClient.teamTasks.archive.mutate(base);
            break;
        }
        refresh();
      } catch (error) {
        throw presentTaskMutationError(error);
      }
    },
    [projectId, refresh],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, [refresh]);

  if (!teamProjectsEnabled || !projectId || detail.notFound) {
    return <ProjectNotFoundState />;
  }

  if (!detail.project && detail.loading) {
    return (
      <PageContainer width="wide">
        <PageHeader title="团队项目" description="正在读取项目概览与成员信息" />
        <PageLoadingPanel label="项目详情加载中" description="项目和成员信息正在同步" />
      </PageContainer>
    );
  }

  if (!detail.project) {
    return <ProjectErrorState onRefresh={refresh} />;
  }

  const projectMembers = members.projectId === projectId ? members.rows : [];
  const memberError = members.projectId === projectId ? members.error : null;
  const membersLoading = members.projectId === projectId && members.loading;

  return (
    <PageContainer width="workspace">
      <PageHeader
        title={detail.project.name}
        description={detail.project.description || '这个团队项目还没有添加说明。'}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={detail.loading || membersLoading}
            className="h-11"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', (detail.loading || membersLoading) && 'animate-spin')}
              aria-hidden
            />
            刷新项目详情
          </Button>
        }
      />

      <div className="space-y-4">
        {detail.error ? <StaleNotice message={detail.error} /> : null}
        <ProjectOverview project={detail.project} />
        {teamTaskLifecycleEnabled ? (
          <TeamTaskWorkbench
            currentUserId={me?.userId ?? ''}
            role={detail.project.memberRole ?? 'viewer'}
            rows={tasks.rows}
            members={projectMembers}
            milestoneOptions={milestoneOptions}
            membersLoading={membersLoading}
            memberError={memberError}
            loading={tasks.loading}
            error={tasks.error}
            stale={tasks.stale}
            onRetry={refresh}
            onLoadDetail={loadTaskDetail}
            onCreateTask={createTask}
            onReviewTask={reviewTask}
            onTaskAction={executeTaskAction}
          />
        ) : (
          <TaskLifecycleGate />
        )}
      </div>
    </PageContainer>
  );
}

function ProjectOverview({ project }: { readonly project: UiProject }): JSX.Element {
  const role = project.memberRole ? PROJECT_ROLE_LABEL[project.memberRole] : '未分配';
  return (
    <section
      aria-label="项目概览"
      className="flex flex-col gap-4 border-y border-[#ECEEF2] bg-white px-1 py-4 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 items-center gap-3 sm:mr-auto">
        <div className="rounded-[8px] bg-[#FFF0F4] p-2.5 text-[#EA1F59]">
          <FolderKanban className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-foreground">项目工作区</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            任务、责任与验收记录保持在同一条时间线上
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-5 sm:min-w-[430px]">
        <OverviewField label="团队" value={project.organizationName || '未命名团队'} />
        <OverviewField label="任务" value={`${project.taskCount} 项`} />
        <OverviewField label="你的权限" value={`当前角色：${role}`} />
      </dl>
    </section>
  );
}

function OverviewField({
  label,
  value,
}: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div className="min-w-0 border-l border-[#ECEEF2] pl-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function TaskLifecycleGate(): JSX.Element {
  return (
    <div className="rounded-[8px] border border-[#E7E7E7] bg-[#FAFAFA] px-4 py-5">
      <p className="text-sm font-medium text-foreground">团队任务工作台尚未为当前账号开放</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        项目概览与成员信息仍可继续使用。
      </p>
    </div>
  );
}

function StaleNotice({ message }: { readonly message: string }): JSX.Element {
  return (
    <output className="block rounded-[8px] border border-[#F1D7A8] bg-[#FFF9ED] px-4 py-2.5 text-sm text-[#815F1B]">
      {message}
    </output>
  );
}

function ProjectNotFoundState(): JSX.Element {
  return (
    <PageContainer width="form">
      <PageHeader title="找不到这个项目" description="项目可能已被删除，或你不再拥有访问权限。" />
    </PageContainer>
  );
}

function ProjectErrorState({ onRefresh }: { readonly onRefresh: () => void }): JSX.Element {
  return (
    <PageContainer width="form">
      <PageHeader title="团队项目" description="项目概览与成员信息" />
      <div className="rounded-[8px] border border-[#F2CBD6] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <h2 className="text-sm font-semibold text-foreground">项目详情暂时无法加载</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          请稍后重试，或返回项目列表查看其他项目。
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-4 h-11" onClick={onRefresh}>
          重新加载
        </Button>
      </div>
    </PageContainer>
  );
}

function initialProjectDetailState(projectId: string, enabled: boolean): ProjectDetailState {
  return {
    projectId,
    project: null,
    loading: enabled && Boolean(projectId),
    error: null,
    notFound: !enabled || !projectId,
  };
}

function initialProjectMembersState(projectId: string, enabled: boolean): ProjectMembersState {
  return {
    projectId,
    rows: [],
    loading: enabled && Boolean(projectId),
    error: null,
  };
}

function initialProjectTasksState(projectId: string, enabled: boolean): ProjectTasksState {
  return {
    requestId: 0,
    rows: [],
    loading: enabled && Boolean(projectId),
    error: null,
    stale: false,
  };
}

function normalizeTeamProject(value: unknown, projectId: string): UiProject | null {
  const project = normalizeProjectRows([value]).find(
    (candidate) => candidate.projectId === projectId && candidate.scope === 'organization',
  );
  return project ?? null;
}

function normalizeProjectMemberRows(value: unknown, projectId: string): UiProjectMember[] {
  if (!Array.isArray(value)) return [];
  const seenMemberIds = new Set<string>();
  const seenUserIds = new Set<string>();
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const tenantHint = ownValue(entry, 'projectId');
    if (tenantHint !== undefined && safeText(tenantHint) !== projectId) return [];
    const projectMemberId = ownText(entry, 'projectMemberId');
    const organizationMemberId = ownText(entry, 'organizationMemberId');
    const userId = ownText(entry, 'userId');
    const role = ownValue(entry, 'role');
    if (
      !projectMemberId ||
      !organizationMemberId ||
      !userId ||
      seenMemberIds.has(projectMemberId) ||
      seenUserIds.has(userId) ||
      !isProjectMemberRole(role)
    ) {
      return [];
    }
    seenMemberIds.add(projectMemberId);
    seenUserIds.add(userId);
    return [
      {
        projectMemberId,
        organizationMemberId,
        userId,
        displayName: ownText(entry, 'displayName') || '未命名成员',
        avatarUrl: ownNullableText(entry, 'avatarUrl'),
        role,
      },
    ];
  });
}

function normalizeTeamTaskRows(value: unknown, projectId: string): TeamTaskWorkbenchRow[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = ownText(entry, 'id');
    const rowProjectId = ownText(entry, 'projectId');
    const title = ownText(entry, 'title');
    const state = ownValue(entry, 'state');
    const assignmentMode = ownValue(entry, 'assignmentMode');
    const version = ownValue(entry, 'version');
    const revisionRound = ownValue(entry, 'revisionRound');
    if (
      !id ||
      seen.has(id) ||
      rowProjectId !== projectId ||
      !title ||
      !isTeamTaskState(state) ||
      !isAssignmentMode(assignmentMode) ||
      !Number.isSafeInteger(version) ||
      (version as number) < 1 ||
      !Number.isSafeInteger(revisionRound) ||
      (revisionRound as number) < 0
    ) {
      return [];
    }
    seen.add(id);
    const collaboratorUserIds = Array.isArray(entry.collaboratorUserIds)
      ? entry.collaboratorUserIds.map(safeText).filter(Boolean)
      : [];
    return [
      {
        ...entry,
        id,
        projectId,
        title,
        description: ownNullableText(entry, 'description'),
        assignmentMode,
        state,
        version: version as number,
        dueAt: ownNullableText(entry, 'dueAt'),
        revisionRound: revisionRound as number,
        responsibleUserId: ownNullableText(entry, 'responsibleUserId'),
        responsibleDisplayName: ownNullableText(entry, 'responsibleDisplayName'),
        responsibleAssignmentId: ownNullableText(entry, 'responsibleAssignmentId'),
        responsibleAssignmentStatus: normalizeAssignmentStatus(entry.responsibleAssignmentStatus),
        myPendingAssignmentId: ownNullableText(entry, 'myPendingAssignmentId'),
        myPendingAssignmentRole:
          entry.myPendingAssignmentRole === 'responsible' ||
          entry.myPendingAssignmentRole === 'collaborator'
            ? entry.myPendingAssignmentRole
            : null,
        myPendingAssignmentStatus:
          entry.myPendingAssignmentStatus === 'offered' ||
          entry.myPendingAssignmentStatus === 'applied'
            ? entry.myPendingAssignmentStatus
            : null,
        canSelectClaim: entry.canSelectClaim === true,
        claimApplicants: normalizeClaimApplicants(entry.claimApplicants),
        collaboratorUserIds,
        milestoneId: ownNullableText(entry, 'milestoneId'),
        milestone: ownNullableText(entry, 'milestone'),
        submittedOnTime:
          entry.submittedOnTime === true ? true : entry.submittedOnTime === false ? false : null,
        accepted:
          state === 'accepted' || state === 'completed'
            ? true
            : state === 'revision_requested' || state === 'rejected_final'
              ? false
              : null,
        latestSubmissionId: ownNullableText(entry, 'latestSubmissionId'),
        latestReviewId: ownNullableText(entry, 'latestReviewId'),
        contract: normalizeTaskContract(entry.contract),
        timeline: normalizeTaskTimeline(entry.timeline),
        updatedAt: ownText(entry, 'updatedAt'),
      } as TeamTaskWorkbenchRow,
    ];
  });
}

function normalizeMilestoneOptions(value: unknown): Array<{ id: string; title: string }> {
  if (!isRecord(value) || !Array.isArray(value.milestones)) return [];
  const seen = new Set<string>();
  return value.milestones.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = ownText(entry, 'id');
    const title = ownText(entry, 'title');
    if (!id || !title || seen.has(id)) return [];
    seen.add(id);
    return [{ id, title }];
  });
}

function isAssignmentMode(value: unknown): value is TeamTaskWorkbenchRow['assignmentMode'] {
  return value === 'direct' || value === 'first_come' || value === 'leader_select';
}

function normalizeAssignmentStatus(
  value: unknown,
): TeamTaskWorkbenchRow['responsibleAssignmentStatus'] {
  return value === 'offered' || value === 'applied' || value === 'accepted' ? value : null;
}

function isTeamTaskState(value: unknown): value is TeamTaskWorkbenchRow['state'] {
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

function isProjectMemberRole(value: unknown): value is ProjectMemberRole {
  return value === 'lead' || value === 'member' || value === 'viewer';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function ownValue(value: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function ownText(value: Record<string, unknown>, key: string): string {
  return safeText(ownValue(value, key));
}

function ownNullableText(value: Record<string, unknown>, key: string): string | null {
  return ownText(value, key) || null;
}

function normalizeTaskContract(value: unknown): TeamTaskWorkbenchRow['contract'] {
  if (!isRecord(value)) return null;
  const version = ownValue(value, 'version');
  const objective = ownText(value, 'objective');
  const approverUserId = ownText(value, 'approverUserId');
  const arbitratorUserId = ownText(value, 'arbitratorUserId');
  const criteriaValue = ownValue(value, 'criteria');
  if (
    !Number.isSafeInteger(version) ||
    !objective ||
    !approverUserId ||
    !arbitratorUserId ||
    !Array.isArray(criteriaValue)
  )
    return null;
  const criteria = criteriaValue.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = ownText(entry, 'id');
    const description = ownText(entry, 'description');
    return id && description ? [{ id, description }] : [];
  });
  return { version: version as number, objective, criteria, approverUserId, arbitratorUserId };
}

function normalizeClaimApplicants(
  value: unknown,
): NonNullable<TeamTaskWorkbenchRow['claimApplicants']> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const assignmentId = ownText(entry, 'assignmentId');
    const userId = ownText(entry, 'userId');
    if (!assignmentId || !userId) return [];
    return [{ assignmentId, userId, displayName: ownNullableText(entry, 'displayName') }];
  });
}

function normalizeTaskTimeline(value: unknown): TeamTaskWorkbenchRow['timeline'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const kind = ownValue(entry, 'kind');
    const label = ownText(entry, 'label');
    const at = ownText(entry, 'at');
    if (!isTimelineKind(kind) || !label || !at) return [];
    return [{ kind, label, at }];
  });
}

function isTimelineKind(
  value: unknown,
): value is NonNullable<TeamTaskWorkbenchRow['timeline']>[number]['kind'] {
  return (
    typeof value === 'string' &&
    ['contract', 'assignment', 'block', 'submission', 'review', 'appeal', 'ai'].includes(value)
  );
}

function mutationReceipt(value: unknown): { workItemId: string; version: number } {
  if (!isRecord(value)) throw new Error('任务操作返回了无效结果');
  const workItemId = ownText(value, 'workItemId');
  const version = ownValue(value, 'version');
  if (!workItemId || !Number.isSafeInteger(version) || (version as number) < 1) {
    throw new Error('任务操作返回了无效结果');
  }
  return { workItemId, version: version as number };
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function presentTaskMutationError(error: unknown): Error {
  if (isRecord(error) && isRecord(error.data) && error.data.code === 'CONFLICT') {
    return new Error('任务已在其他位置更新，请刷新后重试');
  }
  if (error instanceof Error) return error;
  return new Error('任务操作失败，请稍后重试');
}
