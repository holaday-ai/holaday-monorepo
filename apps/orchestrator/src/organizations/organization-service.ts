import { newExternalId } from '@holaday/shared-types';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import type { DB } from '../db/client.js';
import { readInsertId } from '../db/mysql-result.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { projectMembers } from '../db/schema/project-members.js';
import { projects } from '../db/schema/projects.js';
import { users } from '../db/schema/users.js';
import {
  type OrganizationMembership,
  type OrganizationRole,
  type PermissionDecision,
  type PermissionReason,
  canChangeOrganizationMemberRole,
  canDeactivateOrganizationMember,
  canSetReportingLine,
} from './organization-permissions.js';

const managerUsers = alias(users, 'organization_manager_users');

export type OrganizationServiceErrorCode =
  | 'UNKNOWN_ACTOR'
  | 'ORGANIZATION_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'
  | 'PERMISSION_DENIED';

/** Domain-only failure that the tRPC adapter can map without coupling this service to HTTP. */
export class OrganizationServiceError extends Error {
  constructor(
    public readonly code: OrganizationServiceErrorCode,
    public readonly reason?: PermissionReason,
  ) {
    super(reason ?? code);
    this.name = 'OrganizationServiceError';
  }
}

export interface CreateOrganizationInput {
  db: DB;
  actorExternalId: string;
  name: string;
}

export interface OrganizationListInput {
  db: DB;
  actorExternalId: string;
}

export interface OrganizationScopedInput extends OrganizationListInput {
  organizationExternalId: string;
}

export interface ReportingLineInput extends OrganizationScopedInput {
  targetMemberExternalId: string;
  managerMemberExternalId: string;
}

export interface MemberRoleInput extends OrganizationScopedInput {
  targetMemberExternalId: string;
  nextRole: OrganizationRole;
}

export interface DeactivateMemberInput extends OrganizationScopedInput {
  targetMemberExternalId: string;
}

interface OrganizationMemberSnapshot {
  id: number;
  externalId: string;
  organizationId: number;
  organizationExternalId: string;
  userId: number;
  role: OrganizationRole;
  status: string;
}

function asPermissionMembership(snapshot: OrganizationMemberSnapshot): OrganizationMembership {
  return {
    organizationId: snapshot.organizationExternalId,
    userId: String(snapshot.userId),
    role: snapshot.role,
    status: snapshot.status,
  };
}

function requireAllowed(decision: PermissionDecision): void {
  if (!decision.allowed) {
    throw new OrganizationServiceError('PERMISSION_DENIED', decision.reason);
  }
}

/** Actor external ids are resolved exactly once at each public service boundary. */
async function resolveActorUserId(db: DB, actorExternalId: string): Promise<number> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, actorExternalId))
    .limit(1);
  if (!row) throw new OrganizationServiceError('UNKNOWN_ACTOR');
  return row.id;
}

/** All organization-scoped operations begin with this active tenant-bound actor lookup. */
async function requireActiveActorMembership(
  db: Pick<DB, 'select'>,
  actorUserId: number,
  organizationExternalId: string,
): Promise<OrganizationMemberSnapshot> {
  const [row] = await db
    .select({
      id: organizationMembers.id,
      externalId: organizationMembers.externalId,
      organizationId: organizationMembers.organizationId,
      organizationExternalId: organizations.externalId,
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
  if (!row) throw new OrganizationServiceError('ORGANIZATION_NOT_FOUND');
  return { ...row, role: row.role as OrganizationRole };
}

/** Lookup stays private so callers can only address target memberships through their external id. */
async function findOrganizationMember(
  db: Pick<DB, 'select'>,
  memberExternalId: string,
): Promise<OrganizationMemberSnapshot | null> {
  const [row] = await db
    .select({
      id: organizationMembers.id,
      externalId: organizationMembers.externalId,
      organizationId: organizationMembers.organizationId,
      organizationExternalId: organizations.externalId,
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      status: organizationMembers.status,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.externalId, memberExternalId))
    .limit(1);
  return row ? { ...row, role: row.role as OrganizationRole } : null;
}

async function requireOrganizationMember(
  db: Pick<DB, 'select'>,
  memberExternalId: string,
): Promise<OrganizationMemberSnapshot> {
  const member = await findOrganizationMember(db, memberExternalId);
  if (!member) throw new OrganizationServiceError('MEMBER_NOT_FOUND');
  return member;
}

/** Locks every active owner before a demotion or deactivation decision. */
async function lockActiveOwners(db: Pick<DB, 'select'>, organizationId: number): Promise<number> {
  const owners = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.role, 'owner'),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .for('update');
  return owners.length;
}

export async function createOrganization(input: CreateOrganizationInput) {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  // This worktree's package symlink may still point at the pre-Task-1 shared types source;
  // fresh installs receive the committed organization/organizationMember prefixes.
  const organizationExternalId = newExternalId('organization' as never);
  const ownerMembershipExternalId = newExternalId('organizationMember' as never);

  await input.db.transaction(async (tx) => {
    const inserted = await tx.insert(organizations).values({
      externalId: organizationExternalId,
      name: input.name,
      ownerUserId: actorUserId,
      status: 'active',
      // Canary creation is opt-in even though the migration-level default remains false.
      teamProjectsEnabled: true,
    });
    const organizationId = readInsertId(inserted);
    await tx.insert(organizationMembers).values({
      externalId: ownerMembershipExternalId,
      organizationId,
      userId: actorUserId,
      role: 'owner',
      status: 'active',
    });
  });

  return {
    organizationId: organizationExternalId,
    name: input.name,
    role: 'owner' as const,
    teamProjectsEnabled: true,
  };
}

export async function listOrganizationsForUser(input: OrganizationListInput) {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  const memberships = await input.db
    .select({
      organizationId: organizations.id,
      organizationExternalId: organizations.externalId,
      organizationName: organizations.name,
      teamProjectsEnabled: organizations.teamProjectsEnabled,
      role: organizationMembers.role,
      managerDisplayName: managerUsers.displayName,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .leftJoin(managerUsers, eq(managerUsers.id, organizationMembers.managerUserId))
    .where(
      and(
        eq(organizationMembers.userId, actorUserId),
        eq(organizationMembers.status, 'active'),
        eq(organizations.status, 'active'),
      ),
    );

  if (memberships.length === 0) return [];

  const activeCounts = await input.db
    .select({
      organizationId: organizationMembers.organizationId,
      activeMemberCount: count(),
    })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.status, 'active'),
        inArray(
          organizationMembers.organizationId,
          memberships.map((membership) => membership.organizationId),
        ),
      ),
    )
    .groupBy(organizationMembers.organizationId);
  const countsByOrganizationId = new Map(
    activeCounts.map((row) => [row.organizationId, Number(row.activeMemberCount)]),
  );

  return memberships.map((membership) => ({
    organizationId: membership.organizationExternalId,
    name: membership.organizationName,
    callerRole: membership.role as OrganizationRole,
    managerDisplayName: membership.managerDisplayName,
    activeMemberCount: countsByOrganizationId.get(membership.organizationId) ?? 0,
    teamProjectsEnabled: membership.teamProjectsEnabled,
  }));
}

