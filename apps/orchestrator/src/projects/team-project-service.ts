import { newExternalId } from '@holaday/shared-types';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { projectMembers } from '../db/schema/project-members.js';
import { projects } from '../db/schema/projects.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import {
  type OrganizationRole,
  canCreateTeamProject,
} from '../organizations/organization-permissions.js';
import { type ProjectAccessInput, requireReadableProject } from './project-access.js';

const CONSISTENT_READ_TRANSACTION = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
} as const;

export type TeamProjectServiceErrorCode = 'NOT_FOUND' | 'FORBIDDEN';

export class TeamProjectServiceError extends Error {
  constructor(public readonly code: TeamProjectServiceErrorCode) {
    super(code === 'NOT_FOUND' ? 'organization not found' : 'project action forbidden');
    this.name = 'TeamProjectServiceError';
  }
}

type ActiveTeamMembership = {
  organizationInternalId: number;
  organizationExternalId: string;
  organizationName?: string;
  organizationStatus: string;
  teamProjectsEnabled: boolean;
  actorUserId: number;
  actorExternalId: string;
  organizationRole: string;
  organizationMemberStatus: string;
};

function hidden(): never {
  throw new TeamProjectServiceError('NOT_FOUND');
}

function isOrganizationRole(role: string): role is OrganizationRole {
  return role === 'owner' || role === 'admin' || role === 'manager' || role === 'member';
}

function validateMembership(
  row: ActiveTeamMembership | undefined,
  actorExternalId: string,
  organizationExternalId: string,
): ActiveTeamMembership {
  if (
    !row ||
    row.organizationExternalId !== organizationExternalId ||
    row.organizationStatus !== 'active' ||
    row.teamProjectsEnabled !== true ||
    row.actorExternalId !== actorExternalId ||
    row.organizationMemberStatus !== 'active' ||
    !isOrganizationRole(row.organizationRole)
  ) {
    return hidden();
  }
  return row;
}

function buildTeamProjectListQuery(
  db: Pick<DB, 'select'>,
  actorExternalId: string,
  organizationExternalId: string,
) {
  return db
    .select({
      externalId: projects.externalId,
      name: projects.name,
      description: projects.description,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      organizationId: organizations.externalId,
      organizationName: organizations.name,
      memberRole: projectMembers.role,
      taskCount: sql<number>`COUNT(${tasks.id})`.as('task_count'),
    })
    .from(projects)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, projects.organizationId),
        eq(organizations.externalId, organizationExternalId),
        eq(organizations.status, 'active'),
        eq(organizations.teamProjectsEnabled, true),
      ),
    )
    .innerJoin(users, eq(users.externalId, actorExternalId))
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.organizationId, organizations.id),
        eq(organizationMembers.userId, users.id),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.userId, users.id),
        eq(projectMembers.status, 'active'),
      ),
    )
    .leftJoin(tasks, eq(tasks.projectId, projects.id))
    .where(eq(projects.organizationId, organizations.id))
    .groupBy(
      projects.id,
      projects.externalId,
      projects.name,
      projects.description,
      projects.createdAt,
      projects.updatedAt,
      organizations.externalId,
      organizations.name,
      projectMembers.role,
    )
    .orderBy(desc(projects.updatedAt));
}

function buildActiveTeamOrganizationMembershipQuery(
  db: Pick<DB, 'select'>,
  actorExternalId: string,
  organizationExternalId: string,
) {
  return db
    .select({
      organizationInternalId: organizations.id,
      organizationExternalId: organizations.externalId,
      organizationStatus: organizations.status,
      teamProjectsEnabled: organizations.teamProjectsEnabled,
      actorUserId: users.id,
      actorExternalId: users.externalId,
      organizationRole: organizationMembers.role,
      organizationMemberStatus: organizationMembers.status,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, organizationMembers.organizationId),
        eq(organizations.externalId, organizationExternalId),
        eq(organizations.status, 'active'),
        eq(organizations.teamProjectsEnabled, true),
      ),
    )
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(users.externalId, actorExternalId), eq(organizationMembers.status, 'active')))
    .limit(1);
}

