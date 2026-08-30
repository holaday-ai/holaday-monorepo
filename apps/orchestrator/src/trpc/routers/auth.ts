import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { isVideoEnabledFor } from '../../agent/video/video-access.js';
import { EmailCodeError, createEmailCodeService } from '../../auth/email-code.js';
import { MfaError, MfaService } from '../../auth/mfa-service.js';
import { AuthError, AuthService } from '../../auth/service.js';
import { users } from '../../db/schema/users.js';
import { isTeamProjectsEnabledFor } from '../../organizations/team-project-access.js';
import { isTeamTaskLifecycleEnabledForUser } from '../../team-work-items/team-task-access.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

const registerInput = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(128).optional(),
});

const loginInput = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

const sendCodeInput = z.object({
  email: z.string().email().max(255),
});

const verifyCodeInput = z.object({
  email: z.string().email().max(255),
  code: z.string().regex(/^\d{6}$/),
});

const resetPasswordInput = z.object({
  email: z.string().email().max(255),
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(8).max(128),
});

const changePasswordWithCodeInput = z.object({
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(8).max(128),
});

const mfaCode = z
  .string()
  .trim()
  .min(6)
  .max(11)
  .regex(/^(?:\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/);

const verifyMfaChallengeInput = z.object({
  mfaToken: z.string().min(1).max(4096),
  code: mfaCode,
});

// Module-scope service so the in-memory code store survives across
// requests. Test suites can instantiate their own via
// createEmailCodeService(fakeSender).
const emailCodeService = createEmailCodeService();

export const authRouter = router({
  /**
   * Lists which login methods this deployment has enabled. Frontend
   * hides Google / email-code buttons when the matching env vars are
   * unset so users don't see a button that always errors.
   */
  loginOptions: publicProcedure.query(() => ({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    emailCode: Boolean(process.env.RESEND_API_KEY) || process.env.NODE_ENV !== 'production',
    // Phase 12 — SMS lane is enabled when the cn-payment / hd-auth
    // gateway URL is configured. The gateway itself decides whether
    // its Aliyun SMS adapter is wired; the SPA can show the tab the
    // moment routing is in place, and a mis-configured gateway
    // surfaces an error in send/verify rather than a missing tab.
    sms: Boolean(process.env.ALIYUN_SMS_URL),
  })),

  register: publicProcedure.input(registerInput).mutation(async ({ ctx, input }) => {
    const svc = new AuthService(ctx.db);
    try {
      return await svc.register(input);
    } catch (err) {
      if (err instanceof AuthError && err.code === 'EMAIL_TAKEN') {
        throw new TRPCError({ code: 'CONFLICT', message: err.message });
      }
      throw maskUnexpectedAuthError(ctx, 'auth.register', err);
    }
  }),

  login: publicProcedure.input(loginInput).mutation(async ({ ctx, input }) => {
    const svc = new AuthService(ctx.db);
    try {
      return await svc.login(input);
    } catch (err) {
      if (err instanceof AuthError && err.code === 'INVALID_CREDENTIALS') {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: err.message });
      }
      throw maskUnexpectedAuthError(ctx, 'auth.login', err);
    }
  }),

  sendCode: publicProcedure.input(sendCodeInput).mutation(async ({ input }) => {
    try {
      const { cooldownMs } = await emailCodeService.sendCode(input.email);
      return { ok: true as const, cooldownMs };
    } catch (err) {
      if (err instanceof EmailCodeError && err.code === 'COOLDOWN') {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: err.message });
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }),

  verifyCode: publicProcedure.input(verifyCodeInput).mutation(async ({ ctx, input }) => {
    try {
      await emailCodeService.verifyCode(input.email, input.code);
    } catch (err) {
      if (err instanceof EmailCodeError) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: err.message });
      }
      throw err;
    }
    const svc = new AuthService(ctx.db);
    try {
      return await svc.loginOrRegisterByEmail(input.email);
    } catch (err) {
      throw maskUnexpectedAuthError(ctx, 'auth.verifyCode', err);
    }
  }),

  // ---------------------------------------------------------------
  // Phase 12 — SMS login (Aliyun SMS via hd-auth.orangebench.tech).
  //
  // Both procedures are pure proxies: Vultr can't reach Aliyun's SMS
  // API directly (rate limit by source IP, signing complexity), so
  // we delegate to the cn-payment gateway which holds the AK/SK and
  // the in-memory code store. The gateway returns either { ok: true }
  // for /send or a verified { token, user } payload for /verify.
  //
  // The gateway URL comes from ALIYUN_SMS_URL — `loginOptions.sms`
  // gates the SPA's phone-login tab on the same env, so a missing
  // URL means the tab is simply hidden rather than throwing here.
  // ---------------------------------------------------------------
  smsSend: publicProcedure
    .input(z.object({ phone: z.string().regex(/^1[3-9]\d{9}$/) }))
    .mutation(async ({ input }) => {
      const url = process.env.ALIYUN_SMS_URL;
      if (!url) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'sms gateway not configured',
        });
      }
      const res = await fetch(`${url}/api/sms/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: input.phone }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        cooldownMs?: number;
        error?: string;
        message?: string;
      };
      if (!res.ok || !body.ok) {
        // Map the gateway's error codes onto TRPC ones the SPA's
        // existing toast handler already understands.
        if (body.error === 'too_frequent') {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: '60 秒内只能发送一次',
          });
        }
        if (body.error === 'invalid_phone') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '手机号格式错误' });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: body.message ?? '短信发送失败',
        });
      }
      return { ok: true as const, cooldownMs: body.cooldownMs ?? 60_000 };
    }),

  smsVerify: publicProcedure
    .input(
      z.object({
        phone: z.string().regex(/^1[3-9]\d{9}$/),
        code: z.string().regex(/^\d{6}$/),
      }),
    )
    .mutation(async ({ input }) => {
      const url = process.env.ALIYUN_SMS_URL;
      if (!url) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'sms gateway not configured',
        });
      }
      const res = await fetch(`${url}/api/sms/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = (await res.json().catch(() => ({}))) as {
        accessToken?: string;
        user?: import('../../auth/service.js').PublicUser;
        mfaRequired?: true;
        mfaToken?: string;
        closureRecoveryRequired?: true;
        recoveryToken?: string;
        closureStatus?: 'pending_grace' | 'processing' | 'needs_attention';
        error?: string;
      };
      if (!res.ok) {
        if (body.error === 'invalid_code') {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '验证码错误' });
        }
        if (body.error === 'expired') {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '验证码已过期' });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: body.error ?? '验证失败',
        });
      }
      if (body.mfaRequired && body.mfaToken && body.user) {
        return { user: body.user, mfaRequired: true as const, mfaToken: body.mfaToken };
      }
      if (body.closureRecoveryRequired && body.recoveryToken && body.closureStatus && body.user) {
        return {
          user: body.user,
          closureRecoveryRequired: true as const,
          recoveryToken: body.recoveryToken,
          closureStatus: body.closureStatus,
        };
      }
      if (!body.accessToken || !body.user) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '网关响应缺少 token',
        });
      }
      return { user: body.user, accessToken: body.accessToken, mfaRequired: false as const };
    }),

  /**
   * Resolve the bearer token to the user's public profile. Powers the
   * sidebar's user card (real email + display name + plan) so we stop
   * hardcoding "Yalei / Free" for everyone.
   */
  /**
   * Forgot-password flow — shares the same verification-code store as
   * email-code login. Verify + replace password + issue a fresh JWT
   * so the user lands logged in. Code is single-use (consumed by
   * verifyCode inside the service).
   */
  resetPassword: publicProcedure.input(resetPasswordInput).mutation(async ({ ctx, input }) => {
    try {
      await emailCodeService.verifyCode(input.email, input.code);
    } catch (err) {
      if (err instanceof EmailCodeError) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: err.message });
      }
      throw err;
    }
    const svc = new AuthService(ctx.db);
    try {
      return await svc.resetPasswordByEmail(input.email, input.password);
    } catch (err) {
      if (err instanceof AuthError && err.code === 'INVALID_CREDENTIALS') {
        throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
      }
      throw maskUnexpectedAuthError(ctx, 'auth.resetPassword', err);
    }
  }),

  sendPasswordChangeCode: protectedProcedure.mutation(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!row) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }
    if (!row.email) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '当前账号尚未绑定邮箱，请先联系支持。',
      });
    }
    try {
      const { cooldownMs } = await emailCodeService.sendCode(row.email, 'password-change');
      return { ok: true as const, cooldownMs };
    } catch (err) {
      if (err instanceof EmailCodeError && err.code === 'COOLDOWN') {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: err.message });
      }
      throw maskUnexpectedAuthError(ctx, 'auth.sendPasswordChangeCode', err);
    }
  }),

  changePasswordWithCode: protectedProcedure
    .input(changePasswordWithCodeInput)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      if (!row.email) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '当前账号尚未绑定邮箱，请先联系支持。',
        });
      }
      try {
        await emailCodeService.verifyCode(row.email, input.code, 'password-change');
      } catch (err) {
        if (err instanceof EmailCodeError) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: err.message });
        }
        throw err;
      }
      try {
        return await new AuthService(ctx.db).changePasswordForUser(ctx.userId, input.password);
      } catch (err) {
        if (err instanceof AuthError && err.code === 'INVALID_CREDENTIALS') {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: err.message });
        }
        throw maskUnexpectedAuthError(ctx, 'auth.changePasswordWithCode', err);
      }
    }),

  verifyMfaChallenge: publicProcedure
    .input(verifyMfaChallengeInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await new MfaService(ctx.db).verifyChallenge(input.mfaToken, input.code);
      } catch (err) {
        throw mapMfaError(ctx, 'auth.verifyMfaChallenge', err);
      }
    }),

  mfaStatus: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await new MfaService(ctx.db).status(ctx.userId);
    } catch (err) {
      throw mapMfaError(ctx, 'auth.mfaStatus', err);
    }
  }),

  beginMfaSetup: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      return await new MfaService(ctx.db).beginSetup(ctx.userId);
    } catch (err) {
      throw mapMfaError(ctx, 'auth.beginMfaSetup', err);
    }
  }),

  confirmMfaSetup: protectedProcedure
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await new MfaService(ctx.db).confirmSetup(ctx.userId, input.code);
      } catch (err) {
        throw mapMfaError(ctx, 'auth.confirmMfaSetup', err);
      }
    }),

  regenerateMfaRecoveryCodes: protectedProcedure
    .input(z.object({ code: mfaCode }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await new MfaService(ctx.db).regenerateRecoveryCodes(ctx.userId, input.code);
      } catch (err) {
        throw mapMfaError(ctx, 'auth.regenerateMfaRecoveryCodes', err);
      }
    }),

  disableMfa: protectedProcedure
    .input(z.object({ code: mfaCode }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await new MfaService(ctx.db).disable(ctx.userId, input.code);
      } catch (err) {
        throw mapMfaError(ctx, 'auth.disableMfa', err);
      }
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({
        externalId: users.externalId,
        email: users.email,
        phone: users.phone,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        plan: users.plan,
        planExpiresAt: users.planExpiresAt,
        selectedRoles: users.selectedRoles,
        role: users.role,
      })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!row) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }
    // Phase 14 audit follow-up — the per-user BrowserPool now serves
    // every authenticated user (no allow-list). When the pool is up,
    // every user gets their own Brave; the SPA's VNC viewer always
    // points at /vnc-ws/<userId>.
    const multiUser = ctx.browserPool != null;
    return {
      userId: row.externalId,
      email: row.email,
      phone: row.phone,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      plan: row.plan,
      planExpiresAt: row.planExpiresAt,
      multiUser,
      // Phase 10 Tier 2 — exposes the basic-plan user's selected
      // role ids (or null when never set). Drives the workbench's
      // "你还没选角色" onboarding banner; saves the SPA a separate
      // roles.list round-trip on every page load.
      selectedRoles: (row.selectedRoles ?? []) as string[],
      // Phase 27 — admin gate. SPA reads this to decide whether to
      // render the "管理后台" sidebar entry + the /admin guard.
      role: row.role as 'user' | 'admin',
      // Phase 1 #4 — video-creation gradual-rollout gate. The SPA reads
      // this to show/hide the「视频任务」sidebar entry + guard /video.
      // Single source with the tasks.ts fork (agent/video/video-access.ts).
      videoEnabled: isVideoEnabledFor(ctx.userId),
      teamProjectsEnabled: isTeamProjectsEnabledFor(ctx.userId),
      // Auth has no organization context, so expose only the nested
      // user/global eligibility. Organization-scoped callers additionally
      // require organizations.team_projects_enabled through the full helper.
      teamTaskLifecycleEnabled: isTeamTaskLifecycleEnabledForUser(ctx.userId),
    };
  }),
});

function maskUnexpectedAuthError(
  ctx: { logger?: { error: (obj: unknown, msg?: string) => void } },
  procedure: string,
  err: unknown,
): TRPCError {
  if (err instanceof TRPCError) return err;
  ctx.logger?.error(
    { procedure, err: err instanceof Error ? err.message : String(err) },
    'auth: unexpected error',
  );
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: '登录服务暂时不可用，请稍后重试。',
  });
}

function mapMfaError(
  ctx: { logger?: { error: (obj: unknown, msg?: string) => void } },
  procedure: string,
  err: unknown,
): TRPCError {
  if (err instanceof MfaError) {
    if (err.code === 'LOCKED') {
      return new TRPCError({ code: 'TOO_MANY_REQUESTS', message: err.message });
    }
    if (err.code === 'ALREADY_ENABLED') {
      return new TRPCError({ code: 'CONFLICT', message: err.message });
    }
    if (err.code === 'NOT_ENABLED' || err.code === 'SETUP_EXPIRED') {
      return new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
    }
    return new TRPCError({ code: 'UNAUTHORIZED', message: err.message });
  }
  return maskUnexpectedAuthError(ctx, procedure, err);
}
