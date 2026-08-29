import { useAppShellContext } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { normalizeProjectRows } from '@/lib/project-page-state';
import { type AppRouter, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader, PageLoadingPanel } from '@/pages/PageShell';
import type { UiProject } from '@/types/task';
import type { inferRouterClient } from '@trpc/client';
import { FolderKanban, RefreshCw, Users } from 'lucide-react';
import * as React from 'react';
import { useParams } from 'react-router-dom';

type ProjectMemberRole = 'lead' | 'member' | 'viewer';

interface UiProjectMember {
  readonly projectMemberId: string;
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

const PROJECT_ROLE_LABEL: Record<ProjectMemberRole, string> = {
  lead: '项目负责人',
  member: '项目成员',
  viewer: '仅查看',
};

type Task12ProjectDetailClient = Pick<inferRouterClient<AppRouter>, 'projects'>;

// Detail procedures stay coupled to AppRouter while local normalization rebuilds UI rows.
const task12ProjectDetailClient: Task12ProjectDetailClient = trpc;

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
  const requestRef = React.useRef(0);
  const mountedRef = React.useRef(false);
  const [detail, setDetail] = React.useState<ProjectDetailState>(() =>
    initialProjectDetailState(projectId, teamProjectsEnabled),
  );
  const [members, setMembers] = React.useState<ProjectMembersState>(() =>
    initialProjectMembersState(projectId, teamProjectsEnabled),
  );

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

    const projectRequest = task12ProjectDetailClient.projects.get.query({ projectId });
    const memberRequest = task12ProjectDetailClient.projects.members.query({ projectId });

    void projectRequest.then(
      (response) => {
        if (!mountedRef.current || requestRef.current !== requestId) return;
        const project = normalizeTeamProject(response, projectId);
        if (!project) {
          setDetail({
            projectId,
            project: null,
            loading: false,
            error: null,
            notFound: true,
          });
          return;
        }
        setDetail({ projectId, project, loading: false, error: null, notFound: false });
      },
      (error: unknown) => {
        if (!mountedRef.current || requestRef.current !== requestId) return;
        if (isNotFoundError(error)) {
          setDetail({
            projectId,
            project: null,
            loading: false,
            error: null,
            notFound: true,
          });
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
      () => {
        if (!mountedRef.current || requestRef.current !== requestId) return;
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
  }, [projectId, teamProjectsEnabled]);

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
    <PageContainer width="wide">
      <PageHeader
        title={detail.project.name}
        description="团队项目概览"
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
        <FutureExecutionCopy />
        <ProjectMembersPanel rows={projectMembers} loading={membersLoading} error={memberError} />
      </div>
    </PageContainer>
  );
}

function ProjectOverview({ project }: { readonly project: UiProject }): JSX.Element {
  const role = project.memberRole ? PROJECT_ROLE_LABEL[project.memberRole] : '未分配';
  return (
    <section
      aria-label="项目概览"
      className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-[8px] bg-[#FFF0F4] p-2.5 text-[#EA1F59]">
          <FolderKanban className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">项目概览</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {project.description || '这个团队项目还没有添加说明。'}
          </p>
        </div>
      </div>
      <dl className="mt-5 grid gap-3 border-t border-[#EFEFEF] pt-5 sm:grid-cols-3">
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
    <div className="rounded-[8px] bg-[#FAFAFA] px-3.5 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function FutureExecutionCopy(): JSX.Element {
  return (
    <div className="rounded-[8px] border border-[#E7E7E7] bg-[#FAFAFA] px-4 py-3">
      <p className="text-sm leading-relaxed text-muted-foreground">
        团队任务执行将在后续阶段开放。当前可先查看项目概览与成员。
      </p>
    </div>
  );
}

function ProjectMembersPanel({
  rows,
  loading,
  error,
}: {
  readonly rows: readonly UiProjectMember[];
  readonly loading: boolean;
  readonly error: string | null;
}): JSX.Element {
  return (
    <section
      aria-label="项目成员"
      className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6"
    >
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-[#EA1F59]" aria-hidden />
        <h2 className="text-base font-semibold text-foreground">项目成员</h2>
        {!loading && !error ? (
          <span className="text-xs text-muted-foreground">{rows.length} 人</span>
        ) : null}
      </div>

      {error ? <CollectionNotice message={error} stale={rows.length > 0} /> : null}
      {loading && rows.length === 0 ? (
        <div aria-label="项目成员加载中" className="mt-4 space-y-2" aria-live="polite">
          <div className="hola-skel h-12 rounded-[8px] bg-[#EFEFEF]/85" />
          <div className="hola-skel h-12 rounded-[8px] bg-[#EFEFEF]/85" />
        </div>
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <p className="mt-4 rounded-[8px] bg-[#FAFAFA] px-4 py-5 text-center text-sm text-muted-foreground">
          项目还没有成员
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="mt-4 divide-y divide-[#EFEFEF]">
          {rows.map((member) => (
            <li
              key={member.projectMemberId}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <MemberAvatar member={member} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{member.displayName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {PROJECT_ROLE_LABEL[member.role]}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function MemberAvatar({ member }: { readonly member: UiProjectMember }): JSX.Element {
  if (member.avatarUrl) {
    return (
      <img
        src={member.avatarUrl}
        alt=""
        className="h-9 w-9 shrink-0 rounded-full border border-[#E7E7E7] object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FFF0F4] text-xs font-semibold text-[#C31749]"
    >
      {member.displayName.slice(0, 1).toLocaleUpperCase() || '成'}
    </div>
  );
}

function CollectionNotice({
  message,
  stale,
}: { readonly message: string; readonly stale: boolean }): JSX.Element {
  return (
    <output
      className={cn(
        'mt-4 block rounded-[8px] border px-3 py-2 text-xs',
        stale
          ? 'border-[#F1D7A8] bg-[#FFF9ED] text-[#815F1B]'
          : 'border-[#F2CBD6] bg-[#FFF5F7] text-[#9B2143]',
      )}
    >
      {message}
    </output>
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
    const userId = ownText(entry, 'userId');
    const role = ownValue(entry, 'role');
    if (
      !projectMemberId ||
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
        userId,
        displayName: ownText(entry, 'displayName') || '未命名成员',
        avatarUrl: ownNullableText(entry, 'avatarUrl'),
        role,
      },
    ];
  });
}

function isNotFoundError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const data = ownValue(error, 'data');
  if (isRecord(data) && ownValue(data, 'code') === 'NOT_FOUND') return true;
  const message = ownText(error, 'message');
  return /not[ _-]?found/i.test(message);
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
