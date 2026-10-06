import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import type { UiOrganization } from '@/lib/organization-page-state';
import { cn } from '@/lib/utils';
import { Building2, ChevronDown, Plus, RefreshCw, UserRound } from 'lucide-react';

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
      className="hd-workspace-switcher"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DropdownMenu><DropdownMenuTrigger asChild><button className="hd-workspace-trigger h-11" type="button" title="切换工作区"><Building2 /><span>{organizations.find(item => item.organizationId === selectedOrganizationId)?.name ?? '个人空间'}</span><ChevronDown /></button></DropdownMenuTrigger><DropdownMenuContent align="start">
          <DropdownMenuItem className="h-11" onSelect={() => onSelectOrganization(null)}><UserRound />个人空间</DropdownMenuItem>
          {organizations.map(organization => <DropdownMenuItem className="h-11" key={organization.organizationId} onSelect={() => onSelectOrganization(organization.organizationId)}><Building2 />{organization.name}<small>{ORGANIZATION_ROLE_LABEL[organization.role]}</small></DropdownMenuItem>)}
        </DropdownMenuContent></DropdownMenu>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="刷新团队空间"
            title="刷新团队空间"
            disabled={loading}
            onClick={onRefresh}
            className="h-11 w-11 px-0 text-[#595757] hover:bg-[#EFEFEF]/70 hover:text-[#FF0061]"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onCreateOrganization}
            className="h-11 bg-[#FF0061] px-4 text-white hover:bg-[#FF0061]/90"
          >
            <Plus className="h-3.5 w-3.5" />
            创建团队
          </Button>
        </div>
      </div>

      {loading && !hasOrganizations ? (
        <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
          团队工作区加载中…
        </p>
      ) : error && !hasOrganizations ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-[8px] border border-[#FF0061]/20 bg-[#FF0061]/[0.035] px-3 py-2 text-xs text-[#595757]">
          <span>团队工作区暂时无法加载</span>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-11 items-center px-2 font-medium text-[#FF0061]"
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
