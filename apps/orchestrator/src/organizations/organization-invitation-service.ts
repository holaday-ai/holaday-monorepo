import { createHash, randomBytes as secureRandomBytes } from 'node:crypto';
import { newExternalId } from '@holaday/shared-types';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { organizationInvitations } from '../db/schema/organization-invitations.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { users } from '../db/schema/users.js';
import {
  type OrganizationMembership,
  type OrganizationRole,
  type PermissionDecision,
  type PermissionReason,
  canInviteOrganizationMember,
  isReportingManagerRole,
} from './organization-permissions.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationServiceErrorCode =
  | 'UNKNOWN_ACTOR'
  | 'ORGANIZATION_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'
  | 'PERMISSION_DENIED'
  /** Deliberately covers absent, expired, revoked, accepted, and raced invitation tokens. */
  | 'INVITATION_NOT_AVAILABLE';

/** Domain-only failure; the router maps it without exposing invitation state. */
export class InvitationServiceError extends Error {
  constructor(
    public readonly code: InvitationServiceErrorCode,
    public readonly reason?: PermissionReason,
  ) {
    super(reason ?? code);
    this.name = 'InvitationServiceError';
  }
}

export interface CreateInvitationInput {
  db: DB;
  actorExternalId: string;
  organizationExternalId: string;
  role: OrganizationRole;
  /** Optional active, same-organization reporting manager for the invited membership. */
  managerMemberExternalId?: string;
  /** Test seam only; production falls back to cryptographically secure node:crypto randomness. */
  randomBytes?: (size: number) => Buffer;
  /** Test seam only; production uses the current time. */
  now?: () => Date;
}

export interface AcceptInvitationInput {
  db: DB;
  actorExternalId: string;
  token: string;
  now?: () => Date;
}

export interface RevokeInvitationInput {
  db: DB;
  actorExternalId: string;
  organizationExternalId: string;
  invitationExternalId: string;
  now?: () => Date;
}

interface LockedOrganization {
  id: number;
  externalId: string;
}

interface MembershipSnapshot {
  id: number;
  externalId: string;
  organizationId: number;
  userId: number;
  role: OrganizationRole;
  status: string;
}

interface InvitationSnapshot {
  id: number;
  externalId: string;
  organizationId: number;
  tokenHash: string;
  role: OrganizationRole;
  managerUserId: number | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

function nowFrom(input: { now?: () => Date }): Date {
  return input.now?.() ?? new Date();
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createToken(random: (size: number) => Buffer): string {
  return random(32).toString('base64url');
}

function requireAllowed(decision: PermissionDecision): void {
  if (!decision.allowed) throw new InvitationServiceError('PERMISSION_DENIED', decision.reason);
}

function asPermissionMembership(member: MembershipSnapshot): OrganizationMembership {
  return {
    organizationId: String(member.organizationId),
    userId: String(member.userId),
    role: member.role,
    status: member.status,
  };
}

async function resolveActorUserId(db: DB, actorExternalId: string): Promise<number> {
  const [actor] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, actorExternalId))
    .limit(1);
  if (!actor) throw new InvitationServiceError('UNKNOWN_ACTOR');
  return actor.id;
}

async function requireActiveActorMembership(
  db: Pick<DB, 'select'>,
  actorUserId: number,
  organizationExternalId: string,
): Promise<MembershipSnapshot> {
  const [member] = await db
    .select({
      id: organizationMembers.id,
      externalId: organizationMembers.externalId,
      organizationId: organizationMembers.organizationId,
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      status: organizationMembers.status,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizations.externalId, organizationExternalId),
        eq(organizations.status, 'active'),
        eq(organizationMembers.userId, actorUserId),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .limit(1);
  if (!member) throw new InvitationServiceError('ORGANIZATION_NOT_FOUND');
  return { ...member, role: member.role as OrganizationRole };
}

async function lockActiveOrganization(
  db: Pick<DB, 'select'>,
  organizationExternalId: string,
): Promise<LockedOrganization> {
  const [organization] = await db
    .select({ id: organizations.id, externalId: organizations.externalId })
    .from(organizations)
    .where(
      and(eq(organizations.externalId, organizationExternalId), eq(organizations.status, 'active')),
    )
    .for('update');
  if (!organization) throw new InvitationServiceError('ORGANIZATION_NOT_FOUND');
  return organization;
}

async function lockActiveOrganizationById(
  db: Pick<DB, 'select'>,
  organizationId: number,
): Promise<LockedOrganization> {
  const [organization] = await db
    .select({ id: organizations.id, externalId: organizations.externalId })
    .from(organizations)
    .where(and(eq(organizations.id, organizationId), eq(organizations.status, 'active')))
    .for('update');
  if (!organization) throw new InvitationServiceError('INVITATION_NOT_AVAILABLE');
  return organization;
}

async function lockActiveActorMembership(
  db: Pick<DB, 'select'>,
  actorUserId: number,
  organizationId: number,
): Promise<MembershipSnapshot> {
  const [member] = await db
    .select({
      id: organizationMembers.id,
      externalId: organizationMembers.externalId,
      organizationId: organizationMembers.organizationId,
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      status: organizationMembers.status,
    })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, actorUserId),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .for('update');
  if (!member) throw new InvitationServiceError('ORGANIZATION_NOT_FOUND');
  return { ...member, role: member.role as OrganizationRole };
}

