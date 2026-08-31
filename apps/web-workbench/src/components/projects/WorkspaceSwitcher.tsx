import { Button } from '@/components/ui/button';
import type { UiOrganization } from '@/lib/organization-page-state';
import { cn } from '@/lib/utils';
import { Building2, Plus, RefreshCw, UserRound } from 'lucide-react';

interface WorkspaceSwitcherProps {
  organizations: readonly UiOrganization[];
  selectedOrganizationId: string | null;
  loading: boolean;
  error: string | null;
  onSelectOrganization(organizationId: string | null): void;
  onCreateOrganization(): void;
  onRefresh(): void;
}

const ORGANIZATION_ROLE_LABEL = {
  owner: '所有者',
  admin: '管理员',
  manager: '主管',
  member: '成员',
} as const;

export function WorkspaceSwitcher({
  organizations,
  selectedOrganizationId,
  loading,
  error,
  onSelectOrganization,
  onCreateOrganization,
  onRefresh,
}: WorkspaceSwitcherProps): JSX.Element {
  const hasOrganizations = organizations.length > 0;
  const stale = Boolean(error && hasOrganizations);

  return (
    <section
      aria-label="工作区切换"
      className="mb-5 rounded-[10px] border border-[#DCDDDD] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">工作区</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">切换个人项目或你已加入的团队空间。</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="刷新团队空间"
            title="刷新团队空间"
            disabled={loading}
            onClick={onRefresh}
            className="h-11 w-11 px-0 text-[#595757] hover:bg-[#EFEFEF]/70 hover:text-[#EA1F59]"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onCreateOrganization}
            className="h-11 bg-[#EA1F59] px-4 text-white hover:bg-[#EA1F59]/90"
          >
            <Plus className="h-3.5 w-3.5" />
            创建团队
          </Button>
        </div>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5">
        <button
          type="button"
          aria-pressed={selectedOrganizationId === null}
          onClick={() => onSelectOrganization(null)}
          className={workspaceButtonClass(selectedOrganizationId === null)}
        >
          <UserRound className="h-4 w-4" aria-hidden />
          <span>个人空间</span>
        </button>
        {organizations.map((organization) => (
          <button
            type="button"
            key={organization.organizationId}
            aria-pressed={selectedOrganizationId === organization.organizationId}
            onClick={() => onSelectOrganization(organization.organizationId)}
            className={workspaceButtonClass(selectedOrganizationId === organization.organizationId)}
          >
            <Building2 className="h-4 w-4" aria-hidden />
            <span>{organization.name}</span>
            <span className="rounded-full bg-[#EFEFEF]/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {ORGANIZATION_ROLE_LABEL[organization.role]}
            </span>
          </button>
        ))}
      </div>

      {loading && !hasOrganizations ? (
        <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
          团队工作区加载中…
        </p>
      ) : error && !hasOrganizations ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-[8px] border border-[#EA1F59]/20 bg-[#EA1F59]/[0.035] px-3 py-2 text-xs text-[#595757]">
          <span>团队工作区暂时无法加载</span>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-11 items-center px-2 font-medium text-[#EA1F59]"
          >
            重试
          </button>
        </div>
      ) : !loading && !error && !hasOrganizations ? (
        <p className="mt-3 text-xs text-muted-foreground">还没有团队工作区</p>
      ) : stale ? (
        <output className="mt-3 block text-xs text-[#9A3B55]">
          团队工作区列表更新失败，当前保留上次结果
        </output>
      ) : null}
    </section>
  );
}

function workspaceButtonClass(active: boolean): string {
  return cn(
    'inline-flex h-11 shrink-0 items-center gap-2 rounded-[8px] border px-3 text-xs font-medium transition-colors',
    active
      ? 'border-[#EA1F59]/35 bg-[#EA1F59]/[0.055] text-[#EA1F59]'
      : 'border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:text-foreground',
  );
}
