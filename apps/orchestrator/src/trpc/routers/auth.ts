import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { AuthError, AuthService } from '../../auth/service.js';
import { publicProcedure, router } from '../trpc.js';

const registerInput = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(128).optional(),
});

const loginInput = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

export const authRouter = router({
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
});
