/**
 * BROWSER-HOME-1 — the「云浏览器」entry's server side: one task-less cloud browser per user.
 *
 * open()  → create or reuse `bhs_<userId>`; returns { sessionId, url } (url null = blank page).
 * nav()   → back / forward / reload / goto (an address or search words) as the person's input.
 * close() → release it (the last address is remembered for the next open).
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
import { browserHomeSessions } from '../../browser-home/browser-home-session.js';
import { PoolCapacityError } from '../../browser-pool/browser-pool.js';
import { env as appEnv } from '../../config/env.js';
import { users } from '../../db/schema/users.js';
import type { Context } from '../context.js';
import { protectedProcedure, router } from '../trpc.js';
import { navigateOwnedBrowser } from './browser-control.js';

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

export const browserHomeRouter = router({
  open: browserHomeProcedure.mutation(async ({ ctx }) => {
    const pool = requirePool(ctx);
    try {
      return await browserHomeSessions.open(pool, ctx.userId, ctx.logger);
    } catch (error) {
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
      const instance = browserHomeSessions.instanceFor(pool, ctx.userId);
      if (!instance) return { ok: false as const, reason: 'no_session' };
      pool.touch(instance.taskId);
      let url: string | undefined;
      if (input.direction === 'goto') {
        const address = resolveBrowserHomeAddress(input.input ?? '', await regionFor(ctx));
        if (!address) return { ok: false as const, reason: 'missing_url' };
        url = address.url;
      }
      const result = await navigateOwnedBrowser({
        pool,
        logger: ctx.logger,
        instance,
        // No task ever runs on this browser (yet): the person's own review control.
        reviewAllowed: true,
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

  close: browserHomeProcedure.mutation(async ({ ctx }) => {
    const pool = requirePool(ctx);
    return { released: await browserHomeSessions.close(pool, ctx.userId) };
  }),
});
