import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { EmailCodeError, createEmailCodeService } from '../../auth/email-code.js';
import { AuthError, AuthService } from '../../auth/service.js';
import { users } from '../../db/schema/users.js';
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
  })),

  register: publicProcedure.input(registerInput).mutation(async ({ ctx, input }) => {
    const svc = new AuthService(ctx.db);
    try {
      return await svc.register(input);
    } catch (err) {
      if (err instanceof AuthError && err.code === 'EMAIL_TAKEN') {
        throw new TRPCError({ code: 'CONFLICT', message: err.message });
      }
      throw err;
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
      throw err;
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
    return await svc.loginOrRegisterByEmail(input.email);
  }),

  /**
   * Resolve the bearer token to the user's public profile. Powers the
   * sidebar's user card (real email + display name + plan) so we stop
   * hardcoding "Yalei / Free" for everyone.
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({
        externalId: users.externalId,
        email: users.email,
        displayName: users.displayName,
        plan: users.plan,
      })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!row) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }
    return {
      userId: row.externalId,
      email: row.email,
      displayName: row.displayName,
      plan: row.plan,
    };
  }),
});
