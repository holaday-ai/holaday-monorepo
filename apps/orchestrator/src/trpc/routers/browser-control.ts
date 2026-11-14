import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  defaultBrowserNetworkPolicy,
  staticBrowserUrlSafetyMessage,
} from '../../agent/browser-network-policy.js';
import { browserControlSessions } from '../../agent/supercar/browser-control-sessions.js';
import { BrowserInputOutcomeUnknownError } from '../../agent/supercar/browser-control.js';
import { captchaHandoffs } from '../../agent/supercar/captcha-handoff.js';
import type { BrowserPool } from '../../browser-pool/browser-pool.js';
import type { BrowserInstance } from '../../browser-pool/types.js';
import { browserProfileStore } from '../../browser-profiles/profile-store.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { isTaskTerminalStatus } from '../../task-status.js';
import type { Context } from '../context.js';
import { protectedProcedure } from '../trpc.js';

const taskInput = z.object({ taskId: z.string().min(1) });
// FIX-61 复审 #2 #2: the same 「已结束」 as everywhere else (the page, checkpointBrowserSession).
// The old local list missed partial_success, so a 部分完成 task's screen was treated as a run with
// no runner: every takeover came back 412 browser_runner_unavailable and the page stayed 仅观察.
const ended = (status: string) => isTaskTerminalStatus(status) || status === 'timeout';

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
    return { instance: null, terminal: ended(row.status), userId: row.userId };
  }
  return { instance, terminal: ended(row.status), userId: row.userId };
}

// REBUILD-4 共同操作: no control state, takeover or handback — the person uses the browser at any
// time (the screencast input and browserNav below); the assistant yields while they are busy.

export type BrowserNavDirection = 'back' | 'forward' | 'reload' | 'goto';
export type BrowserNavResult = { ok: true } | { ok: false; reason: string; message?: string };

/**
 * The person's back / forward / reload / goto on a pool browser they own, run through the
 * browser's control as human input (the assistant yields). Shared by tasks.browserNav and
 * BROWSER-HOME-1's browserHome.nav. `reviewAllowed`: no running task binds this browser, so a
 * fresh review control may be opened. A goto target must pass the browser network policy.
 */
export async function navigateOwnedBrowser(args: {
  pool: Pick<BrowserPool, 'peek' | 'release'> | null | undefined;
  logger: Pick<Logger, 'warn'>;
  instance: BrowserInstance;
  reviewAllowed: boolean;
  direction: BrowserNavDirection;
  url?: string;
}): Promise<BrowserNavResult> {
  const { pool, instance } = args;
  // A finished task's browser: the person just uses it (an open review control, no lease).
  const session =
    browserControlSessions.openForViewer(instance) ??
    (args.reviewAllowed ? browserControlSessions.review(instance) : null);
  if (!session) return { ok: false, reason: 'browser_control_not_owned' };
  try {
    return await session.control.runHuman(async (signal): Promise<BrowserNavResult> => {
      const page = await instance.executor.getPage();
      const options = { timeout: 15_000, waitUntil: 'domcontentloaded' as const };
      let target = args.url?.trim() ?? '';
      if (args.direction === 'goto') {
        if (!target) return { ok: false, reason: 'missing_url' };
        if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) target = `https://${target}`;
        if (!/^https?:\/\//i.test(target))
          return {
            ok: false,
            reason: 'bad_scheme',
            message: staticBrowserUrlSafetyMessage(target) ?? '只能访问 http 或 https 网页。',
          };
        const decision = await defaultBrowserNetworkPolicy.check(target);
        if (!decision.allowed)
          return { ok: false, reason: 'blocked_target', message: decision.message };
      }
      signal.throwIfAborted();
      if (pool?.peek(instance.taskId) !== instance || instance.status !== 'ready')
        throw new Error('browser_session_changed');
      try {
        if (args.direction === 'back') {
          if (!(await page.goBack(options))) return { ok: false, reason: 'no_history' };
        } else if (args.direction === 'forward') {
          if (!(await page.goForward(options))) return { ok: false, reason: 'no_history' };
        } else if (args.direction === 'goto') await page.goto(target, options);
        else await page.reload(options);
        return { ok: true };
      } catch {
        // A navigation timeout does not establish whether the page changed.
        void browserControlSessions
          .quarantine(
            instance,
            () =>
              pool?.release(instance.taskId, 'browser-navigation-unknown') ??
              Promise.resolve(false),
          )
          .catch((error: unknown) =>
            args.logger.warn({ error, taskId: instance.taskId }, 'browser stop unconfirmed'),
          );
        throw new BrowserInputOutcomeUnknownError();
      }
    }, 'navigate');
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'nav_failed' };
  }
}

export const browserNavProcedure = protectedProcedure
  .input(
    z.object({
      taskId: z.string().optional(),
      direction: z.enum(['back', 'forward', 'reload', 'goto']),
      // REBUILD-4: no lease. An old client's extra controlLease key is stripped by zod (accepted).
      url: z.string().max(2048).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    if (!input.taskId) return { ok: false as const, reason: 'task_required' };
    const owned = await ownedBrowser(ctx, input.taskId);
    const instance = owned.instance;
    if (!instance) return { ok: false as const, reason: 'no_executor' };
    return navigateOwnedBrowser({
      pool: ctx.browserPool,
      logger: ctx.logger,
      instance,
      reviewAllowed: owned.terminal,
      direction: input.direction,
      url: input.url,
    });
  });

/**
 * CAPTCHA-REDUCE-1: the user's persistent cloud browser profile (verification
 * clearance). `configured` is false when the store is off; clearing is always
 * safe and only touches the caller's own profile.
 */
export const browserProfileStatusProcedure = protectedProcedure.query(() => ({
  configured: browserProfileStore() !== null,
}));
export const browserProfileClearProcedure = protectedProcedure.mutation(async ({ ctx }) => {
  const store = browserProfileStore();
  if (store) await store.clear(ctx.userId);
  return { ok: true as const, configured: store !== null };
});

export const browserCaptchaProcedure = protectedProcedure
  .input(taskInput.extend({ action: z.enum(['continue', 'cancel', 'status', 'alternate']) }))
  .mutation(async ({ ctx, input }) => {
    const owned = await ownedBrowser(ctx, input.taskId);
    const session =
      owned.instance && browserControlSessions.get(owned.instance, ctx.userId, input.taskId);
    if (!session || !captchaHandoffs.active(input.taskId, ctx.userId, session.control))
      return { ok: false, state: 'inactive' as const };
    const status = () => captchaHandoffs.status(input.taskId, ctx.userId, session.control);
    if (input.action === 'cancel') {
      captchaHandoffs.cancel(input.taskId, ctx.userId, session.control);
      return { ok: true, state: 'cancelled' as const };
    }
    if (input.action === 'status') return { ok: true, state: 'waiting' as const, ...status() };
    if (input.action === 'alternate') {
      // CAPTCHA-REDUCE-1: only offered after repeated failed rounds.
      const ok = captchaHandoffs.alternate(input.taskId, ctx.userId, session.control);
      return { ok, state: ok ? ('alternate' as const) : ('waiting' as const), ...status() };
    }
    const ok = await captchaHandoffs.proceed(input.taskId, ctx.userId, session.control);
    return { ok, state: ok ? ('resuming' as const) : ('waiting' as const), ...status() };
  });
