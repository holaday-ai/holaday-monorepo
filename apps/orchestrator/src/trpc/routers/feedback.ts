import { randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type PrivateEmailSender, privateResendSender } from '../../auth/email-code.js';
import { feedbackCases } from '../../db/schema/feedback-cases.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * Feedback is stored in the governed relational source of truth. Resend is a
 * content-free case notification only: no identity, message, context, UA, or
 * provider error body may enter the inbox or operational logs.
 */
const submitInput = z.object({
  message: z.string().min(1).max(4_000),
  context: z.string().max(512).optional(),
});

const FEEDBACK_TO_EMAIL = process.env.FEEDBACK_TO_EMAIL ?? 'feedback@holaday.ai';

export interface FeedbackRouterDependencies {
  emailSender: PrivateEmailSender;
  createCaseRef: () => string;
}

export function createFeedbackRouter(dependencies: FeedbackRouterDependencies) {
  return router({
    submit: protectedProcedure.input(submitInput).mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const ua = (
        typeof (ctx as unknown as { req?: { headers?: Record<string, unknown> } }).req?.headers?.[
          'user-agent'
        ] === 'string'
          ? ((ctx as unknown as { req: { headers: { 'user-agent': string } } }).req.headers[
              'user-agent'
            ] as string)
          : '(unknown)'
      ).slice(0, 512);
      const caseRef = dependencies.createCaseRef();
      await ctx.db.insert(feedbackCases).values({
        externalId: caseRef,
        userId: userRow.id,
        message: input.message,
        context: input.context ?? null,
        userAgent: ua,
      });
      try {
        if (!dependencies.emailSender.isAvailable())
          throw new Error('private delivery unavailable');
        await dependencies.emailSender.send({
          to: FEEDBACK_TO_EMAIL,
          subject: `[HOLA DAY feedback] ${caseRef}`,
          text: `New governed feedback case: ${caseRef}`,
        });
        ctx.logger.info({ caseRef, status: 'accepted' }, 'feedback delivery status');
      } catch {
        ctx.logger.error({ caseRef, status: 'failed' }, 'feedback delivery status');
      }
      return { ok: true as const };
    }),
  });
}

export const feedbackRouter = createFeedbackRouter({
  emailSender: privateResendSender,
  createCaseRef: () => `fbc_${randomBytes(12).toString('hex')}`,
});
