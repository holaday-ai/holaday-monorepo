/**
 * Phase 16 — projects router. CRUD for the user-owned project
 * grouping. Tasks are linked via tasks.project_id (managed by the
 * tasks.moveToProject mutation, not here).
 */

import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.js';
import { projects } from '../../db/schema/projects.js';
import { tasks as tasksTable } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { PROJECT_ROLES } from '../../organizations/organization-permissions.js';
import { isTeamProjectsEnabledFor } from '../../organizations/team-project-access.js';
import {
  ProjectAccessError,
  addProjectMemberWithAccess,
  deleteProjectWithAccess,
  removeProjectMemberWithAccess,
  renameProjectWithAccess,
  requireReadableProject,
} from '../../projects/project-access.js';
import {
  TeamProjectServiceError,
  __teamProjectServiceInternals,
  createTeamProject,
  getTeamProjectWithAccess,
  listProjectMembersWithAccess,
  listTeamProjects,
} from '../../projects/team-project-service.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * Resolve the caller's internal user.id from the external usr_… id
 * stamped on the auth context. Throws UNAUTHORIZED rather than
 * silently returning [] so a stale token surfaces immediately.
 */
async function requireUserId(ctx: {
  db: typeof import('../../db/client.js').db;
  userId: string;
}): Promise<number> {
  const [row] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  }
  return row.id;
}

function mapProjectAccessError(error: unknown): never {
  if (error instanceof ProjectAccessError) {
    throw new TRPCError({
      code: error.code,
      message:
        error.code === 'NOT_FOUND'
          ? 'project not found'
          : error.code === 'CONFLICT'
            ? error.reason === 'SOLE_PROJECT_LEAD'
              ? 'project must retain an active lead'
              : 'project member already exists'
            : 'project action forbidden',
    });
  }
  throw error;
}

async function callProjectAccess<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return mapProjectAccessError(error);
  }
}

async function callTeamProjectService<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TeamProjectServiceError) {
      throw new TRPCError({
        code: error.code,
        message: error.code === 'NOT_FOUND' ? 'organization not found' : 'project action forbidden',
      });
    }
    throw error;
  }
}

async function requirePersonalOrEnabledMutation(
  db: DB,
  actorExternalId: string,
  projectExternalId: string,
): Promise<void> {
  if (isTeamProjectsEnabledFor(actorExternalId)) return;
  const access = await callProjectAccess(() =>
    requireReadableProject(db, { actorExternalId, projectExternalId }),
  );
  if (access.scope === 'organization') {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'project not found' });
  }
}

function buildPersonalProjectListQuery(db: Pick<DB, 'select'>, userId: number) {
  return db
    .select({
      id: projects.id,
      externalId: projects.externalId,
      name: projects.name,
      description: projects.description,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.organizationId)))
    .orderBy(desc(projects.updatedAt));
}