function buildTeamProjectCreatorQuery(
  db: Pick<DB, 'select'>,
  actorExternalId: string,
  organizationExternalId: string,
) {
  return db
    .select({
      organizationInternalId: organizations.id,
      organizationExternalId: organizations.externalId,
      organizationName: organizations.name,
      organizationStatus: organizations.status,
      teamProjectsEnabled: organizations.teamProjectsEnabled,
      actorUserId: users.id,
      actorExternalId: users.externalId,
      organizationRole: organizationMembers.role,
      organizationMemberStatus: organizationMembers.status,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, organizationMembers.organizationId),
        eq(organizations.externalId, organizationExternalId),
        eq(organizations.status, 'active'),
        eq(organizations.teamProjectsEnabled, true),
      ),
    )
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(users.externalId, actorExternalId), eq(organizationMembers.status, 'active')))
    .for('update')
    .limit(1);
}

function buildLockedTeamOrganizationQuery(db: Pick<DB, 'select'>, organizationExternalId: string) {
  return db
    .select({
      organizationInternalId: organizations.id,
      organizationExternalId: organizations.externalId,
      organizationStatus: organizations.status,
      teamProjectsEnabled: organizations.teamProjectsEnabled,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.externalId, organizationExternalId),
        eq(organizations.status, 'active'),
        eq(organizations.teamProjectsEnabled, true),
      ),
    )
    .for('update')
    .limit(1);
}

function buildProjectDetailQuery(
  db: Pick<DB, 'select'>,
  projectId: number,
  projectExternalId: string,
) {
  return db
    .select({
      externalId: projects.externalId,
      name: projects.name,
      description: projects.description,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      taskCount: sql<number>`COUNT(${tasks.id})`.as('task_count'),
    })
    .from(projects)
    .leftJoin(tasks, eq(tasks.projectId, projects.id))
    .where(and(eq(projects.id, projectId), eq(projects.externalId, projectExternalId)))
    .groupBy(
      projects.id,
      projects.externalId,
      projects.name,
      projects.description,
      projects.createdAt,
      projects.updatedAt,
    )
    .limit(1);
}

function buildActiveProjectMembersQuery(db: Pick<DB, 'select'>, projectId: number) {
  return db
    .select({
      projectMemberId: projectMembers.externalId,
      organizationMemberId: organizationMembers.externalId,
      userId: users.externalId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.organizationId, projects.organizationId),
        eq(organizationMembers.userId, projectMembers.userId),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.status, 'active')))
    .orderBy(asc(projectMembers.createdAt));
}

function buildTeamProjectCreatorMembershipInsert(
  db: Pick<DB, 'insert'>,
  input: { externalId: string; projectId: number; userId: number },
) {
  return db.insert(projectMembers).values({
    externalId: input.externalId,
    projectId: input.projectId,
    userId: input.userId,
    role: 'lead',
    status: 'active',
  });
}

function buildTeamProjectInsert(
  db: Pick<DB, 'insert'>,
  input: {
    externalId: string;
    userId: number;
    organizationId: number;
    name: string;
    description: string | null;
  },
) {
  return db.insert(projects).values(input);
}

export async function listTeamProjects(input: {
  db: DB;
  actorExternalId: string;
  organizationExternalId: string;
}) {
  return input.db.transaction(async (tx) => {
    const [membership] = (await buildActiveTeamOrganizationMembershipQuery(
      tx,
      input.actorExternalId,
      input.organizationExternalId,
    )) as ActiveTeamMembership[];
    validateMembership(membership, input.actorExternalId, input.organizationExternalId);
    const rows = await buildTeamProjectListQuery(
      tx,
      input.actorExternalId,
      input.organizationExternalId,
    );
    return rows.map((project) => ({
      projectId: project.externalId,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      taskCount: Number(project.taskCount),
      scope: 'organization' as const,
      organizationId: project.organizationId,
      organizationName: project.organizationName,
      memberRole: project.memberRole,
    }));
  }, CONSISTENT_READ_TRANSACTION);
}

