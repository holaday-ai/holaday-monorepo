import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  type InvitationRole,
  type InviteLinkState,
  type UiOrganizationMember,
  clearInviteLinkState,
  normalizeInviteLinkState,
} from '@/lib/organization-page-state';
import { pageActionError } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, Link2, X } from 'lucide-react';
import * as React from 'react';

interface OrganizationInviteDialogProps {
  open: boolean;
  organizationId: string;
  organizationName: string;
  inviteRoles: readonly InvitationRole[];
  members: readonly UiOrganizationMember[];
  onClose(): void;
}

const INVITATION_ROLE_LABEL: Record<InvitationRole, string> = {
  admin: '管理员',
  manager: '主管',
  member: '成员',
};

interface Task12InvitationClient {
  readonly organizations: {
    readonly createInvitation: {
      mutate(input: {
        readonly organizationId: string;
        readonly role: InvitationRole;
        readonly managerMemberId?: string;
      }): Promise<unknown>;
    };
  };
}

// Treat the one-time-link response as untrusted until Task 11 normalization.
const task12InvitationClient = trpc as unknown as Task12InvitationClient;

export function OrganizationInviteDialog({
  open,
  organizationId,
  organizationName,
  inviteRoles,
  members,
  onClose,
}: OrganizationInviteDialogProps): JSX.Element {
  const toast = useToast();
  const [role, setRole] = React.useState<InvitationRole>(() => inviteRoles[0] ?? 'member');
  const [managerMemberId, setManagerMemberId] = React.useState('');
  const [inviteLink, setInviteLink] = React.useState<InviteLinkState>(() => clearInviteLinkState());
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const selectedRole = inviteRoles.includes(role) ? role : (inviteRoles[0] ?? 'member');
  const managerCandidates = members.filter(
    (member) => member.role === 'owner' || member.role === 'admin' || member.role === 'manager',
  );

  const close = React.useCallback(() => {
    setInviteLink(clearInviteLinkState());
    setError(null);
    setCreating(false);
    setManagerMemberId('');
    setRole(inviteRoles[0] ?? 'member');
    onClose();
  }, [inviteRoles, onClose]);

  const createLink = async (): Promise<void> => {
    if (creating || !inviteRoles.includes(selectedRole)) return;
    setCreating(true);
    setError(null);
    setInviteLink(clearInviteLinkState());
    try {
      const response = await task12InvitationClient.organizations.createInvitation.mutate({
        organizationId,
        role: selectedRole,
        ...(managerMemberId ? { managerMemberId } : {}),
      });
      const next = normalizeInviteLinkState(response, organizationId);
      if (next.status !== 'ready') {
        setError('邀请链接无效，请重新生成');
        return;
      }
      setInviteLink(next);
    } catch (caught) {
      setError(pageActionError('邀请链接生成失败', caught));
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (): Promise<void> => {
    if (inviteLink.status !== 'ready') return;
    try {
      await navigator.clipboard.writeText(inviteLink.inviteUrl);
      toast.show('邀请链接已复制');
    } catch {
      toast.show('复制失败，请手动选择邀请链接', 'error');
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !creating) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/35 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-[#DCDDDD] bg-white p-5 text-card-foreground shadow-[0_20px_60px_rgba(17,24,39,0.18)] focus:outline-none dark:border-white/10 dark:bg-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                邀请成员加入{organizationName}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-5 text-muted-foreground">
                链接只在本次创建后显示，请通过可信渠道发送。
              </Dialog.Description>
            </div>
            <button
              type="button"
              aria-label="关闭邀请对话框"
              title="关闭"
              disabled={creating}
              onClick={close}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#595757] hover:bg-[#EFEFEF]/70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {inviteLink.status === 'ready' ? (
            <div className="mt-5 space-y-3">
              <div className="rounded-[8px] border border-[#42C0EF]/30 bg-[#42C0EF]/[0.045] p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-[#167C9A]">
                  <Check className="h-3.5 w-3.5" />
                  邀请链接已生成
                </div>
                <label
                  className="mt-3 block text-xs text-muted-foreground"
                  htmlFor="organization-invite-url"
                >
                  一次性邀请链接
                </label>
                <input
                  id="organization-invite-url"
                  readOnly
                  value={inviteLink.inviteUrl}
                  className="mt-1 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2 text-xs text-foreground outline-none"
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  有效期至 {formatExpiry(inviteLink.expiresAt)}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={close}>
                  关闭
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void copyLink()}
                  className="bg-[#EA1F59] text-white hover:bg-[#EA1F59]/90"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制邀请链接
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <label className="block text-xs font-medium text-[#595757]">
                成员角色
                <select
                  aria-label="成员角色"
                  value={selectedRole}
                  onChange={(event) => setRole(event.target.value as InvitationRole)}
                  className="mt-1.5 h-9 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-sm text-foreground focus-visible:border-[#ADADAD] focus-visible:outline-none"
                >
                  {inviteRoles.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {INVITATION_ROLE_LABEL[candidate]}
                    </option>
                  ))}
                </select>
              </label>
              {managerCandidates.length > 0 ? (
                <label className="block text-xs font-medium text-[#595757]">
                  直属上级（可选）
                  <select
                    aria-label="直属上级（可选）"
                    value={managerMemberId}
                    onChange={(event) => setManagerMemberId(event.target.value)}
                    className="mt-1.5 h-9 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-sm text-foreground focus-visible:border-[#ADADAD] focus-visible:outline-none"
                  >
                    <option value="">暂不设置</option>
                    {managerCandidates.map((candidate) => (
                      <option key={candidate.memberId} value={candidate.memberId}>
                        {candidate.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {error ? (
                <p role="alert" className="text-xs text-[#EA1F59]">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={close} disabled={creating}>
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void createLink()}
                  disabled={creating || inviteRoles.length === 0}
                  className="bg-[#EA1F59] text-white hover:bg-[#EA1F59]/90"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {creating ? '生成中…' : '生成邀请链接'}
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatExpiry(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