export const projectsRouter = router({
  /**
   * List the caller's projects, most-recently-updated first, with a
   * task count per project for the sidebar `(N)` badge.
   */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }).optional())
    .query(async ({ ctx, input }) => {
      if (input?.organizationId) {
        if (!isTeamProjectsEnabledFor(ctx.userId)) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'organization not found' });
        }
        return callTeamProjectService(() =>
          listTeamProjects({
            db: ctx.db,
            actorExternalId: ctx.userId,
            organizationExternalId: input.organizationId,
          }),
        );
      }

      const userId = await requireUserId(ctx);
      const rows = await buildPersonalProjectListQuery(ctx.db, userId);
      if (rows.length === 0) return [];
      // Count tasks per project. One round-trip — group + filter to
      // the caller's projects only. Projects with zero tasks return
      // count = 0 via the join in the map below.
      const counts = await ctx.db
        .select({
          projectId: tasksTable.projectId,
          n: sql<number>`COUNT(*)`.as('n'),
        })
        .from(tasksTable)
        .where(eq(tasksTable.userId, userId))
        .groupBy(tasksTable.projectId);
      const countByProjectId = new Map<number, number>();
      for (const r of counts) {
        if (r.projectId != null) countByProjectId.set(r.projectId, Number(r.n));
      }
      return rows.map((p) => ({
        projectId: p.externalId,
        name: p.name,
        description: p.description,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        taskCount: countByProjectId.get(p.id) ?? 0,
      }));
    }),

  get: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      if (!isTeamProjectsEnabledFor(ctx.userId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'project not found' });
      }
      const project = await callTeamProjectService(() =>
        callProjectAccess(() =>
          getTeamProjectWithAccess(ctx.db, {
            actorExternalId: ctx.userId,
            projectExternalId: input.projectId,
          }),
        ),
      );
      return {
        projectId: project.externalId,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        taskCount: project.taskCount,
        scope: project.scope,
        organizationId: project.organizationId,
        organizationName: project.organizationName,
        memberRole: project.memberRole,
      };
    }),

  members: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      if (!isTeamProjectsEnabledFor(ctx.userId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'project not found' });
      }
      const members = await callTeamProjectService(() =>
        callProjectAccess(() =>
          listProjectMembersWithAccess(ctx.db, {
            actorExternalId: ctx.userId,
            projectExternalId: input.projectId,
          }),
        ),
      );
      return members.map((member) => ({
        projectMemberId: member.projectMemberId,
        organizationMemberId: member.organizationMemberId,
        userId: member.userId,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        role: member.role,
      }));
    }),

  addMember: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        organizationMemberId: z.string().min(1),
        role: z.enum(PROJECT_ROLES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isTeamProjectsEnabledFor(ctx.userId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'project not found' });
      }
      const member = await callProjectAccess(() =>
        addProjectMemberWithAccess(
          ctx.db,
          { actorExternalId: ctx.userId, projectExternalId: input.projectId },
          input.organizationMemberId,
          input.role,
        ),
      );
      return {
        projectMemberId: member.projectMemberId,
        userId: member.userId,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        role: member.role,
      };
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        projectMemberId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isTeamProjectsEnabledFor(ctx.userId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'project not found' });
      }
      const removed = await callProjectAccess(() =>
        removeProjectMemberWithAccess(
          ctx.db,
          { actorExternalId: ctx.userId, projectExternalId: input.projectId },
          input.projectMemberId,
        ),
      );
      return {
        ok: true as const,
        projectId: input.projectId,
        projectMemberId: removed.projectMemberId,
        status: removed.status,
      };
    }),

  /** Create a new project. Returns the external id for SPA routing. */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        description: z.string().max(500).optional(),
        organizationId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.organizationId) {
        if (!isTeamProjectsEnabledFor(ctx.userId)) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'organization not found' });
        }
        return callTeamProjectService(() =>
          createTeamProject({
            db: ctx.db,
            actorExternalId: ctx.userId,
            organizationExternalId: input.organizationId as string,
            name: input.name,
            description: input.description ?? null,
          }),
        );
      }
      const userId = await requireUserId(ctx);
      const externalId = newExternalId('project');
      await ctx.db.insert(projects).values({
        externalId,
        userId,
        name: input.name,
        description: input.description ?? null,
      });
      return { projectId: externalId, name: input.name };
    }),

  /** Rename a project. Empty name rejected — projects always have a label. */
  rename: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().trim().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePersonalOrEnabledMutation(ctx.db, ctx.userId, input.projectId);
      await callProjectAccess(() =>
        renameProjectWithAccess(
          ctx.db,
          { actorExternalId: ctx.userId, projectExternalId: input.projectId },
          { name: input.name },
        ),
      );
      return { ok: true as const, projectId: input.projectId, name: input.name };
    }),

  /**
   * Delete a project. Tasks linked to it have project_id set NULL by
   * the FK (ON DELETE SET NULL) so the user's history is preserved
   * even after deletion.
   */
  delete: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requirePersonalOrEnabledMutation(ctx.db, ctx.userId, input.projectId);
      await callProjectAccess(() =>
        deleteProjectWithAccess(ctx.db, {
          actorExternalId: ctx.userId,
          projectExternalId: input.projectId,
        }),
      );
      return { ok: true as const, projectId: input.projectId };
    }),
});

export const __projectsRouterInternals = {
  ...__teamProjectServiceInternals,
  buildPersonalProjectListQuery,
};
