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

type ProjectMutationAction = 'rename' | 'manage_members' | 'delete';
type ProjectAccessTransaction = Pick<DB, 'select' | 'insert' | 'update' | 'delete'>;
type ProjectMutationGrant<Action extends ProjectMutationAction> = ProjectAccess & {
  readonly action: Action;
};

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
type PublicProjectAccess = Readonly<ProjectAccess>;
type ProjectActionExecutor<Result> = (access: PublicProjectAccess) => Promise<Result> | Result;

/** A live rename capability; it expires before its enclosing transaction resolves. */
export interface RenameProjectSession {
  readonly action: 'rename';
  rename<Result>(executor: ProjectActionExecutor<Result>): Promise<Result>;
}

/** A live project-membership management capability. */
export interface ProjectMemberManagementSession {
  readonly action: 'manage_members';
  manageMembers<Result>(executor: ProjectActionExecutor<Result>): Promise<Result>;
}

/** A live project deletion capability. */
export interface DeleteProjectSession {
  readonly action: 'delete';
  delete<Result>(executor: ProjectActionExecutor<Result>): Promise<Result>;
}

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

interface LiveCapability {
  readonly tx: ProjectAccessTransaction;
  readonly grant: ProjectMutationGrant<ProjectMutationAction>;
  active: boolean;
  used: boolean;
}

const capabilities = new WeakMap<object, LiveCapability>();

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

/**
 * One actor- and project-bound snapshot for personal and team projects. The
 * joins stay LEFT so the personal branch remains visible; the WHERE branch
 * separately requires all organization/project membership rows for teams.
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

/** Read-only access has no transaction or row-lock side effects. */
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

function requireLiveAction<Action extends ProjectMutationAction>(
  session: object,
  action: Action,
): ProjectMutationGrant<Action> {
  const capability = capabilities.get(session);
  if (!capability?.active || capability.grant.action !== action) return forbidden();
  capability.used = true;
  return capability.grant as ProjectMutationGrant<Action>;
}

function freezeAccess(access: ProjectAccess): PublicProjectAccess {
  return Object.freeze({ ...access }) as PublicProjectAccess;
}

function createRenameSession(): RenameProjectSession {
  const session = {
    action: 'rename' as const,
    async rename<Result>(executor: ProjectActionExecutor<Result>): Promise<Result> {
      const liveGrant = requireLiveAction(session, 'rename');
      return executor(freezeAccess(liveGrant));
    },
  };
  return Object.freeze(session);
}

function createMemberManagementSession(): ProjectMemberManagementSession {
  const session = {
    action: 'manage_members' as const,
    async manageMembers<Result>(executor: ProjectActionExecutor<Result>): Promise<Result> {
      const liveGrant = requireLiveAction(session, 'manage_members');
      return executor(freezeAccess(liveGrant));
    },
  };
  return Object.freeze(session);
}

function createDeleteSession(): DeleteProjectSession {
  const session = {
    action: 'delete' as const,
    async delete<Result>(executor: ProjectActionExecutor<Result>): Promise<Result> {
      const liveGrant = requireLiveAction(session, 'delete');
      return executor(freezeAccess(liveGrant));
    },
  };
  return Object.freeze(session);
}

async function withLiveSession<Action extends ProjectMutationAction, Session, Result>(
  db: DB,
  input: ProjectAccessInput,
  action: Action,
  createSession: () => Session,
  executor: (session: Session) => Promise<Result>,
): Promise<Result> {
  return db.transaction(async (tx) => {
    const access = await loadProjectAccess(tx, input, true);
    const grant = authorizeMutation(access, action);
    const session = createSession();
    capabilities.set(session as object, { tx, grant, active: true, used: false });
    try {
      const result = await executor(session);
      if (!capabilities.get(session as object)?.used) return forbidden();
      return result;
    } finally {
      const capability = capabilities.get(session as object);
      if (capability) capability.active = false;
    }
  });
}

/** Executes rename work only within a locked, live rename session. */
export function withRenameProjectSession<Result>(
  db: DB,
  input: ProjectAccessInput,
  executor: (session: RenameProjectSession) => Promise<Result>,
): Promise<Result> {
  return withLiveSession(db, input, 'rename', createRenameSession, executor);
}

/** Executes project-membership work only within a locked, live member session. */
export function withProjectMemberManagementSession<Result>(
  db: DB,
  input: ProjectAccessInput,
  executor: (session: ProjectMemberManagementSession) => Promise<Result>,
): Promise<Result> {
  return withLiveSession(db, input, 'manage_members', createMemberManagementSession, executor);
}

/** Executes deletion work only within a locked, live delete session. */
export function withDeleteProjectSession<Result>(
  db: DB,
  input: ProjectAccessInput,
  executor: (session: DeleteProjectSession) => Promise<Result>,
): Promise<Result> {
  return withLiveSession(db, input, 'delete', createDeleteSession, executor);
}

export const __projectAccessInternals = {
  buildProjectAccessSnapshotQuery,
  snapshotToAccess,
};
