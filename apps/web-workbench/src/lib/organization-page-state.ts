export type OrganizationRole = 'owner' | 'admin' | 'manager' | 'member';
export type InvitationRole = Exclude<OrganizationRole, 'owner'>;

export interface UiOrganization {
  readonly organizationId: string;
  readonly name: string;
  readonly role: OrganizationRole;
  readonly managerDisplayName: string | null;
  readonly activeMemberCount: number;
}

export interface UiOrganizationMember {
  readonly organizationId: string;
  readonly memberId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly role: OrganizationRole;
  readonly managerUserId: string | null;
  readonly managerDisplayName: string | null;
  readonly status: 'active';
}

export type SelectedWorkspace =
  | { readonly scope: 'personal'; readonly organizationId: null; readonly organization: null }
  | {
      readonly scope: 'organization';
      readonly organizationId: string;
      readonly organization: UiOrganization;
    };

export type InviteLinkState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'ready';
      readonly organizationId: string;
      readonly invitationId: string;
      readonly inviteUrl: string;
      readonly expiresAt: string | Date;
    };

export interface OrganizationActionVisibility {
  readonly canCreateProject: boolean;
  readonly inviteRoles: readonly InvitationRole[];
}

export interface MemberActionVisibility {
  readonly canSetReportingLine: boolean;
  readonly canChangeRole: boolean;
  readonly canDeactivate: boolean;
  readonly roleOptions: readonly OrganizationRole[];
  readonly managerMemberIds: readonly string[];
}

const ORGANIZATION_ROLES = ['owner', 'admin', 'manager', 'member'] as const;
const NON_OWNER_ROLES = ['admin', 'manager', 'member'] as const;

export function normalizeOrganizationRows(value: unknown): UiOrganization[] {
  if (!Array.isArray(value)) return [];
  const seenOrganizationIds = new Set<string>();

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const organizationId = ownText(entry, 'organizationId');
    const role = ownValue(entry, 'role');
    if (!organizationId || seenOrganizationIds.has(organizationId) || !isOrganizationRole(role)) {
      return [];
    }
    seenOrganizationIds.add(organizationId);
    return [
      {
        organizationId,
        name: ownText(entry, 'name') || '未命名团队',
        role,
        managerDisplayName: ownNullableText(entry, 'managerDisplayName'),
        activeMemberCount: safeCount(ownValue(entry, 'activeMemberCount')),
      },
    ];
  });
}

export function normalizeSelectedWorkspace(
  value: unknown,
  organizations: readonly UiOrganization[],
): SelectedWorkspace {
  const organizationId = safeText(value);
  if (organizationId) {
    const organization = normalizeOrganizationRows(organizations).find(
      (candidate) => candidate.organizationId === organizationId,
    );
    if (organization) return { scope: 'organization', organizationId, organization };
  }
  return { scope: 'personal', organizationId: null, organization: null };
}

export function normalizeOrganizationMemberRows(
  value: unknown,
  organizationIdValue: string,
): UiOrganizationMember[] {
  const organizationId = safeText(organizationIdValue);
  if (!organizationId || !Array.isArray(value)) return [];
  const seenMemberIds = new Set<string>();
  const seenUserIds = new Set<string>();

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const tenantHint = ownValue(entry, 'organizationId');
    if (tenantHint !== undefined && safeText(tenantHint) !== organizationId) return [];
    const memberId = ownText(entry, 'memberId');
    const userId = ownText(entry, 'userId');
    const role = ownValue(entry, 'role');
    if (
      !memberId ||
      !userId ||
      seenMemberIds.has(memberId) ||
      seenUserIds.has(userId) ||
      !isOrganizationRole(role) ||
      ownValue(entry, 'status') !== 'active'
    ) {
      return [];
    }
    seenMemberIds.add(memberId);
    seenUserIds.add(userId);
    return [
      {
        organizationId,
        memberId,
        userId,
        displayName: ownText(entry, 'displayName') || '未命名成员',
        avatarUrl: ownNullableText(entry, 'avatarUrl'),
        role,
        managerUserId: ownNullableText(entry, 'managerUserId'),
        managerDisplayName: ownNullableText(entry, 'managerDisplayName'),
        status: 'active' as const,
      },
    ];
  });
}

