import { useAppShellContext } from '@/components/AppShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { OrganizationInviteDialog } from '@/components/projects/OrganizationInviteDialog';
import { OrganizationMembersPanel } from '@/components/projects/OrganizationMembersPanel';
import { WorkspaceSwitcher } from '@/components/projects/WorkspaceSwitcher';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import {
  type OrganizationRole,
  type UiOrganization,
  type UiOrganizationMember,
  normalizeOrganizationMemberRows,
  normalizeOrganizationRows,
  normalizeSelectedWorkspace,
  organizationActionVisibility,
} from '@/lib/organization-page-state';
import { pageActionError, pageErrorMessage } from '@/lib/page-error-copy';
import {
  PROJECT_NAME_MAX_LENGTH,
  normalizeProjectRows,
  projectCountSummary,
  projectLoadErrorCopy,
  projectNameState,
} from '@/lib/project-page-state';
import { type AppRouter, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader, PageLoadingPanel } from '@/pages/PageShell';
import type { UiProject } from '@/types/task';
import * as Dialog from '@radix-ui/react-dialog';
import type { inferRouterClient } from '@trpc/client';
import {
  AlertCircle,
  Building2,
  FolderOpen,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

interface ScopedCollectionState<T> {
  readonly organizationId: string | null;
  readonly rows: readonly T[];
  readonly loading: boolean;
  readonly error: string | null;
}

const ORGANIZATION_ROLE_LABEL: Record<OrganizationRole, string> = {
  owner: '所有者',
  admin: '管理员',
  manager: '主管',
  member: '成员',
};

type Task12WorkspaceClient = Pick<inferRouterClient<AppRouter>, 'organizations' | 'projects'>;

// Keep the Task 12 surface named while deriving every procedure directly from AppRouter.
const task12WorkspaceClient: Task12WorkspaceClient = trpc;

/**
 * Personal projects keep the established no-input AppShell collection. The
 * organization branch is mounted only for an exact true rollout flag, then
 * stores Task 11 normalized rows rather than raw API payloads.
 */
export function ProjectsPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { me, projects: shellProjects, refreshProjects } = useAppShellContext();
  const teamProjectsEnabled = me?.teamProjectsEnabled === true;
  const mountedRef = React.useRef(false);
  const personalRequestRef = React.useRef(0);
  const organizationRequestRef = React.useRef(0);
  const workspaceRequestGenerationRef = React.useRef(new Map<string, number>());
  const selectedOrganizationIdRef = React.useRef<string | null>(null);
  const teamProjectsEnabledRef = React.useRef(teamProjectsEnabled);
  const organizationsRef = React.useRef<readonly UiOrganization[]>([]);

  const [personalProjects, setPersonalProjects] = React.useState<UiProject[]>(() =>
    shellProjects.filter((project) => project.scope === 'personal'),
  );
  const [personalLoading, setPersonalLoading] = React.useState(shellProjects.length === 0);
  const [personalError, setPersonalError] = React.useState<string | null>(null);
  const [organizations, setOrganizations] = React.useState<UiOrganization[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = React.useState(teamProjectsEnabled);
  const [organizationsError, setOrganizationsError] = React.useState<string | null>(null);
  const [selectedWorkspaceValue, setSelectedWorkspaceValue] = React.useState<string | null>(null);
  const [teamProjects, setTeamProjects] =
    React.useState<ScopedCollectionState<UiProject>>(emptyScopedCollection);
  const [members, setMembers] =
    React.useState<ScopedCollectionState<UiOrganizationMember>>(emptyScopedCollection);

  const [creatingPersonal, setCreatingPersonal] = React.useState(
    searchParams.get('create') === '1',
  );
  const [personalName, setPersonalName] = React.useState('');
  const [personalNameTouched, setPersonalNameTouched] = React.useState(false);
  const [creatingPersonalNow, setCreatingPersonalNow] = React.useState(false);
  const [createOrganizationOpen, setCreateOrganizationOpen] = React.useState(false);
  const [createTeamProjectOpen, setCreateTeamProjectOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<UiProject | null>(null);
  const [pendingMemberRemoval, setPendingMemberRemoval] =
    React.useState<UiOrganizationMember | null>(null);

  const selectedWorkspace = normalizeSelectedWorkspace(
    teamProjectsEnabled ? selectedWorkspaceValue : null,
    organizations,
  );
  const selectedOrganization = selectedWorkspace.organization;
  const selectedOrganizationId = selectedWorkspace.organizationId;
  teamProjectsEnabledRef.current = teamProjectsEnabled;
  selectedOrganizationIdRef.current = selectedOrganizationId;
  organizationsRef.current = organizations;
  const organizationActions = selectedOrganization
    ? organizationActionVisibility(selectedOrganization.role)
    : null;
  const selectedTeamProjects = scopedRowsFor(teamProjects, selectedOrganizationId);
  const selectedMembers = scopedRowsFor(members, selectedOrganizationId);
  const personalCreateState = projectNameState(
    personalName,
    personalProjects.map((project) => project.name),
  );
  const showPersonalCreateError = personalNameTouched && personalCreateState.error !== null;

  const invalidateWorkspace = React.useCallback(
    (organizationId: string, removeOrganization = true): void => {
      if (selectedOrganizationIdRef.current !== organizationId) return;
      bumpWorkspaceGeneration(workspaceRequestGenerationRef.current, organizationId);
      selectedOrganizationIdRef.current = null;
      setSelectedWorkspaceValue(null);
      setTeamProjects(emptyScopedCollection());
      setMembers(emptyScopedCollection());
      setCreateTeamProjectOpen(false);
      setInviteOpen(false);
      setPendingDelete(null);
      setPendingMemberRemoval(null);
      if (removeOrganization) {
        setOrganizations((current) => {
          const next = current.filter(
            (organization) => organization.organizationId !== organizationId,
          );
          organizationsRef.current = next;
          return next;
        });
      }
    },
    [],
  );

  const refreshPersonalProjects = React.useCallback(async () => {
    const requestId = personalRequestRef.current + 1;
    personalRequestRef.current = requestId;
    setPersonalLoading(true);
    setPersonalError(null);
    const result = await refreshProjects();
    if (!mountedRef.current || personalRequestRef.current !== requestId) return null;
    if ('error' in result) {
      setPersonalError(pageErrorMessage(result.error));
      setPersonalLoading(false);
      toast.show('项目暂时无法加载', 'error');
      return null;
    }
    const nextProjects = result.projects.filter((project) => project.scope === 'personal');
    setPersonalProjects(nextProjects);
    setPersonalLoading(false);
    return nextProjects;
  }, [refreshProjects, toast]);

  const refreshOrganizations = React.useCallback(async () => {
    if (!teamProjectsEnabledRef.current) return null;
    const requestId = organizationRequestRef.current + 1;
    organizationRequestRef.current = requestId;
    setOrganizationsLoading(true);
    setOrganizationsError(null);
    try {
      const response = await task12WorkspaceClient.organizations.list.query();
      const nextOrganizations = normalizeOrganizationRows(response);
      if (!mountedRef.current || organizationRequestRef.current !== requestId) return null;
      const currentOrganizationId = selectedOrganizationIdRef.current;
      const previousOrganization = currentOrganizationId
        ? organizationsRef.current.find(
            (organization) => organization.organizationId === currentOrganizationId,
          )
        : null;
      const nextOrganization = currentOrganizationId
        ? nextOrganizations.find(
            (organization) => organization.organizationId === currentOrganizationId,
          )
        : null;
      organizationsRef.current = nextOrganizations;
      setOrganizations(nextOrganizations);
      setOrganizationsLoading(false);
      if (currentOrganizationId && !nextOrganization) {
        invalidateWorkspace(currentOrganizationId, false);
      } else if (
        previousOrganization &&
        nextOrganization &&
        previousOrganization.role !== nextOrganization.role
      ) {
        setInviteOpen(false);
        setCreateTeamProjectOpen(false);
        setPendingDelete(null);
        setPendingMemberRemoval(null);
      }
      return nextOrganizations;
    } catch (error) {
      if (!mountedRef.current || organizationRequestRef.current !== requestId) return null;
      if (isHiddenResourceError(error)) {
        const currentOrganizationId = selectedOrganizationIdRef.current;
        organizationsRef.current = [];
        setOrganizations([]);
        setOrganizationsError(null);
        setOrganizationsLoading(false);
        if (currentOrganizationId) invalidateWorkspace(currentOrganizationId, false);
        return [];
      }
      setOrganizationsError(pageErrorMessage(error));
      setOrganizationsLoading(false);
      return null;
    }
  }, [invalidateWorkspace]);

  const refreshOrganizationWorkspace = React.useCallback(
    async (organizationId: string) => {
      if (!teamProjectsEnabledRef.current || selectedOrganizationIdRef.current !== organizationId) {
        return;
      }
      const requestGeneration = bumpWorkspaceGeneration(
        workspaceRequestGenerationRef.current,
        organizationId,
      );
      setTeamProjects((current) => startScopedRefresh(current, organizationId));
      setMembers((current) => startScopedRefresh(current, organizationId));

      const projectFuture = task12WorkspaceClient.projects.list.query({ organizationId });
      const memberFuture = task12WorkspaceClient.organizations.members.query({ organizationId });
      const settleProjects = projectFuture.then(
        (response) => {
          if (
            !isCurrentWorkspaceRequest({
              mounted: mountedRef.current,
              teamProjectsEnabled: teamProjectsEnabledRef.current,
              selectedOrganizationId: selectedOrganizationIdRef.current,
              generations: workspaceRequestGenerationRef.current,
              organizationId,
              requestGeneration,
            })
          ) {
            return;
          }
          setTeamProjects({
            organizationId,
            rows: normalizeProjectRows(response, { organizationId }),
            loading: false,
            error: null,
          });
        },
        (error: unknown) => {
          if (
            !isCurrentWorkspaceRequest({
              mounted: mountedRef.current,
              teamProjectsEnabled: teamProjectsEnabledRef.current,
              selectedOrganizationId: selectedOrganizationIdRef.current,
              generations: workspaceRequestGenerationRef.current,
              organizationId,
              requestGeneration,
            })
          ) {
            return;
          }
          if (isHiddenResourceError(error)) {
            invalidateWorkspace(organizationId);
            return;
          }
          setTeamProjects((current) => finishScopedFailure(current, organizationId, error));
        },
      );
      const settleMembers = memberFuture.then(
        (response) => {
          if (
            !isCurrentWorkspaceRequest({
              mounted: mountedRef.current,
              teamProjectsEnabled: teamProjectsEnabledRef.current,
              selectedOrganizationId: selectedOrganizationIdRef.current,
              generations: workspaceRequestGenerationRef.current,
              organizationId,
              requestGeneration,
            })
          ) {
            return;
          }
          setMembers({
            organizationId,
            rows: normalizeOrganizationMemberRows(response, organizationId),
            loading: false,
            error: null,
          });
        },
        (error: unknown) => {
          if (
            !isCurrentWorkspaceRequest({
              mounted: mountedRef.current,
              teamProjectsEnabled: teamProjectsEnabledRef.current,
              selectedOrganizationId: selectedOrganizationIdRef.current,
              generations: workspaceRequestGenerationRef.current,
              organizationId,
              requestGeneration,
            })
          ) {
            return;
          }
          if (isHiddenResourceError(error)) {
            invalidateWorkspace(organizationId);
            return;
          }
          setMembers((current) => finishScopedFailure(current, organizationId, error));
        },
      );
      await Promise.all([settleProjects, settleMembers]);
    },
    [invalidateWorkspace],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    void refreshPersonalProjects();
    if (teamProjectsEnabled) void refreshOrganizations();
    return () => {
      mountedRef.current = false;
      personalRequestRef.current += 1;
      organizationRequestRef.current += 1;
      workspaceRequestGenerationRef.current.clear();
    };
  }, [refreshOrganizations, refreshPersonalProjects, teamProjectsEnabled]);

  React.useEffect(() => {
    if (!teamProjectsEnabled || !selectedOrganizationId) {
      setTeamProjects(emptyScopedCollection());
      setMembers(emptyScopedCollection());
      setCreateTeamProjectOpen(false);
      setInviteOpen(false);
      setPendingDelete(null);
      setPendingMemberRemoval(null);
      return;
    }
    void refreshOrganizationWorkspace(selectedOrganizationId);
    return () => {
      bumpWorkspaceGeneration(workspaceRequestGenerationRef.current, selectedOrganizationId);
    };
  }, [refreshOrganizationWorkspace, selectedOrganizationId, teamProjectsEnabled]);

  const selectWorkspace = React.useCallback((organizationId: string | null) => {
    const previousOrganizationId = selectedOrganizationIdRef.current;
    if (previousOrganizationId) {
      bumpWorkspaceGeneration(workspaceRequestGenerationRef.current, previousOrganizationId);
    }
    selectedOrganizationIdRef.current = organizationId;
    setSelectedWorkspaceValue(organizationId);
    setCreatingPersonal(false);
    setPersonalName('');
    setPersonalNameTouched(false);
    setCreateTeamProjectOpen(false);
    setInviteOpen(false);
    setPendingDelete(null);
    setPendingMemberRemoval(null);
    if (!organizationId) {
      setTeamProjects(emptyScopedCollection());
      setMembers(emptyScopedCollection());
    }
  }, []);

  const createPersonalProject = async (): Promise<void> => {
    setPersonalNameTouched(true);
    if (!personalCreateState.canSubmit || creatingPersonalNow) return;
    setCreatingPersonalNow(true);
    try {
      await trpc.projects.create.mutate({ name: personalCreateState.name });
      if (!mountedRef.current) return;
      toast.show(`已创建项目「${personalCreateState.name}」`);
      setPersonalName('');
      setPersonalNameTouched(false);
      setCreatingPersonal(false);
      await refreshPersonalProjects();
    } catch (error) {
      if (mountedRef.current) toast.show(pageActionError('创建失败', error), 'error');
    } finally {
      if (mountedRef.current) setCreatingPersonalNow(false);
    }
  };

  const createOrganization = async (name: string): Promise<boolean> => {
    try {
      const response = await task12WorkspaceClient.organizations.create.mutate({ name });
      const [created] = normalizeOrganizationRows([response]);
      if (!mountedRef.current || !created) {
        if (mountedRef.current) toast.show('团队创建结果无效，请刷新后重试', 'error');
        return false;
      }
      setOrganizations((current) => normalizeOrganizationRows([...current, created]));
      selectedOrganizationIdRef.current = created.organizationId;
      setSelectedWorkspaceValue(created.organizationId);
      toast.show(`已创建团队「${created.name}」`);
      void refreshOrganizations();
      return true;
    } catch (error) {
      if (mountedRef.current) toast.show(pageActionError('创建团队失败', error), 'error');
      return false;
    }
  };

  const createTeamProject = async (name: string): Promise<boolean> => {
    const organizationId = selectedOrganizationIdRef.current;
    if (!organizationId) return false;
    try {
      await task12WorkspaceClient.projects.create.mutate({
        name,
        organizationId,
      });
      if (!mountedRef.current) return false;
      toast.show(`已创建团队项目「${name}」`);
      if (selectedOrganizationIdRef.current === organizationId) {
        void refreshOrganizationWorkspace(organizationId);
      }
      return true;
    } catch (error) {
      if (mountedRef.current) toast.show(pageActionError('创建团队项目失败', error), 'error');
      return false;
    }
  };

  const performDelete = async (project: UiProject): Promise<void> => {
    try {
      await trpc.projects.delete.mutate({ projectId: project.projectId });
      if (!mountedRef.current) return;
      toast.show('项目已删除');
      if (project.scope === 'organization' && project.organizationId) {
        if (selectedOrganizationIdRef.current === project.organizationId) {
          await refreshOrganizationWorkspace(project.organizationId);
        }
      } else {
        await refreshPersonalProjects();
      }
    } catch (error) {
      if (mountedRef.current) toast.show(pageActionError('删除失败', error), 'error');
    }
  };

  const updateReportingLine = async (
    memberId: string,
    managerMemberId: string,
  ): Promise<boolean> => {
    const organizationId = selectedOrganizationIdRef.current;
    if (!organizationId) return false;
    try {
      await task12WorkspaceClient.organizations.updateReportingLine.mutate({
        organizationId,
        memberId,
        managerMemberId,
      });
      if (!mountedRef.current) return false;
      toast.show('直属上级已更新');
      const refreshes: Promise<unknown>[] = [refreshOrganizations()];
      if (selectedOrganizationIdRef.current === organizationId) {
        refreshes.push(refreshOrganizationWorkspace(organizationId));
      }
      await Promise.all(refreshes);
      return true;
    } catch (error) {
      if (mountedRef.current) toast.show(pageActionError('更新直属上级失败', error), 'error');
      return false;
    }
  };

  const updateMemberRole = async (memberId: string, role: OrganizationRole): Promise<boolean> => {
    const organizationId = selectedOrganizationIdRef.current;
    if (!organizationId) return false;
    try {
      await task12WorkspaceClient.organizations.updateMemberRole.mutate({
        organizationId,
        memberId,
        role,
      });
      if (!mountedRef.current) return false;
      toast.show('成员角色已更新');
      const refreshes: Promise<unknown>[] = [refreshOrganizations()];
      if (selectedOrganizationIdRef.current === organizationId) {
        refreshes.push(refreshOrganizationWorkspace(organizationId));
      }
      await Promise.all(refreshes);
      return true;
    } catch (error) {
      if (mountedRef.current) toast.show(pageActionError('更新成员角色失败', error), 'error');
      return false;
    }
  };

  const deactivateMember = async (member: UiOrganizationMember): Promise<void> => {
    const organizationId = selectedOrganizationIdRef.current;
    if (!organizationId) return;
    try {
      await task12WorkspaceClient.organizations.deactivateMember.mutate({
        organizationId,
        memberId: member.memberId,
      });
      if (!mountedRef.current) return;
      toast.show(`已移除成员「${member.displayName}」`);
      const refreshes: Promise<unknown>[] = [refreshOrganizations()];
      if (selectedOrganizationIdRef.current === organizationId) {
        refreshes.push(refreshOrganizationWorkspace(organizationId));
      }
      await Promise.all(refreshes);
    } catch (error) {
      if (mountedRef.current) toast.show(pageActionError('移除成员失败', error), 'error');
    }
  };

  const personalSummary = projectCountSummary({
    count: personalProjects.length,
    loading: personalLoading,
    error: personalError,
  });
  const teamSummary = projectCountSummary({
    count: selectedTeamProjects.rows.length,
    loading: selectedTeamProjects.loading,
    error: selectedTeamProjects.error,
  });

  return (
    <PageContainer width="wide">
      <PageHeader
        title="项目"
        description={
          teamProjectsEnabled ? '在个人项目与团队工作区之间切换' : '按项目分组管理你的任务'
        }
        action={
          selectedOrganization && organizationActions ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <SummaryPill>{teamSummary}</SummaryPill>
              {organizationActions.inviteRoles.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setInviteOpen(true)}
                  className="h-11"
                >
                  邀请成员
                </Button>
              ) : null}
              {organizationActions.canCreateProject ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setCreateTeamProjectOpen(true)}
                  className="h-11 bg-[#EA1F59] text-white hover:bg-[#EA1F59]/90"
                >
                  <Plus className="h-4 w-4" />
                  新建团队项目
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <SummaryPill>{personalSummary}</SummaryPill>
              {!creatingPersonal ? (
                <button
                  type="button"
                  onClick={() => {
                    setCreatingPersonal(true);
                    setPersonalNameTouched(false);
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#EA1F59] px-3 text-sm font-medium text-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition hover:bg-[#EA1F59]/90"
                >
                  <Plus className="h-4 w-4" />
                  新建项目
                </button>
              ) : null}
            </div>
          )
        }
      />

      {teamProjectsEnabled ? (
        <WorkspaceSwitcher
          organizations={organizations}
          selectedOrganizationId={selectedOrganizationId}
          loading={organizationsLoading}
          error={organizationsError}
          onSelectOrganization={selectWorkspace}
          onCreateOrganization={() => setCreateOrganizationOpen(true)}
          onRefresh={() => void refreshOrganizations()}
        />
      ) : null}

      {selectedOrganization && organizationActions ? (
        <div>
          <OrganizationWorkspaceSummary
            organization={selectedOrganization}
            loading={selectedTeamProjects.loading || selectedMembers.loading}
            onRefresh={() => void refreshOrganizationWorkspace(selectedOrganization.organizationId)}
          />
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.85fr)] lg:items-start">
            <ProjectCollection
              title="团队项目"
              description="团队项目是当前工作区的主要内容。"
              projects={selectedTeamProjects.rows}
              loading={selectedTeamProjects.loading}
              error={selectedTeamProjects.error}
              loadingLabel="团队项目加载中"
              errorTitle="团队项目暂时无法加载"
              staleTitle="团队项目更新失败，当前保留上次结果"
              emptyTitle="还没有团队项目"
              emptyDescription={
                organizationActions.canCreateProject
                  ? '创建第一个团队项目，明确成员与协作边界。'
                  : '当前还没有你可访问的团队项目。'
              }
              onRetry={() => void refreshOrganizationWorkspace(selectedOrganization.organizationId)}
              onCreate={
                organizationActions.canCreateProject
                  ? () => setCreateTeamProjectOpen(true)
                  : undefined
              }
              onOpen={(project) => navigate(`/projects/${encodeURIComponent(project.projectId)}`)}
              organizationRole={selectedOrganization.role}
              onDelete={setPendingDelete}
            />
            <OrganizationMembersPanel
              organization={selectedOrganization}
              members={selectedMembers.rows}
              loading={selectedMembers.loading}
              error={selectedMembers.error}
              onRefresh={() =>
                void refreshOrganizationWorkspace(selectedOrganization.organizationId)
              }
              onUpdateReportingLine={updateReportingLine}
              onUpdateRole={updateMemberRole}
              onDeactivate={async (member) => setPendingMemberRemoval(member)}
            />
          </div>
        </div>
      ) : (
        <div>
          {teamProjectsEnabled ? (
            <header className="mb-3">
              <h2 className="text-base font-semibold text-foreground">个人项目</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">仅自己可见的任务分组。</p>
            </header>
          ) : null}
          {creatingPersonal ? (
            <PersonalCreateForm
              value={personalName}
              touched={personalNameTouched}
              busy={creatingPersonalNow}
              onChange={setPersonalName}
              onBlur={() => setPersonalNameTouched(true)}
              onCancel={() => {
                setCreatingPersonal(false);
                setPersonalName('');
                setPersonalNameTouched(false);
              }}
              onSubmit={() => void createPersonalProject()}
              error={showPersonalCreateError ? personalCreateState.error : null}
              canSubmit={personalCreateState.canSubmit}
            />
          ) : null}
          <ProjectCollection
            projects={personalProjects}
            loading={personalLoading}
            error={personalError}
            loadingLabel={teamProjectsEnabled ? '个人项目加载中' : '项目加载中'}
            errorTitle={teamProjectsEnabled ? '个人项目暂时无法加载' : '项目暂时无法加载'}
            staleTitle={
              teamProjectsEnabled
                ? '个人项目更新失败，当前保留上次结果'
                : '项目暂时无法加载，当前保留上次结果'
            }
            emptyTitle={teamProjectsEnabled ? '还没有个人项目' : '还没有项目'}
            emptyDescription="创建一个项目来分组管理你的任务。"
            onRetry={() => void refreshPersonalProjects()}
            onCreate={() => {
              setCreatingPersonal(true);
              setPersonalNameTouched(false);
            }}
            onOpen={(project) => navigate(`/?project=${project.projectId}`)}
            onDelete={setPendingDelete}
          />
        </div>
      )}

      <CreateNameDialog
        open={teamProjectsEnabled && createOrganizationOpen}
        title="创建团队空间"
        description="建立独立的成员与项目权限边界。"
        inputLabel="团队名称"
        submitLabel="创建团队"
        onClose={() => setCreateOrganizationOpen(false)}
        onSubmit={createOrganization}
      />
      <CreateNameDialog
        open={teamProjectsEnabled && selectedOrganization !== null && createTeamProjectOpen}
        title="新建团队项目"
        description={`在「${selectedOrganization?.name ?? '团队'}」中创建项目。`}
        inputLabel="项目名称"
        submitLabel="创建项目"
        onClose={() => setCreateTeamProjectOpen(false)}
        onSubmit={createTeamProject}
      />
      {teamProjectsEnabled && inviteOpen && selectedOrganization && organizationActions ? (
        <OrganizationInviteDialog
          key={selectedOrganization.organizationId}
          open
          organizationId={selectedOrganization.organizationId}
          organizationName={selectedOrganization.name}
          inviteRoles={organizationActions.inviteRoles}
          members={selectedMembers.rows}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}
      <ConfirmDialog
        open={pendingDelete !== null && (pendingDelete.scope === 'personal' || teamProjectsEnabled)}
        title="删除这个项目？"
        description={
          pendingDelete
            ? `项目「${pendingDelete.name}」共 ${pendingDelete.taskCount} 个任务。\n项目下的任务会移回默认列表，任务本身不会被删除。`
            : ''
        }
        confirmLabel="删除项目"
        destructive
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          const project = pendingDelete;
          if (!project) return;
          await performDelete(project);
          if (mountedRef.current) setPendingDelete(null);
        }}
      />
      <ConfirmDialog
        open={teamProjectsEnabled && selectedOrganization !== null && pendingMemberRemoval !== null}
        title="移除这位团队成员？"
        description={
          pendingMemberRemoval
            ? `成员「${pendingMemberRemoval.displayName}」将失去当前团队空间的访问权限。`
            : ''
        }
        confirmLabel="移除成员"
        destructive
        onClose={() => setPendingMemberRemoval(null)}
        onConfirm={async () => {
          const member = pendingMemberRemoval;
          if (!member) return;
          await deactivateMember(member);
          if (mountedRef.current) setPendingMemberRemoval(null);
        }}
      />
    </PageContainer>
  );
}

