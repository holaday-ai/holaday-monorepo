import { authRouter } from './routers/auth.js';
import { feedbackRouter } from './routers/feedback.js';
import { llmCallsRouter } from './routers/llm-calls.js';
import { paymentRouter } from './routers/payment.js';
import { tasksRouter } from './routers/tasks.js';
import { publicProcedure, router } from './trpc.js';

export const appRouter = router({
  health: publicProcedure.query(() => ({
    status: 'ok' as const,
    time: new Date().toISOString(),
  })),
  auth: authRouter,
  tasks: tasksRouter,
  llmCalls: llmCallsRouter,
  feedback: feedbackRouter,
  payment: paymentRouter,
});

export type AppRouter = typeof appRouter;
