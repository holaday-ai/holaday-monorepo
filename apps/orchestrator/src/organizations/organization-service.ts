import { newExternalId } from '@holaday/shared-types';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
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
  REPORTING_MANAGER_ROLES,
  canChangeOrganizationMemberRole,
  canDeactivateOrganizationMember,
  canSetReportingLine,
  isReportingManagerRole,
} from './organization-permissions.js';

const managerUsers = alias(users, 'organization_manager_users');
const managerMemberships = alias(organizationMembers, 'organization_manager_memberships');

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

interface LockedOrganization {
  id: number;
  externalId: string;
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

/**
 * Every mutation locks members only after its organization row is locked. The organization id
 * is part of the predicate, so a supplied foreign membership cannot acquire another tenant lock.
 */
function buildLockOrganizationMembersQuery(
  db: Pick<DB, 'select'>,
  organizationId: number,
  memberExternalIds: readonly string[],
) {
  return db
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
        inArray(organizationMembers.externalId, [...memberExternalIds]),
      ),
    )
    .orderBy(asc(organizationMembers.externalId))
    .for('update');
}

async function lockOrganizationMembers(
  db: Pick<DB, 'select'>,
  organization: LockedOrganization,
  memberExternalIds: readonly string[],
): Promise<Map<string, OrganizationMemberSnapshot>> {
  const externalIds = [...new Set(memberExternalIds)].sort((left, right) =>
    left.localeCompare(right),
  );
  const rows = await buildLockOrganizationMembersQuery(db, organization.id, externalIds);
  return new Map(
    rows.map((row) => [
      row.externalId,
      {
        ...row,
        organizationExternalId: organization.externalId,
        role: row.role as OrganizationRole,
      },
    ]),
  );
}

function requireLockedOrganizationMember(
  members: ReadonlyMap<string, OrganizationMemberSnapshot>,
  memberExternalId: string,
): OrganizationMemberSnapshot {
  const member = members.get(memberExternalId);
  if (!member) throw new OrganizationServiceError('MEMBER_NOT_FOUND');
  return member;
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
  if (!organization) throw new OrganizationServiceError('ORGANIZATION_NOT_FOUND');
  return organization;
}

/** The actor is re-read and locked inside the transaction after the organization lock. */
async function requireLockedActiveActorMembership(
  db: Pick<DB, 'select'>,
  actorUserId: number,
  organization: LockedOrganization,
): Promise<OrganizationMemberSnapshot> {
  const [row] = await db
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
        eq(organizationMembers.organizationId, organization.id),
        eq(organizationMembers.userId, actorUserId),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .for('update');
  if (!row) throw new OrganizationServiceError('ORGANIZATION_NOT_FOUND');
  return {
    ...row,
    organizationExternalId: organization.externalId,
    role: row.role as OrganizationRole,
  };
}

async function clearActiveReportingLines(
  db: Pick<DB, 'update'>,
  organizationId: number,
  managerUserId: number,
): Promise<void> {
  await db
    .update(organizationMembers)
    .set({ managerUserId: null })
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.managerUserId, managerUserId),
        eq(organizationMembers.status, 'active'),
      ),
    );
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
    .orderBy(asc(organizationMembers.externalId))
    .for('update');
  return owners.length;
}

