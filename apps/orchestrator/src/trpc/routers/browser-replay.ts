import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { browserReplayStore } from '../../agent/browser-tools/browser-replay-service.js';
import {
  browserCapabilities,
  instanceBrowserCapabilities,
} from '../../config/browser-capabilities.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import type { Context } from '../context.js';
import { protectedProcedure, router } from '../trpc.js';

async function requireOwner(ctx: Context, taskId: string) {
  const [task] = await ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(users, eq(tasks.userId, users.id))
    .where(and(eq(tasks.externalId, taskId), eq(users.externalId, ctx.userId!)))
    .limit(1);
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: '回放不可用' });
}
const input = z.object({ taskId: z.string().min(1).max(100) });
export const browserReplayRouter = router({
  capabilities: protectedProcedure.input(input.optional()).query(async ({ ctx, input }) => {
    if (!input) return browserCapabilities(ctx.userId);
    await requireOwner(ctx, input.taskId);
    const instance = ctx.browserPool?.peek(input.taskId);
    return instance?.userId === ctx.userId
      ? instanceBrowserCapabilities(instance)
      : browserCapabilities(ctx.userId);
  }),
  read: protectedProcedure
    .input(input.extend({ offset: z.number().int().min(0).max(2000).default(0) }))
    .query(async ({ ctx, input }) => {
      const instance = ctx.browserPool?.peek(input.taskId);
      const capabilities =
        instance?.userId === ctx.userId
          ? instanceBrowserCapabilities(instance)
          : browserCapabilities(ctx.userId);
      if (!capabilities.replayV1) return null;
      await requireOwner(ctx, input.taskId);
      return browserReplayStore.read(ctx.userId, input.taskId, input.offset);
    }),
  remove: protectedProcedure.input(input).mutation(async ({ ctx, input }) => {
    await requireOwner(ctx, input.taskId);
    await browserReplayStore.remove(ctx.userId, input.taskId);
    return { ok: true };
  }),
});