async function lockActiveManagerMembership(
  db: Pick<DB, 'select'>,
  organizationId: number,
  externalId: string,
): Promise<MembershipSnapshot> {
  const [manager] = await db
    .select({
      id: organizationMembers.id,
      externalId: organizationMembers.externalId,
      organizationId: organizationMembers.organizationId,
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      status: organizationMembers.status,
    })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.externalId, externalId),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .for('update');
  if (!manager) throw new InvitationServiceError('MEMBER_NOT_FOUND');
  return { ...manager, role: manager.role as OrganizationRole };
}

function buildTokenLookupQuery(db: Pick<DB, 'select'>, hash: string) {
  return db
    .select({ organizationId: organizationInvitations.organizationId })
    .from(organizationInvitations)
    .where(eq(organizationInvitations.tokenHash, hash))
    .limit(1);
}

async function lockInvitationByHash(
  db: Pick<DB, 'select'>,
  organizationId: number,
  hash: string,
): Promise<InvitationSnapshot | null> {
  const [invitation] = await db
    .select({
      id: organizationInvitations.id,
      externalId: organizationInvitations.externalId,
      organizationId: organizationInvitations.organizationId,
      tokenHash: organizationInvitations.tokenHash,
      role: organizationInvitations.role,
      managerUserId: organizationInvitations.managerUserId,
      expiresAt: organizationInvitations.expiresAt,
      acceptedAt: organizationInvitations.acceptedAt,
      revokedAt: organizationInvitations.revokedAt,
    })
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.organizationId, organizationId),
        eq(organizationInvitations.tokenHash, hash),
      ),
    )
    .for('update');
  return invitation ? { ...invitation, role: invitation.role as OrganizationRole } : null;
}

async function lockInvitationByExternalId(
  db: Pick<DB, 'select'>,
  organizationId: number,
  externalId: string,
): Promise<InvitationSnapshot | null> {
  const [invitation] = await db
    .select({
      id: organizationInvitations.id,
      externalId: organizationInvitations.externalId,
      organizationId: organizationInvitations.organizationId,
      tokenHash: organizationInvitations.tokenHash,
      role: organizationInvitations.role,
      managerUserId: organizationInvitations.managerUserId,
      expiresAt: organizationInvitations.expiresAt,
      acceptedAt: organizationInvitations.acceptedAt,
      revokedAt: organizationInvitations.revokedAt,
    })
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.organizationId, organizationId),
        eq(organizationInvitations.externalId, externalId),
      ),
    )
    .for('update');
  return invitation ? { ...invitation, role: invitation.role as OrganizationRole } : null;
}

async function lockMembershipForUser(
  db: Pick<DB, 'select'>,
  organizationId: number,
  userId: number,
): Promise<{ id: number; externalId: string; status: string } | null> {
  const [member] = await db
    .select({
      id: organizationMembers.id,
      externalId: organizationMembers.externalId,
      status: organizationMembers.status,
    })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .for('update');
  return member ?? null;
}

async function requireActiveInvitationManager(
  db: Pick<DB, 'select'>,
  organizationId: number,
  managerUserId: number | null,
): Promise<void> {
  if (managerUserId === null) return;
  const [manager] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, managerUserId),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .for('update');
  if (!manager || !isReportingManagerRole(manager.role as OrganizationRole)) {
    throw new InvitationServiceError('INVITATION_NOT_AVAILABLE');
  }
}

function invitationAvailable(invitation: InvitationSnapshot, now: Date): boolean {
  return (
    invitation.acceptedAt === null && invitation.revokedAt === null && invitation.expiresAt > now
  );
}

/** Guarded update is the final replay backstop after the locked read. */
function buildConsumeInvitationQuery(db: Pick<DB, 'update'>, invitationId: number, now: Date) {
  return db
    .update(organizationInvitations)
    .set({ acceptedAt: now })
    .where(
      and(
        eq(organizationInvitations.id, invitationId),
        isNull(organizationInvitations.acceptedAt),
        isNull(organizationInvitations.revokedAt),
        gt(organizationInvitations.expiresAt, now),
      ),
    );
}

function buildRevokeInvitationQuery(db: Pick<DB, 'update'>, invitationId: number, now: Date) {
  return db
    .update(organizationInvitations)
    .set({ revokedAt: now })
    .where(
      and(
        eq(organizationInvitations.id, invitationId),
        isNull(organizationInvitations.acceptedAt),
        isNull(organizationInvitations.revokedAt),
      ),
    );
}

