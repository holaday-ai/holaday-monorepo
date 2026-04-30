/**
 * Phase 16 — projects router. CRUD for the user-owned project
 * grouping. Tasks are linked via tasks.project_id (managed by the
 * tasks.moveToProject mutation, not here).
 */

import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { projects } from '../../db/schema/projects.js';
import { tasks as tasksTable } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * Resolve the caller's internal user.id from the external usr_… id
 * stamped on the auth context. Throws UNAUTHORIZED rather than
 * silently returning [] so a stale token surfaces immediately.
 */
async function requireUserId(
  ctx: { db: typeof import('../../db/client.js').db; userId: string },
): Promise<number> {
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

export const projectsRouter = router({
  /**
   * List the caller's projects, most-recently-updated first, with a
   * task count per project for the sidebar `(N)` badge.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .select({
        id: projects.id,
        externalId: projects.externalId,
        name: projects.name,
        description: projects.description,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.updatedAt));
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

  /** Create a new project. Returns the external id for SPA routing. */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        description: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
      const userId = await requireUserId(ctx);
      const [row] = await ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.externalId, input.projectId), eq(projects.userId, userId)))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'project not found' });
      }
      await ctx.db
        .update(projects)
        .set({ name: input.name })
        .where(eq(projects.id, row.id));
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
      const userId = await requireUserId(ctx);
      const [row] = await ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.externalId, input.projectId), eq(projects.userId, userId)))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'project not found' });
      }
      await ctx.db.delete(projects).where(eq(projects.id, row.id));
      return { ok: true as const, projectId: input.projectId };
    }),
});
