import { newExternalId } from '@holaday/shared-types';
import { and, asc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { projectMembers } from '../db/schema/project-members.js';
import { projects } from '../db/schema/projects.js';
import { users } from '../db/schema/users.js';
import {
  ORGANIZATION_ROLES,
  type OrganizationRole,
  PROJECT_ROLES,
  type ProjectRole,
  canDeleteTeamProject,
  canRemoveProjectMember,
  canRenameTeamProject,
} from '../organizations/organization-permissions.js';

export type ProjectAccessErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT';
export type ProjectAccessConflictReason = 'DUPLICATE_MEMBER' | 'SOLE_PROJECT_LEAD';

export class ProjectAccessError extends Error {
  constructor(
    public readonly code: ProjectAccessErrorCode,
    public readonly reason?: ProjectAccessConflictReason,
  ) {
    super(
      code === 'NOT_FOUND'
        ? 'project not found'
        : code === 'CONFLICT'
          ? reason === 'SOLE_PROJECT_LEAD'
            ? 'project must retain an active lead'
            : 'project member already exists'
          : 'project action forbidden',
    );
    this.name = 'ProjectAccessError';
  }
}

export interface ProjectAccessInput {
  actorExternalId: string;
  projectExternalId: string;
}

export interface PersonalProjectAccess {
  projectId: number;
  scope: 'personal';
  organizationInternalId: null;
  organizationExternalId: null;
  organizationName: null;
  organizationRole: null;
  projectRole: null;
}

export interface OrganizationProjectAccess {
  projectId: number;
  scope: 'organization';
  organizationInternalId: number;
  organizationExternalId: string;
  organizationName: string;
  organizationRole: OrganizationRole;
  projectRole: ProjectRole;
}

export type ProjectAccess = PersonalProjectAccess | OrganizationProjectAccess;
type ProjectMutationAction = 'rename' | 'manage_members' | 'delete';
type ProjectAccessTransaction = Pick<DB, 'select' | 'insert' | 'update' | 'delete'>;
type ProjectMutationGrant<Action extends ProjectMutationAction> = ProjectAccess & {
  readonly action: Action;
};

interface ProjectAccessSnapshot {
  projectId: number;
  projectExternalId: string;
  projectOwnerUserId: number;
  actorUserId: number;
  actorExternalId: string;
  organizationInternalId: number | null;
  organizationRowId: number | null;
  organizationExternalId: string | null;
  organizationName: string | null;
  organizationStatus: string | null;
  teamProjectsEnabled: boolean | null;
  organizationMemberOrganizationId: number | null;
  organizationMemberUserId: number | null;
  organizationMemberRole: string | null;
  organizationMemberStatus: string | null;
  projectMemberProjectId: number | null;
  projectMemberUserId: number | null;
  projectMemberRole: string | null;
  projectMemberStatus: string | null;
}

interface TargetProjectMemberSnapshot {
  id: number;
  externalId: string;
  projectId: number;
  userId: number;
  role: string;
  status: string;
}

interface TargetOrganizationMemberSnapshot {
  id: number;
  externalId: string;
  organizationId: number;
  userId: number;
  status: string;
  userExternalId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface LockedOrganizationSnapshot {
  id: number;
  externalId: string;
  name: string;
  status: string;
  teamProjectsEnabled: boolean;
}

interface LockedOrganizationMemberSnapshot {
  id: number;
  externalId: string;
  organizationId: number;
  userId: number;
  role: string;
  status: string;
}

interface LockedProjectSnapshot {
  id: number;
  externalId: string;
  userId: number;
  organizationId: number | null;
}

function hidden(): never {
  throw new ProjectAccessError('NOT_FOUND');
}

function forbidden(): never {
  throw new ProjectAccessError('FORBIDDEN');
}

function conflict(reason: ProjectAccessConflictReason): never {
  throw new ProjectAccessError('CONFLICT', reason);
}

function isOrganizationRole(role: string | null): role is OrganizationRole {
  return role !== null && (ORGANIZATION_ROLES as readonly string[]).includes(role);
}

function isProjectRole(role: string | null): role is ProjectRole {
  return role !== null && (PROJECT_ROLES as readonly string[]).includes(role);
}

/** One actor/project-bound snapshot; LEFT joins preserve the personal branch. */
function buildProjectAccessSnapshotQuery(db: Pick<DB, 'select'>, input: ProjectAccessInput) {
  return db
    .select({
      projectId: projects.id,
      projectExternalId: projects.externalId,
      projectOwnerUserId: projects.userId,
      actorUserId: users.id,
      actorExternalId: users.externalId,
      organizationInternalId: projects.organizationId,
      organizationRowId: organizations.id,
      organizationExternalId: organizations.externalId,
      organizationName: organizations.name,
      organizationStatus: organizations.status,
      teamProjectsEnabled: organizations.teamProjectsEnabled,
      organizationMemberOrganizationId: organizationMembers.organizationId,
      organizationMemberUserId: organizationMembers.userId,
      organizationMemberRole: organizationMembers.role,
      organizationMemberStatus: organizationMembers.status,
      projectMemberProjectId: projectMembers.projectId,
      projectMemberUserId: projectMembers.userId,
      projectMemberRole: projectMembers.role,
      projectMemberStatus: projectMembers.status,
    })
    .from(projects)
    .innerJoin(users, eq(users.externalId, input.actorExternalId))
    .leftJoin(
      organizations,
      and(
        eq(organizations.id, projects.organizationId),
        eq(organizations.status, 'active'),
        eq(organizations.teamProjectsEnabled, true),
      ),
    )
    .leftJoin(
      organizationMembers,
      and(
        eq(organizationMembers.organizationId, organizations.id),
        eq(organizationMembers.userId, users.id),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .leftJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.userId, users.id),
        eq(projectMembers.status, 'active'),
      ),
    )
    .where(
      and(
        eq(projects.externalId, input.projectExternalId),
        or(
          and(isNull(projects.organizationId), eq(projects.userId, users.id)),
          and(
            isNotNull(projects.organizationId),
            isNotNull(organizations.id),
            isNotNull(organizationMembers.id),
            isNotNull(projectMembers.id),
          ),
        ),
      ),
    )
    .limit(1);
}

function buildLockedProjectMembershipsQuery(db: Pick<DB, 'select'>, projectId: number) {
  return db
    .select({
      id: projectMembers.id,
      externalId: projectMembers.externalId,
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.role,
      status: projectMembers.status,
    })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(projectMembers.id))
    .for('update');
}