export async function createTeamProject(input: {
  db: DB;
  actorExternalId: string;
  organizationExternalId: string;
  name: string;
  description: string | null;
}) {
  const projectExternalId = newExternalId('project');
  const creatorMembershipExternalId = newExternalId('projectMember');
  return input.db.transaction(async (tx) => {
    const [lockedOrganization] = await buildLockedTeamOrganizationQuery(
      tx,
      input.organizationExternalId,
    );
    if (
      !lockedOrganization ||
      lockedOrganization.organizationExternalId !== input.organizationExternalId ||
      lockedOrganization.organizationStatus !== 'active' ||
      lockedOrganization.teamProjectsEnabled !== true
    ) {
      return hidden();
    }
    const [row] = (await buildTeamProjectCreatorQuery(
      tx,
      input.actorExternalId,
      input.organizationExternalId,
    )) as ActiveTeamMembership[];
    const actor = validateMembership(row, input.actorExternalId, input.organizationExternalId);
    if (actor.organizationInternalId !== lockedOrganization.organizationInternalId) return hidden();
    const permission = canCreateTeamProject({
      organizationId: actor.organizationExternalId,
      userId: String(actor.actorUserId),
      role: actor.organizationRole as OrganizationRole,
      status: actor.organizationMemberStatus,
    });
    if (!permission.allowed) throw new TeamProjectServiceError('FORBIDDEN');

    const insertedProject = await buildTeamProjectInsert(tx, {
      externalId: projectExternalId,
      userId: actor.actorUserId,
      organizationId: actor.organizationInternalId,
      name: input.name,
      description: input.description,
    });
    if (readAffectedRows(insertedProject) !== 1) return hidden();
    const projectId = readInsertId(insertedProject);
    const insertedMembership = await buildTeamProjectCreatorMembershipInsert(tx, {
      externalId: creatorMembershipExternalId,
      projectId,
      userId: actor.actorUserId,
    });
    if (readAffectedRows(insertedMembership) !== 1) return hidden();
    readInsertId(insertedMembership);

    return {
      projectId: projectExternalId,
      name: input.name,
      scope: 'organization' as const,
      organizationId: actor.organizationExternalId,
      organizationName: actor.organizationName ?? hidden(),
      memberRole: 'lead' as const,
    };
  });
}

export async function getTeamProjectWithAccess(db: DB, input: ProjectAccessInput) {
  return db.transaction(async (tx) => {
    const access = await requireReadableProject(tx, input);
    if (access.scope !== 'organization') return hidden();
    const [project] = await buildProjectDetailQuery(tx, access.projectId, input.projectExternalId);
    if (!project || project.externalId !== input.projectExternalId) return hidden();
    return {
      ...project,
      taskCount: Number(project.taskCount),
      scope: access.scope,
      organizationId: access.organizationExternalId,
      organizationName: access.organizationName,
      memberRole: access.projectRole,
    };
  }, CONSISTENT_READ_TRANSACTION);
}

export async function listProjectMembersWithAccess(db: DB, input: ProjectAccessInput) {
  return db.transaction(async (tx) => {
    const access = await requireReadableProject(tx, input);
    if (access.scope !== 'organization') return hidden();
    return buildActiveProjectMembersQuery(tx, access.projectId);
  }, CONSISTENT_READ_TRANSACTION);
}

export const __teamProjectServiceInternals = {
  buildActiveProjectMembersQuery,
  buildActiveTeamOrganizationMembershipQuery,
  buildProjectDetailQuery,
  buildLockedTeamOrganizationQuery,
  buildTeamProjectCreatorMembershipInsert,
  buildTeamProjectCreatorQuery,
  buildTeamProjectInsert,
  buildTeamProjectListQuery,
  CONSISTENT_READ_TRANSACTION,
};