export async function listOrganizationMembers(input: OrganizationScopedInput) {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  const actor = await requireActiveActorMembership(
    input.db,
    actorUserId,
    input.organizationExternalId,
  );
  const rows = await input.db
    .select({
      memberExternalId: organizationMembers.externalId,
      userExternalId: users.externalId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      role: organizationMembers.role,
      managerUserExternalId: managerUsers.externalId,
      managerDisplayName: managerUsers.displayName,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(managerUsers, eq(managerUsers.id, organizationMembers.managerUserId))
    .where(
      and(
        eq(organizationMembers.organizationId, actor.organizationId),
        eq(organizationMembers.status, 'active'),
      ),
    );

  return rows.map((row) => ({
    memberId: row.memberExternalId,
    userId: row.userExternalId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    role: row.role as OrganizationRole,
    managerUserId: row.managerUserExternalId,
    managerDisplayName: row.managerDisplayName,
    status: 'active' as const,
  }));
}

export async function updateReportingLine(input: ReportingLineInput): Promise<{ ok: true }> {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  const actor = await requireActiveActorMembership(
    input.db,
    actorUserId,
    input.organizationExternalId,
  );
  const target = await requireOrganizationMember(input.db, input.targetMemberExternalId);
  const manager = await requireOrganizationMember(input.db, input.managerMemberExternalId);
  requireAllowed(
    canSetReportingLine({
      actor: asPermissionMembership(actor),
      member: asPermissionMembership(target),
      manager: asPermissionMembership(manager),
    }),
  );

  await input.db
    .update(organizationMembers)
    .set({ managerUserId: manager.userId })
    .where(and(eq(organizationMembers.id, target.id), eq(organizationMembers.status, 'active')));
  return { ok: true };
}

export async function updateMemberRole(input: MemberRoleInput): Promise<{ ok: true }> {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  await input.db.transaction(async (tx) => {
    const actor = await requireActiveActorMembership(tx, actorUserId, input.organizationExternalId);
    const target = await requireOrganizationMember(tx, input.targetMemberExternalId);
    const ownerCount = await lockActiveOwners(tx, actor.organizationId);
    requireAllowed(
      canChangeOrganizationMemberRole({
        actor: asPermissionMembership(actor),
        target: asPermissionMembership(target),
        nextRole: input.nextRole,
        ownerCount,
      }),
    );
    await tx
      .update(organizationMembers)
      .set({ role: input.nextRole })
      .where(and(eq(organizationMembers.id, target.id), eq(organizationMembers.status, 'active')));
  });
  return { ok: true };
}

export async function deactivateMember(input: DeactivateMemberInput): Promise<{ ok: true }> {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  await input.db.transaction(async (tx) => {
    const actor = await requireActiveActorMembership(tx, actorUserId, input.organizationExternalId);
    const target = await requireOrganizationMember(tx, input.targetMemberExternalId);
    const ownerCount = await lockActiveOwners(tx, actor.organizationId);
    requireAllowed(
      canDeactivateOrganizationMember({
        actor: asPermissionMembership(actor),
        target: asPermissionMembership(target),
        ownerCount,
      }),
    );

    await tx
      .update(organizationMembers)
      .set({ status: 'inactive' })
      .where(and(eq(organizationMembers.id, target.id), eq(organizationMembers.status, 'active')));
    await tx
      .update(projectMembers)
      .set({ status: 'inactive' })
      .where(
        and(
          eq(projectMembers.userId, target.userId),
          eq(projectMembers.status, 'active'),
          sql`exists (select 1 from ${projects} where ${projects.id} = ${projectMembers.projectId} and ${projects.organizationId} = ${actor.organizationId})`,
        ),
      );
  });
  return { ok: true };
}
