import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import type { DB } from '../db/client.js';
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
  canRenameTeamProject,
} from '../organizations/organization-permissions.js';

export type ProjectAccessErrorCode = 'NOT_FOUND' | 'FORBIDDEN';

/** Domain-only failure; transport adapters decide how to render it. */
export class ProjectAccessError extends Error {
  constructor(public readonly code: ProjectAccessErrorCode) {
    super(code === 'NOT_FOUND' ? 'project not found' : 'project action forbidden');
    this.name = 'ProjectAccessError';
  }
}

/** Only external IDs from the authenticated request may cross this boundary. */
export interface ProjectAccessInput {
  actorExternalId: string;
  projectExternalId: string;
}

export type ProjectMutationAction = 'rename' | 'manage_members' | 'delete';

export interface MutableProjectAccessInput<Action extends ProjectMutationAction>
  extends ProjectAccessInput {
  action: Action;
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

declare const projectAccessTransactionBrand: unique symbol;
declare const projectMutationGrantBrand: unique symbol;

/**
 * A transaction capability created only by withProjectAccessTransaction. It
 * makes a later router write type-dependent on the same transaction that
 * locked and authorized its project access snapshot.
 */
export type ProjectAccessTransaction = Pick<DB, 'select' | 'insert' | 'update' | 'delete'> & {
  readonly [projectAccessTransactionBrand]: 'project-access-transaction';
};

/** A mutation grant is invariant in its exact action via its discriminator. */
export type ProjectMutationGrant<Action extends ProjectMutationAction> = ProjectAccess & {
  readonly action: Action;
  readonly [projectMutationGrantBrand]: Action;
};

interface ProjectAccessSnapshot {
  projectId: number;
  projectExternalId: string;
  projectOwnerUserId: number;
  actorUserId: number;
  organizationInternalId: number | null;
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

function hidden(): never {
  throw new ProjectAccessError('NOT_FOUND');
}

function isOrganizationRole(role: string | null): role is OrganizationRole {
  return role !== null && (ORGANIZATION_ROLES as readonly string[]).includes(role);
}

function isProjectRole(role: string | null): role is ProjectRole {
  return role !== null && (PROJECT_ROLES as readonly string[]).includes(role);
}

/**
 * One actor- and project-bound snapshot for personal and team projects. The
 * query itself excludes stale organization/member rows; the shape checks below
 * deliberately repeat those bindings so a fake or malformed driver row cannot
 * evade the tenant boundary.
 */
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
      organizationInternalId: projects.organizationId,
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

function snapshotToAccess(snapshot: ProjectAccessSnapshot | undefined): ProjectAccess {
  if (!snapshot) return hidden();

  if (snapshot.organizationInternalId === null) {
    if (snapshot.projectOwnerUserId !== snapshot.actorUserId) return hidden();
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
  return snapshotToAccess(snapshot);
}

/** Read-only project access has no transaction or row lock side effects. */
export async function requireReadableProject(
  db: Pick<DB, 'select'>,
  input: ProjectAccessInput,
): Promise<ProjectAccess> {
  return loadProjectAccess(db, input, false);
}

/** Runs authorization and the caller's write callback inside one DB transaction. */
export async function withProjectAccessTransaction<Result>(
  db: DB,
  callback: (tx: ProjectAccessTransaction) => Promise<Result>,
): Promise<Result> {
  return db.transaction(async (tx) => callback(tx as unknown as ProjectAccessTransaction));
}

function accessDecision<Action extends ProjectMutationAction>(
  access: ProjectAccess,
  action: Action,
): void {
  if (access.scope === 'personal') {
    if (action === 'manage_members') throw new ProjectAccessError('FORBIDDEN');
    return;
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
  if (!decision.allowed) throw new ProjectAccessError('FORBIDDEN');
}

/**
 * Mutable access only accepts the branded transaction and locks the complete
 * joined access snapshot before returning an action-specific grant.
 */
export async function requireMutableProject<Action extends ProjectMutationAction>(
  tx: ProjectAccessTransaction,
  input: MutableProjectAccessInput<Action>,
): Promise<ProjectMutationGrant<Action>> {
  const access = await loadProjectAccess(tx, input, true);
  accessDecision(access, input.action);
  return { ...access, action: input.action } as ProjectMutationGrant<Action>;
}

/**
 * The write-oriented entrypoint: callers receive an exact action grant and
 * its originating transaction together, so a Task 9 write cannot be placed
 * after an independently committed access check.
 */
export async function withMutableProjectAccess<Action extends ProjectMutationAction, Result>(
  db: DB,
  input: MutableProjectAccessInput<Action>,
  callback: (tx: ProjectAccessTransaction, grant: ProjectMutationGrant<Action>) => Promise<Result>,
): Promise<Result> {
  return withProjectAccessTransaction(db, async (tx) => {
    const grant = await requireMutableProject(tx, input);
    return callback(tx, grant);
  });
}

function requireGrantAction<Action extends ProjectMutationAction>(
  grant: ProjectMutationGrant<Action>,
  action: Action,
): ProjectMutationGrant<Action> {
  if (grant.action !== action) throw new ProjectAccessError('FORBIDDEN');
  return grant;
}

/** Task 9 write helpers consume the matching action grant, never plain access. */
export function requireRenameProjectGrant(
  grant: ProjectMutationGrant<'rename'>,
): ProjectMutationGrant<'rename'> {
  return requireGrantAction(grant, 'rename');
}

export function requireMemberManagementProjectGrant(
  grant: ProjectMutationGrant<'manage_members'>,
): ProjectMutationGrant<'manage_members'> {
  return requireGrantAction(grant, 'manage_members');
}

export function requireDeleteProjectGrant(
  grant: ProjectMutationGrant<'delete'>,
): ProjectMutationGrant<'delete'> {
  return requireGrantAction(grant, 'delete');
}

export const __projectAccessInternals = {
  buildProjectAccessSnapshotQuery,
  snapshotToAccess,
};