export async function createOrganization(input: CreateOrganizationInput) {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  const organizationExternalId = newExternalId('organization');
  const ownerMembershipExternalId = newExternalId('organizationMember');

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

function buildOrganizationListQuery(db: Pick<DB, 'select'>, actorUserId: number) {
  return db
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
    .leftJoin(
      managerMemberships,
      and(
        eq(managerMemberships.organizationId, organizationMembers.organizationId),
        eq(managerMemberships.userId, organizationMembers.managerUserId),
        eq(managerMemberships.status, 'active'),
        inArray(managerMemberships.role, [...REPORTING_MANAGER_ROLES]),
      ),
    )
    .leftJoin(managerUsers, eq(managerUsers.id, managerMemberships.userId))
    .where(
      and(
        eq(organizationMembers.userId, actorUserId),
        eq(organizationMembers.status, 'active'),
        eq(organizations.status, 'active'),
      ),
    );
}

export async function listOrganizationsForUser(input: OrganizationListInput) {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  const memberships = await buildOrganizationListQuery(input.db, actorUserId);

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

function buildActiveMemberListQuery(db: Pick<DB, 'select'>, organizationId: number) {
  return db
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
    .leftJoin(
      managerMemberships,
      and(
        eq(managerMemberships.organizationId, organizationMembers.organizationId),
        eq(managerMemberships.userId, organizationMembers.managerUserId),
        eq(managerMemberships.status, 'active'),
        inArray(managerMemberships.role, [...REPORTING_MANAGER_ROLES]),
      ),
    )
    .leftJoin(managerUsers, eq(managerUsers.id, managerMemberships.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.status, 'active'),
      ),
    );
}

export async function listOrganizationMembers(input: OrganizationScopedInput) {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  const actor = await requireActiveActorMembership(
    input.db,
    actorUserId,
    input.organizationExternalId,
  );
  const rows = await buildActiveMemberListQuery(input.db, actor.organizationId);

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
  await requireActiveActorMembership(input.db, actorUserId, input.organizationExternalId);
  await input.db.transaction(async (tx) => {
    const organization = await lockActiveOrganization(tx, input.organizationExternalId);
    const actor = await requireLockedActiveActorMembership(tx, actorUserId, organization);
    const lockedMembers = await lockOrganizationMembers(tx, organization, [
      input.targetMemberExternalId,
      input.managerMemberExternalId,
    ]);
    const target = requireLockedOrganizationMember(lockedMembers, input.targetMemberExternalId);
    const manager = requireLockedOrganizationMember(lockedMembers, input.managerMemberExternalId);
    requireAllowed(
      canSetReportingLine({
        actor: asPermissionMembership(actor),
        member: asPermissionMembership(target),
        manager: asPermissionMembership(manager),
      }),
    );
    const result = await tx
      .update(organizationMembers)
      .set({ managerUserId: manager.userId })
      .where(and(eq(organizationMembers.id, target.id), eq(organizationMembers.status, 'active')));
    if (readAffectedRows(result) !== 1) throw new OrganizationServiceError('MEMBER_NOT_FOUND');
  });
  return { ok: true };
}

export async function updateMemberRole(input: MemberRoleInput): Promise<{ ok: true }> {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  await requireActiveActorMembership(input.db, actorUserId, input.organizationExternalId);
  await input.db.transaction(async (tx) => {
    const organization = await lockActiveOrganization(tx, input.organizationExternalId);
    const actor = await requireLockedActiveActorMembership(tx, actorUserId, organization);
    const target = requireLockedOrganizationMember(
      await lockOrganizationMembers(tx, organization, [input.targetMemberExternalId]),
      input.targetMemberExternalId,
    );
    const ownerCount = await lockActiveOwners(tx, organization.id);
    requireAllowed(
      canChangeOrganizationMemberRole({
        actor: asPermissionMembership(actor),
        target: asPermissionMembership(target),
        nextRole: input.nextRole,
        ownerCount,
      }),
    );
    const result = await tx
      .update(organizationMembers)
      .set({ role: input.nextRole })
      .where(and(eq(organizationMembers.id, target.id), eq(organizationMembers.status, 'active')));
    if (readAffectedRows(result) !== 1) throw new OrganizationServiceError('MEMBER_NOT_FOUND');
    if (isReportingManagerRole(target.role) && !isReportingManagerRole(input.nextRole)) {
      await clearActiveReportingLines(tx, organization.id, target.userId);
    }
  });
  return { ok: true };
}

export async function deactivateMember(input: DeactivateMemberInput): Promise<{ ok: true }> {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  await requireActiveActorMembership(input.db, actorUserId, input.organizationExternalId);
  await input.db.transaction(async (tx) => {
    const organization = await lockActiveOrganization(tx, input.organizationExternalId);
    const actor = await requireLockedActiveActorMembership(tx, actorUserId, organization);
    const target = requireLockedOrganizationMember(
      await lockOrganizationMembers(tx, organization, [input.targetMemberExternalId]),
      input.targetMemberExternalId,
    );
    const ownerCount = await lockActiveOwners(tx, organization.id);
    requireAllowed(
      canDeactivateOrganizationMember({
        actor: asPermissionMembership(actor),
        target: asPermissionMembership(target),
        ownerCount,
      }),
    );

    const deactivated = await tx
      .update(organizationMembers)
      .set({ status: 'inactive' })
      .where(and(eq(organizationMembers.id, target.id), eq(organizationMembers.status, 'active')));
    if (readAffectedRows(deactivated) !== 1) throw new OrganizationServiceError('MEMBER_NOT_FOUND');
    await tx
      .update(projectMembers)
      .set({ status: 'inactive' })
      .where(
        and(
          eq(projectMembers.userId, target.userId),
          eq(projectMembers.status, 'active'),
          sql`exists (select 1 from ${projects} where ${projects.id} = ${projectMembers.projectId} and ${projects.organizationId} = ${organization.id})`,
        ),
      );
    if (isReportingManagerRole(target.role)) {
      await clearActiveReportingLines(tx, organization.id, target.userId);
    }
  });
  return { ok: true };
}

export const __organizationServiceInternals = {
  buildActiveMemberListQuery,
  buildLockOrganizationMembersQuery,
  buildOrganizationListQuery,
};
