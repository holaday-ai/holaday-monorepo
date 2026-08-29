import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
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

export type ProjectAccessErrorCode = 'NOT_FOUND' | 'FORBIDDEN';

export class ProjectAccessError extends Error {
  constructor(public readonly code: ProjectAccessErrorCode) {
    super(code === 'NOT_FOUND' ? 'project not found' : 'project action forbidden');
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
type ProjectAccessTransaction = Pick<DB, 'select' | 'update' | 'delete'>;
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

function hidden(): never {
  throw new ProjectAccessError('NOT_FOUND');
}

function forbidden(): never {
  throw new ProjectAccessError('FORBIDDEN');
}

function isOrganizationRole(role: string | null): role is OrganizationRole {
  return role !== null && (ORGANIZATION_ROLES as readonly string[]).includes(role);
}

function isProjectRole(role: string | null): role is ProjectRole {
  return role !== null && (PROJECT_ROLES as readonly string[]).includes(role);
}

/** One actor/project-bound snapshot; LEFT joins preserve the personal branch. */
function buildProjectAccessSnapshotQuery(
  db: Pick<DB, 'select'>,
  input: ProjectAccessInput,
  lock: boolean,
) {
  const query = db
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
    );
  return lock ? query.for('update').limit(1) : query.limit(1);
}

function buildLockedTargetMemberQuery(
  db: Pick<DB, 'select'>,
  projectId: number,
  targetProjectMemberExternalId: string,
) {
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
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.externalId, targetProjectMemberExternalId),
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
  lock: boolean,
): Promise<ProjectAccess> {
  const [snapshot] = (await buildProjectAccessSnapshotQuery(
    db,
    input,
    lock,
  )) as ProjectAccessSnapshot[];
  return snapshotToAccess(snapshot, input);
}

export async function requireReadableProject(
  db: Pick<DB, 'select'>,
  input: ProjectAccessInput,
): Promise<ProjectAccess> {
  return loadProjectAccess(db, input, false);
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

async function withAuthorizedMutation<Action extends ProjectMutationAction, Result>(
  db: DB,
  input: ProjectAccessInput,
  action: Action,
  write: (tx: ProjectAccessTransaction, grant: ProjectMutationGrant<Action>) => Promise<Result>,
): Promise<Result> {
  return db.transaction(async (tx) => {
    const access = await loadProjectAccess(tx, input, true);
    const grant = authorizeMutation(access, action);
    return write(tx, grant);
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
  return withAuthorizedMutation(db, input, 'manage_members', async (tx, grant) => {
    const [target] = (await buildLockedTargetMemberQuery(
      tx,
      grant.projectId,
      targetProjectMemberExternalId,
    )) as TargetProjectMemberSnapshot[];
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
  buildLockedTargetMemberQuery,
  snapshotToAccess,
};