export function normalizeInviteLinkState(
  value: unknown,
  organizationIdValue: string,
): InviteLinkState {
  const organizationId = safeText(organizationIdValue);
  if (!organizationId || !isRecord(value)) return { status: 'idle' };
  const tenantHint = ownValue(value, 'organizationId');
  if (tenantHint !== undefined && safeText(tenantHint) !== organizationId) {
    return { status: 'idle' };
  }
  const invitationId = ownText(value, 'invitationId');
  const inviteUrl = safeInviteUrl(ownValue(value, 'inviteUrl'));
  const expiresAt = safeDate(ownValue(value, 'expiresAt'));
  if (!invitationId || !inviteUrl || !expiresAt) return { status: 'idle' };
  return { status: 'ready', organizationId, invitationId, inviteUrl, expiresAt };
}

export function clearInviteLinkState(_state?: InviteLinkState): InviteLinkState {
  return { status: 'idle' };
}

export function organizationActionVisibility(role: OrganizationRole): OrganizationActionVisibility {
  if (role === 'owner' || role === 'admin') {
    return { canCreateProject: true, inviteRoles: ['admin', 'manager', 'member'] };
  }
  if (role === 'manager') {
    return { canCreateProject: true, inviteRoles: ['manager', 'member'] };
  }
  return { canCreateProject: false, inviteRoles: [] };
}

export function memberActionVisibility(input: {
  readonly organization: UiOrganization;
  readonly target: UiOrganizationMember;
  readonly members: readonly UiOrganizationMember[];
}): MemberActionVisibility {
  const [organization] = normalizeOrganizationRows([input.organization]);
  if (!organization) return noMemberActions();
  const members = normalizeOrganizationMemberRows(input.members, organization.organizationId);
  const [target] = normalizeOrganizationMemberRows([input.target], organization.organizationId);
  if (!target) return noMemberActions();
  const currentTarget = members.find(
    (member) =>
      member.memberId === target.memberId &&
      member.userId === target.userId &&
      member.role === target.role,
  );
  if (!currentTarget) return noMemberActions();

  const managerMemberIds = isReportingManagerRole(organization.role)
    ? members
        .filter(
          (member) => isReportingManagerRole(member.role) && member.userId !== currentTarget.userId,
        )
        .map((member) => member.memberId)
    : [];
  const ownerCount = members.filter((member) => member.role === 'owner').length;
  const canManageNonOwner = organization.role === 'owner' || organization.role === 'admin';
  const canManageOwner = organization.role === 'owner' && ownerCount > 1;
  const canManageTarget = currentTarget.role === 'owner' ? canManageOwner : canManageNonOwner;
  const availableRoles = organization.role === 'owner' ? ORGANIZATION_ROLES : NON_OWNER_ROLES;
  const roleOptions = canManageTarget
    ? availableRoles.filter((role) => role !== currentTarget.role)
    : [];

  return {
    canSetReportingLine: managerMemberIds.length > 0,
    canChangeRole: roleOptions.length > 0,
    canDeactivate: canManageTarget,
    roleOptions,
    managerMemberIds,
  };
}

function noMemberActions(): MemberActionVisibility {
  return {
    canSetReportingLine: false,
    canChangeRole: false,
    canDeactivate: false,
    roleOptions: [],
    managerMemberIds: [],
  };
}

function isOrganizationRole(value: unknown): value is OrganizationRole {
  return value === 'owner' || value === 'admin' || value === 'manager' || value === 'member';
}

function isReportingManagerRole(role: OrganizationRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
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

function safeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function safeDate(value: unknown): string | Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && !Number.isNaN(Date.parse(trimmed)) ? trimmed : null;
}

function safeInviteUrl(value: unknown): string {
  const text = safeText(value);
  if (!text) return '';
  try {
    const parsed = new URL(text, 'https://holaday.invalid');
    const isRelative = text.startsWith('/') && !text.startsWith('//');
    const isHttp =
      !parsed.username &&
      !parsed.password &&
      (parsed.protocol === 'http:' || parsed.protocol === 'https:');
    if (!isHttp || (!isRelative && parsed.origin === 'https://holaday.invalid')) return '';
    if (parsed.pathname !== '/organizations/invitations/accept') return '';
    if (!parsed.searchParams.get('token')) return '';
    return text;
  } catch {
    return '';
  }
}
