import { and, eq } from 'drizzle-orm';
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

export interface ProjectAccessInput {
  db: DB;
  actorExternalId: string;
  projectExternalId: string;
}

/**
 * The action is mandatory so a caller cannot accidentally use rename-level
 * access for a later, more sensitive mutation such as deletion.
 */
export type ProjectMutationAction = 'rename' | 'remove_member' | 'delete';

export interface MutableProjectAccessInput extends ProjectAccessInput {
  action: ProjectMutationAction;
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

interface ProjectSnapshot {
  id: number;
  externalId: string;
  ownerUserId: number;
  organizationInternalId: number | null;
  organizationExternalId: string | null;
  organizationName: string | null;
  organizationStatus: string | null;
  teamProjectsEnabled: boolean | null;
}

interface OrganizationMembershipSnapshot {
  organizationId: number;
  userId: number;
  role: string;
  status: string;
}

interface ProjectMembershipSnapshot {
  projectId: number;
  userId: number;
  role: string;
  status: string;
}

/** Resolve the authenticated external actor once at the access boundary. */
async function resolveActorUserId(
  db: Pick<DB, 'select'>,
  actorExternalId: string,
): Promise<number> {
  const [actor] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, actorExternalId))
    .limit(1);
  // An invalid/stale authenticated identity must not disclose project state either.
  if (!actor) throw new ProjectAccessError('NOT_FOUND');
  return actor.id;
}

/**
 * Team organizations are joined only when active and enabled. A team project
 * with no matching joined organization is intentionally indistinguishable
 * from a nonexistent project at this boundary.
 */
function buildProjectLookupQuery(db: Pick<DB, 'select'>, projectExternalId: string) {
  return db
    .select({
      id: projects.id,
      externalId: projects.externalId,
      ownerUserId: projects.userId,
      organizationInternalId: projects.organizationId,
      organizationExternalId: organizations.externalId,
      organizationName: organizations.name,
      organizationStatus: organizations.status,
      teamProjectsEnabled: organizations.teamProjectsEnabled,
    })
    .from(projects)
    .leftJoin(
      organizations,
      and(
        eq(organizations.id, projects.organizationId),
        eq(organizations.status, 'active'),
        eq(organizations.teamProjectsEnabled, true),
      ),
    )
    .where(eq(projects.externalId, projectExternalId))
    .limit(1);
}

function buildOrganizationMembershipQuery(
  db: Pick<DB, 'select'>,
  organizationId: number,
  actorUserId: number,
) {
  return db
    .select({
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
    .limit(1);
}

function buildProjectMembershipQuery(
  db: Pick<DB, 'select'>,
  projectId: number,
  actorUserId: number,
) {
  return db
    .select({
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.role,
      status: projectMembers.status,
    })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, actorUserId),
        eq(projectMembers.status, 'active'),
      ),
    )
    .limit(1);
}

function hidden(): never {
  throw new ProjectAccessError('NOT_FOUND');
}

function isActiveOrganizationMembership(
  membership: OrganizationMembershipSnapshot | undefined,
  organizationId: number,
  actorUserId: number,
): membership is OrganizationMembershipSnapshot {
  return (
    membership?.organizationId === organizationId &&
    membership.userId === actorUserId &&
    membership.status === 'active'
  );
}

function isActiveProjectMembership(
  membership: ProjectMembershipSnapshot | undefined,
  projectId: number,
  actorUserId: number,
): membership is ProjectMembershipSnapshot {
  return (
    membership?.projectId === projectId &&
    membership.userId === actorUserId &&
    membership.status === 'active'
  );
}

function isOrganizationRole(role: string): role is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(role);
}

function isProjectRole(role: string): role is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(role);
}

/**
 * Returns only authoritative access context. Team access is possible only
 * after the project, active enabled organization, active org membership, and
 * active project membership all bind to the same resolved actor.
 */
export async function requireReadableProject(input: ProjectAccessInput): Promise<ProjectAccess> {
  const actorUserId = await resolveActorUserId(input.db, input.actorExternalId);
  const [project] = (await buildProjectLookupQuery(
    input.db,
    input.projectExternalId,
  )) as ProjectSnapshot[];
  if (!project) return hidden();

  if (project.organizationInternalId === null) {
    if (project.ownerUserId !== actorUserId) return hidden();
    return {
      projectId: project.id,
      scope: 'personal',
      organizationInternalId: null,
      organizationExternalId: null,
      organizationName: null,
      organizationRole: null,
      projectRole: null,
    };
  }

  if (
    project.organizationExternalId === null ||
    project.organizationName === null ||
    project.organizationStatus !== 'active' ||
    project.teamProjectsEnabled !== true
  ) {
    return hidden();
  }

  const [organizationMembership] = (await buildOrganizationMembershipQuery(
    input.db,
    project.organizationInternalId,
    actorUserId,
  )) as OrganizationMembershipSnapshot[];
  if (
    !isActiveOrganizationMembership(
      organizationMembership,
      project.organizationInternalId,
      actorUserId,
    )
  ) {
    return hidden();
  }

  const [projectMembership] = (await buildProjectMembershipQuery(
    input.db,
    project.id,
    actorUserId,
  )) as ProjectMembershipSnapshot[];
  if (!isActiveProjectMembership(projectMembership, project.id, actorUserId)) return hidden();
  if (!isOrganizationRole(organizationMembership.role) || !isProjectRole(projectMembership.role)) {
    return hidden();
  }

  return {
    projectId: project.id,
    scope: 'organization',
    organizationInternalId: project.organizationInternalId,
    organizationExternalId: project.organizationExternalId,
    organizationName: project.organizationName,
    organizationRole: organizationMembership.role,
    projectRole: projectMembership.role,
  };
}

/**
 * Applies the Task 4 permission matrix after (and only after) readable access
 * has established the tenant and both membership boundaries. Removing a
 * specific member still requires its own target-membership binding later.
 */
export async function requireMutableProject(
  input: MutableProjectAccessInput,
): Promise<ProjectAccess> {
  const access = await requireReadableProject(input);
  if (access.scope === 'personal') {
    if (input.action === 'remove_member') throw new ProjectAccessError('FORBIDDEN');
    return access;
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
    input.action === 'delete' ? canDeleteTeamProject(context) : canRenameTeamProject(context);
  if (!decision.allowed) throw new ProjectAccessError('FORBIDDEN');
  return access;
}

export const __projectAccessInternals = {
  buildProjectLookupQuery,
  buildOrganizationMembershipQuery,
  buildProjectMembershipQuery,
};
