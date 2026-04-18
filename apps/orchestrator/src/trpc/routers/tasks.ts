import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { TaskController } from '../../agent/task-controller.js';
import { protectedProcedure, router } from '../trpc.js';

// Phase 0 scaffold: no persistence yet — the controller returns `persist`
// effects, but we don't yet write them to MySQL. Persistence lands in
// the next commit (tasks/task_steps/task_events).
const taskController = new TaskController();

const createInput = z.object({
  intent: z.string().min(1).max(4_000),
  occupation: z.string().optional(),
});

export const tasksRouter = router({
  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const plan = await ctx.planner.plan({
      intent: input.intent,
      userId: ctx.userId,
      occupation: input.occupation ?? null,
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
});
