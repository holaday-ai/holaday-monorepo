import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { SkillCatalogueEntry } from '../../agent/planner.js';
import { TaskController } from '../../agent/task-controller.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { skills } from '../../db/schema/skills.js';
import { users } from '../../db/schema/users.js';
import { broadcastToUser, updateTaskStateForUser } from '../../ws/server.js';
import { protectedProcedure, router } from '../trpc.js';

const taskController = new TaskController();

const taskIdInput = z.object({ taskId: z.string().min(1) });

const createInput = z.object({
  intent: z.string().min(1).max(4_000),
  occupation: z.string().optional(),
});

export const tasksRouter = router({
  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const [userRow] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!userRow) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }

    const catalogue = await loadSkillCatalogue(ctx.db, input.occupation ?? null);

    const plan = await ctx.planner.plan({
      intent: input.intent,
      userId: ctx.userId,
      occupation: input.occupation ?? null,
      skills: catalogue,
    });
    if (plan.length === 0) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'planner returned empty plan',
      });
    }

    const taskId = newExternalId('task');
    const { state } = taskController.start({
      state: {
        taskId,
        status: 'planning',
        plan,
        cursor: 0,
        pendingConfirm: null,
      },
    });

    const repo = new TaskRepository(ctx.db);
    await repo.insertTask(state, { userId: userRow.id, intent: input.intent });

    return {
      taskId: state.taskId,
      status: state.status,
      steps: state.plan.map((s) => ({
        id: s.id,
        kind: s.kind,
        risk: s.risk,
        requiresConfirm: s.requiresConfirm ?? false,
      })),
    };
  }),

  pause: protectedProcedure.input(taskIdInput).mutation(async ({ ctx, input }) => {
    const repo = new TaskRepository(ctx.db);
    const prev = await loadTaskState(repo, input.taskId, ctx.userId);

    const { state: next, effects } = taskController.pause(prev, 'user');
    if (next === prev) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `cannot pause from status=${prev.status}`,
      });
    }

    await repo.applyControlTransition(prev, next);
    updateTaskStateForUser(ctx.userId, next);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }
    return { taskId: next.taskId, status: next.status, pauseReason: next.pauseReason ?? null };
  }),

  resume: protectedProcedure.input(taskIdInput).mutation(async ({ ctx, input }) => {
    const repo = new TaskRepository(ctx.db);
    const prev = await loadTaskState(repo, input.taskId, ctx.userId);

    const { state: next, effects } = taskController.resume(prev);
    if (next === prev) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `cannot resume from status=${prev.status}`,
      });
    }

    await repo.applyControlTransition(prev, next);
    updateTaskStateForUser(ctx.userId, next);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }
    return { taskId: next.taskId, status: next.status };
  }),
});

async function loadTaskState(repo: TaskRepository, taskExternalId: string, userExternalId: string) {
  const all = await repo.rehydrateInFlight();
  const hit = all.find(
    (r) => r.state.taskId === taskExternalId && r.userExternalId === userExternalId,
  );
  if (!hit) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `task ${taskExternalId} not in-flight`,
    });
  }
  return hit.state;
}

/**
 * Active skills the user can route to: either untagged (applies to everyone)
 * or tagged with the user's occupation. We return slug + one-line description
 * only — v0.2 §5.5 lazy-load: full SKILL.md is fetched on demand when the
 * commander actually picks a skill.
 */
async function loadSkillCatalogue(
  db: import('../../db/client.js').DB,
  occupation: string | null,
): Promise<SkillCatalogueEntry[]> {
  const occupationMatch = occupation
    ? or(isNull(skills.occupationTag), eq(skills.occupationTag, occupation))
    : isNull(skills.occupationTag);

  const rows = await db
    .select({
      slug: skills.slug,
      description: skills.description,
      occupationTag: skills.occupationTag,
    })
    .from(skills)
    .where(and(eq(skills.status, 'active'), occupationMatch));

  return rows
    .filter((r): r is { slug: string; description: string; occupationTag: string | null } =>
      Boolean(r.description),
    )
    .map((r) => ({
      slug: r.slug,
      description: r.description,
      occupationTag: r.occupationTag,
    }));
}