function buildLockedOrganizationQuery(
  db: Pick<DB, 'select'>,
  organizationId: number,
  organizationExternalId: string,
) {
  return db
    .select({
      id: organizations.id,
      externalId: organizations.externalId,
      name: organizations.name,
      status: organizations.status,
      teamProjectsEnabled: organizations.teamProjectsEnabled,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, organizationId),
        eq(organizations.externalId, organizationExternalId),
        eq(organizations.status, 'active'),
        eq(organizations.teamProjectsEnabled, true),
      ),
    )
    .for('update')
    .limit(1);
}

function buildLockedActorOrganizationMemberQuery(
  db: Pick<DB, 'select'>,
  organizationId: number,
  actorUserId: number,
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
        eq(organizationMembers.userId, actorUserId),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .for('update')
    .limit(1);
}

function buildLockedProjectQuery(
  db: Pick<DB, 'select'>,
  projectId: number,
  projectExternalId: string,
  organizationId: number | null,
) {
  return db
    .select({
      id: projects.id,
      externalId: projects.externalId,
      userId: projects.userId,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.externalId, projectExternalId),
        organizationId === null
          ? isNull(projects.organizationId)
          : eq(projects.organizationId, organizationId),
      ),
    )
    .for('update')
    .limit(1);
}

function buildLockedTargetOrganizationMemberQuery(
  db: Pick<DB, 'select'>,
  organizationId: number,
  targetOrganizationMemberExternalId: string,
) {
  return db
    .select({
      id: organizationMembers.id,
      externalId: organizationMembers.externalId,
      organizationId: organizationMembers.organizationId,
      userId: organizationMembers.userId,
      status: organizationMembers.status,
      userExternalId: users.externalId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.externalId, targetOrganizationMemberExternalId),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .for('update')
    .limit(1);
}

function snapshotToAccess(
  snapshot: ProjectAccessSnapshot | undefined,
  input: ProjectAccessInput,
): ProjectAccess {
  if (
    !snapshot ||
    snapshot.actorExternalId !== input.actorExternalId ||
    snapshot.projectExternalId !== input.projectExternalId
  ) {
    return hidden();
  }
  if (snapshot.organizationInternalId === null) {
    if (
      snapshot.projectOwnerUserId !== snapshot.actorUserId ||
      snapshot.organizationRowId !== null ||
      snapshot.organizationExternalId !== null ||
      snapshot.organizationMemberOrganizationId !== null ||
      snapshot.organizationMemberUserId !== null ||
      snapshot.projectMemberProjectId !== null ||
      snapshot.projectMemberUserId !== null
    ) {
      return hidden();
    }
    return {
      projectId: snapshot.projectId,
      scope: 'personal',
      organizationInternalId: null,
      organizationExternalId: null,
      organizationName: null,
      organizationRole: null,
      projectRole: null,
    };
  }
  if (
    snapshot.organizationRowId !== snapshot.organizationInternalId ||
    snapshot.organizationExternalId === null ||
    snapshot.organizationName === null ||
    snapshot.organizationStatus !== 'active' ||
    snapshot.teamProjectsEnabled !== true ||
    snapshot.organizationMemberOrganizationId !== snapshot.organizationInternalId ||
    snapshot.organizationMemberUserId !== snapshot.actorUserId ||
    snapshot.organizationMemberStatus !== 'active' ||
    snapshot.projectMemberProjectId !== snapshot.projectId ||
    snapshot.projectMemberUserId !== snapshot.actorUserId ||
    snapshot.projectMemberStatus !== 'active' ||
    !isOrganizationRole(snapshot.organizationMemberRole) ||
    !isProjectRole(snapshot.projectMemberRole)
  ) {
    return hidden();
  }
  return {
    projectId: snapshot.projectId,
    scope: 'organization',
    organizationInternalId: snapshot.organizationInternalId,
    organizationExternalId: snapshot.organizationExternalId,
    organizationName: snapshot.organizationName,
    organizationRole: snapshot.organizationMemberRole,
    projectRole: snapshot.projectMemberRole,
  };
}

async function loadProjectAccess(
  db: Pick<DB, 'select'>,
  input: ProjectAccessInput,
): Promise<ProjectAccess> {
  const [snapshot] = (await buildProjectAccessSnapshotQuery(db, input)) as ProjectAccessSnapshot[];
  return snapshotToAccess(snapshot, input);
}

export async function requireReadableProject(
  db: Pick<DB, 'select'>,
  input: ProjectAccessInput,
): Promise<ProjectAccess> {
  return loadProjectAccess(db, input);
}

function authorizeMutation<Action extends ProjectMutationAction>(
  access: ProjectAccess,
  action: Action,
): ProjectMutationGrant<Action> {
  if (access.scope === 'personal') {
    if (action === 'manage_members') return forbidden();
    return { ...access, action };
  }
  const context = {
    organizationId: access.organizationExternalId,
    projectOrganizationId: access.organizationExternalId,
    targetProjectId: String(access.projectId),
    actorOrganizationMember: {
      organizationId: access.organizationExternalId,
      userId: 'authoritative-actor',
      role: access.organizationRole,
      status: 'active',
    },
    actorProjectMember: {
      projectId: String(access.projectId),
      userId: 'authoritative-actor',
      role: access.projectRole,
      status: 'active',
    },
  };
  const decision =
    action === 'delete' ? canDeleteTeamProject(context) : canRenameTeamProject(context);
  if (!decision.allowed) return forbidden();
  return { ...access, action };
}

type CanonicalMutationLocks = {
  projectMemberships: TargetProjectMemberSnapshot[];
  targetOrganizationMember?: TargetOrganizationMemberSnapshot;
};

async function lockCanonicalMutationAccess(
  tx: ProjectAccessTransaction,
  input: ProjectAccessInput,
  candidate: ProjectAccessSnapshot,
  targetOrganizationMemberExternalId?: string,
): Promise<{ access: ProjectAccess; locks: CanonicalMutationLocks }> {
  const candidateAccess = snapshotToAccess(candidate, input);

  if (candidateAccess.scope === 'personal') {
    const [project] = (await buildLockedProjectQuery(
      tx,
      candidate.projectId,
      input.projectExternalId,
      null,
    )) as LockedProjectSnapshot[];
    if (
      !project ||
      project.userId !== candidate.actorUserId ||
      project.organizationId !== null ||
      project.externalId !== input.projectExternalId
    ) {
      return hidden();
    }
    return { access: candidateAccess, locks: { projectMemberships: [] } };
  }

  // Team mutations always lock tenant state before the project. The candidate lookup is
  // deliberately nonlocking and supplies identifiers only; no candidate authorization field is
  // trusted after this point.
  const [organization] = (await buildLockedOrganizationQuery(
    tx,
    candidateAccess.organizationInternalId,
    candidateAccess.organizationExternalId,
  )) as LockedOrganizationSnapshot[];
  if (
    !organization ||
    organization.id !== candidateAccess.organizationInternalId ||
    organization.externalId !== candidateAccess.organizationExternalId ||
    organization.status !== 'active' ||
    organization.teamProjectsEnabled !== true
  ) {
    return hidden();
  }
  const [actorOrganizationMember] = (await buildLockedActorOrganizationMemberQuery(
    tx,
    organization.id,
    candidate.actorUserId,
  )) as LockedOrganizationMemberSnapshot[];
  if (
    !actorOrganizationMember ||
    actorOrganizationMember.organizationId !== organization.id ||
    actorOrganizationMember.userId !== candidate.actorUserId ||
    actorOrganizationMember.status !== 'active' ||
    !isOrganizationRole(actorOrganizationMember.role)
  ) {
    return hidden();
  }

  let targetOrganizationMember: TargetOrganizationMemberSnapshot | undefined;
  if (targetOrganizationMemberExternalId) {
    [targetOrganizationMember] = (await buildLockedTargetOrganizationMemberQuery(
      tx,
      organization.id,
      targetOrganizationMemberExternalId,
    )) as TargetOrganizationMemberSnapshot[];
    if (
      !targetOrganizationMember ||
      targetOrganizationMember.organizationId !== organization.id ||
      targetOrganizationMember.status !== 'active'
    ) {
      return hidden();
    }
  }

  // Lock the project only after organization and organization-member locks.
  const [lockedProject] = (await buildLockedProjectQuery(
    tx,
    candidate.projectId,
    input.projectExternalId,
    organization.id,
  )) as LockedProjectSnapshot[];
  if (
    !lockedProject ||
    lockedProject.id !== candidate.projectId ||
    lockedProject.externalId !== input.projectExternalId ||
    lockedProject.organizationId !== organization.id
  ) {
    return hidden();
  }
  const projectMemberships = (await buildLockedProjectMembershipsQuery(
    tx,
    lockedProject.id,
  )) as TargetProjectMemberSnapshot[];
  if (
    projectMemberships.some(
      (membership) =>
        membership.projectId !== lockedProject.id ||
        !isProjectRole(membership.role) ||
        (membership.status !== 'active' && membership.status !== 'inactive'),
    )
  ) {
    return hidden();
  }
  const actorProjectMember = projectMemberships.find(
    (membership) => membership.userId === candidate.actorUserId && membership.status === 'active',
  );
  if (!actorProjectMember || !isProjectRole(actorProjectMember.role)) return hidden();

  return {
    access: {
      projectId: lockedProject.id,
      scope: 'organization',
      organizationInternalId: organization.id,
      organizationExternalId: organization.externalId,
      organizationName: organization.name,
      organizationRole: actorOrganizationMember.role,
      projectRole: actorProjectMember.role,
    },
    locks: { projectMemberships, targetOrganizationMember },
  };
}

async function withAuthorizedMutation<Action extends ProjectMutationAction, Result>(
  db: DB,
  input: ProjectAccessInput,
  action: Action,
  write: (
    tx: ProjectAccessTransaction,
    grant: ProjectMutationGrant<Action>,
    locks: CanonicalMutationLocks,
  ) => Promise<Result>,
  targetOrganizationMemberExternalId?: string,
): Promise<Result> {
  const [candidate] = (await buildProjectAccessSnapshotQuery(db, input)) as ProjectAccessSnapshot[];
  if (!candidate) return hidden();
  snapshotToAccess(candidate, input);
  return db.transaction(async (tx) => {
    const { access, locks } = await lockCanonicalMutationAccess(
      tx,
      input,
      candidate,
      targetOrganizationMemberExternalId,
    );
    const grant = authorizeMutation(access, action);
    return write(tx, grant, locks);
  });
}

function requireExactlyOne(result: unknown): void {
  if (readAffectedRows(result) !== 1) hidden();
}

function publicAccess(grant: ProjectMutationGrant<ProjectMutationAction>): ProjectAccess {
  const { action: _action, ...access } = grant;
  return access;
}

export async function renameProjectWithAccess(
  db: DB,
  input: ProjectAccessInput,
  update: { name: string },
) {
  return withAuthorizedMutation(db, input, 'rename', async (tx, grant) => {
    const result = await tx
      .update(projects)
      .set({ name: update.name })
      .where(
        and(eq(projects.id, grant.projectId), eq(projects.externalId, input.projectExternalId)),
      );
    requireExactlyOne(result);
    return { ...publicAccess(grant), name: update.name };
  });
}

export async function removeProjectMemberWithAccess(
  db: DB,
  input: ProjectAccessInput,
  targetProjectMemberExternalId: string,
) {
  return withAuthorizedMutation(db, input, 'manage_members', async (tx, grant, locks) => {
    const target = locks.projectMemberships.find(
      (membership) => membership.externalId === targetProjectMemberExternalId,
    );
    if (
      !target ||
      target.projectId !== grant.projectId ||
      target.status !== 'active' ||
      !isProjectRole(target.role)
    ) {
      return hidden();
    }
    if (grant.scope === 'personal') return forbidden();
    const decision = canRemoveProjectMember({
      organizationId: grant.organizationExternalId,
      projectOrganizationId: grant.organizationExternalId,
      targetProjectId: String(grant.projectId),
      actorOrganizationMember: {
        organizationId: grant.organizationExternalId,
        userId: 'authoritative-actor',
        role: grant.organizationRole,
        status: 'active',
      },
      actorProjectMember: {
        projectId: String(grant.projectId),
        userId: 'authoritative-actor',
        role: grant.projectRole,
        status: 'active',
      },
      targetProjectMember: {
        projectId: String(target.projectId),
        userId: String(target.userId),
        role: target.role,
        status: target.status,
      },
    });
    if (!decision.allowed) return forbidden();
    const activeMemberships = locks.projectMemberships.filter(
      (membership) => membership.status === 'active',
    );
    if (
      target.role === 'lead' &&
      activeMemberships.filter((membership) => membership.role === 'lead').length <= 1
    ) {
      return conflict('SOLE_PROJECT_LEAD');
    }
    const result = await tx
      .update(projectMembers)
      .set({ status: 'inactive' })
      .where(
        and(
          eq(projectMembers.id, target.id),
          eq(projectMembers.projectId, grant.projectId),
          eq(projectMembers.status, 'active'),
        ),
      );
    requireExactlyOne(result);
    return {
      ...publicAccess(grant),
      projectMemberId: target.externalId,
      status: 'inactive' as const,
    };
  });
}

export async function addProjectMemberWithAccess(
  db: DB,
  input: ProjectAccessInput,
  targetOrganizationMemberExternalId: string,
  role: ProjectRole,
) {
  return withAuthorizedMutation(
    db,
    input,
    'manage_members',
    async (tx, grant, locks) => {
      if (grant.scope === 'personal') return forbidden();
      const target = locks.targetOrganizationMember;
      if (
        !target ||
        target.organizationId !== grant.organizationInternalId ||
        target.status !== 'active'
      ) {
        return hidden();
      }
      const existing = locks.projectMemberships.find(
        (membership) => membership.userId === target.userId,
      );
      if (
        existing &&
        (existing.projectId !== grant.projectId ||
          existing.userId !== target.userId ||
          !isProjectRole(existing.role) ||
          (existing.status !== 'active' && existing.status !== 'inactive'))
      ) {
        return hidden();
      }
      if (existing?.status === 'active') return conflict('DUPLICATE_MEMBER');

      let projectMemberExternalId: string;
      if (existing) {
        const result = await tx
          .update(projectMembers)
          .set({ role, status: 'active' })
          .where(
            and(
              eq(projectMembers.id, existing.id),
              eq(projectMembers.projectId, grant.projectId),
              eq(projectMembers.userId, target.userId),
              eq(projectMembers.status, 'inactive'),
            ),
          );
        requireExactlyOne(result);
        projectMemberExternalId = existing.externalId;
      } else {
        projectMemberExternalId = newExternalId('projectMember');
        const result = await tx.insert(projectMembers).values({
          externalId: projectMemberExternalId,
          projectId: grant.projectId,
          userId: target.userId,
          role,
          status: 'active',
        });
        requireExactlyOne(result);
      }

      return {
        ...publicAccess(grant),
        projectMemberId: projectMemberExternalId,
        userId: target.userExternalId,
        displayName: target.displayName,
        avatarUrl: target.avatarUrl,
        role,
      };
    },
    targetOrganizationMemberExternalId,
  );
}

export async function deleteProjectWithAccess(db: DB, input: ProjectAccessInput) {
  return withAuthorizedMutation(db, input, 'delete', async (tx, grant) => {
    const result = await tx
      .delete(projects)
      .where(
        and(eq(projects.id, grant.projectId), eq(projects.externalId, input.projectExternalId)),
      );
    requireExactlyOne(result);
    return publicAccess(grant);
  });
}

export const __projectAccessInternals = {
  buildProjectAccessSnapshotQuery,
  buildLockedActorOrganizationMemberQuery,
  buildLockedOrganizationQuery,
  buildLockedProjectMembershipsQuery,
  buildLockedProjectQuery,
  buildLockedTargetOrganizationMemberQuery,
  snapshotToAccess,
};
