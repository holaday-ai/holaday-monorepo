import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { defaultBrowserNetworkPolicy } from '../../agent/browser-network-policy.js';
import { hasParkedSupercarHandle, supercarReply } from '../../agent/supercar/agent-loop.js';
import { browserControlSessions } from '../../agent/supercar/browser-control-sessions.js';
import { BrowserInputOutcomeUnknownError } from '../../agent/supercar/browser-control.js';
import { localChromeTaskSessions } from '../../agent/supercar/local-chrome-task-session.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import type { Context } from '../context.js';
import { protectedProcedure } from '../trpc.js';

const taskInput = z.object({ taskId: z.string().min(1) });
const terminal = new Set(['completed', 'failed', 'cancelled', 'timeout']);

async function ownedBrowser(ctx: Context & { userId: string }, taskId: string) {
  const [row] = await ctx.db
    .select({ status: tasks.status, userExternalId: users.externalId, userId: users.id })
    .from(tasks)
    .innerJoin(users, eq(tasks.userId, users.id))
    .where(
      and(eq(tasks.externalId, taskId), eq(users.externalId, ctx.userId), eq(tasks.origin, 'user')),
    )
    .limit(1);
  if (!row || row.userExternalId !== ctx.userId) throw new TRPCError({ code: 'NOT_FOUND' });
  const instance = ctx.browserPool?.peek(taskId);
  if (
    !instance ||
    instance.userId !== ctx.userId ||
    instance.taskId !== taskId ||
    instance.status !== 'ready'
  ) {
    return { instance: null, terminal: terminal.has(row.status), userId: row.userId };
  }
  return { instance, terminal: terminal.has(row.status), userId: row.userId };
}

export const browserControlStateProcedure = protectedProcedure
  .input(taskInput)
  .query(async ({ ctx, input }) => {
    const owned = await ownedBrowser(ctx, input.taskId);
    const local = localChromeTaskSessions.get(ctx.userId, input.taskId);
    if (local)
      return {
        taskId: input.taskId,
        supported: true,
        mode: 'running' as const,
        ...local.control.snapshot(),
      };
    const session =
      owned.instance && browserControlSessions.get(owned.instance, ctx.userId, input.taskId);
    return {
      taskId: input.taskId,
      supported: Boolean(owned.instance && (session || owned.terminal)),
      mode: owned.terminal && !session?.active ? ('review' as const) : ('running' as const),
      phase: session?.control.snapshot().phase ?? ('closed' as const),
      lease: session?.control.snapshot().lease ?? null,
      error: session
        ? session.control.snapshot().error
        : owned.instance && owned.terminal
          ? null
          : owned.instance
            ? 'runner_unavailable'
            : 'session_unavailable',
    };
  });

export const browserControlProcedure = protectedProcedure
  .input(
    taskInput.extend({
      action: z.enum(['takeover', 'return']),
      controlLease: z.string().optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const owned = await ownedBrowser(ctx, input.taskId);
    const local = localChromeTaskSessions.get(ctx.userId, input.taskId);
    if (local) {
      try {
        if (input.action === 'takeover') local.control.requestHuman();
        else local.control.returnToAgent(input.controlLease ?? '');
      } catch {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'browser_control_not_owned' });
      }
      return {
        taskId: input.taskId,
        supported: true,
        mode: 'running' as const,
        ...local.control.snapshot(),
      };
    }
    if (!owned.instance)
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'browser_session_unavailable' });
    let session = browserControlSessions.get(owned.instance, ctx.userId, input.taskId);
    if (input.action === 'takeover' && owned.terminal && !session?.active) {
      session = browserControlSessions.review(owned.instance);
    }
    if (!session)
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'browser_runner_unavailable' });
    if (input.action === 'takeover') session.control.requestHuman();
    else {
      const state = session.control.snapshot();
      if (!input.controlLease || state.lease !== input.controlLease)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'browser_control_not_owned' });
      if (hasParkedSupercarHandle(input.taskId)) {
        const resumed = await new TaskRepository(ctx.db, ctx.taskOrigin).markAwaitingReplyResumed(
          input.taskId,
          owned.userId,
        );
        if (!resumed.persisted)
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'browser_resume_not_persisted',
          });
        // It is a handback instruction, never affirmative permission to replay
        // the pre-handoff sensitive action. The waiting loop discards that action.
        supercarReply(input.taskId, '浏览器已交还，请根据当前页面重新规划并继续。');
      }
      session.control.returnToAgent(input.controlLease);
    }
    return {
      taskId: input.taskId,
      supported: true,
      mode: session.active ? ('running' as const) : ('review' as const),
      ...session.control.snapshot(),
    };
  });

export const browserNavProcedure = protectedProcedure
  .input(
    z.object({
      taskId: z.string().optional(),
      direction: z.enum(['back', 'forward', 'reload', 'goto']),
      url: z.string().max(2048).optional(),
      controlLease: z.string().optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    if (!input.taskId) return { ok: false as const, reason: 'task_required' };
    const owned = await ownedBrowser(ctx, input.taskId);
    const instance = owned.instance;
    if (!instance) return { ok: false as const, reason: 'no_executor' };
    const session = browserControlSessions.get(instance, ctx.userId, input.taskId);
    if (!session) return { ok: false as const, reason: 'browser_control_not_owned' };
    try {
      return await session.control.runHuman(input.controlLease ?? '', async (signal) => {
        const page = await instance.executor.getPage();
        const options = { timeout: 15_000, waitUntil: 'domcontentloaded' as const };
        let target = input.url?.trim() ?? '';
        if (input.direction === 'goto') {
          if (!target) return { ok: false as const, reason: 'missing_url' };
          if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) target = `https://${target}`;
          if (!/^https?:\/\//i.test(target)) return { ok: false as const, reason: 'bad_scheme' };
          if (!(await defaultBrowserNetworkPolicy.check(target)).allowed)
            return { ok: false as const, reason: 'blocked_target' };
        }
        signal.throwIfAborted();
        if (ctx.browserPool?.peek(input.taskId ?? '') !== instance || instance.status !== 'ready')
          throw new Error('browser_session_changed');
        try {
          if (input.direction === 'back') {
            if (!(await page.goBack(options))) return { ok: false as const, reason: 'no_history' };
          } else if (input.direction === 'forward') {
            if (!(await page.goForward(options)))
              return { ok: false as const, reason: 'no_history' };
          } else if (input.direction === 'goto') await page.goto(target, options);
          else await page.reload(options);
          return { ok: true as const };
        } catch {
          // A navigation timeout does not establish whether the page changed.
          void browserControlSessions
            .quarantine(
              instance,
              () =>
                ctx.browserPool?.release(instance.taskId, 'browser-navigation-unknown') ??
                Promise.resolve(false),
            )
            .catch((error: unknown) =>
              ctx.logger.warn({ error, taskId: instance.taskId }, 'browser stop unconfirmed'),
            );
          throw new BrowserInputOutcomeUnknownError();
        }
      });
    } catch (error) {
      return { ok: false as const, reason: error instanceof Error ? error.message : 'nav_failed' };
    }
  });