function ProjectCollection({
  title,
  description,
  projects,
  loading,
  error,
  loadingLabel,
  errorTitle,
  staleTitle,
  emptyTitle,
  emptyDescription,
  onRetry,
  onCreate,
  onOpen,
  organizationRole,
  onDelete,
}: {
  title?: string;
  description?: string;
  projects: readonly UiProject[];
  loading: boolean;
  error: string | null;
  loadingLabel: string;
  errorTitle: string;
  staleTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  onRetry(): void;
  onCreate?: () => void;
  onOpen(project: UiProject): void;
  organizationRole?: OrganizationRole;
  onDelete?: (project: UiProject) => void;
}): JSX.Element {
  const hasProjects = projects.length > 0;
  const errorCopy = projectLoadErrorCopy(error);
  return (
    <section aria-label={title}>
      {title ? (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </header>
      ) : null}

      {error && hasProjects ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-[8px] border border-[#EA1F59]/20 bg-white px-3 py-2 text-xs text-[#595757]">
          <span>{staleTitle}</span>
          <button type="button" onClick={onRetry} className="font-medium text-[#EA1F59]">
            重试
          </button>
        </div>
      ) : null}

      {loading && !hasProjects ? (
        <PageLoadingPanel label={loadingLabel} description="正在同步项目列表" />
      ) : error && !hasProjects ? (
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <AlertCircle className="h-8 w-8 text-primary" />
          <div className="text-sm font-medium text-foreground/80">{errorTitle}</div>
          <div className="max-w-md text-xs leading-5 text-muted-foreground">{errorCopy.body}</div>
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 inline-flex h-8 items-center rounded-md bg-[#EA1F59] px-3 text-xs font-medium text-white transition hover:bg-[#EA1F59]/90"
          >
            重试
          </button>
        </div>
      ) : !hasProjects ? (
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-dashed border-[#DCDDDD] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <FolderOpen className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">{emptyTitle}</div>
          <div className="text-xs text-muted-foreground">{emptyDescription}</div>
          {onCreate ? (
            <button
              type="button"
              onClick={onCreate}
              className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md bg-[#EA1F59] px-3 text-xs font-medium text-white transition hover:bg-[#EA1F59]/90"
            >
              <Plus className="h-3.5 w-3.5" />
              {title === '团队项目' ? '新建团队项目' : '新建项目'}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <article
              key={project.projectId}
              className="group flex flex-col gap-2 rounded-[8px] border border-[#DCDDDD] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-[transform,border-color,box-shadow] hover:-translate-y-px hover:border-[#ADADAD] hover:shadow-[0_5px_16px_rgba(15,23,42,0.055)]"
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(project)}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-[#595757] transition-colors group-hover:border-[#ADADAD]">
                    {project.scope === 'organization' ? (
                      <Building2 className="h-4 w-4" aria-hidden />
                    ) : (
                      <FolderOpen className="h-4 w-4" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground hover:text-[#EA1F59]">
                      {project.name}
                    </div>
                    {project.description ? (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {project.description}
                      </div>
                    ) : null}
                  </div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`项目 ${project.name} 操作`}
                      title="更多"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#595757] transition-colors hover:bg-[#EFEFEF]/60 hover:text-foreground"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onSelect={() => onOpen(project)}>
                      <FolderOpen className="text-muted-foreground" />
                      <span>{project.scope === 'organization' ? '查看项目' : '打开项目'}</span>
                    </DropdownMenuItem>
                    {onDelete && canDeleteProject(project, organizationRole) ? (
                      <DropdownMenuItem
                        onSelect={() => onDelete(project)}
                        className="text-[#EA1F59] focus:bg-[#EA1F59]/[0.06] focus:text-[#EA1F59]"
                      >
                        <Trash2 />
                        <span>删除项目</span>
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>{project.taskCount} 个任务</span>
                {project.memberRole ? (
                  <span className="rounded-full bg-[#EFEFEF]/80 px-1.5 py-0.5">
                    {project.memberRole === 'lead'
                      ? '项目负责人'
                      : project.memberRole === 'viewer'
                        ? '观察者'
                        : '项目成员'}
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PersonalCreateForm({
  value,
  touched,
  busy,
  error,
  canSubmit,
  onChange,
  onBlur,
  onCancel,
  onSubmit,
}: {
  value: string;
  touched: boolean;
  busy: boolean;
  error: string | null;
  canSubmit: boolean;
  onChange(value: string): void;
  onBlur(): void;
  onCancel(): void;
  onSubmit(): void;
}): JSX.Element {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="mb-4 rounded-[8px] border border-[#DCDDDD] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <input
            // biome-ignore lint/a11y/noAutofocus: preserve the established personal-project create flow
            autoFocus
            value={value}
            onBlur={onBlur}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) onCancel();
            }}
            placeholder="项目名称（≤100 字）"
            maxLength={PROJECT_NAME_MAX_LENGTH}
            aria-invalid={touched && error !== null}
            aria-describedby="project-name-help"
            className="w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-1.5 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)] focus-visible:border-[#ADADAD] focus-visible:outline-none"
          />
          <div
            id="project-name-help"
            className={cn(
              'mt-1 flex items-center justify-between gap-3 text-xs',
              touched && error ? 'text-[#EA1F59]' : 'text-muted-foreground',
            )}
          >
            <span role={touched && error ? 'alert' : undefined}>
              {touched && error ? error : '创建后可把相关任务归到同一个项目。'}
            </span>
            <span className="shrink-0 tabular-nums">
              {value.length}/{PROJECT_NAME_MAX_LENGTH}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="submit"
            disabled={!canSubmit || busy}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:h-8',
              canSubmit && !busy
                ? 'bg-[#EA1F59] text-white hover:bg-[#EA1F59]/90'
                : 'cursor-not-allowed border border-[#DCDDDD] bg-[#EFEFEF]/60 text-muted-foreground',
            )}
          >
            {busy ? '创建中…' : '创建'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md border border-transparent px-3 py-1.5 text-xs text-[#595757] transition-colors hover:border-[#DCDDDD] hover:bg-white hover:text-foreground sm:h-8"
          >
            取消
          </button>
        </div>
      </div>
    </form>
  );
}

function OrganizationWorkspaceSummary({
  organization,
  loading,
  onRefresh,
}: {
  organization: UiOrganization;
  loading: boolean;
  onRefresh(): void;
}): JSX.Element {
  return (
    <section
      aria-label={`${organization.name} 工作区概览`}
      className="rounded-[10px] border border-[#DCDDDD] bg-gradient-to-br from-white to-[#F9F8FC] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[#57479C]/15 bg-[#57479C]/[0.065] text-[#57479C]">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground">{organization.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              当前身份：{ORGANIZATION_ROLE_LABEL[organization.role]} ·{' '}
              {organization.activeMemberCount} 位活跃成员
            </p>
            {organization.managerDisplayName ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                直属上级：{organization.managerDisplayName}
              </p>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={onRefresh}
          className="h-11"
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
          刷新工作区
        </Button>
      </div>
    </section>
  );
}

function CreateNameDialog({
  open,
  title,
  description,
  inputLabel,
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  inputLabel: string;
  submitLabel: string;
  onClose(): void;
  onSubmit(name: string): Promise<boolean>;
}): JSX.Element {
  const [name, setName] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const normalizedName = name.trim();
  const error = !normalizedName
    ? `请输入${inputLabel}`
    : name.length > PROJECT_NAME_MAX_LENGTH
      ? `${inputLabel}不能超过 ${PROJECT_NAME_MAX_LENGTH} 个字符`
      : null;

  const close = React.useCallback(() => {
    if (busy) return;
    setName('');
    setTouched(false);
    onClose();
  }, [busy, onClose]);

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (error || busy) return;
    setBusy(true);
    const created = await onSubmit(normalizedName);
    setBusy(false);
    if (created) {
      setName('');
      setTouched(false);
      onClose();
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[78] bg-black/35 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[79] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-[#DCDDDD] bg-white p-5 shadow-[0_20px_60px_rgba(17,24,39,0.18)] focus:outline-none dark:border-white/10 dark:bg-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-5 text-muted-foreground">
                {description}
              </Dialog.Description>
            </div>
            <button
              type="button"
              aria-label={`关闭${title}`}
              title="关闭"
              onClick={close}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[#595757] hover:bg-[#EFEFEF]/70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <label className="mt-5 block text-xs font-medium text-[#595757]">
            {inputLabel}
            <input
              aria-label={inputLabel}
              value={name}
              maxLength={PROJECT_NAME_MAX_LENGTH}
              onBlur={() => setTouched(true)}
              onChange={(event) => setName(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-sm text-foreground focus-visible:border-[#ADADAD] focus-visible:outline-none"
            />
          </label>
          {touched && error ? (
            <p role="alert" className="mt-2 text-xs text-[#EA1F59]">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={close}
              disabled={busy}
              className="h-11"
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || Boolean(error)}
              onClick={() => void submit()}
              className="h-11 bg-[#EA1F59] text-white hover:bg-[#EA1F59]/90"
            >
              {busy ? '创建中…' : submitLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SummaryPill({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="inline-flex items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      {children}
    </div>
  );
}

function emptyScopedCollection<T>(): ScopedCollectionState<T> {
  return { organizationId: null, rows: [], loading: false, error: null };
}

function startScopedRefresh<T>(
  current: ScopedCollectionState<T>,
  organizationId: string,
): ScopedCollectionState<T> {
  return {
    organizationId,
    rows: current.organizationId === organizationId ? current.rows : [],
    loading: true,
    error: null,
  };
}

function finishScopedFailure<T>(
  current: ScopedCollectionState<T>,
  organizationId: string,
  error: unknown,
): ScopedCollectionState<T> {
  return {
    organizationId,
    rows: current.organizationId === organizationId ? current.rows : [],
    loading: false,
    error: pageErrorMessage(error),
  };
}

function scopedRowsFor<T>(
  state: ScopedCollectionState<T>,
  organizationId: string | null,
): ScopedCollectionState<T> {
  if (!organizationId) return emptyScopedCollection();
  if (state.organizationId === organizationId) return state;
  return { organizationId, rows: [], loading: true, error: null };
}

function canDeleteProject(project: UiProject, organizationRole?: OrganizationRole): boolean {
  if (project.scope === 'personal') return true;
  if (
    project.memberRole !== 'lead' &&
    project.memberRole !== 'member' &&
    project.memberRole !== 'viewer'
  ) {
    return false;
  }
  return organizationRole === 'owner' || organizationRole === 'admin';
}

function bumpWorkspaceGeneration(generations: Map<string, number>, organizationId: string): number {
  const nextGeneration = (generations.get(organizationId) ?? 0) + 1;
  generations.set(organizationId, nextGeneration);
  return nextGeneration;
}

function isCurrentWorkspaceRequest(input: {
  readonly mounted: boolean;
  readonly teamProjectsEnabled: boolean;
  readonly selectedOrganizationId: string | null;
  readonly generations: ReadonlyMap<string, number>;
  readonly organizationId: string;
  readonly requestGeneration: number;
}): boolean {
  return (
    input.mounted &&
    input.teamProjectsEnabled &&
    input.selectedOrganizationId === input.organizationId &&
    input.generations.get(input.organizationId) === input.requestGeneration
  );
}

function isHiddenResourceError(error: unknown): boolean {
  const code = trpcErrorCode(error);
  return code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'UNAUTHORIZED';
}

function trpcErrorCode(error: unknown): string | null {
  if (!isUnknownRecord(error)) return null;
  const directCode = ownUnknownText(error, 'code');
  if (directCode) return directCode;
  const data = ownUnknownRecord(error, 'data');
  const dataCode = data ? ownUnknownText(data, 'code') : '';
  if (dataCode) return dataCode;
  const shape = ownUnknownRecord(error, 'shape');
  const shapeData = shape ? ownUnknownRecord(shape, 'data') : null;
  return shapeData ? ownUnknownText(shapeData, 'code') || null : null;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function ownUnknownRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const candidate = Object.prototype.hasOwnProperty.call(value, key) ? value[key] : null;
  return isUnknownRecord(candidate) ? candidate : null;
}

function ownUnknownText(value: Record<string, unknown>, key: string): string {
  const candidate = Object.prototype.hasOwnProperty.call(value, key) ? value[key] : null;
  return typeof candidate === 'string' ? candidate : '';
}