export async function createInvitation(input: CreateInvitationInput) {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  await requireActiveActorMembership(input.db, actorUserId, input.organizationExternalId);
  const createdAt = nowFrom(input);
  const expiresAt = new Date(createdAt.getTime() + INVITATION_TTL_MS);
  const plaintextToken = createToken(input.randomBytes ?? secureRandomBytes);
  const hash = tokenHash(plaintextToken);
  const invitationExternalId = newExternalId('organizationInvitation');

  await input.db.transaction(async (tx) => {
    const organization = await lockActiveOrganization(tx, input.organizationExternalId);
    const actor = await lockActiveActorMembership(tx, actorUserId, organization.id);
    requireAllowed(canInviteOrganizationMember(asPermissionMembership(actor), input.role));

    let managerUserId: number | null = null;
    if (input.managerMemberExternalId) {
      const manager = await lockActiveManagerMembership(
        tx,
        organization.id,
        input.managerMemberExternalId,
      );
      if (!isReportingManagerRole(manager.role)) {
        throw new InvitationServiceError('PERMISSION_DENIED', 'manager_role_not_permitted');
      }
      managerUserId = manager.userId;
    }

    await tx.insert(organizationInvitations).values({
      externalId: invitationExternalId,
      organizationId: organization.id,
      tokenHash: hash,
      role: input.role,
      managerUserId,
      invitedByUserId: actorUserId,
      expiresAt,
    });
  });

  // This is the only domain return path containing the plaintext token.
  return { invitationId: invitationExternalId, token: plaintextToken, expiresAt };
}

export async function acceptInvitation(input: AcceptInvitationInput) {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  const hash = tokenHash(input.token);
  const lookup = await buildTokenLookupQuery(input.db, hash);
  const tokenLookup = lookup[0];
  if (!tokenLookup) throw new InvitationServiceError('INVITATION_NOT_AVAILABLE');
  const acceptedAt = nowFrom(input);

  return input.db.transaction(async (tx) => {
    // Lock order is organization -> invitation -> membership. The preflight hash lookup never writes.
    const organization = await lockActiveOrganizationById(tx, tokenLookup.organizationId);
    const invitation = await lockInvitationByHash(tx, organization.id, hash);
    if (!invitation || !invitationAvailable(invitation, acceptedAt)) {
      throw new InvitationServiceError('INVITATION_NOT_AVAILABLE');
    }
    const member = await lockMembershipForUser(tx, organization.id, actorUserId);
    await requireActiveInvitationManager(tx, organization.id, invitation.managerUserId);
    const consumed = await buildConsumeInvitationQuery(tx, invitation.id, acceptedAt);
    if (readAffectedRows(consumed) !== 1)
      throw new InvitationServiceError('INVITATION_NOT_AVAILABLE');

    if (member?.status === 'active') {
      return { membershipId: member.externalId, status: 'already_member' as const };
    }
    if (member) {
      await tx
        .update(organizationMembers)
        .set({
          status: 'active',
          role: invitation.role,
          managerUserId: invitation.managerUserId,
          joinedAt: acceptedAt,
        })
        .where(eq(organizationMembers.id, member.id));
      return { membershipId: member.externalId, status: 'reactivated' as const };
    }

    const membershipExternalId = newExternalId('organizationMember');
    await tx.insert(organizationMembers).values({
      externalId: membershipExternalId,
      organizationId: organization.id,
      userId: actorUserId,
      role: invitation.role,
      managerUserId: invitation.managerUserId,
      status: 'active',
      joinedAt: acceptedAt,
    });
    return { membershipId: membershipExternalId, status: 'joined' as const };
  });
}

export async function revokeInvitation(input: RevokeInvitationInput): Promise<{ ok: true }> {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  await requireActiveActorMembership(input.db, actorUserId, input.organizationExternalId);
  const revokedAt = nowFrom(input);

  await input.db.transaction(async (tx) => {
    const organization = await lockActiveOrganization(tx, input.organizationExternalId);
    const actor = await lockActiveActorMembership(tx, actorUserId, organization.id);
    const invitation = await lockInvitationByExternalId(
      tx,
      organization.id,
      input.invitationExternalId,
    );
    if (!invitation || !invitationAvailable(invitation, revokedAt)) {
      throw new InvitationServiceError('INVITATION_NOT_AVAILABLE');
    }
    requireAllowed(canInviteOrganizationMember(asPermissionMembership(actor), invitation.role));
    const revoked = await buildRevokeInvitationQuery(tx, invitation.id, revokedAt);
    if (readAffectedRows(revoked) !== 1)
      throw new InvitationServiceError('INVITATION_NOT_AVAILABLE');
  });
  return { ok: true };
}

export const __organizationInvitationServiceInternals = {
  buildConsumeInvitationQuery,
  buildTokenLookupQuery,
};
