/**
 * BROWSER-HOME-1 — the「云浏览器」entry's server side: one task-less cloud browser per user.
 *
 * open()  → create or reuse `bhs_<userId>`; returns { sessionId, url } (url null = blank page).
 *           With { viewerId } the page is counted as one of the user's open pages.
 * nav()   → back / forward / reload / goto (an address or search words) as the person's input.
 *           A page that does not load is an error message; the browser is kept.
 * close() → with { viewerId }: that page left; the browser is released only when no other page
 *           of the user uses it, after a short grace that a new open() cancels. Without: release
 *           it now (the last address is remembered for the next open). While one of the
 *           user's tasks holds it (tasks.create browserHomeSession), the session ends and the
 *           task's normal release applies when it finishes.
 *
 * A task sent from the page runs in this same browser (step 4): the pool lends it to the task and
 * takes it back on every terminal state; open / nav / the stream follow it meanwhile.
 *
 * Behind BROWSER_HOME_ENABLED + BROWSER_HOME_ALLOWLIST: off, every endpoint refuses (FORBIDDEN).
 * The screen streams through /screencast-ws/bhs_<userId> (streaming/screencast-proxy.ts).
 */

import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { isBrowserHomeEnabledFor } from '../../browser-home/browser-home-access.js';
import {
  type BrowserHomeRegion,
  resolveBrowserHomeAddress,
} from '../../browser-home/browser-home-address.js';
import { navigateBrowserHome } from '../../browser-home/browser-home-nav.js';
import { browserHomeSessions } from '../../browser-home/browser-home-session.js';
import { PoolCapacityError } from '../../browser-pool/browser-pool.js';
import { getVaultRuntime } from '../../browser-session-vault/runtime.js';
import { instanceBrowserCapabilities } from '../../config/browser-capabilities.js';
import { env as appEnv } from '../../config/env.js';
import { users } from '../../db/schema/users.js';
import type { Context } from '../context.js';
import { protectedProcedure, router } from '../trpc.js';

const browserHomeProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isBrowserHomeEnabledFor(ctx.userId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '云浏览器暂未开放' });
  }
  return next({ ctx });
});

function requirePool(ctx: Context) {
  if (!ctx.browserPool) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '云浏览器暂时不可用' });
  }
  return ctx.browserPool;
}

async function regionFor(ctx: Context & { userId: string }): Promise<BrowserHomeRegion> {
  const [row] = await ctx.db
    .select({ modelDataRegion: users.modelDataRegion })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  const region = row?.modelDataRegion;
  return region === 'cn' || region === 'intl' ? region : appEnv.MODEL_DATA_REGION_DEFAULT;
}

/** P2-4: the /browser page instance (one id per mount) — see BrowserHomeSessions.leave. */
const viewerInput = z.object({ viewerId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) }).optional();
const openInput = z
  .object({
    viewerId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .optional(),
    profileId: z.string().uuid().optional(),
  })
  .strict()
  .optional();
function homeProfiles() {
  const runtime = getVaultRuntime();
  return appEnv.BROWSER_HOME_PROFILE_V1 && runtime?.cloudHomeEnabled ? runtime : null;
}

export const browserHomeRouter = router({
  profileOptions: browserHomeProcedure.query(async ({ ctx }) => {
    const runtime = homeProfiles();
    if (!runtime) return { enabled: false, profiles: [] };
    const grants = await runtime.vault.list(ctx.userId);
    return {
      enabled: true,
      profiles: grants
        .filter((g) => g.sessionAccess === 'cloud-home-v1')
        .map((g) => ({
          id: g.id,
          origin: g.origin,
          status: g.status,
          expiresAt: g.expiresAt,
        })),
    };
  }),
  open: browserHomeProcedure.input(openInput).mutation(async ({ ctx, input }) => {
    const pool = requirePool(ctx);
    let profile: { id: string; origin: string } | undefined;
    if (input?.profileId) {
      const runtime = homeProfiles();
      if (!runtime)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '保存的云端状态暂不可用。' });
      const grant = (await runtime.vault.list(ctx.userId)).find(
        (g) =>
          g.id === input.profileId &&
          g.sessionAccess === 'cloud-home-v1' &&
          g.status === 'connected',
      );
      if (!grant)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '保存的站点状态已失效或不属于当前账号。',
        });
      profile = { id: grant.id, origin: grant.origin };
    }
    try {
      const opened = await browserHomeSessions.open(
        pool,
        ctx.userId,
        ctx.logger,
        input?.viewerId,
        profile,
      );
      const location = browserHomeSessions.locate(pool, ctx.userId);
      if (!location) throw new Error('Browser is not ready for reuse');
      return { ...opened, capabilities: instanceBrowserCapabilities(location.instance) };
    } catch (error) {
      if (error instanceof Error && error.message === 'home_profile_switch_required')
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '当前个人浏览器仍在使用，请先结束当前会话再切换保存状态。',
        });
      if (error instanceof PoolCapacityError) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: '云浏览器暂时都在忙，请稍后再试',
        });
      }
      if (
        error instanceof Error &&
        /release is not complete|not ready for reuse|POOL_PROCESS_CLEANUP_PENDING/.test(
          error.message,
        )
      ) {
        throw new TRPCError({ code: 'CONFLICT', message: '云浏览器正在释放，请稍后重试' });
      }
      ctx.logger.warn(
        { userId: ctx.userId, err: error instanceof Error ? error.message : String(error) },
        'browser-home: open failed',
      );
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '云浏览器打开失败，请稍后重试',
      });
    }
  }),

  nav: browserHomeProcedure
    .input(
      z.object({
        direction: z.enum(['back', 'forward', 'reload', 'goto']),
        input: z.string().max(2048).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const pool = requirePool(ctx);
      const location = browserHomeSessions.locate(pool, ctx.userId);
      if (!location) return { ok: false as const, reason: 'no_session' };
      const { instance } = location;
      pool.touch(instance.taskId);
      let url: string | undefined;
      if (input.direction === 'goto') {
        const address = resolveBrowserHomeAddress(input.input ?? '', await regionFor(ctx));
        if (!address) return { ok: false as const, reason: 'missing_url' };
        url = address.url;
      }
      const result = await navigateBrowserHome({
        pool,
        instance,
        // In the session: the person's own review control. Held by their task: the task's control
        // (the assistant yields to the person, as for any input on the screen).
        reviewAllowed: location.heldBy === null,
        direction: input.direction,
        url,
      });
      if (!result.ok) return result;
      let current: string | null = null;
      try {
        current = (await instance.executor.getPage()).url();
      } catch {
        current = null;
      }
      browserHomeSessions.rememberUrl(ctx.userId, current);
      return { ok: true as const, url: current };
    }),

  close: browserHomeProcedure.input(viewerInput).mutation(async ({ ctx, input }) => {
    const pool = requirePool(ctx);
    // A page leaving: released only when it was the last one, after the close grace.
    if (input?.viewerId) {
      browserHomeSessions.leave(pool, ctx.userId, input.viewerId);
      return { released: false };
    }
    return { released: await browserHomeSessions.close(pool, ctx.userId) };
  }),
});
