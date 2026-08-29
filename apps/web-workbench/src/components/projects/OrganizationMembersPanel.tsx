import { Button } from '@/components/ui/button';
import {
  type OrganizationRole,
  type UiOrganization,
  type UiOrganizationMember,
  memberActionVisibility,
} from '@/lib/organization-page-state';
import { PageLoadingPanel } from '@/pages/PageShell';
import { RefreshCw, UserMinus, UsersRound } from 'lucide-react';
import * as React from 'react';

interface OrganizationMembersPanelProps {
  organization: UiOrganization;
  members: readonly UiOrganizationMember[];
  loading: boolean;
  error: string | null;
  onRefresh(): void;
  onUpdateReportingLine(memberId: string, managerMemberId: string): Promise<boolean>;
  onUpdateRole(memberId: string, role: OrganizationRole): Promise<boolean>;
  onDeactivate(member: UiOrganizationMember): Promise<void>;
}

const ORGANIZATION_ROLE_LABEL: Record<OrganizationRole, string> = {
  owner: '所有者',
  admin: '管理员',
  manager: '主管',
  member: '成员',
};

export function OrganizationMembersPanel({
  organization,
  members,
  loading,
  error,
  onRefresh,
  onUpdateReportingLine,
  onUpdateRole,
  onDeactivate,
}: OrganizationMembersPanelProps): JSX.Element {
  const mountedRef = React.useRef(true);
  const busyActionRef = React.useRef<string | null>(null);
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [actionSelections, setActionSelections] = React.useState<Record<string, string>>({});
  const hasMembers = members.length > 0;
  const memberById = React.useMemo(
    () => new Map(members.map((member) => [member.memberId, member] as const)),
    [members],
  );
  const visibilityByMemberId = React.useMemo(
    () =>
      new Map(
        members.map(
          (member) =>
            [
              member.memberId,
              memberActionVisibility({ organization, target: member, members }),
            ] as const,
        ),
      ),
    [members, organization],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      busyActionRef.current = null;
    };
  }, []);

  const runAction = async (key: string, action: () => Promise<unknown>): Promise<void> => {
    if (busyActionRef.current) return;
    busyActionRef.current = key;
    setBusyAction(key);
    try {
      await action();
    } finally {
      if (mountedRef.current) {
        busyActionRef.current = null;
        setBusyAction(null);
        setActionSelections((current) => ({ ...current, [key]: '' }));
      }
    }
  };

  const changeSelection = (key: string, value: string): void => {
    setActionSelections((current) => ({ ...current, [key]: value }));
  };

  return (
    <section
      aria-label="团队成员"
      className="rounded-[10px] border border-[#DCDDDD] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <UsersRound className="h-4 w-4 text-[#57479C]" />
            团队成员
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {organization.activeMemberCount} 位活跃成员
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="刷新团队成员"
          title="刷新团队成员"
          disabled={loading}
          onClick={onRefresh}
          className="h-11 w-11 px-0 text-[#595757] hover:bg-[#EFEFEF]/70"
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
        </Button>
      </header>

      {loading && !hasMembers ? (
        <div className="mt-4">
          <PageLoadingPanel label="团队成员加载中" description="正在读取成员与权限" />
        </div>
      ) : error && !hasMembers ? (
        <CollectionMessage title="团队成员暂时无法加载" actionLabel="重试" onAction={onRefresh} />
      ) : !loading && !error && !hasMembers ? (
        <CollectionMessage title="还没有团队成员" />
      ) : (
        <div className="mt-4 space-y-3">
          {error ? (
            <output className="block rounded-[8px] bg-[#EA1F59]/[0.045] px-3 py-2 text-xs text-[#9A3B55]">
              成员列表更新失败，当前保留上次结果
            </output>
          ) : null}
          {members.map((member) => {
            const visibility = visibilityByMemberId.get(member.memberId);
            if (!visibility) return null;
            const managerCandidates = visibility.managerMemberIds.flatMap((memberId) => {
              const candidate = memberById.get(memberId);
              return candidate ? [candidate] : [];
            });
            const managerActionKey = `${organization.organizationId}:manager:${member.memberId}`;
            const roleActionKey = `${organization.organizationId}:role:${member.memberId}`;
            const deactivateActionKey = `${organization.organizationId}:deactivate:${member.memberId}`;
            return (
              <article
                key={member.memberId}
                className="rounded-[8px] border border-[#EFEFEF] bg-[#FAFAFA]/70 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {member.displayName}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {ORGANIZATION_ROLE_LABEL[member.role]}
                      {member.managerDisplayName ? ` · 上级：${member.managerDisplayName}` : ''}
                    </div>
                  </div>
                </div>
                {visibility.canSetReportingLine ||
                visibility.canChangeRole ||
                visibility.canDeactivate ? (
                  <div className="mt-3 flex flex-col gap-2 border-t border-[#EFEFEF] pt-3">
                    {visibility.canSetReportingLine ? (
                      <select
                        aria-label={`设置 ${member.displayName} 的直属上级`}
                        value={actionSelections[managerActionKey] ?? ''}
                        disabled={busyAction !== null}
                        onChange={(event) => {
                          const managerMemberId = event.target.value;
                          if (!managerMemberId) return;
                          changeSelection(managerActionKey, managerMemberId);
                          void runAction(managerActionKey, () =>
                            onUpdateReportingLine(member.memberId, managerMemberId),
                          );
                        }}
                        className="h-11 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-2.5 text-xs text-[#595757] outline-none focus-visible:border-[#EA1F59]/45 focus-visible:ring-2 focus-visible:ring-[#EA1F59]/30 focus-visible:ring-offset-1"
                      >
                        <option value="">设置直属上级</option>
                        {managerCandidates.map((candidate) => (
                          <option key={candidate.memberId} value={candidate.memberId}>
                            {candidate.displayName}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {visibility.canChangeRole ? (
                      <select
                        aria-label={`更改 ${member.displayName} 的角色`}
                        value={actionSelections[roleActionKey] ?? ''}
                        disabled={busyAction !== null}
                        onChange={(event) => {
                          const role = event.target.value as OrganizationRole;
                          if (!role) return;
                          changeSelection(roleActionKey, role);
                          void runAction(roleActionKey, () => onUpdateRole(member.memberId, role));
                        }}
                        className="h-11 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-2.5 text-xs text-[#595757] outline-none focus-visible:border-[#EA1F59]/45 focus-visible:ring-2 focus-visible:ring-[#EA1F59]/30 focus-visible:ring-offset-1"
                      >
                        <option value="">更改角色</option>
                        {visibility.roleOptions.map((role) => (
                          <option key={role} value={role}>
                            {ORGANIZATION_ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {visibility.canDeactivate ? (
                      <button
                        type="button"
                        aria-label={`移除 ${member.displayName}`}
                        disabled={busyAction !== null}
                        onClick={() =>
                          void runAction(deactivateActionKey, () => onDeactivate(member))
                        }
                        className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[8px] border border-[#EA1F59]/20 bg-white px-2.5 text-xs font-medium text-[#EA1F59] hover:bg-[#EA1F59]/[0.045] disabled:opacity-50"
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        移除 {member.displayName}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CollectionMessage({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}): JSX.Element {
  return (
    <div className="mt-4 rounded-[8px] border border-dashed border-[#DCDDDD] px-3 py-8 text-center">
      <UsersRound className="mx-auto h-6 w-6 text-muted-foreground/40" />
      <p className="mt-2 text-xs font-medium text-[#595757]">{title}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-2 text-xs font-medium text-[#EA1F59]"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
