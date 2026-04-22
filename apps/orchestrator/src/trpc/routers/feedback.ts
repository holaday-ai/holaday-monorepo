import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { resendSender } from '../../auth/email-code.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * Collect in-app user feedback and forward it to ops via Resend. Very
 * thin: the message + optional context string (e.g. "task_id=xxx") +
 * the caller's email land in a single mail to FEEDBACK_TO_EMAIL. We
 * deliberately avoid persisting to the DB — the inbox is authoritative
 * and the whole feature is for the first couple hundred users.
 *
 * If Resend isn't configured, the mutation still returns ok=true — the
 * email helper logs the payload so the operator can read it out of
 * pm2 logs. Failing the mutation would frustrate users on a cold
 * dev env.
 */
const submitInput = z.object({
  message: z.string().min(1).max(4_000),
  context: z.string().max(512).optional(),
});

const FEEDBACK_TO_EMAIL =
  process.env.FEEDBACK_TO_EMAIL ?? 'feedback@holaday.ai';

export const feedbackRouter = router({
  submit: protectedProcedure.input(submitInput).mutation(async ({ ctx, input }) => {
    const [userRow] = await ctx.db
      .select({ email: users.email, externalId: users.externalId })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    const from = userRow?.email ?? '(unknown)';
    const ua =
      typeof (ctx as unknown as { req?: { headers?: Record<string, unknown> } }).req?.headers?.[
        'user-agent'
      ] === 'string'
        ? ((ctx as unknown as { req: { headers: { 'user-agent': string } } }).req.headers[
            'user-agent'
          ] as string)
        : '(unknown)';
    const text = [
      `From: ${from} (${userRow?.externalId ?? ctx.userId})`,
      `User-Agent: ${ua}`,
      input.context ? `Context: ${input.context}` : null,
      '',
      input.message,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await resendSender.send({
        to: FEEDBACK_TO_EMAIL,
        subject: `[HOLA DAY feedback] ${from}`,
        text,
      });
    } catch (err) {
      ctx.logger.error(
        { err, from, message: input.message.slice(0, 200) },
        'feedback: delivery failed — message logged above',
      );
      // Don't fail the mutation — we already have the payload in logs.
    }
    ctx.logger.info({ from, context: input.context ?? null }, 'feedback submitted');
    return { ok: true as const };
  }),
});
